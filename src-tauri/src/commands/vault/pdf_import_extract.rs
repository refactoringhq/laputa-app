use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PdfMarkdownOcrMode {
    TextOnly,
    OcrWhenNeeded,
    OcrAllPages,
}

#[derive(Debug)]
pub struct PageMarkdown {
    pub page_number: u32,
    pub text: String,
    pub source: PageTextSource,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PageTextSource {
    Embedded,
    Ocr,
    Empty,
}

pub struct ExternalToolSet {
    pub pdfinfo: bool,
    pub pdftotext: bool,
    pub pdftoppm: bool,
    pub tesseract: bool,
}

impl ExternalToolSet {
    pub fn detect() -> Self {
        Self {
            pdfinfo: command_available("pdfinfo"),
            pdftotext: command_available("pdftotext"),
            pdftoppm: command_available("pdftoppm"),
            tesseract: command_available("tesseract"),
        }
    }

    pub fn ocr_available(&self) -> bool {
        self.pdftoppm && self.tesseract
    }
}

const MIN_PAGE_TEXT_CHARS: usize = 80;
const MAX_REPLACEMENT_CHAR_RATIO: f32 = 0.02;

pub fn ensure_pdf_path(path: &Path) -> Result<(), String> {
    let ext = path.extension().and_then(OsStr::to_str).unwrap_or_default();
    if ext.eq_ignore_ascii_case("pdf") {
        Ok(())
    } else {
        Err("Only PDF files can be converted to Markdown notes.".to_string())
    }
}

pub fn requires_ocr(mode: PdfMarkdownOcrMode) -> bool {
    mode != PdfMarkdownOcrMode::TextOnly
}

pub fn vault_path_string(path: Option<&Path>) -> Option<String> {
    path.map(|v| v.to_string_lossy().to_string())
}

pub fn command_available(program: &str) -> bool {
    Command::new(program).arg("--version").output().is_ok()
}

pub fn command_stdout(program: &str, args: &[String]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run {program}: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("{program} failed with status {}", output.status)
        } else {
            stderr
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn pdf_page_count(path: &Path) -> Result<Option<u32>, String> {
    let output = command_stdout("pdfinfo", &[path.to_string_lossy().to_string()])?;
    Ok(output.lines().find_map(|line| {
        let v = line.strip_prefix("Pages:")?.trim();
        v.parse::<u32>().ok()
    }))
}

pub fn extract_pages(
    path: &Path,
    mode: PdfMarkdownOcrMode,
    language: Option<&str>,
    page_count: Option<u32>,
    tools: &ExternalToolSet,
) -> Result<Vec<PageMarkdown>, String> {
    match page_count {
        Some(count) => (1..=count).map(|p| extract_page(path, mode, language, p, tools)).collect(),
        None => Ok(vec![PageMarkdown {
            page_number: 1,
            text: extract_all_embedded_text(path)?,
            source: PageTextSource::Embedded,
        }]),
    }
}

fn extract_page(
    path: &Path,
    mode: PdfMarkdownOcrMode,
    language: Option<&str>,
    page_number: u32,
    tools: &ExternalToolSet,
) -> Result<PageMarkdown, String> {
    let embedded = if tools.pdftotext { extract_embedded_text_page(path, page_number)? } else { String::new() };
    let use_ocr = match mode {
        PdfMarkdownOcrMode::TextOnly => false,
        PdfMarkdownOcrMode::OcrAllPages => true,
        PdfMarkdownOcrMode::OcrWhenNeeded => !page_text_is_usable(&embedded),
    };
    if use_ocr {
        let text = ocr_page(path, page_number, language)?;
        return Ok(PageMarkdown { page_number, source: if text.trim().is_empty() { PageTextSource::Empty } else { PageTextSource::Ocr }, text });
    }
    Ok(PageMarkdown { page_number, source: if embedded.trim().is_empty() { PageTextSource::Empty } else { PageTextSource::Embedded }, text: embedded })
}

pub fn extract_all_embedded_text(path: &Path) -> Result<String, String> {
    command_stdout("pdftotext", &["-layout".to_string(), "-enc".to_string(), "UTF-8".to_string(), path.to_string_lossy().to_string(), "-".to_string()]).map(normalize_extracted_text)
}

pub fn extract_embedded_text_page(path: &Path, page_number: u32) -> Result<String, String> {
    command_stdout("pdftotext", &["-layout".to_string(), "-enc".to_string(), "UTF-8".to_string(), "-f".to_string(), page_number.to_string(), "-l".to_string(), page_number.to_string(), path.to_string_lossy().to_string(), "-".to_string()]).map(normalize_extracted_text)
}

pub fn ocr_page(path: &Path, page_number: u32, language: Option<&str>) -> Result<String, String> {
    let dir = tempfile::tempdir().map_err(|e| format!("Failed to create OCR temp dir: {e}"))?;
    let prefix = dir.path().join("page");
    command_stdout("pdftoppm", &["-f".to_string(), page_number.to_string(), "-l".to_string(), page_number.to_string(), "-r".to_string(), "200".to_string(), "-png".to_string(), path.to_string_lossy().to_string(), prefix.to_string_lossy().to_string()])?;
    let image_path = find_rendered_page(dir.path())?;
    let mut args = vec![image_path.to_string_lossy().to_string(), "stdout".to_string()];
    if let Some(lang) = language.filter(|v| !v.trim().is_empty()) {
        args.push("-l".to_string());
        args.push(lang.trim().to_string());
    }
    command_stdout("tesseract", &args).map(normalize_extracted_text)
}

fn find_rendered_page(dir: &Path) -> Result<PathBuf, String> {
    fs::read_dir(dir)
        .map_err(|e| format!("Failed to read OCR temp dir: {e}"))?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .find(|p| p.extension().and_then(OsStr::to_str).is_some_and(|ext| ext.eq_ignore_ascii_case("png")))
        .ok_or_else(|| "PDF page rendering did not produce an image for OCR.".to_string())
}

pub fn normalize_extracted_text(text: String) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n").lines().map(str::trim_end).collect::<Vec<_>>().join("\n").trim().to_string()
}

pub fn page_text_is_usable(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.chars().count() < MIN_PAGE_TEXT_CHARS { return false; }
    let total = trimmed.chars().count();
    let replacement = trimmed.chars().filter(|ch| *ch == '\u{fffd}').count();
    (replacement as f32 / total as f32) <= MAX_REPLACEMENT_CHAR_RATIO
}

pub fn title_from_pdf_path(path: &Path) -> String {
    path.file_stem()
        .and_then(OsStr::to_str)
        .map(title_from_stem)
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| "Imported PDF".to_string())
}

fn title_from_stem(stem: &str) -> String {
    stem.replace(['_', '-'], " ").split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn markdown_link_target(path: &str) -> String {
    if path.contains(char::is_whitespace) { format!("<{}>", path.replace('>', "%3E")) } else { path.to_string() }
}

pub fn relative_path_for_markdown(root: &Path, path: &Path) -> Result<String, String> {
    path.strip_prefix(root)
        .map_err(|_| "PDF path must stay inside the vault.".to_string())
        .map(|r| r.to_string_lossy().replace('\\', "/"))
}

pub fn unique_note_path(root: &Path, pdf_path: &Path) -> Result<PathBuf, String> {
    let parent = pdf_path.parent().unwrap_or(root);
    let stem = pdf_path.file_stem().and_then(OsStr::to_str).unwrap_or("Imported PDF");
    for index in 0..1000 {
        let filename = if index == 0 { format!("{stem}.md") } else { format!("{stem} {index}.md") };
        let candidate = parent.join(filename);
        if !candidate.exists() { return Ok(candidate); }
    }
    Err("Could not find an available Markdown filename for the imported PDF.".to_string())
}

pub struct MarkdownNoteInput<'a> {
    pub title: &'a str,
    pub source_pdf: &'a str,
    pub mode: PdfMarkdownOcrMode,
    pub imported_at: &'a str,
    pub page_count: Option<u32>,
    pub pages: &'a [PageMarkdown],
}

pub fn build_markdown_note(input: MarkdownNoteInput<'_>) -> String {
    let pages = input.page_count.map_or_else(|| "null".to_string(), |v| v.to_string());
    let pages_text_extracted = input.pages.iter().filter(|p| p.source == PageTextSource::Embedded).count();
    let pages_ocr = input.pages.iter().filter(|p| p.source == PageTextSource::Ocr).count();
    let mut markdown = format!(
        "---\ntype: Note\nsource_pdf: \"{src}\"\npdf_import:\n  mode: {mode}\n  imported_at: \"{at}\"\n  pages: {pages}\n  pages_text_extracted: {extracted}\n  pages_ocr: {ocr}\n---\n\n# {title}\n\n[Source PDF]({link})\n",
        src = yaml_escape(input.source_pdf),
        mode = ocr_mode_key(input.mode),
        at = yaml_escape(input.imported_at),
        pages = pages,
        extracted = pages_text_extracted,
        ocr = pages_ocr,
        title = input.title,
        link = markdown_link_target(input.source_pdf),
    );
    for page in input.pages {
        markdown.push_str(&format!("\n## Page {}\n\n", page.page_number));
        if page.text.trim().is_empty() { markdown.push_str("_No text extracted from this page._\n"); }
        else { markdown.push_str(page.text.trim()); markdown.push('\n'); }
    }
    markdown
}

fn yaml_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn ocr_mode_key(mode: PdfMarkdownOcrMode) -> &'static str {
    match mode {
        PdfMarkdownOcrMode::TextOnly => "text_only",
        PdfMarkdownOcrMode::OcrWhenNeeded => "ocr_when_needed",
        PdfMarkdownOcrMode::OcrAllPages => "ocr_all_pages",
    }
}
