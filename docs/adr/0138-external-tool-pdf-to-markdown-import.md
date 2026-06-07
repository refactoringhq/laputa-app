---
type: ADR
id: "0138"
title: "External-tool PDF to Markdown import"
status: active
date: 2026-06-06
---

# ADR 0138: External-tool PDF to Markdown import

## Context

Tolaria already previews PDF files as ordinary binary vault files. Users also need to turn a PDF into an editable Markdown note while keeping the source PDF in the vault.

The robust path needs embedded text extraction and optional OCR. Bundling a PDF renderer and OCR runtime would add platform packaging work, larger app artifacts, and native dependency risk before the workflow has proven demand.

## Decision

Implement PDF to Markdown import as a vault command backed by runtime-detected external tools:

- `pdfinfo` reads page count when available.
- `pdftotext` extracts embedded PDF text.
- `pdftoppm` renders individual pages for OCR.
- `tesseract` performs OCR when the user chooses OCR modes.

The renderer exposes "Convert to note" for active PDF previews, PDF note-list context rows, and the command palette when the active item is a PDF. The command creates a separate Markdown note beside the PDF, links back to the source PDF, records import metadata in frontmatter, reloads the vault, and opens the created note. The source PDF is never modified.

## Consequences

- Users with Poppler can convert text PDFs without installing OCR tooling.
- OCR remains optional and fails with an actionable message when `pdftoppm` or `tesseract` is missing.
- Tolaria avoids shipping a native PDF/OCR stack in this iteration.
- The generated Markdown quality depends on the external tools and PDF structure.
- Future work can replace the external-tool backend with bundled PDFium/Vision/Tesseract if product usage justifies the packaging cost.
