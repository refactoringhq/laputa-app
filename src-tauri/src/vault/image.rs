use crate::settings::normalize_vault_relative_folder;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

/// Check if a character is safe for use in filenames (alphanumeric, dot, dash, underscore).
fn is_safe_filename_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '.' | '-' | '_')
}

/// Sanitize a filename by replacing unsafe characters with underscores.
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| if is_safe_filename_char(c) { c } else { '_' })
        .collect()
}

/// Default folder for media when the user has not configured a custom one.
pub const DEFAULT_MEDIA_FOLDER: &str = "attachments";

/// Image file extensions considered valid for drag-drop import.
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "tiff"];

/// Video file extensions considered valid for drag-drop import.
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mov", "webm", "mkv", "avi", "m4v"];

/// Resolve the destination folder for a media write. Falls back to `DEFAULT_MEDIA_FOLDER`
/// when the input is empty, missing, or rejected by `normalize_vault_relative_folder`.
fn resolve_media_folder(folder: Option<&str>) -> String {
    normalize_vault_relative_folder(folder).unwrap_or_else(|| DEFAULT_MEDIA_FOLDER.to_string())
}

/// Prepare the destination directory and generate a unique target path inside it.
fn prepare_media_path(
    vault_path: &str,
    folder: Option<&str>,
    filename: &str,
) -> Result<std::path::PathBuf, String> {
    let resolved = resolve_media_folder(folder);
    let target_dir = Path::new(vault_path).join(&resolved);
    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Failed to create media directory {}: {}", resolved, e))?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let unique_name = format!("{}-{}", timestamp, sanitize_filename(filename));
    Ok(target_dir.join(unique_name))
}

fn copy_into_vault(
    vault_path: &str,
    folder: Option<&str>,
    source_path: &str,
    allowed_extensions: &[&str],
    kind_label: &str,
) -> Result<String, String> {
    let source = Path::new(source_path);
    if !source.exists() {
        return Err(format!("Source file does not exist: {}", source_path));
    }

    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !allowed_extensions.contains(&ext.as_str()) {
        return Err(format!(
            "Not a supported {} format: {}",
            kind_label, source_path
        ));
    }

    let filename = source
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(kind_label);
    let target_path = prepare_media_path(vault_path, folder, filename)?;

    fs::copy(source, &target_path).map_err(|e| format!("Failed to copy {}: {}", kind_label, e))?;

    Ok(target_path.to_string_lossy().to_string())
}

fn save_base64(
    vault_path: &str,
    folder: Option<&str>,
    filename: &str,
    data: &str,
    kind_label: &str,
) -> Result<String, String> {
    use base64::Engine;

    let target_path = prepare_media_path(vault_path, folder, filename)?;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("Invalid base64 data: {}", e))?;

    fs::write(&target_path, bytes).map_err(|e| format!("Failed to write {}: {}", kind_label, e))?;

    Ok(target_path.to_string_lossy().to_string())
}

/// Save an uploaded image into the resolved media folder.
/// Returns the absolute path to the saved file.
pub fn save_image(
    vault_path: &str,
    folder: Option<&str>,
    filename: &str,
    data: &str,
) -> Result<String, String> {
    save_base64(vault_path, folder, filename, data, "image")
}

/// Copy an image file from `source_path` into the resolved media folder.
/// Used for Tauri native drag-drop which provides absolute file paths.
/// Returns the absolute path to the saved file.
pub fn copy_image_to_vault(
    vault_path: &str,
    folder: Option<&str>,
    source_path: &str,
) -> Result<String, String> {
    copy_into_vault(vault_path, folder, source_path, IMAGE_EXTENSIONS, "image")
}

/// Save an uploaded video into the resolved media folder.
/// Returns the absolute path to the saved file.
pub fn save_video(
    vault_path: &str,
    folder: Option<&str>,
    filename: &str,
    data: &str,
) -> Result<String, String> {
    save_base64(vault_path, folder, filename, data, "video")
}

/// Copy a video file from `source_path` into the resolved media folder.
pub fn copy_video_to_vault(
    vault_path: &str,
    folder: Option<&str>,
    source_path: &str,
) -> Result<String, String> {
    copy_into_vault(vault_path, folder, source_path, VIDEO_EXTENSIONS, "video")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_sanitize_filename_safe_chars() {
        assert_eq!(sanitize_filename("photo.png"), "photo.png");
        assert_eq!(sanitize_filename("my-image_01.jpg"), "my-image_01.jpg");
    }

    #[test]
    fn test_sanitize_filename_unsafe_chars() {
        assert_eq!(sanitize_filename("my file (1).png"), "my_file__1_.png");
        assert_eq!(sanitize_filename("path/to/img.png"), "path_to_img.png");
    }

    #[test]
    fn test_resolve_media_folder_falls_back_to_default() {
        assert_eq!(resolve_media_folder(None), "attachments");
        assert_eq!(resolve_media_folder(Some("")), "attachments");
        assert_eq!(resolve_media_folder(Some("../escape")), "attachments");
    }

    #[test]
    fn test_resolve_media_folder_uses_user_value() {
        assert_eq!(resolve_media_folder(Some("Media/Images")), "Media/Images");
        assert_eq!(
            resolve_media_folder(Some("  /Media/Videos/  ")),
            "Media/Videos"
        );
    }

    #[test]
    fn test_save_image_creates_file_in_default_folder() {
        use base64::Engine;

        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();
        let data = base64::engine::general_purpose::STANDARD.encode(b"fake image data");

        let saved_path = save_image(vault_path, None, "test.png", &data).unwrap();
        assert!(std::path::Path::new(&saved_path).exists());
        assert!(saved_path.contains("attachments"));
        assert!(saved_path.contains("test.png"));
        assert_eq!(fs::read(&saved_path).unwrap(), b"fake image data");
    }

    #[test]
    fn test_save_image_creates_file_in_custom_folder() {
        use base64::Engine;

        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();
        let data = base64::engine::general_purpose::STANDARD.encode(b"png bytes");

        let saved_path = save_image(vault_path, Some("Media/Images"), "shot.png", &data).unwrap();
        assert!(std::path::Path::new(&saved_path).exists());
        assert!(saved_path.contains("Media/Images"));
    }

    #[test]
    fn test_save_image_creates_attachments_dir_when_missing() {
        use base64::Engine;

        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();
        assert!(!dir.path().join("attachments").exists());

        let data = base64::engine::general_purpose::STANDARD.encode(b"test");
        save_image(vault_path, None, "img.png", &data).unwrap();
        assert!(dir.path().join("attachments").exists());
    }

    #[test]
    fn test_save_image_invalid_base64() {
        let dir = TempDir::new().unwrap();
        let result = save_image(
            dir.path().to_str().unwrap(),
            None,
            "test.png",
            "not!!!base64",
        );
        assert!(result.unwrap_err().contains("Invalid base64"));
    }

    #[test]
    fn test_copy_image_to_vault_success() {
        let dir = TempDir::new().unwrap();
        let source_path = dir.path().join("source.png");
        fs::write(&source_path, b"fake png data").unwrap();

        let saved_path = copy_image_to_vault(
            dir.path().to_str().unwrap(),
            None,
            source_path.to_str().unwrap(),
        )
        .unwrap();
        assert!(std::path::Path::new(&saved_path).exists());
        assert!(saved_path.contains("attachments"));
        assert_eq!(fs::read(&saved_path).unwrap(), b"fake png data");
    }

    #[test]
    fn test_copy_image_to_vault_uses_custom_folder() {
        let dir = TempDir::new().unwrap();
        let source_path = dir.path().join("hero.jpg");
        fs::write(&source_path, b"jpg data").unwrap();

        let saved_path = copy_image_to_vault(
            dir.path().to_str().unwrap(),
            Some("Media/Images"),
            source_path.to_str().unwrap(),
        )
        .unwrap();
        assert!(saved_path.contains("Media/Images"));
        assert!(dir.path().join("Media/Images").exists());
    }

    #[test]
    fn test_copy_image_to_vault_nonexistent_source() {
        let dir = TempDir::new().unwrap();
        let result =
            copy_image_to_vault(dir.path().to_str().unwrap(), None, "/nonexistent/photo.png");
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn test_copy_image_to_vault_rejects_non_image() {
        let dir = TempDir::new().unwrap();
        let source_path = dir.path().join("document.pdf");
        fs::write(&source_path, b"fake pdf").unwrap();

        let result = copy_image_to_vault(
            dir.path().to_str().unwrap(),
            None,
            source_path.to_str().unwrap(),
        );
        assert!(result.unwrap_err().contains("Not a supported image"));
    }

    #[test]
    fn test_copy_image_to_vault_accepts_all_image_extensions() {
        let dir = TempDir::new().unwrap();
        for ext in IMAGE_EXTENSIONS {
            let source_path = dir.path().join(format!("img.{}", ext));
            fs::write(&source_path, b"data").unwrap();
            let result = copy_image_to_vault(
                dir.path().to_str().unwrap(),
                None,
                source_path.to_str().unwrap(),
            );
            assert!(result.is_ok(), "failed for extension: {}", ext);
        }
    }

    #[test]
    fn test_save_video_writes_to_resolved_folder() {
        use base64::Engine;

        let dir = TempDir::new().unwrap();
        let vault_path = dir.path().to_str().unwrap();
        let data = base64::engine::general_purpose::STANDARD.encode(b"mp4 bytes");

        let saved_path = save_video(vault_path, Some("Media/Videos"), "clip.mp4", &data).unwrap();
        assert!(std::path::Path::new(&saved_path).exists());
        assert!(saved_path.contains("Media/Videos"));
        assert!(saved_path.contains("clip.mp4"));
    }

    #[test]
    fn test_copy_video_to_vault_accepts_all_video_extensions() {
        let dir = TempDir::new().unwrap();
        for ext in VIDEO_EXTENSIONS {
            let source_path = dir.path().join(format!("clip.{}", ext));
            fs::write(&source_path, b"video bytes").unwrap();
            let result = copy_video_to_vault(
                dir.path().to_str().unwrap(),
                None,
                source_path.to_str().unwrap(),
            );
            assert!(result.is_ok(), "failed for extension: {}", ext);
        }
    }

    #[test]
    fn test_copy_video_to_vault_rejects_image() {
        let dir = TempDir::new().unwrap();
        let source_path = dir.path().join("photo.png");
        fs::write(&source_path, b"png").unwrap();

        let result = copy_video_to_vault(
            dir.path().to_str().unwrap(),
            None,
            source_path.to_str().unwrap(),
        );
        assert!(result.unwrap_err().contains("Not a supported video"));
    }
}
