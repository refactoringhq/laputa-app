use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::Serialize;

use crate::vault;

use super::boundary::{with_boundary, with_validated_path, ValidatedPathMode};
use super::pdf_import_extract;

pub use super::pdf_import_extract::{
    ExternalToolSet, PageMarkdown, PageTextSource, PdfMarkdownOcrMode,
};

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct PdfMarkdownImportResult {
    pub note_path: String,
    pub note_title: String,
    pub page_count: Option<u32>,
    pub pages_text_extracted: u32,
    pub pages_ocr: u32,
    pub ocr_available: bool,
    pub text_length: usize,
}



#[tauri::command]
pub async fn convert_pdf_to_markdown_note(
    pdf_path: PathBuf,
    vault_path: Option<PathBuf>,
    ocr_mode: PdfMarkdownOcrMode,
    ocr_language: Option<String>,
) -> Result<PdfMarkdownImportResult, String> {
    tokio::task::spawn_blocking(move || {
        convert_pdf_to_markdown_note_blocking(pdf_path, vault_path, ocr_mode, ocr_language)
    })
    .await
    .map_err(|error| format!("Task panicked: {error}"))?
}

fn convert_pdf_to_markdown_note_blocking(
    pdf_path: PathBuf,
    vault_path: Option<PathBuf>,
    ocr_mode: PdfMarkdownOcrMode,
    ocr_language: Option<String>,
) -> Result<PdfMarkdownImportResult, String> {
    let raw_vault_path = pdf_import_extract::vault_path_string(vault_path.as_deref());
    let pdf_path = resolve_pdf_path(&raw_vault_path, &pdf_path)?;
    let tools = ExternalToolSet::detect();
    validate_import_tools(&tools, ocr_mode)?;
    let page_count = detect_page_count(&tools, &pdf_path, ocr_mode)?;
    let pages = pdf_import_extract::extract_pages(&pdf_path, ocr_mode, ocr_language.as_deref(), page_count, &tools)?;
    let (_vault_root, note_path, relative_pdf_path) = prepare_note_paths(raw_vault_path.as_deref(), &pdf_path)?;
    let title = pdf_import_extract::title_from_pdf_path(&pdf_path);
    let content = pdf_import_extract::build_markdown_note(pdf_import_extract::MarkdownNoteInput {
        title: &title,
        source_pdf: &relative_pdf_path,
        mode: ocr_mode,
        imported_at: &Utc::now().to_rfc3339(),
        page_count,
        pages: &pages,
    });
    vault::create_note_content(note_path.to_string_lossy().as_ref(), &content)?;
    Ok(build_import_result(&note_path, title, page_count, &pages, &tools))
}

fn resolve_pdf_path(raw_vault_path: &Option<String>, pdf_path: &Path) -> Result<PathBuf, String> {
    let raw = pdf_path.to_string_lossy().to_string();
    let validated = PathBuf::from(with_validated_path(&raw, raw_vault_path.as_deref(), ValidatedPathMode::Existing, |p| Ok(p.to_string()))?);
    pdf_import_extract::ensure_pdf_path(&validated)?;
    Ok(validated)
}

fn validate_import_tools(tools: &ExternalToolSet, mode: PdfMarkdownOcrMode) -> Result<(), String> {
    if !tools.pdftotext && mode != PdfMarkdownOcrMode::OcrAllPages {
        return Err("PDF text extraction requires pdftotext. Install Poppler to convert this PDF.".to_string());
    }
    if pdf_import_extract::requires_ocr(mode) && !tools.ocr_available() {
        return Err("OCR requires pdftoppm and tesseract. Install Poppler and Tesseract, or use text extraction only.".to_string());
    }
    Ok(())
}

fn detect_page_count(tools: &ExternalToolSet, pdf_path: &Path, mode: PdfMarkdownOcrMode) -> Result<Option<u32>, String> {
    let count = if tools.pdfinfo { pdf_import_extract::pdf_page_count(pdf_path)? } else { None };
    if pdf_import_extract::requires_ocr(mode) && count.is_none() {
        return Err("OCR requires pdfinfo so Tolaria can process pages safely. Install Poppler and try again.".to_string());
    }
    Ok(count)
}

fn prepare_note_paths(raw_vault_path: Option<&str>, pdf_path: &Path) -> Result<(PathBuf, PathBuf, String), String> {
    let vault_root = with_boundary(raw_vault_path, |b| Ok(b.requested_root().to_path_buf()))?;
    let relative_pdf_path = pdf_import_extract::relative_path_for_markdown(&vault_root, pdf_path)?;
    let note_path = pdf_import_extract::unique_note_path(&vault_root, pdf_path)?;
    Ok((vault_root, note_path, relative_pdf_path))
}

fn build_import_result(
    note_path: &Path,
    note_title: String,
    page_count: Option<u32>,
    pages: &[PageMarkdown],
    tools: &ExternalToolSet,
) -> PdfMarkdownImportResult {
    PdfMarkdownImportResult {
        note_path: note_path.to_string_lossy().to_string(),
        note_title,
        page_count,
        pages_text_extracted: pages.iter().filter(|p| p.source == PageTextSource::Embedded).count() as u32,
        pages_ocr: pages.iter().filter(|p| p.source == PageTextSource::Ocr).count() as u32,
        ocr_available: tools.ocr_available(),
        text_length: pages.iter().map(|p| p.text.len()).sum(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;
    use std::fs;

    #[test]
    fn page_quality_rejects_short_or_corrupt_text() {
        assert!(!pdf_import_extract::page_text_is_usable("short"));
        assert!(!pdf_import_extract::page_text_is_usable(&format!("{}{}", "a".repeat(100), "\u{fffd}".repeat(5))));
        assert!(pdf_import_extract::page_text_is_usable(&"Readable extracted paragraph. ".repeat(8)));
    }

    #[test]
    fn markdown_links_wrap_paths_with_spaces() {
        assert_eq!(pdf_import_extract::markdown_link_target("attachments/report.pdf"), "attachments/report.pdf");
        assert_eq!(pdf_import_extract::markdown_link_target("attachments/project brief.pdf"), "<attachments/project brief.pdf>");
    }

    #[test]
    fn generated_markdown_keeps_pdf_source_and_pages() {
        let pages = vec![
            PageMarkdown { page_number: 1, text: "Hello".to_string(), source: PageTextSource::Embedded },
            PageMarkdown { page_number: 2, text: "Scanned".to_string(), source: PageTextSource::Ocr },
        ];
        let markdown = pdf_import_extract::build_markdown_note(pdf_import_extract::MarkdownNoteInput {
            title: "Project Brief",
            source_pdf: "attachments/project brief.pdf",
            mode: PdfMarkdownOcrMode::OcrWhenNeeded,
            imported_at: "2026-06-06T12:00:00Z",
            page_count: Some(2),
            pages: &pages,
        });
        assert!(markdown.contains("source_pdf: \"attachments/project brief.pdf\""));
        assert!(markdown.contains("mode: ocr_when_needed"));
        assert!(markdown.contains("pages_text_extracted: 1"));
        assert!(markdown.contains("pages_ocr: 1"));
        assert!(markdown.contains("[Source PDF](<attachments/project brief.pdf>)"));
        assert!(markdown.contains("## Page 2\n\nScanned"));
    }

    #[test]
    fn note_path_uses_pdf_folder_and_avoids_collision() {
        let dir = tempfile::TempDir::new().unwrap();
        let pdf = dir.path().join("reports/Project Brief.pdf");
        fs::create_dir_all(pdf.parent().unwrap()).unwrap();
        fs::write(pdf.parent().unwrap().join("Project Brief.md"), "# Existing\n").unwrap();
        let note = pdf_import_extract::unique_note_path(dir.path(), &pdf).unwrap();
        assert_eq!(note.file_name().and_then(OsStr::to_str), Some("Project Brief 1.md"));
        assert_eq!(note.parent(), pdf.parent());
    }
}
