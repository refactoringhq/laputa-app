use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderType {
    LocalFolder,
    IcloudDrive,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ValidationResult {
    Valid,
    Warning,
    Invalid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedVaultProviderSelection {
    pub validation_result: ValidationResult,
    pub provider_type: ProviderType,
    pub provider_root: String,
    pub message: Option<String>,
}

fn classify_provider(canonical_path: &Path, icloud_root: Option<&Path>) -> ProviderType {
    if icloud_root.is_some_and(|root| canonical_path.starts_with(root)) {
        ProviderType::IcloudDrive
    } else {
        ProviderType::LocalFolder
    }
}

fn canonicalize_path(path: &str) -> Result<PathBuf, String> {
    PathBuf::from(path)
        .canonicalize()
        .map_err(|err| format!("Failed to resolve vault path: {}", err))
}

fn discover_icloud_drive_root() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let root = home.join("Library/Mobile Documents/com~apple~CloudDocs");
    root.exists().then_some(root)
}

pub fn validate_vault_provider_selection(
    path: &str,
    explicit_provider_type: Option<&str>,
) -> Result<ValidatedVaultProviderSelection, String> {
    let canonical_path = canonicalize_path(path)?;
    let icloud_root = discover_icloud_drive_root();
    Ok(validate_vault_provider_selection_with(
        canonical_path.as_path(),
        explicit_provider_type,
        icloud_root.as_deref(),
    ))
}

fn validate_vault_provider_selection_with(
    canonical_path: &Path,
    explicit_provider_type: Option<&str>,
    icloud_root: Option<&Path>,
) -> ValidatedVaultProviderSelection {
    let detected_provider = classify_provider(canonical_path, icloud_root);
    let provider_root = canonical_path.to_string_lossy().into_owned();

    match explicit_provider_type {
        Some("icloud-drive") if detected_provider != ProviderType::IcloudDrive => {
            ValidatedVaultProviderSelection {
                validation_result: ValidationResult::Invalid,
                provider_type: ProviderType::IcloudDrive,
                provider_root,
                message: Some(
                    "The selected folder is not inside the detected iCloud Drive root.".to_string(),
                ),
            }
        }
        Some("local-folder") if detected_provider == ProviderType::IcloudDrive => {
            ValidatedVaultProviderSelection {
                validation_result: ValidationResult::Warning,
                provider_type: ProviderType::LocalFolder,
                provider_root,
                message: Some(
                    "This folder appears to be inside iCloud Drive and will stay classified as a local folder until you explicitly change it.".to_string(),
                ),
            }
        }
        Some("icloud-drive") => ValidatedVaultProviderSelection {
            validation_result: ValidationResult::Valid,
            provider_type: ProviderType::IcloudDrive,
            provider_root,
            message: None,
        },
        Some(_) => ValidatedVaultProviderSelection {
            validation_result: ValidationResult::Valid,
            provider_type: ProviderType::LocalFolder,
            provider_root,
            message: None,
        },
        None => ValidatedVaultProviderSelection {
            validation_result: ValidationResult::Valid,
            provider_type: detected_provider,
            provider_root,
            message: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_explicit_icloud_outside_icloud_as_invalid() {
        let result = validate_vault_provider_selection_with(
            Path::new("/tmp/vault"),
            Some("icloud-drive"),
            Some(Path::new(
                "/Users/me/Library/Mobile Documents/com~apple~CloudDocs",
            )),
        );

        assert_eq!(result.validation_result, ValidationResult::Invalid);
        assert_eq!(result.provider_type, ProviderType::IcloudDrive);
    }

    #[test]
    fn warns_when_explicit_local_folder_is_inside_icloud() {
        let icloud_root = Path::new("/Users/me/Library/Mobile Documents/com~apple~CloudDocs");
        let result = validate_vault_provider_selection_with(
            &icloud_root.join("Vault"),
            Some("local-folder"),
            Some(icloud_root),
        );

        assert_eq!(result.validation_result, ValidationResult::Warning);
        assert_eq!(result.provider_type, ProviderType::LocalFolder);
    }

    #[test]
    fn infers_icloud_when_inside_icloud_root() {
        let icloud_root = Path::new("/Users/me/Library/Mobile Documents/com~apple~CloudDocs");
        let result = validate_vault_provider_selection_with(
            &icloud_root.join("Vault"),
            None,
            Some(icloud_root),
        );

        assert_eq!(result.validation_result, ValidationResult::Valid);
        assert_eq!(result.provider_type, ProviderType::IcloudDrive);
    }

    #[test]
    fn falls_back_to_local_folder_when_icloud_root_is_unavailable() {
        let result = validate_vault_provider_selection_with(Path::new("/tmp/vault"), None, None);

        assert_eq!(result.validation_result, ValidationResult::Valid);
        assert_eq!(result.provider_type, ProviderType::LocalFolder);
    }
}
