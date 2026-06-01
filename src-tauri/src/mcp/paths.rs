use std::ffi::OsStr;
use std::path::{Path, PathBuf};

pub(super) fn runtime_resource_roots() -> Vec<PathBuf> {
    let local_app_data = if cfg!(windows) {
        non_empty_env_path("LOCALAPPDATA")
    } else {
        None
    };
    let current_exe = std::env::current_exe().ok();

    runtime_resource_roots_for_env_and_exe(
        non_empty_env_path("RESOURCEPATH"),
        non_empty_env_path("APPDIR"),
        local_app_data,
        current_exe.as_deref(),
    )
}

fn runtime_resource_roots_for_env_and_exe(
    resource_path: Option<PathBuf>,
    appdir: Option<PathBuf>,
    local_app_data: Option<PathBuf>,
    current_exe: Option<&Path>,
) -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Some(resource_path) = resource_path {
        push_resource_root(&mut roots, resource_path);
    }
    if let Some(current_exe) = current_exe {
        push_current_exe_resource_roots(&mut roots, current_exe);
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

fn push_current_exe_resource_roots(roots: &mut Vec<PathBuf>, current_exe: &Path) {
    let Some(exe_dir) = current_exe.parent() else {
        return;
    };

    push_resource_root(roots, exe_dir.to_path_buf());
    push_resource_root(roots, exe_dir.join("resources"));
    if let Some(resource_dir) = macos_app_resources_dir(current_exe) {
        push_resource_root(roots, resource_dir);
    }
}

fn macos_app_resources_dir(executable: &Path) -> Option<PathBuf> {
    let macos_dir = executable.parent()?;
    if macos_dir.file_name() != Some(OsStr::new("MacOS")) {
        return None;
    }

    let contents_dir = macos_dir.parent()?;
    if contents_dir.file_name() != Some(OsStr::new("Contents")) {
        return None;
    }

    let app_dir = contents_dir.parent()?;
    if app_dir.extension() != Some(OsStr::new("app")) {
        return None;
    }

    Some(contents_dir.join("Resources"))
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
        let roots =
            runtime_resource_roots_for_env_and_exe(None, None, Some(local_app_data.clone()), None);

        assert_eq!(roots.iter().filter(|root| *root == &install_dir).count(), 1);
        assert!(roots.contains(&local_app_data.join("tolaria")));

        let candidates =
            super::super::mcp_server_dir_candidates(Path::new("/repo/mcp-server"), &roots);
        assert!(candidates.contains(&install_dir.join("mcp-server")));
    }

    #[test]
    fn includes_macos_app_bundle_resources_from_executable_path() {
        let executable = PathBuf::from("/Applications/Tolaria.app/Contents/MacOS/Tolaria");
        let roots = runtime_resource_roots_for_env_and_exe(None, None, None, Some(&executable));

        assert!(roots.contains(&PathBuf::from(
            "/Applications/Tolaria.app/Contents/Resources"
        )));

        let candidates =
            super::super::mcp_server_dir_candidates(Path::new("/repo/mcp-server"), &roots);
        assert!(candidates.contains(&PathBuf::from(
            "/Applications/Tolaria.app/Contents/Resources/mcp-server"
        )));
    }
}
