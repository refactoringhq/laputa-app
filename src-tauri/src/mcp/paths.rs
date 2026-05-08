use std::path::{Path, PathBuf};

pub(super) fn runtime_resource_roots() -> Vec<PathBuf> {
    let local_app_data = if cfg!(windows) {
        non_empty_env_path("LOCALAPPDATA")
    } else {
        None
    };

    runtime_resource_roots_for_env(
        non_empty_env_path("RESOURCEPATH"),
        non_empty_env_path("APPDIR"),
        current_exe_dir(),
        local_app_data,
    )
}

fn runtime_resource_roots_for_env(
    resource_path: Option<PathBuf>,
    appdir: Option<PathBuf>,
    exe_dir: Option<PathBuf>,
    local_app_data: Option<PathBuf>,
) -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Some(resource_path) = resource_path {
        push_resource_root(&mut roots, resource_path);
    }
    if let Some(appdir) = appdir {
        push_resource_root(&mut roots, appdir.join("usr"));
        push_resource_root(&mut roots, appdir.join("usr/lib/tolaria"));
        push_resource_root(&mut roots, appdir.join("usr/lib/Tolaria"));
    }
    if let Some(exe_dir) = exe_dir {
        push_resource_root(&mut roots, exe_dir);
    }
    if let Some(local_app_data) = local_app_data {
        push_resource_root(&mut roots, local_app_data.join("Tolaria"));
        push_resource_root(&mut roots, local_app_data.join("tolaria"));
    }

    roots
}

fn current_exe_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn includes_windows_install_locations() {
        let local_app_data = PathBuf::from(r"C:\Users\alex\AppData\Local");
        let install_dir = local_app_data.join("Tolaria");
        let roots = runtime_resource_roots_for_env(
            None,
            None,
            Some(install_dir.clone()),
            Some(local_app_data.clone()),
        );

        assert_eq!(roots.iter().filter(|root| *root == &install_dir).count(), 1);
        assert!(roots.contains(&local_app_data.join("tolaria")));

        let candidates =
            super::super::mcp_server_dir_candidates(Path::new("/repo/mcp-server"), &roots);
        assert!(candidates.contains(&install_dir.join("mcp-server")));
    }
}
