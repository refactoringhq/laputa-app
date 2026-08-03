use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static RUNTIME_RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

pub(super) fn set_runtime_resource_dir(resource_dir: PathBuf) {
    if !resource_dir.as_os_str().is_empty() {
        let _ = RUNTIME_RESOURCE_DIR.set(resource_dir);
    }
}

pub(super) fn runtime_resource_roots() -> Vec<PathBuf> {
    let local_app_data = if cfg!(windows) {
        non_empty_env_path("LOCALAPPDATA")
    } else {
        None
    };
    runtime_resource_roots_for_env(
        non_empty_env_path("RESOURCEPATH"),
        non_empty_env_path("APPDIR"),
        local_app_data,
        RUNTIME_RESOURCE_DIR.get().cloned(),
    )
}

fn runtime_resource_roots_for_env(
    resource_path: Option<PathBuf>,
    appdir: Option<PathBuf>,
    local_app_data: Option<PathBuf>,
    runtime_resource_dir: Option<PathBuf>,
) -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Some(resource_path) = resource_path {
        push_resource_root(&mut roots, resource_path);
    }
    if let Some(runtime_resource_dir) = runtime_resource_dir {
        push_resource_root(&mut roots, runtime_resource_dir);
    }
    if let Some(appdir) = appdir {
        push_resource_root(&mut roots, appdir.join("usr"));
        push_resource_root(&mut roots, appdir.join("usr/lib/tolaria"));
        push_resource_root(&mut roots, appdir.join("usr/lib/Tolaria"));
    }
    if let Some(local_app_data) = local_app_data {
        push_resource_root(&mut roots, local_app_data.join("Tolaria"));
        push_resource_root(&mut roots, local_app_data.join("tolaria"));
    }

    roots
}

fn push_resource_root(roots: &mut Vec<PathBuf>, root: PathBuf) {
    if !root.as_os_str().is_empty() && !roots.iter().any(|candidate| candidate == &root) {
        roots.push(root);
    }
}

fn non_empty_env_path(key: &str) -> Option<PathBuf> {
    std::env::var_os(key)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

pub(super) fn client_script_path(path: &Path) -> String {
    strip_windows_verbatim_prefix(&path.to_string_lossy())
}

fn strip_windows_verbatim_prefix(path: &str) -> String {
    const VERBATIM_PREFIX: &str = "\\\\?\\";
    const VERBATIM_UNC_PREFIX: &str = "\\\\?\\UNC\\";

    if let Some(rest) = path.strip_prefix(VERBATIM_UNC_PREFIX) {
        return format!(r"\\{rest}");
    }

    path.strip_prefix(VERBATIM_PREFIX)
        .unwrap_or(path)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn includes_tauri_macos_app_bundle_resource_directory() {
        let resource_dir = PathBuf::from("/Applications/Tolaria.app/Contents/Resources");
        let roots = runtime_resource_roots_for_env(None, None, None, Some(resource_dir.clone()));

        assert!(roots.contains(&resource_dir));

        let candidates =
            super::super::mcp_server_dir_candidates(Path::new("/repo/mcp-server"), &roots);
        assert!(candidates.contains(&resource_dir.join("mcp-server")));
    }

    #[test]
    fn includes_windows_install_locations() {
        let local_app_data = PathBuf::from(r"C:\Users\alex\AppData\Local");
        let install_dir = local_app_data.join("Tolaria");
        let roots = runtime_resource_roots_for_env(None, None, Some(local_app_data.clone()), None);

        assert_eq!(roots.iter().filter(|root| *root == &install_dir).count(), 1);
        assert!(roots.contains(&local_app_data.join("tolaria")));

        let candidates =
            super::super::mcp_server_dir_candidates(Path::new("/repo/mcp-server"), &roots);
        assert!(candidates.contains(&install_dir.join("mcp-server")));
    }

    #[test]
    fn client_script_path_strips_windows_extended_length_disk_prefix() {
        let path = PathBuf::from(r"\\?\D:\Tolaria\mcp-server\index.js");

        assert_eq!(client_script_path(&path), r"D:\Tolaria\mcp-server\index.js",);
    }

    #[test]
    fn client_script_path_strips_windows_extended_length_unc_prefix() {
        let path = PathBuf::from(r"\\?\UNC\server\share\Tolaria\mcp-server\index.js");

        assert_eq!(
            client_script_path(&path),
            r"\\server\share\Tolaria\mcp-server\index.js",
        );
    }

    #[test]
    fn client_script_path_preserves_normal_paths_with_spaces() {
        let path = PathBuf::from(r"D:\Program Files\Tolaria\mcp-server\index.js");

        assert_eq!(
            client_script_path(&path),
            r"D:\Program Files\Tolaria\mcp-server\index.js",
        );
    }
}
