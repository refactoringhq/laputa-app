use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use ironcalc_base::Model;
use regex::Regex;
use serde::{Deserialize, Serialize};

const SHEET_INDEX: u32 = 0;
const DEFAULT_MAX_DEPTH: usize = 4;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetDependencyContent {
    pub path: String,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetExternalReferenceLink {
    pub source_path: String,
    pub target: String,
    pub target_path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveSheetExternalFormulaInputsRequest {
    pub content: String,
    pub current_path: String,
    pub dependencies: Vec<SheetDependencyContent>,
    pub links: Vec<SheetExternalReferenceLink>,
    pub max_depth: Option<usize>,
    pub timezone: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSheetExternalFormulaInput {
    pub cell: String,
    pub evaluated: String,
    pub source: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveSheetExternalFormulaInputsResponse {
    pub inputs: Vec<ResolvedSheetExternalFormulaInput>,
}

#[tauri::command]
pub async fn resolve_sheet_external_formula_inputs(
    request: ResolveSheetExternalFormulaInputsRequest,
) -> Result<ResolveSheetExternalFormulaInputsResponse, String> {
    tokio::task::spawn_blocking(move || resolve_sheet_external_formula_inputs_sync(request))
        .await
        .map_err(|e| format!("Task panicked: {e}"))?
}

fn resolve_sheet_external_formula_inputs_sync(
    request: ResolveSheetExternalFormulaInputsRequest,
) -> Result<ResolveSheetExternalFormulaInputsResponse, String> {
    let mut resolver = ExternalFormulaResolver::new(request);
    resolver.resolve_current_sheet()
}

struct ExternalFormulaResolver {
    content_by_path: HashMap<String, String>,
    current_path: String,
    link_targets: HashMap<String, String>,
    max_depth: usize,
    sheet_literal_cache: HashMap<String, HashMap<String, String>>,
    timezone: String,
}

struct ResolveStack {
    depth: usize,
    paths: HashSet<String>,
}

struct SheetBuildInputs {
    external_inputs: HashMap<String, String>,
    unresolved_external_cells: HashSet<String>,
}

struct SheetRows<'a> {
    path: &'a str,
    rows: &'a [Vec<String>],
}

impl ResolveStack {
    fn new(root_path: &str) -> Self {
        Self {
            depth: 0,
            paths: HashSet::from([root_path.to_string()]),
        }
    }

    fn can_enter(&self, path: &str, max_depth: usize) -> bool {
        self.depth < max_depth && !self.paths.contains(path)
    }

    fn enter(&mut self, path: &str) {
        self.depth += 1;
        self.paths.insert(path.to_string());
    }

    fn exit(&mut self, path: &str) {
        self.depth = self.depth.saturating_sub(1);
        self.paths.remove(path);
    }
}

impl ExternalFormulaResolver {
    fn new(request: ResolveSheetExternalFormulaInputsRequest) -> Self {
        let mut content_by_path = HashMap::from([(request.current_path.clone(), request.content)]);
        for dependency in request.dependencies {
            content_by_path.insert(dependency.path, dependency.content);
        }

        let link_targets = request
            .links
            .into_iter()
            .map(|link| (link_key(&link.source_path, &link.target), link.target_path))
            .collect();

        Self {
            content_by_path,
            current_path: request.current_path,
            link_targets,
            max_depth: request.max_depth.unwrap_or(DEFAULT_MAX_DEPTH),
            sheet_literal_cache: HashMap::new(),
            timezone: request.timezone.unwrap_or_else(|| "UTC".to_string()),
        }
    }

    fn resolve_current_sheet(
        &mut self,
    ) -> Result<ResolveSheetExternalFormulaInputsResponse, String> {
        let content = self
            .content_by_path
            .get(&self.current_path)
            .cloned()
            .ok_or_else(|| "Current sheet content is missing".to_string())?;
        let rows = parse_sheet_rows(&content);
        let mut inputs = Vec::new();

        for (row_index, row) in rows.iter().enumerate() {
            for (column_index, value) in row.iter().enumerate() {
                let source = parse_sheet_markdown_cell_value(value);
                if !is_external_formula_input(&source) {
                    continue;
                }

                let mut stack = ResolveStack::new(&self.current_path);
                if let Some(evaluated) = self.resolve_external_formula_input(
                    &source,
                    &self.current_path.clone(),
                    &mut stack,
                )? {
                    inputs.push(ResolvedSheetExternalFormulaInput {
                        cell: cell_address(row_index + 1, column_index + 1),
                        evaluated,
                        source,
                    });
                }
            }
        }

        Ok(ResolveSheetExternalFormulaInputsResponse { inputs })
    }

    fn resolve_external_formula_input(
        &mut self,
        value: &str,
        source_path: &str,
        stack: &mut ResolveStack,
    ) -> Result<Option<String>, String> {
        if !is_external_formula_input(value) {
            return Ok(None);
        }

        let mut unresolved = false;
        let evaluated = external_ref_regex()
            .replace_all(value, |captures: &regex::Captures<'_>| {
                let raw_target = captures.get(1).map(|m| m.as_str()).unwrap_or_default();
                let column_absolute = captures.get(2).map(|m| m.as_str()).unwrap_or_default();
                let raw_column = captures.get(3).map(|m| m.as_str()).unwrap_or_default();
                let row_absolute = captures.get(4).map(|m| m.as_str()).unwrap_or_default();
                let raw_row = captures.get(5).map(|m| m.as_str()).unwrap_or_default();
                let target = wikilink_target(raw_target);
                let Some(target_path) = self
                    .link_targets
                    .get(&link_key(source_path, &target))
                    .cloned()
                else {
                    unresolved = true;
                    return captures[0].to_string();
                };

                if target_path == source_path {
                    return format!(
                        "{}{}{}{}",
                        column_absolute,
                        raw_column.to_ascii_uppercase(),
                        row_absolute,
                        raw_row,
                    );
                }

                let Some(row) = raw_row.parse::<usize>().ok() else {
                    unresolved = true;
                    return captures[0].to_string();
                };
                let Some(column) = column_index_from_name(raw_column) else {
                    unresolved = true;
                    return captures[0].to_string();
                };
                let address = cell_address(row, column);

                match self.resolve_external_cell_literal(&target_path, &address, stack) {
                    Ok(Some(literal)) => literal,
                    _ => {
                        unresolved = true;
                        captures[0].to_string()
                    }
                }
            })
            .to_string();

        if unresolved || evaluated == value {
            Ok(None)
        } else {
            Ok(Some(evaluated))
        }
    }

    fn resolve_external_cell_literal(
        &mut self,
        path: &str,
        address: &str,
        stack: &mut ResolveStack,
    ) -> Result<Option<String>, String> {
        if !stack.can_enter(path, self.max_depth) {
            return Ok(None);
        }

        if let Some(cached_sheet) = self.sheet_literal_cache.get(path) {
            return Ok(cached_sheet.get(address).cloned());
        }

        let Some(content) = self.content_by_path.get(path).cloned() else {
            return Ok(None);
        };

        stack.enter(path);
        let result = self.build_sheet_literal_cache(path, &content, stack);
        stack.exit(path);
        result?;

        Ok(self
            .sheet_literal_cache
            .get(path)
            .and_then(|sheet| sheet.get(address).cloned()))
    }

    fn build_sheet_literal_cache(
        &mut self,
        path: &str,
        content: &str,
        stack: &mut ResolveStack,
    ) -> Result<(), String> {
        let rows = parse_sheet_rows(content);
        let workbook_name = workbook_name_from_path(path);
        let timezone = self.timezone.clone();
        let mut model = Model::new_empty(workbook_name.as_str(), "en", timezone.as_str(), "en")?;

        let sheet_rows = SheetRows { path, rows: &rows };
        let build_inputs = self.populate_model_from_rows(&mut model, &sheet_rows, stack)?;
        model.evaluate();
        self.sheet_literal_cache.insert(
            path.to_string(),
            collect_sheet_literals(&model, &rows, &build_inputs),
        );
        Ok(())
    }

    fn populate_model_from_rows(
        &mut self,
        model: &mut Model<'_>,
        sheet_rows: &SheetRows<'_>,
        stack: &mut ResolveStack,
    ) -> Result<SheetBuildInputs, String> {
        let mut external_inputs = HashMap::<String, String>::new();
        let mut unresolved_external_cells = HashSet::<String>::new();

        for (row_index, row) in sheet_rows.rows.iter().enumerate() {
            for (column_index, value) in row.iter().enumerate() {
                let source = parse_sheet_markdown_cell_value(value);
                if source.is_empty() {
                    continue;
                }

                let address = cell_address(row_index + 1, column_index + 1);
                let model_input =
                    match self.resolve_external_formula_input(&source, sheet_rows.path, stack)? {
                        Some(evaluated) => {
                            external_inputs.insert(address, evaluated.clone());
                            evaluated
                        }
                        None => {
                            if is_external_formula_input(&source) {
                                unresolved_external_cells.insert(address);
                            }
                            source
                        }
                    };

                model.set_user_input(
                    SHEET_INDEX,
                    row_index as i32 + 1,
                    column_index as i32 + 1,
                    model_input,
                )?;
            }
        }

        Ok(SheetBuildInputs {
            external_inputs,
            unresolved_external_cells,
        })
    }
}

fn collect_sheet_literals(
    model: &Model<'_>,
    rows: &[Vec<String>],
    build_inputs: &SheetBuildInputs,
) -> HashMap<String, String> {
    let mut literals = HashMap::new();
    for (row_index, row) in rows.iter().enumerate() {
        collect_sheet_row_literals(model, row_index, row, build_inputs, &mut literals);
    }
    literals
}

fn collect_sheet_row_literals(
    model: &Model<'_>,
    row_index: usize,
    row: &[String],
    build_inputs: &SheetBuildInputs,
    literals: &mut HashMap<String, String>,
) {
    for (column_index, _value) in row.iter().enumerate() {
        let row_number = row_index as i32 + 1;
        let column_number = column_index as i32 + 1;
        let address = cell_address(row_index + 1, column_index + 1);
        if build_inputs.unresolved_external_cells.contains(&address) {
            continue;
        }
        let content = build_inputs
            .external_inputs
            .get(&address)
            .cloned()
            .unwrap_or_else(|| {
                model
                    .get_localized_cell_content(SHEET_INDEX, row_number, column_number)
                    .unwrap_or_default()
            });
        literals.insert(
            address,
            external_cell_formula_literal(model, row_number, column_number, &content),
        );
    }
}

fn external_ref_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[\[([^\]\n]+?)\]\]\.(\$?)([A-Za-z]+)(\$?)([1-9]\d*)").unwrap())
}

fn numeric_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$").unwrap())
}

fn percent_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^-?[$€£]?\s*[\d,]+(?:\.\d+)?%$").unwrap())
}

fn is_external_formula_input(value: &str) -> bool {
    value.trim_start().starts_with('=') && external_ref_regex().is_match(value)
}

fn normalize_target(target: &str) -> String {
    target.trim().to_lowercase()
}

fn wikilink_target(raw: &str) -> String {
    raw.split_once('|')
        .map(|(target, _)| target)
        .unwrap_or(raw)
        .to_string()
}

fn link_key(source_path: &str, target: &str) -> String {
    format!("{}\n{}", source_path, normalize_target(target))
}

fn workbook_name_from_path(path: &str) -> String {
    path.rsplit(['/', '\\'])
        .next()
        .unwrap_or("Tolaria Sheet")
        .trim_end_matches(".md")
        .to_string()
}

fn first_line_break_len(content: &str, index: usize) -> usize {
    let bytes = content.as_bytes();
    match (bytes.get(index), bytes.get(index + 1)) {
        (Some(b'\r'), Some(b'\n')) => 2,
        (Some(b'\n' | b'\r'), _) => 1,
        _ => 0,
    }
}

fn is_frontmatter_delimiter(line: &str) -> bool {
    line.strip_prefix("---")
        .map(|rest| rest.chars().all(|ch| ch == ' ' || ch == '\t'))
        .unwrap_or(false)
}

fn split_sheet_body(content: &str) -> &str {
    if !content.starts_with("---") {
        return content;
    }

    let opening_line_break = first_line_break_len(content, 3);
    if opening_line_break == 0 {
        return content;
    }

    let mut line_start = 3 + opening_line_break;
    while line_start < content.len() {
        let mut line_end = line_start;
        while line_end < content.len() && !matches!(content.as_bytes()[line_end], b'\n' | b'\r') {
            line_end += 1;
        }

        if is_frontmatter_delimiter(&content[line_start..line_end]) {
            let closing_line_break = first_line_break_len(content, line_end);
            return &content[line_end + closing_line_break..];
        }

        let line_break = first_line_break_len(content, line_end);
        if line_break == 0 {
            break;
        }
        line_start = line_end + line_break;
    }

    content
}

fn parse_sheet_rows(content: &str) -> Vec<Vec<String>> {
    parse_csv_rows(split_sheet_body(content).trim_end())
}

fn parse_csv_rows(source: &str) -> Vec<Vec<String>> {
    if source.is_empty() {
        return Vec::new();
    }

    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .has_headers(false)
        .from_reader(source.as_bytes());

    reader
        .records()
        .filter_map(Result::ok)
        .map(|record| record.iter().map(str::to_string).collect())
        .collect()
}

fn strip_symmetric_markup(value: &str, marker: &str) -> Option<String> {
    let inner = value.strip_prefix(marker)?.strip_suffix(marker)?;
    let formula_candidate = inner.trim_start_matches(['*', '_', '~']).trim_start();
    if formula_candidate.starts_with('=') || inner.is_empty() {
        return None;
    }
    Some(inner.to_string())
}

fn parse_sheet_markdown_cell_value(value: &str) -> String {
    if value.starts_with('=') {
        return value.to_string();
    }

    for marker in ["***", "**", "__", "_", "*", "~~"] {
        if let Some(inner) = strip_symmetric_markup(value, marker) {
            return inner;
        }
    }

    value.to_string()
}

fn column_index_from_name(name: &str) -> Option<usize> {
    let mut value = 0usize;
    for ch in name.chars() {
        if !ch.is_ascii_alphabetic() {
            return None;
        }
        value = value * 26 + (ch.to_ascii_uppercase() as usize - 'A' as usize + 1);
    }
    (value > 0).then_some(value)
}

fn column_name_from_index(mut index: usize) -> String {
    let mut name = String::new();
    while index > 0 {
        let remainder = (index - 1) % 26;
        name.insert(0, (b'A' + remainder as u8) as char);
        index = (index - 1) / 26;
    }
    name
}

fn cell_address(row: usize, column: usize) -> String {
    format!("{}{}", column_name_from_index(column), row)
}

fn normalized_numeric_formula_literal(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Some("0".to_string());
    }
    if numeric_regex().is_match(trimmed) {
        return Some(trimmed.to_string());
    }

    if percent_regex().is_match(trimmed) {
        let normalized = trimmed
            .chars()
            .filter(|ch| !matches!(ch, '$' | '€' | '£' | ',' | ' ' | '%'))
            .collect::<String>();
        if let Ok(parsed) = normalized.parse::<f64>() {
            return Some((parsed / 100.0).to_string());
        }
    }

    let normalized = trimmed
        .trim_start_matches(['$', '€', '£'])
        .trim_start()
        .replace(',', "");
    if numeric_regex().is_match(&normalized) {
        return Some(normalized);
    }

    None
}

fn text_formula_literal(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
    )
}

fn external_cell_formula_literal(
    model: &Model<'_>,
    row: i32,
    column: i32,
    raw_content: &str,
) -> String {
    if !raw_content.trim_start().starts_with('=') {
        return normalized_numeric_formula_literal(raw_content)
            .unwrap_or_else(|| text_formula_literal(raw_content));
    }

    let formatted = model
        .get_formatted_cell_value(SHEET_INDEX, row, column)
        .unwrap_or_default();
    normalized_numeric_formula_literal(&formatted)
        .unwrap_or_else(|| text_formula_literal(&formatted))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(
        content: &str,
        dependencies: Vec<SheetDependencyContent>,
        links: Vec<SheetExternalReferenceLink>,
    ) -> ResolveSheetExternalFormulaInputsRequest {
        ResolveSheetExternalFormulaInputsRequest {
            content: content.to_string(),
            current_path: "/vault/a.md".to_string(),
            dependencies,
            links,
            max_depth: Some(4),
            timezone: Some("UTC".to_string()),
        }
    }

    fn dependency(path: &str, content: &str) -> SheetDependencyContent {
        SheetDependencyContent {
            path: path.to_string(),
            content: content.to_string(),
        }
    }

    fn link(source_path: &str, target: &str, target_path: &str) -> SheetExternalReferenceLink {
        SheetExternalReferenceLink {
            source_path: source_path.to_string(),
            target: target.to_string(),
            target_path: target_path.to_string(),
        }
    }

    #[test]
    fn resolves_direct_external_formula_input() {
        let response = resolve_sheet_external_formula_inputs_sync(request(
            "Total\n=[[b]].A1+5",
            vec![dependency("/vault/b.md", "40")],
            vec![link("/vault/a.md", "b", "/vault/b.md")],
        ))
        .unwrap();

        assert_eq!(
            response.inputs,
            vec![ResolvedSheetExternalFormulaInput {
                cell: "A2".to_string(),
                evaluated: "=40+5".to_string(),
                source: "=[[b]].A1+5".to_string(),
            }],
        );
    }

    #[test]
    fn resolves_transitive_external_formula_input() {
        let response = resolve_sheet_external_formula_inputs_sync(request(
            "=[[b]].A1*2",
            vec![
                dependency("/vault/b.md", "=[[c]].A1+1"),
                dependency("/vault/c.md", "20"),
            ],
            vec![
                link("/vault/a.md", "b", "/vault/b.md"),
                link("/vault/b.md", "c", "/vault/c.md"),
            ],
        ))
        .unwrap();

        assert_eq!(response.inputs[0].evaluated, "=21*2");
    }

    #[test]
    fn leaves_cycles_unresolved() {
        let response = resolve_sheet_external_formula_inputs_sync(request(
            "=[[b]].A1",
            vec![dependency("/vault/b.md", "=[[a]].A1")],
            vec![
                link("/vault/a.md", "b", "/vault/b.md"),
                link("/vault/b.md", "a", "/vault/a.md"),
            ],
        ))
        .unwrap();

        assert!(response.inputs.is_empty());
    }
}
