use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Instant;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Clone)]
pub struct SearchResult {
    pub title: String,
    pub path: String,
    pub snippet: String,
    pub score: f64,
    pub note_type: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    pub elapsed_ms: u64,
    pub query: String,
    pub mode: String,
}

pub struct SearchOptions<'a> {
    pub vault_path: &'a str,
    pub query: &'a str,
    pub mode: &'a str,
    pub limit: usize,
    pub hide_gitignored_files: bool,
}

fn extract_snippet(content: &str, query_lower: &str) -> String {
    let content_lower = content.to_lowercase();
    let pos = match content_lower.find(query_lower) {
        Some(p) => p,
        None => return String::new(),
    };
    let start = content[..pos]
        .rfind('\n')
        .map(|i| i + 1)
        .unwrap_or(pos.saturating_sub(60));
    let end = content[pos..]
        .find('\n')
        .map(|i| pos + i)
        .unwrap_or_else(|| (pos + 120).min(content.len()));
    let snippet = &content[start..end];
    if snippet.len() > 200 {
        format!("{}…", &snippet[..200])
    } else {
        snippet.to_string()
    }
}

fn score_match(title_lower: &str, content_lower: &str, query_lower: &str) -> f64 {
    let title_exact = title_lower.contains(query_lower);
    let title_word = title_lower.split_whitespace().any(|w| w == query_lower);
    let content_count = content_lower.matches(query_lower).count();

    let mut score = 0.0;
    if title_word {
        score += 10.0;
    } else if title_exact {
        score += 5.0;
    }
    score += (content_count as f64).min(20.0) * 0.5;
    score
}

pub fn search_vault(
    vault_path: &str,
    query: &str,
    _mode: &str,
    limit: usize,
) -> Result<SearchResponse, String> {
    search_vault_with_options(SearchOptions {
        vault_path,
        query,
        mode: _mode,
        limit,
        hide_gitignored_files: crate::settings::hide_gitignored_files_enabled(),
    })
}

fn is_markdown_search_candidate(path: &Path) -> bool {
    if !path.extension().is_some_and(|ext| ext == "md") {
        return false;
    }

    !path
        .components()
        .any(|component| component.as_os_str().to_string_lossy().starts_with('.'))
}

fn collect_markdown_paths(vault_dir: &Path, hide_gitignored_files: bool) -> Vec<PathBuf> {
    let paths = WalkDir::new(vault_dir)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.into_path())
        .filter(|path| is_markdown_search_candidate(path))
        .collect::<Vec<_>>();

    crate::vault::filter_gitignored_paths(vault_dir, paths, hide_gitignored_files)
}

pub fn search_vault_with_options(options: SearchOptions<'_>) -> Result<SearchResponse, String> {
    let start = Instant::now();
    let query_lower = options.query.to_lowercase();
    let vault_dir = Path::new(options.vault_path);

    let mut results: Vec<SearchResult> = Vec::new();

    for path in collect_markdown_paths(vault_dir, options.hide_gitignored_files) {
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let content_lower = content.to_lowercase();
        let filename = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        let title = crate::vault::derive_markdown_title_from_content(&content, filename);
        let title_lower = title.to_lowercase();

        if !title_lower.contains(&query_lower) && !content_lower.contains(&query_lower) {
            continue;
        }

        let score = score_match(&title_lower, &content_lower, &query_lower);
        let snippet = extract_snippet(&content, &query_lower);
        let full_path = path.to_string_lossy().to_string();

        results.push(SearchResult {
            title,
            path: full_path,
            snippet,
            score,
            note_type: None,
        });
    }

    results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results.truncate(options.limit);

    let elapsed_ms = start.elapsed().as_millis() as u64;

    Ok(SearchResponse {
        results,
        elapsed_ms,
        query: options.query.to_string(),
        mode: options.mode.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::Builder;

    fn init_git_repo(root: &Path) {
        crate::hidden_command("git")
            .args(["init"])
            .current_dir(root)
            .output()
            .unwrap();
    }

    #[test]
    fn test_extract_snippet_basic() {
        let content = "line one\nline with keyword here\nline three";
        let snippet = extract_snippet(content, "keyword");
        assert!(snippet.contains("keyword"));
    }

    #[test]
    fn test_extract_snippet_no_match() {
        let snippet = extract_snippet("nothing here", "missing");
        assert!(snippet.is_empty());
    }

    #[test]
    fn test_score_match_title_word() {
        let score = score_match("my keyword", "", "keyword");
        assert!(score >= 10.0);
    }

    #[test]
    fn test_score_match_content_only() {
        let score = score_match("unrelated", "some keyword text keyword", "keyword");
        assert!(score > 0.0);
        assert!(score < 10.0);
    }

    #[test]
    fn test_extract_snippet_long() {
        let long_line = "a".repeat(300);
        let content = format!("start\n{}keyword{}\nend", long_line, long_line);
        let snippet = extract_snippet(&content, "keyword");
        assert!(snippet.len() <= 203); // 200 + "…" (3 bytes UTF-8)
    }

    #[test]
    fn test_search_vault_uses_h1_for_result_title() {
        let dir = Builder::new()
            .prefix("search-vault-")
            .tempdir_in(std::env::current_dir().unwrap())
            .unwrap();
        let note_path = dir.path().join("legacy-name.md");
        fs::write(
            &note_path,
            "# Updated Display Title\n\nThe body contains keyword for search.",
        )
        .unwrap();

        let response =
            search_vault(dir.path().to_str().unwrap(), "keyword", "keyword", 10).unwrap();

        assert_eq!(response.results.len(), 1);
        assert_eq!(response.results[0].title, "Updated Display Title");
    }

    #[test]
    fn test_search_vault_hides_gitignored_notes_when_enabled() {
        let dir = Builder::new()
            .prefix("search-gitignored-")
            .tempdir_in(std::env::current_dir().unwrap())
            .unwrap();
        init_git_repo(dir.path());
        fs::create_dir_all(dir.path().join("ignored")).unwrap();
        fs::write(dir.path().join(".gitignore"), "ignored/\n").unwrap();
        fs::write(dir.path().join("visible.md"), "# Visible\n\nneedle").unwrap();
        fs::write(dir.path().join("ignored/hidden.md"), "# Hidden\n\nneedle").unwrap();

        let hidden = search_vault_with_options(SearchOptions {
            vault_path: dir.path().to_str().unwrap(),
            query: "needle",
            mode: "keyword",
            limit: 10,
            hide_gitignored_files: true,
        })
        .unwrap();
        let shown = search_vault_with_options(SearchOptions {
            vault_path: dir.path().to_str().unwrap(),
            query: "needle",
            mode: "keyword",
            limit: 10,
            hide_gitignored_files: false,
        })
        .unwrap();

        assert_eq!(hidden.results.len(), 1);
        assert_eq!(hidden.results[0].title, "Visible");
        assert_eq!(shown.results.len(), 2);
    }
}
