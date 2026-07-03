use serde::Serialize;
use std::ffi::OsString;
use std::process::{Command, Output};

use crate::settings::{normalize_git_provider, Settings};

pub(super) const NATIVE_PROVIDER: &str = "native";
pub(super) const WSL_PROVIDER: &str = "wsl";

#[derive(Debug, Clone, Copy)]
struct ProbeIdentity {
    provider: &'static str,
    label: &'static str,
}

const NATIVE_GIT_IDENTITY: ProbeIdentity = ProbeIdentity {
    provider: NATIVE_PROVIDER,
    label: "Native Git",
};

const WSL_GIT_IDENTITY: ProbeIdentity = ProbeIdentity {
    provider: WSL_PROVIDER,
    label: "WSL2 Git",
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum GitProviderSelection {
    Native,
    Wsl { distro: Option<String> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GitProviderProbe {
    pub provider: String,
    pub label: String,
    pub available: bool,
    pub version: Option<String>,
    pub distro: Option<String>,
    pub path: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GitProviderStatus {
    pub selected_provider: String,
    pub selected_wsl_distro: Option<String>,
    pub native: GitProviderProbe,
    pub wsl_distributions: Vec<GitProviderProbe>,
}

impl GitProviderSelection {
    pub(super) fn from_settings(settings: Option<&Settings>) -> Self {
        let provider =
            settings.and_then(|settings| normalize_git_provider(settings.git_provider.as_deref()));

        if provider.as_deref() == Some(WSL_PROVIDER) && wsl_supported_on_this_platform() {
            return Self::Wsl {
                distro: settings.and_then(|settings| settings.git_wsl_distro.clone()),
            };
        }

        Self::Native
    }

    pub(super) fn provider_id(&self) -> &'static str {
        match self {
            Self::Native => NATIVE_PROVIDER,
            Self::Wsl { .. } => WSL_PROVIDER,
        }
    }
}

pub(super) fn wsl_git_prefix_args(distro: Option<&str>) -> Vec<OsString> {
    let mut args = Vec::new();
    if let Some(distro) = distro.map(str::trim).filter(|distro| !distro.is_empty()) {
        args.push(OsString::from("--distribution"));
        args.push(OsString::from(distro));
    }
    args.push(OsString::from("--exec"));
    args.push(OsString::from("git"));
    args
}

pub(super) fn selected_git_path_argument(
    path: &str,
    settings: Option<&Settings>,
) -> Result<String, String> {
    match GitProviderSelection::from_settings(settings) {
        GitProviderSelection::Wsl { .. } => windows_path_to_wsl_path(path).ok_or_else(|| {
            format!("The selected WSL Git provider cannot translate '{path}' to a WSL path.")
        }),
        GitProviderSelection::Native => Ok(path.to_string()),
    }
}

pub fn git_provider_status() -> GitProviderStatus {
    let settings = crate::settings::get_settings().ok();
    let selection = GitProviderSelection::from_settings(settings.as_ref());

    GitProviderStatus {
        selected_provider: selection.provider_id().to_string(),
        selected_wsl_distro: settings.and_then(|settings| settings.git_wsl_distro),
        native: native_git_probe(),
        wsl_distributions: wsl_git_probes(),
    }
}

pub fn test_git_provider(
    provider: &str,
    distro: Option<&str>,
    vault_path: Option<&str>,
) -> GitProviderProbe {
    match normalize_git_provider(Some(provider)).as_deref() {
        Some(WSL_PROVIDER) => wsl_git_probe(distro, vault_path),
        _ => native_git_probe(),
    }
}

fn native_git_probe() -> GitProviderProbe {
    let output = Command::new("git").arg("--version").output();
    match output {
        Ok(output) if output.status.success() => available_probe(
            NATIVE_GIT_IDENTITY,
            None,
            None,
            version_from_output(&output),
        ),
        Ok(output) => unavailable_probe(NATIVE_GIT_IDENTITY, None, native_failure_message(&output)),
        Err(err) => unavailable_probe(
            NATIVE_GIT_IDENTITY,
            None,
            format!("Native Git is unavailable: {err}"),
        ),
    }
}

fn wsl_git_probes() -> Vec<GitProviderProbe> {
    match wsl_distribution_names() {
        Ok(distributions) if !distributions.is_empty() => distributions
            .into_iter()
            .map(|distro| wsl_git_probe(Some(&distro), None))
            .collect(),
        Ok(_) => vec![unavailable_probe(
            WSL_GIT_IDENTITY,
            None,
            "WSL is installed, but no distributions are configured.".to_string(),
        )],
        Err(message) => vec![unavailable_probe(WSL_GIT_IDENTITY, None, message)],
    }
}

fn wsl_git_probe(distro: Option<&str>, vault_path: Option<&str>) -> GitProviderProbe {
    if !wsl_supported_on_this_platform() {
        return unavailable_probe(
            WSL_GIT_IDENTITY,
            distro.map(ToOwned::to_owned),
            "WSL2 Git is only available on Windows.".to_string(),
        );
    }

    let translated_vault_path = match vault_path
        .and_then(|path| (!path.trim().is_empty()).then(|| windows_path_to_wsl_path(path)))
    {
        Some(Some(path)) => Some(path),
        Some(None) => {
            return unavailable_probe(
                WSL_GIT_IDENTITY,
                distro.map(ToOwned::to_owned),
                "The selected vault path cannot be translated to WSL.".to_string(),
            );
        }
        None => None,
    };

    let output = wsl_git_version_command(distro, translated_vault_path.as_deref()).output();
    match output {
        Ok(output) if output.status.success() => available_probe(
            WSL_GIT_IDENTITY,
            distro.map(ToOwned::to_owned),
            translated_vault_path,
            version_from_output(&output),
        ),
        Ok(output) => unavailable_probe(
            WSL_GIT_IDENTITY,
            distro.map(ToOwned::to_owned),
            native_failure_message(&output),
        ),
        Err(err) => unavailable_probe(
            WSL_GIT_IDENTITY,
            distro.map(ToOwned::to_owned),
            format!("WSL2 Git is unavailable: {err}"),
        ),
    }
}

fn available_probe(
    identity: ProbeIdentity,
    distro: Option<String>,
    path: Option<String>,
    version: Option<String>,
) -> GitProviderProbe {
    let message = version
        .as_deref()
        .map(|version| format!("{} is available: {version}", identity.label))
        .unwrap_or_else(|| format!("{} is available.", identity.label));

    GitProviderProbe {
        provider: identity.provider.to_string(),
        label: identity.label.to_string(),
        available: true,
        version,
        distro,
        path,
        message,
    }
}

fn unavailable_probe(
    identity: ProbeIdentity,
    distro: Option<String>,
    message: String,
) -> GitProviderProbe {
    GitProviderProbe {
        provider: identity.provider.to_string(),
        label: identity.label.to_string(),
        available: false,
        version: None,
        distro,
        path: None,
        message,
    }
}

fn native_failure_message(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return stderr;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stdout.is_empty() {
        return stdout;
    }

    format!("Git exited with status {}", output.status)
}

fn version_from_output(output: &Output) -> Option<String> {
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(target_os = "windows")]
fn wsl_supported_on_this_platform() -> bool {
    true
}

#[cfg(not(target_os = "windows"))]
fn wsl_supported_on_this_platform() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn wsl_distribution_names() -> Result<Vec<String>, String> {
    let output = Command::new("wsl.exe")
        .args(["--list", "--quiet"])
        .output()
        .map_err(|err| format!("WSL is unavailable: {err}"))?;

    if !output.status.success() {
        return Err(native_failure_message(&output));
    }

    Ok(parse_wsl_distribution_names(&output.stdout))
}

#[cfg(not(target_os = "windows"))]
fn wsl_distribution_names() -> Result<Vec<String>, String> {
    Err("WSL2 Git is only available on Windows.".to_string())
}

#[cfg(target_os = "windows")]
fn wsl_git_version_command(distro: Option<&str>, translated_vault_path: Option<&str>) -> Command {
    let mut command = Command::new("wsl.exe");
    if let Some(distro) = distro.map(str::trim).filter(|distro| !distro.is_empty()) {
        command.args(["--distribution", distro]);
    }
    if let Some(path) = translated_vault_path {
        command.args(["--cd", path]);
    }
    command.args(["--exec", "git", "--version"]);
    command
}

#[cfg(not(target_os = "windows"))]
fn wsl_git_version_command(_distro: Option<&str>, _translated_vault_path: Option<&str>) -> Command {
    Command::new("wsl.exe")
}

#[cfg(any(target_os = "windows", test))]
fn parse_wsl_distribution_names(output: &[u8]) -> Vec<String> {
    decode_wsl_output(output)
        .lines()
        .map(|line| line.trim().trim_end_matches('\r').to_string())
        .filter(|line| !line.is_empty())
        .collect()
}

#[cfg(any(target_os = "windows", test))]
fn decode_wsl_output(output: &[u8]) -> String {
    if output.len() >= 2 && output.chunks_exact(2).any(|chunk| chunk[1] == 0) {
        let units = output
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        return String::from_utf16_lossy(&units).replace('\0', "");
    }

    String::from_utf8_lossy(output).replace('\0', "")
}

fn windows_path_to_wsl_path(path: &str) -> Option<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with('/') {
        return Some(trimmed.to_string());
    }

    let normalized = trimmed.replace('\\', "/");
    if let Some(path) = drive_path_to_wsl_path(&normalized) {
        return Some(path);
    }

    wsl_unc_path_to_linux_path(&normalized)
}

fn drive_path_to_wsl_path(path: &str) -> Option<String> {
    let bytes = path.as_bytes();
    if bytes.len() < 3 {
        return None;
    }
    if bytes[1] != b':' {
        return None;
    }
    if bytes[2] != b'/' {
        return None;
    }

    let drive = bytes[0] as char;
    if !drive.is_ascii_alphabetic() {
        return None;
    }

    Some(format!(
        "/mnt/{}/{}",
        drive.to_ascii_lowercase(),
        &path[3..]
    ))
}

fn wsl_unc_path_to_linux_path(path: &str) -> Option<String> {
    for prefix in ["//wsl$/", "//wsl.localhost/"] {
        if let Some(rest) = path.strip_prefix(prefix) {
            let (_, linux_path) = rest.split_once('/')?;
            return Some(format!("/{linux_path}"));
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_utf8_wsl_distribution_names() {
        assert_eq!(
            parse_wsl_distribution_names(b"Ubuntu\r\nDebian\r\n"),
            vec!["Ubuntu", "Debian"]
        );
    }

    #[test]
    fn parses_utf16_wsl_distribution_names() {
        let encoded = "Ubuntu\r\nDebian\r\n"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>();

        assert_eq!(
            parse_wsl_distribution_names(&encoded),
            vec!["Ubuntu", "Debian"]
        );
    }

    #[test]
    fn translates_windows_drive_paths_for_wsl() {
        assert_eq!(
            windows_path_to_wsl_path(r"C:\Users\Luca\Vault").as_deref(),
            Some("/mnt/c/Users/Luca/Vault")
        );
        assert_eq!(
            windows_path_to_wsl_path("D:/Work/Tolaria").as_deref(),
            Some("/mnt/d/Work/Tolaria")
        );
    }

    #[test]
    fn translates_wsl_unc_paths_for_wsl() {
        assert_eq!(
            windows_path_to_wsl_path(r"\\wsl$\Ubuntu\home\luca\vault").as_deref(),
            Some("/home/luca/vault")
        );
        assert_eq!(
            windows_path_to_wsl_path(r"\\wsl.localhost\Debian\var\repo").as_deref(),
            Some("/var/repo")
        );
    }

    #[test]
    fn rejects_untranslatable_relative_paths() {
        assert_eq!(windows_path_to_wsl_path("notes/vault"), None);
        assert_eq!(windows_path_to_wsl_path(""), None);
    }

    #[test]
    fn builds_wsl_git_prefix_args() {
        assert_eq!(
            wsl_git_prefix_args(Some("Ubuntu"))
                .into_iter()
                .map(|arg| arg.to_string_lossy().to_string())
                .collect::<Vec<_>>(),
            vec!["--distribution", "Ubuntu", "--exec", "git"]
        );
    }
}
