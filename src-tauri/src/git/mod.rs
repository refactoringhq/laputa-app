mod author;
mod clone;
mod command;
mod commit;
mod conflict;
mod connect;
mod credentials;
mod dates;
mod file_url;
mod history;
mod provider;
mod pulse;
mod remote;
#[cfg(test)]
mod remote_branch_tests;
mod remote_config;
mod remote_status;
mod remote_url;
mod status;
mod upstream;

use std::ffi::{OsStr, OsString};
use std::io;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

#[cfg(test)]
use std::cell::RefCell;

use crate::cli_agent_runtime::{env_value_from_process_or_user_shell, EnvName};

pub(crate) use author::ensure_author_config;
pub use author::{git_author_identity, GitAuthorIdentity};
#[cfg(test)]
pub(crate) use author::{
    local_config_value, AuthorConfigKey, FALLBACK_AUTHOR_EMAIL, FALLBACK_AUTHOR_NAME,
    LEGACY_FALLBACK_EMAIL,
};
pub use clone::clone_repo;
pub use commit::git_commit;
pub use conflict::{
    get_conflict_files, get_conflict_mode, git_commit_conflict_resolution, git_resolve_conflict,
    is_merge_in_progress, is_rebase_in_progress,
};
pub use connect::{disconnect_all_remotes, git_add_remote, GitAddRemoteResult};
pub use dates::{get_all_file_dates, GitDates};
pub use file_url::git_file_url;
pub use history::{get_file_diff, get_file_diff_at_commit, get_file_history};
pub use provider::{git_provider_status, test_git_provider, GitProviderProbe, GitProviderStatus};
pub use pulse::{get_last_commit_info, get_vault_pulse, LastCommitInfo, PulseCommit, PulseFile};
pub use remote::{git_pull, git_push, has_remote, GitPullResult, GitPushResult};
pub use remote_status::{git_remote_status, GitRemoteStatus};
pub(crate) use remote_url::validate_user_remote_url;
pub use status::{
    discard_file_changes, get_modified_files, get_modified_files_with_stats, ModifiedFile,
};

use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct GitCommit {
    pub hash: String,
    #[serde(rename = "shortHash")]
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub date: i64,
}

const DEFAULT_GITIGNORE: &str = "# Tolaria app files (machine-specific, never commit)\n\
.laputa/settings.json\n\
\n\
# macOS\n\
.DS_Store\n\
.AppleDouble\n\
.LSOverride\n\
\n\
# Thumbnails\n\
._*\n\
\n\
# Editors\n\
.vscode/\n\
.idea/\n\
*.swp\n\
*.swo\n";

const GIT_SHELL_ENV_NAMES: [EnvName<'static>; 8] = [
    EnvName::trusted("GIT_AUTHOR_NAME"),
    EnvName::trusted("GIT_AUTHOR_EMAIL"),
    EnvName::trusted("GIT_COMMITTER_NAME"),
    EnvName::trusted("GIT_COMMITTER_EMAIL"),
    EnvName::trusted("GIT_CONFIG_GLOBAL"),
    EnvName::trusted("GIT_CONFIG_SYSTEM"),
    EnvName::trusted("XDG_CONFIG_HOME"),
    EnvName::trusted("EMAIL"),
];

#[derive(Clone)]
struct GitLaunchConfig {
    program: OsString,
    prefix_args: Vec<OsString>,
    path: Option<OsString>,
}

#[derive(Default)]
struct ShellGitConfig {
    git_path: Option<PathBuf>,
    path: Option<OsString>,
}

struct GitShellEnvBinding {
    name: &'static str,
    value: String,
}

pub(crate) fn git_command() -> Command {
    let config = git_launch_config();
    let mut command = crate::hidden_command(&config.program);
    command.args(config.prefix_args);
    if let Some(path) = &config.path {
        command.env("PATH", path);
    }
    sanitize_linux_appimage_git_env(&mut command);
    apply_git_shell_env(&mut command);
    #[cfg(test)]
    apply_test_git_config_env(&mut command);
    command.args([
        "-c",
        "core.quotePath=false",
        "-c",
        "protocol.ext.allow=never",
        "-c",
        "protocol.file.allow=user",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.sshCommand=ssh",
    ]);
    command
}

pub(crate) fn git_command_at(path: &Path) -> io::Result<Command> {
    let path = path.to_str().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("Git path '{}' is not valid UTF-8", path.display()),
        )
    })?;
    let path = git_path_argument(path)
        .map_err(|message| io::Error::new(io::ErrorKind::InvalidInput, message))?;
    let mut command = git_command();
    command.args(["-C", &path]);
    Ok(command)
}

pub fn has_direct_git_metadata(path: impl AsRef<Path>) -> bool {
    path.as_ref().join(".git").exists()
}

pub fn is_inside_work_tree(path: impl AsRef<Path>) -> bool {
    let path = path.as_ref();
    if !path.is_dir() {
        return false;
    }

    let Ok(output) = git_command_at(path).and_then(|mut command| {
        command
            .args(["rev-parse", "--is-inside-work-tree"])
            .output()
    }) else {
        return false;
    };

    output.status.success() && String::from_utf8_lossy(&output.stdout).trim() == "true"
}

fn apply_git_shell_env(command: &mut Command) {
    for binding in git_shell_env_bindings() {
        command.env(binding.name, &binding.value);
    }
}

fn git_shell_env_bindings() -> &'static Vec<GitShellEnvBinding> {
    static BINDINGS: OnceLock<Vec<GitShellEnvBinding>> = OnceLock::new();
    BINDINGS.get_or_init(|| {
        GIT_SHELL_ENV_NAMES
            .iter()
            .filter_map(|name| {
                env_value_from_process_or_user_shell(*name).map(|value| GitShellEnvBinding {
                    name: name.as_str(),
                    value,
                })
            })
            .collect()
    })
}

#[cfg(test)]
#[derive(Clone)]
struct TestGitConfigEnv {
    global: PathBuf,
    system: PathBuf,
}

#[cfg(test)]
thread_local! {
    static TEST_GIT_CONFIG_ENV: RefCell<Option<TestGitConfigEnv>> = const { RefCell::new(None) };
}

#[cfg(test)]
fn apply_test_git_config_env(command: &mut Command) {
    TEST_GIT_CONFIG_ENV.with(|env| {
        if let Some(config) = env.borrow().as_ref() {
            command.env("GIT_CONFIG_GLOBAL", &config.global);
            command.env("GIT_CONFIG_SYSTEM", &config.system);
        }
    });
}

pub(crate) fn git_path_argument(path: &str) -> Result<String, String> {
    let settings = crate::settings::get_settings().ok();
    provider::selected_git_path_argument(path, settings.as_ref())
}

fn git_launch_config() -> GitLaunchConfig {
    detect_git_launch_config()
}

fn detect_git_launch_config() -> GitLaunchConfig {
    let parent_path = std::env::var_os("PATH");
    let settings = crate::settings::get_settings().ok();
    if let provider::GitProviderSelection::Wsl { distro } =
        provider::GitProviderSelection::from_settings(settings.as_ref())
    {
        return GitLaunchConfig {
            program: OsString::from("wsl.exe"),
            prefix_args: provider::wsl_git_prefix_args(distro.as_deref()),
            path: parent_path,
        };
    }

    git_launch_config_from_sources(
        parent_path,
        configured_git_path(),
        shell_git_config(),
        standard_git_candidates(),
    )
}

fn git_launch_config_from_sources(
    parent_path: Option<OsString>,
    configured_git_path: Option<PathBuf>,
    shell: Option<ShellGitConfig>,
    standard_candidates: Vec<PathBuf>,
) -> GitLaunchConfig {
    let shell = shell.unwrap_or_default();
    let program = configured_git_path
        .or(shell.git_path)
        .or_else(|| standard_candidates.into_iter().next())
        .map(PathBuf::into_os_string)
        .unwrap_or_else(|| OsString::from("git"));
    let path = path_with_git_parent(shell.path.or(parent_path), &program);

    GitLaunchConfig {
        program,
        prefix_args: Vec::new(),
        path,
    }
}

fn configured_git_path() -> Option<PathBuf> {
    crate::settings::get_settings()
        .ok()
        .and_then(|settings| settings.git_path)
        .map(PathBuf::from)
        .filter(|path| is_executable_file(path))
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };

    metadata.is_file() && has_executable_bit(&metadata)
}

#[cfg(unix)]
fn has_executable_bit(metadata: &std::fs::Metadata) -> bool {
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn has_executable_bit(metadata: &std::fs::Metadata) -> bool {
    metadata.is_file()
}

#[cfg(target_os = "macos")]
fn standard_git_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/git"),
        PathBuf::from("/usr/local/bin/git"),
        PathBuf::from("/usr/bin/git"),
    ];
    candidates.extend(cellar_git_candidates("/opt/homebrew/Cellar/git"));
    candidates.extend(cellar_git_candidates("/usr/local/Cellar/git"));
    candidates
        .into_iter()
        .filter(|path| is_executable_file(path))
        .collect()
}

#[cfg(not(target_os = "macos"))]
fn standard_git_candidates() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(target_os = "macos")]
fn cellar_git_candidates(root: &str) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut candidates = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path().join("bin").join("git"))
        .filter(|path| is_executable_file(path))
        .collect::<Vec<_>>();
    candidates.sort();
    candidates.reverse();
    candidates
}

fn path_with_git_parent(base: Option<OsString>, program: &OsStr) -> Option<OsString> {
    let mut paths = base
        .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .unwrap_or_default();

    let program_path = Path::new(program);
    if let Some(parent) = program_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        push_unique_path(&mut paths, parent.to_path_buf());
    }

    if paths.is_empty() {
        return None;
    }

    std::env::join_paths(paths).ok()
}

fn push_unique_path(paths: &mut Vec<PathBuf>, candidate: PathBuf) {
    if paths.iter().any(|path| path == &candidate) {
        return;
    }
    paths.push(candidate);
}

#[cfg(target_os = "macos")]
fn shell_git_config() -> Option<ShellGitConfig> {
    user_shell_candidates()
        .into_iter()
        .filter(|shell| shell.exists())
        .find_map(|shell| shell_git_config_from_shell(&shell))
}

#[cfg(not(target_os = "macos"))]
fn shell_git_config() -> Option<ShellGitConfig> {
    None
}

#[cfg(target_os = "macos")]
fn shell_git_config_from_shell(shell: &Path) -> Option<ShellGitConfig> {
    let output = crate::hidden_command(shell)
        .arg("-lc")
        .arg("printf '%s\\n%s' \"$(command -v git 2>/dev/null || true)\" \"$PATH\"")
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut lines = stdout.lines();
    let git_path = lines
        .next()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .filter(|path| path.exists());
    let path = lines
        .next()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(OsString::from);

    if git_path.is_none() && path.is_none() {
        return None;
    }

    Some(ShellGitConfig { git_path, path })
}

#[cfg(target_os = "macos")]
fn user_shell_candidates() -> Vec<PathBuf> {
    let mut shells = Vec::new();
    if let Some(shell) = std::env::var_os("SHELL") {
        if !shell.is_empty() {
            shells.push(PathBuf::from(shell));
        }
    }
    shells.push(PathBuf::from("/bin/zsh"));
    shells.push(PathBuf::from("/bin/bash"));
    shells
}

#[cfg(any(test, all(desktop, target_os = "linux")))]
const LINUX_APPIMAGE_GIT_ENV_REMOVALS: [&str; 3] =
    ["LD_LIBRARY_PATH", "LD_PRELOAD", "GIT_EXEC_PATH"];

#[cfg(all(desktop, target_os = "linux"))]
fn sanitize_linux_appimage_git_env(command: &mut Command) {
    sanitize_linux_appimage_git_env_for_launch(command, linux_appimage_env_present());
}

#[cfg(not(all(desktop, target_os = "linux")))]
fn sanitize_linux_appimage_git_env(_command: &mut Command) {}

#[cfg(any(test, all(desktop, target_os = "linux")))]
fn sanitize_linux_appimage_git_env_for_launch(command: &mut Command, is_appimage: bool) {
    if !is_appimage {
        return;
    }

    for key in LINUX_APPIMAGE_GIT_ENV_REMOVALS {
        command.env_remove(key);
    }
}

#[cfg(all(desktop, target_os = "linux"))]
fn linux_appimage_env_present() -> bool {
    ["APPIMAGE", "APPDIR"]
        .into_iter()
        .any(|key| std::env::var(key).is_ok_and(|value| !value.trim().is_empty()))
}

/// Ensure a `.gitignore` with sensible defaults exists in the vault directory.
/// Creates the file if missing; leaves existing `.gitignore` files untouched.
pub fn ensure_gitignore(path: impl AsRef<Path>) -> Result<(), String> {
    let gitignore_path = path.as_ref().join(".gitignore");
    if !gitignore_path.exists() {
        std::fs::write(&gitignore_path, DEFAULT_GITIGNORE)
            .map_err(|e| format!("Failed to write .gitignore: {}", e))?;
    }
    Ok(())
}

/// Initialize a new git repository, stage all files, and create an initial commit.
pub fn init_repo(path: impl AsRef<Path>) -> Result<(), String> {
    let dir = path.as_ref();

    run_git(dir, &["init"])?;
    ensure_author_config(dir)?;

    // Write .gitignore before the first commit so machine-specific and
    // macOS metadata files are never tracked and don't cause conflicts.
    ensure_gitignore(dir)?;

    run_git(dir, &["add", "."])?;
    commit_initial_vault_setup(dir)?;

    Ok(())
}

fn commit_initial_vault_setup(dir: &Path) -> Result<(), String> {
    run_git(
        dir,
        &[
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            "Initial vault setup",
        ],
    )
}

/// Run a git command in the given directory, returning an error on failure.
fn run_git(dir: &Path, args: &[&str]) -> Result<(), String> {
    let output = command::git_output(dir, args).map_err(|e| {
        format!(
            "Failed to run git {}: {e}",
            command::git_command_label(args)
        )
    })?;

    if output.status.success() {
        return Ok(());
    }

    Err(format!(
        "git {} failed: {}",
        command::git_command_label(args),
        String::from_utf8_lossy(&output.stderr)
    ))
}

/// Extract "owner/repo" from a GitHub remote URL.
/// Supports HTTPS (https://github.com/owner/repo.git) and
/// SSH (git@github.com:owner/repo.git) formats.
fn normalize_github_repo_path(repo_path: &str) -> Option<String> {
    let repo_path = repo_path.strip_suffix(".git").unwrap_or(repo_path);
    repo_path.contains('/').then(|| repo_path.to_string())
}

fn github_remote_suffix(url: &str) -> Option<&str> {
    const GITHUB_PREFIXES: [&str; 4] = [
        "git@github.com:",
        "https://github.com/",
        "http://github.com/",
        "ssh://git@github.com/",
    ];

    GITHUB_PREFIXES
        .iter()
        .find_map(|prefix| url.strip_prefix(prefix))
        .or_else(|| url.split_once("@github.com/").map(|(_, suffix)| suffix))
}

fn parse_github_repo_path(url: &str) -> Option<String> {
    github_remote_suffix(url.trim()).and_then(normalize_github_repo_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::ffi::OsString;
    use std::fs;
    use tempfile::TempDir;

    /// Redirect global and system git config to files under a TempDir so
    /// identity tests are hermetic with respect to the developer's own
    /// gitconfig.
    pub(crate) struct GitConfigEnvGuard {
        previous: Option<TestGitConfigEnv>,
        _dir: TempDir,
    }

    impl GitConfigEnvGuard {
        /// No identity resolvable outside the repo's local config.
        pub(crate) fn isolated() -> Self {
            Self::with_global_identity(None)
        }

        /// Optionally expose a global identity to spawned git commands.
        pub(crate) fn with_global_identity(identity: Option<(&str, &str)>) -> Self {
            let dir = TempDir::new().unwrap();
            let global = dir.path().join("gitconfig-global");
            if let Some((name, email)) = identity {
                fs::write(
                    &global,
                    format!("[user]\n\tname = {name}\n\temail = {email}\n"),
                )
                .unwrap();
            }
            let system = dir.path().join("gitconfig-system");

            let config = TestGitConfigEnv { global, system };
            let previous = TEST_GIT_CONFIG_ENV.with(|env| env.replace(Some(config)));

            Self {
                previous,
                _dir: dir,
            }
        }
    }

    impl Drop for GitConfigEnvGuard {
        fn drop(&mut self) {
            let previous = self.previous.take();
            TEST_GIT_CONFIG_ENV.with(|env| {
                env.replace(previous);
            });
        }
    }

    fn assert_repo_path(url: &str, expected: Option<&str>) {
        assert_eq!(
            parse_github_repo_path(url),
            expected.map(ToString::to_string)
        );
    }

    pub(crate) fn setup_git_repo() -> TempDir {
        let dir = TempDir::new().unwrap();
        let path = dir.path();

        git_command()
            .args(["init", "--initial-branch=main"])
            .current_dir(path)
            .output()
            .unwrap();

        git_command()
            .args(["config", "user.email", "test@test.com"])
            .current_dir(path)
            .output()
            .unwrap();

        git_command()
            .args(["config", "user.name", "Test User"])
            .current_dir(path)
            .output()
            .unwrap();

        dir
    }

    /// Set up a bare "remote" and a clone that acts as the working vault.
    pub(crate) fn setup_remote_pair() -> (TempDir, TempDir, TempDir) {
        let bare_dir = TempDir::new().unwrap();
        let bare = bare_dir.path();

        git_command()
            .args(["init", "--bare", "--initial-branch=main"])
            .current_dir(bare)
            .output()
            .unwrap();

        let clone_a_dir = TempDir::new().unwrap();
        git_command()
            .args(["clone", bare.to_str().unwrap(), "."])
            .current_dir(clone_a_dir.path())
            .output()
            .unwrap();
        for cmd in &[
            &["config", "user.email", "a@test.com"][..],
            &["config", "user.name", "User A"][..],
        ] {
            git_command()
                .args(*cmd)
                .current_dir(clone_a_dir.path())
                .output()
                .unwrap();
        }

        let clone_b_dir = TempDir::new().unwrap();
        git_command()
            .args(["clone", bare.to_str().unwrap(), "."])
            .current_dir(clone_b_dir.path())
            .output()
            .unwrap();
        for cmd in &[
            &["config", "user.email", "b@test.com"][..],
            &["config", "user.name", "User B"][..],
        ] {
            git_command()
                .args(*cmd)
                .current_dir(clone_b_dir.path())
                .output()
                .unwrap();
        }

        (bare_dir, clone_a_dir, clone_b_dir)
    }

    fn init_plain_repo() -> TempDir {
        let dir = TempDir::new().unwrap();
        git_command()
            .args(["init", "--initial-branch=main"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        dir
    }

    fn set_local_identity(dir: &Path, name: &str, email: &str) {
        for (key, value) in [("user.name", name), ("user.email", email)] {
            git_command()
                .args(["config", "--local", key, value])
                .current_dir(dir)
                .output()
                .unwrap();
        }
    }

    fn assert_local_identity(dir: &Path, name: Option<&str>, email: Option<&str>) {
        assert_eq!(
            local_config_value(dir, AuthorConfigKey::Name)
                .unwrap()
                .as_deref(),
            name
        );
        assert_eq!(
            local_config_value(dir, AuthorConfigKey::Email)
                .unwrap()
                .as_deref(),
            email
        );
    }

    #[test]
    fn test_ensure_author_config_respects_existing_global_identity() {
        let _env =
            GitConfigEnvGuard::with_global_identity(Some(("Global User", "global@test.com")));

        let dir = init_plain_repo();

        ensure_author_config(dir.path()).unwrap();

        // The globally configured identity resolves, so no local override
        // should be written.
        assert_local_identity(dir.path(), None, None);
    }

    #[test]
    fn test_ensure_author_config_sets_fallback_without_any_identity() {
        let _env = GitConfigEnvGuard::isolated();

        let dir = init_plain_repo();

        ensure_author_config(dir.path()).unwrap();

        assert_local_identity(
            dir.path(),
            Some(FALLBACK_AUTHOR_NAME),
            Some(FALLBACK_AUTHOR_EMAIL),
        );
    }

    #[test]
    fn test_ensure_author_config_heals_legacy_identity_when_global_exists() {
        let _env =
            GitConfigEnvGuard::with_global_identity(Some(("Global User", "global@test.com")));

        let dir = init_plain_repo();
        set_local_identity(dir.path(), FALLBACK_AUTHOR_NAME, LEGACY_FALLBACK_EMAIL);

        ensure_author_config(dir.path()).unwrap();

        // The legacy pair is removed so the global identity resolves again.
        assert_local_identity(dir.path(), None, None);
    }

    #[test]
    fn test_ensure_author_config_replaces_legacy_identity_without_global() {
        let _env = GitConfigEnvGuard::isolated();

        let dir = init_plain_repo();
        set_local_identity(dir.path(), FALLBACK_AUTHOR_NAME, LEGACY_FALLBACK_EMAIL);

        ensure_author_config(dir.path()).unwrap();

        // No user identity anywhere: the legacy email is replaced with the
        // fallback so commits keep working.
        assert_local_identity(
            dir.path(),
            Some(FALLBACK_AUTHOR_NAME),
            Some(FALLBACK_AUTHOR_EMAIL),
        );
    }

    #[test]
    fn test_ensure_author_config_keeps_user_set_local_identity() {
        let _env = GitConfigEnvGuard::isolated();

        let dir = init_plain_repo();
        set_local_identity(dir.path(), "Vault Owner", "owner@example.com");

        ensure_author_config(dir.path()).unwrap();

        // A local identity the user set themselves is never touched.
        assert_local_identity(dir.path(), Some("Vault Owner"), Some("owner@example.com"));
    }

    #[test]
    fn test_git_author_identity_warns_when_local_identity_shadows_global_identity() {
        let _env =
            GitConfigEnvGuard::with_global_identity(Some(("Vault Owner", "owner@example.com")));

        let dir = init_plain_repo();
        set_local_identity(dir.path(), "Unexpected User", "unexpected@example.com");

        let identity = git_author_identity(dir.path().to_str().unwrap()).unwrap();

        assert_eq!(identity.name, "Unexpected User");
        assert_eq!(identity.email, "unexpected@example.com");
        assert_eq!(identity.source, "repository");
        assert_eq!(identity.warning.as_deref(), Some("local_overrides_global"));
    }

    #[test]
    fn test_ensure_author_config_preserves_user_name_when_healing_legacy_email() {
        let _env = GitConfigEnvGuard::isolated();

        let dir = init_plain_repo();
        set_local_identity(dir.path(), "Vault Owner", LEGACY_FALLBACK_EMAIL);

        ensure_author_config(dir.path()).unwrap();

        assert_local_identity(dir.path(), Some("Vault Owner"), Some(FALLBACK_AUTHOR_EMAIL));
    }

    #[test]
    fn test_ensure_author_config_skips_legacy_email_resolved_from_global() {
        let _env =
            GitConfigEnvGuard::with_global_identity(Some(("Someone", LEGACY_FALLBACK_EMAIL)));

        let dir = init_plain_repo();

        ensure_author_config(dir.path()).unwrap();

        // The name resolves globally; the legacy email is skipped and the
        // fallback is written locally instead.
        assert_local_identity(dir.path(), None, Some(FALLBACK_AUTHOR_EMAIL));
    }

    #[test]
    fn test_init_repo_respects_global_author_identity_for_initial_commit() {
        let _env =
            GitConfigEnvGuard::with_global_identity(Some(("Global User", "global@test.com")));

        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("note.md"), "# Note\n").unwrap();

        init_repo(dir.path()).unwrap();

        assert_local_identity(dir.path(), None, None);

        let author = git_command()
            .args(["log", "-1", "--format=%an <%ae>"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&author.stdout).trim(),
            "Global User <global@test.com>"
        );
    }

    fn command_envs(command: &Command) -> HashMap<String, Option<String>> {
        command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().to_string(),
                    value.map(|entry| entry.to_string_lossy().to_string()),
                )
            })
            .collect()
    }

    struct GitLaunchConfigCase<'a> {
        parent_path: Option<&'a str>,
        configured_git_path: Option<&'a str>,
        shell: Option<(&'a str, &'a str)>,
        standard_candidates: &'a [&'a str],
        expected_program: &'a str,
        expected_path: Option<&'a str>,
    }

    fn assert_git_launch_config(case: GitLaunchConfigCase<'_>) {
        let shell = case.shell.map(|(git_path, path)| ShellGitConfig {
            git_path: Some(PathBuf::from(git_path)),
            path: Some(OsString::from(path)),
        });
        let config = git_launch_config_from_sources(
            case.parent_path.map(OsString::from),
            case.configured_git_path.map(PathBuf::from),
            shell,
            case.standard_candidates
                .iter()
                .map(|candidate| PathBuf::from(*candidate))
                .collect(),
        );

        assert_eq!(config.program, OsString::from(case.expected_program));
        assert_eq!(config.path, case.expected_path.map(OsString::from));
    }

    #[test]
    fn test_git_launch_config_source_precedence() {
        for case in [
            GitLaunchConfigCase {
                parent_path: Some("/usr/bin:/bin"),
                configured_git_path: Some("/custom/bin/git"),
                shell: Some(("/opt/homebrew/bin/git", "/opt/homebrew/bin:/usr/bin:/bin")),
                standard_candidates: &["/usr/local/bin/git"],
                expected_program: "/custom/bin/git",
                expected_path: Some("/opt/homebrew/bin:/usr/bin:/bin:/custom/bin"),
            },
            GitLaunchConfigCase {
                parent_path: Some("/usr/bin:/bin"),
                configured_git_path: None,
                shell: Some(("/opt/homebrew/bin/git", "/opt/homebrew/bin:/usr/bin:/bin")),
                standard_candidates: &[],
                expected_program: "/opt/homebrew/bin/git",
                expected_path: Some("/opt/homebrew/bin:/usr/bin:/bin"),
            },
            GitLaunchConfigCase {
                parent_path: Some("/usr/bin:/bin"),
                configured_git_path: None,
                shell: None,
                standard_candidates: &["/opt/homebrew/bin/git"],
                expected_program: "/opt/homebrew/bin/git",
                expected_path: Some("/usr/bin:/bin:/opt/homebrew/bin"),
            },
            GitLaunchConfigCase {
                parent_path: Some("/usr/bin:/bin"),
                configured_git_path: None,
                shell: None,
                standard_candidates: &[],
                expected_program: "git",
                expected_path: Some("/usr/bin:/bin"),
            },
        ] {
            assert_git_launch_config(case);
        }
    }

    #[test]
    fn test_ensure_gitignore_creates_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_str().unwrap();

        ensure_gitignore(path).unwrap();

        let content = fs::read_to_string(dir.path().join(".gitignore")).unwrap();
        assert!(content.contains(".DS_Store"));
        assert!(content.contains(".laputa/settings.json"));
    }

    #[test]
    fn test_ensure_gitignore_preserves_existing() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join(".gitignore"), "my-rule\n").unwrap();

        ensure_gitignore(dir.path().to_str().unwrap()).unwrap();

        let content = fs::read_to_string(dir.path().join(".gitignore")).unwrap();
        assert_eq!(content, "my-rule\n");
    }

    #[test]
    fn test_linux_appimage_git_commands_remove_appimage_loader_env() {
        let mut command = crate::hidden_command("git");

        sanitize_linux_appimage_git_env_for_launch(&mut command, true);

        let envs = command_envs(&command);

        for key in LINUX_APPIMAGE_GIT_ENV_REMOVALS {
            assert_eq!(envs.get(key), Some(&None));
        }
    }

    #[test]
    fn test_non_appimage_git_commands_keep_parent_env_unmodified() {
        let mut command = crate::hidden_command("git");

        sanitize_linux_appimage_git_env_for_launch(&mut command, false);

        let envs = command_envs(&command);

        for key in LINUX_APPIMAGE_GIT_ENV_REMOVALS {
            assert!(!envs.contains_key(key));
        }
    }

    #[test]
    fn test_git_command_applies_security_config() {
        let args = git_command()
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert_has_config_arg(&args, "core.quotePath=false");
        assert_has_config_arg(&args, "protocol.ext.allow=never");
        assert_has_config_arg(&args, "protocol.file.allow=user");
        assert_has_config_arg(&args, "core.fsmonitor=false");
        assert_has_config_arg(&args, "core.sshCommand=ssh");
    }

    fn assert_has_config_arg(args: &[String], value: &str) {
        assert!(args
            .windows(2)
            .any(|pair| pair[0] == "-c" && pair[1] == value));
    }

    #[test]
    fn test_init_repo_creates_git_directory() {
        let dir = TempDir::new().unwrap();
        let vault = dir.path().join("new-vault");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("note.md"), "# Test\n").unwrap();

        init_repo(vault.to_str().unwrap()).unwrap();

        assert!(vault.join(".git").exists());
    }

    #[test]
    fn test_init_repo_creates_initial_commit() {
        let dir = TempDir::new().unwrap();
        let vault = dir.path().join("new-vault");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("note.md"), "# Test\n").unwrap();

        init_repo(vault.to_str().unwrap()).unwrap();

        let log = git_command()
            .args(["log", "--oneline"])
            .current_dir(&vault)
            .output()
            .unwrap();
        let log_str = String::from_utf8_lossy(&log.stdout);
        assert!(log_str.contains("Initial vault setup"));
    }

    #[test]
    fn test_init_repo_creates_initial_commit_when_signing_is_misconfigured() {
        let dir = TempDir::new().unwrap();
        let vault = dir.path().join("new-vault");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("note.md"), "# Test\n").unwrap();

        git_command()
            .args(["init"])
            .current_dir(&vault)
            .output()
            .unwrap();
        git_command()
            .args(["config", "commit.gpgsign", "true"])
            .current_dir(&vault)
            .output()
            .unwrap();
        git_command()
            .args(["config", "gpg.program", "/missing/tolaria-test-gpg"])
            .current_dir(&vault)
            .output()
            .unwrap();

        init_repo(vault.to_str().unwrap()).unwrap();

        let log = git_command()
            .args(["log", "--oneline"])
            .current_dir(&vault)
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&log.stdout).contains("Initial vault setup"));
    }

    #[test]
    fn test_init_repo_stages_all_files() {
        let dir = TempDir::new().unwrap();
        let vault = dir.path().join("new-vault");
        fs::create_dir_all(vault.join("sub")).unwrap();
        fs::write(vault.join("note.md"), "# Test\n").unwrap();
        fs::write(vault.join("sub/nested.md"), "# Nested\n").unwrap();

        init_repo(vault.to_str().unwrap()).unwrap();

        let status = git_command()
            .args(["status", "--porcelain"])
            .current_dir(&vault)
            .output()
            .unwrap();
        assert!(
            String::from_utf8_lossy(&status.stdout).trim().is_empty(),
            "All files should be committed"
        );
    }

    #[test]
    fn test_init_repo_creates_gitignore() {
        let dir = TempDir::new().unwrap();
        let vault = dir.path().join("new-vault");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("note.md"), "# Test\n").unwrap();

        init_repo(vault.to_str().unwrap()).unwrap();

        let gitignore = vault.join(".gitignore");
        assert!(
            gitignore.exists(),
            ".gitignore should be created by init_repo"
        );
        let content = fs::read_to_string(&gitignore).unwrap();
        assert!(
            content.contains(".DS_Store"),
            ".gitignore should exclude .DS_Store"
        );
        assert!(
            content.contains(".laputa/settings.json"),
            ".gitignore should exclude settings.json"
        );
        // Cache is now stored outside the vault — no need for .gitignore entry
        assert!(
            !content.contains(".laputa-cache.json"),
            ".gitignore should NOT contain .laputa-cache.json (cache is external)"
        );
    }

    #[test]
    fn test_init_repo_does_not_overwrite_existing_gitignore() {
        let dir = TempDir::new().unwrap();
        let vault = dir.path().join("new-vault");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("note.md"), "# Test\n").unwrap();
        fs::write(vault.join(".gitignore"), "custom-rule\n").unwrap();

        init_repo(vault.to_str().unwrap()).unwrap();

        let content = fs::read_to_string(vault.join(".gitignore")).unwrap();
        assert_eq!(
            content, "custom-rule\n",
            "existing .gitignore should not be overwritten"
        );
    }

    #[test]
    fn test_parse_github_repo_path_variants() {
        let tokenized_url = format!(
            "https://{}@github.com/owner/repo.git",
            ["gho", "abc123"].join("_")
        );
        for url in [
            "https://github.com/owner/repo.git",
            "https://github.com/owner/repo",
            "http://github.com/owner/repo.git",
            "git@github.com:owner/repo.git",
            "git@github.com:owner/repo",
            "ssh://git@github.com/owner/repo.git",
            tokenized_url.as_str(),
        ] {
            assert_repo_path(url, Some("owner/repo"));
        }
    }

    #[test]
    fn test_parse_github_repo_path_non_github() {
        assert_repo_path("https://gitlab.com/owner/repo.git", None);
        assert_repo_path("owner/repo", None);
    }
}
