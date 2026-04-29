use std::fs;
use std::io::{Error, ErrorKind, Write};
use std::path::Path;
use std::time::UNIX_EPOCH;

/// Read file metadata (modified_at timestamp, created_at timestamp, file size).
/// Creation time is sourced from filesystem metadata (birthtime on macOS).
pub(crate) fn read_file_metadata(path: &Path) -> Result<(Option<u64>, Option<u64>, u64), String> {
    let metadata =
        fs::metadata(path).map_err(|e| format!("Failed to stat {}: {}", path.display(), e))?;
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    let created_at = metadata
        .created()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    Ok((modified_at, created_at, metadata.len()))
}

fn invalid_utf8_text_error(path: &Path) -> String {
    format!("File is not valid UTF-8 text: {}", path.display())
}

fn is_invalid_platform_path_error(error: &Error) -> bool {
    error.kind() == ErrorKind::InvalidInput || error.raw_os_error() == Some(123)
}

fn read_existing_note_bytes(path: &Path) -> Result<Vec<u8>, String> {
    if !path.exists() {
        return Err(format!("File does not exist: {}", path.display()));
    }
    if !path.is_file() {
        return Err(format!("Path is not a file: {}", path.display()));
    }
    fs::read(path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))
}

#[derive(Clone, Copy)]
enum NoteIoOperation {
    Save,
    Create,
}

#[derive(Clone, Copy)]
struct NotePathDisplay<'a> {
    value: &'a str,
}

impl<'a> NotePathDisplay<'a> {
    fn new(value: &'a str) -> Self {
        Self { value }
    }
}

impl NoteIoOperation {
    fn verb(self) -> &'static str {
        match self {
            Self::Save => "save",
            Self::Create => "create",
        }
    }
}

fn note_io_error(operation: NoteIoOperation, path: NotePathDisplay<'_>, error: &Error) -> String {
    let verb = operation.verb();
    if is_invalid_platform_path_error(error) {
        let path = path.value;
        format!(
            "Failed to {verb} note: the path is invalid on this platform. Rename the note or move it to a valid folder, then try again. Path: {path}"
        )
    } else {
        let path = path.value;
        format!("Failed to {verb} {path}: {error}")
    }
}

/// Read the content of a single note file.
pub fn get_note_content(path: &Path) -> Result<String, String> {
    let bytes = read_existing_note_bytes(path)?;
    String::from_utf8(bytes).map_err(|_| invalid_utf8_text_error(path))
}

/// Check whether a note still has the exact content the renderer cached.
pub fn note_content_matches(path: &Path, expected_content: &str) -> Result<bool, String> {
    let bytes = read_existing_note_bytes(path)?;
    Ok(bytes == expected_content.as_bytes())
}

fn validate_save_path(file_path: &Path, display_path: &str) -> Result<(), String> {
    let parent_missing = file_path.parent().is_some_and(|p| !p.exists());
    if parent_missing {
        return Err(format!(
            "Parent directory does not exist: {}",
            file_path.parent().unwrap().display()
        ));
    }
    let is_readonly = file_path.exists()
        && file_path
            .metadata()
            .map(|m| m.permissions().readonly())
            .unwrap_or(false);
    if is_readonly {
        return Err(format!("File is read-only: {}", display_path));
    }
    Ok(())
}

/// Write content to a note file. Creates parent directory if needed, validates path,
/// then writes content to disk.
pub fn save_note_content(path: &str, content: &str) -> Result<(), String> {
    let file_path = Path::new(path);
    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| {
                note_io_error(NoteIoOperation::Save, NotePathDisplay::new(path), &e)
            })?;
        }
    }
    validate_save_path(file_path, path)?;
    fs::write(file_path, content)
        .map_err(|e| note_io_error(NoteIoOperation::Save, NotePathDisplay::new(path), &e))
}

/// Create a new note file without overwriting any existing file.
pub fn create_note_content(path: &str, content: &str) -> Result<(), String> {
    let file_path = Path::new(path);
    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| {
                note_io_error(NoteIoOperation::Create, NotePathDisplay::new(path), &e)
            })?;
        }
    }
    validate_save_path(file_path, path)?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(file_path)
        .map_err(|e| match e.kind() {
            ErrorKind::AlreadyExists => format!("File already exists: {}", path),
            _ => note_io_error(NoteIoOperation::Create, NotePathDisplay::new(path), &e),
        })?;
    file.write_all(content.as_bytes())
        .map_err(|e| note_io_error(NoteIoOperation::Save, NotePathDisplay::new(path), &e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_windows_invalid_path_syntax_as_recoverable_save_error() {
        let path = r"C:\Users\@raflymln\notes\untitled-note-1777236475.md";
        let message = note_io_error(
            NoteIoOperation::Save,
            NotePathDisplay::new(path),
            &Error::from_raw_os_error(123),
        );

        assert!(message.contains("path is invalid on this platform"));
        assert!(message.contains("Rename the note or move it to a valid folder"));
        assert!(!message.contains("os error 123"));
    }

    #[test]
    fn note_content_matches_detects_external_edits() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, "# Fresh\n").unwrap();

        assert!(note_content_matches(&path, "# Fresh\n").unwrap());
        assert!(!note_content_matches(&path, "# Stale\n").unwrap());
    }
}
