use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;
use uuid::Uuid;

use crate::git::{get_all_file_dates, GitDates};
use std::collections::HashMap;

use super::path_identity::{
    normalize_path_for_identity, push_unique_relative_path, relative_path_key,
    vault_relative_path_string,
};
use super::{is_md_file, parse_md_file, parse_non_md_file, scan_vault, VaultEntry};

// --- Vault Cache ---

/// Bump this when VaultEntry fields change to force a full rescan.
/// v12: fix gray_matter YAML sanitization (unquoted colons / hash comments in list items)
/// v13: preserve plain square brackets in parsed markdown H1 titles
const CACHE_VERSION: u32 = 13;
const CACHE_WRITE_LOCK_STALE_SECS: u64 = 30;

#[derive(Clone, Debug, Serialize, Deserialize)]
struct VaultCache {
    #[serde(default = "default_cache_version")]
    version: u32,
    /// The vault path when the cache was written. Used to detect stale caches
    /// from a different machine or a moved vault directory.
    #[serde(default)]
    vault_path: String,
    commit_hash: String,
    entries: Vec<VaultEntry>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CacheFileFingerprint {
    byte_len: usize,
    content_hash: u64,
}

#[derive(Debug)]
struct LoadedCache {
    cache: VaultCache,
    fingerprint: CacheFileFingerprint,
}

#[derive(Debug)]
enum CacheLoadState {
    Missing,
    Loaded(LoadedCache),
    Invalid(String),
    Unreadable(String),
}

#[derive(Debug, Eq, PartialEq)]
enum CacheWriteOutcome {
    Replaced,
    SkippedConcurrentUpdate,
    SkippedActiveWriter,
}

struct CacheWriteLock {
    path: PathBuf,
}

impl Drop for CacheWriteLock {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_file(&self.path) {
            if error.kind() != ErrorKind::NotFound {
                log::warn!(
                    "Failed to release cache write lock {}: {}",
                    self.path.display(),
                    error
                );
            }
        }
    }
}

fn default_cache_version() -> u32 {
    1
}

/// Compute a deterministic hex hash of the vault path for use as cache filename.
fn vault_path_hash(vault: &Path) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    normalize_path_for_identity(&vault.to_string_lossy()).hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// Return the cache directory. Override with `LAPUTA_CACHE_DIR` env var (for tests).
fn cache_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("LAPUTA_CACHE_DIR") {
        return PathBuf::from(dir);
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("~"))
        .join(".laputa")
        .join("cache")
}

fn cache_path(vault: &Path) -> PathBuf {
    cache_dir().join(format!("{}.json", vault_path_hash(vault)))
}

fn cache_lock_path(vault: &Path) -> PathBuf {
    cache_path(vault).with_extension("lock")
}

fn cache_temp_path(final_path: &Path) -> PathBuf {
    let file_name = final_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("cache.json");
    final_path.with_file_name(format!("{file_name}.{}.tmp", Uuid::new_v4()))
}

/// Legacy cache path inside the vault directory (pre-migration).
fn legacy_cache_path(vault: &Path) -> PathBuf {
    vault.join(".laputa-cache.json")
}

fn git_head_hash(vault: &Path) -> Option<String> {
    run_git(vault, &["rev-parse", "HEAD"]).map(|s| s.trim().to_string())
}

/// Run a git command in the given directory and return stdout if successful.
fn run_git(vault: &Path, args: &[&str]) -> Option<String> {
    let output = crate::git::git_command()
        .args(args)
        .current_dir(vault)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Parse a git status porcelain line into (status_code, file_path).
fn parse_porcelain_line(line: &str) -> Option<(&str, String)> {
    if line.len() < 3 {
        return None;
    }
    Some((&line[..2], line[3..].trim().to_string()))
}

/// Extract file paths from git diff --name-only output.
/// Includes all non-hidden files (not just .md) so the cache picks up
/// view files (.yml), binary assets, etc.
fn collect_paths_from_diff(stdout: &str) -> Vec<String> {
    let mut paths = Vec::new();
    for line in stdout.lines() {
        push_unique_relative_path(&mut paths, line);
    }
    paths
}

/// Extract file paths from git status --porcelain output.
/// Includes all non-hidden files so incremental cache updates cover
/// every file type the vault scanner recognises.
fn collect_paths_from_porcelain(stdout: &str) -> Vec<String> {
    let mut paths = Vec::new();
    for (_, path) in stdout.lines().filter_map(parse_porcelain_line) {
        push_unique_relative_path(&mut paths, path);
    }
    paths
}

fn git_changed_files(vault: &Path, from_hash: &str, to_hash: &str) -> Vec<String> {
    let diff_arg = format!("{}..{}", from_hash, to_hash);
    let mut files = run_git(vault, &["diff", &diff_arg, "--name-only"])
        .map(|s| collect_paths_from_diff(&s))
        .unwrap_or_default();

    // Include uncommitted changes (modified, staged, and untracked files).
    let uncommitted = git_uncommitted_files(vault);

    for path in uncommitted.into_iter() {
        push_unique_relative_path(&mut files, path);
    }

    files
}

fn git_uncommitted_files(vault: &Path) -> Vec<String> {
    // Modified/staged tracked files from git status --porcelain
    let mut files: Vec<String> = run_git(vault, &["status", "--porcelain"])
        .map(|s| collect_paths_from_porcelain(&s))
        .unwrap_or_default();

    // Untracked files via ls-files (lists individual files, not just directories).
    // git status --porcelain shows `?? dir/` for new directories, hiding individual
    // files inside — ls-files resolves them so the cache picks up all new files.
    let untracked = run_git(vault, &["ls-files", "--others", "--exclude-standard"])
        .map(|s| {
            let mut paths = Vec::new();
            for line in s.lines() {
                push_unique_relative_path(&mut paths, line);
            }
            paths
        })
        .unwrap_or_default();

    for path in untracked {
        push_unique_relative_path(&mut files, path);
    }

    files
}

fn cache_fingerprint(bytes: &[u8]) -> CacheFileFingerprint {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hasher);
    CacheFileFingerprint {
        byte_len: bytes.len(),
        content_hash: hasher.finish(),
    }
}

fn read_cache_bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "Failed to read cache {}: {}",
            path.display(),
            error
        )),
    }
}

fn read_cache_fingerprint(path: &Path) -> Result<Option<CacheFileFingerprint>, String> {
    Ok(read_cache_bytes(path)?.map(|bytes| cache_fingerprint(&bytes)))
}

fn load_cache(vault: &Path) -> CacheLoadState {
    let path = cache_path(vault);
    let Some(bytes) = (match read_cache_bytes(&path) {
        Ok(bytes) => bytes,
        Err(error) => return CacheLoadState::Unreadable(error),
    }) else {
        return CacheLoadState::Missing;
    };

    let fingerprint = cache_fingerprint(&bytes);
    match serde_json::from_slice(&bytes) {
        Ok(cache) => CacheLoadState::Loaded(LoadedCache { cache, fingerprint }),
        Err(error) => CacheLoadState::Invalid(format!(
            "Failed to parse cache {}: {}",
            path.display(),
            error
        )),
    }
}

fn lock_is_stale(lock_path: &Path) -> bool {
    fs::metadata(lock_path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.elapsed().ok())
        .map(|elapsed| elapsed > Duration::from_secs(CACHE_WRITE_LOCK_STALE_SECS))
        .unwrap_or(false)
}

fn ensure_cache_parent_dir(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create cache directory {}: {}",
                parent.display(),
                error
            )
        })?;
    }
    Ok(())
}

fn initialize_cache_write_lock(
    mut file: fs::File,
    lock_path: &Path,
) -> Result<CacheWriteLock, String> {
    let pid = std::process::id().to_string();
    if let Err(error) = file.write_all(pid.as_bytes()).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(lock_path);
        return Err(format!(
            "Failed to initialize cache write lock {}: {}",
            lock_path.display(),
            error
        ));
    }
    Ok(CacheWriteLock {
        path: lock_path.to_path_buf(),
    })
}

fn try_create_cache_write_lock(lock_path: &Path) -> Result<Option<CacheWriteLock>, String> {
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(lock_path)
    {
        Ok(file) => initialize_cache_write_lock(file, lock_path).map(Some),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => Ok(None),
        Err(error) => Err(format!(
            "Failed to acquire cache write lock {}: {}",
            lock_path.display(),
            error
        )),
    }
}

fn remove_stale_cache_write_lock(lock_path: &Path) -> Result<bool, String> {
    if !lock_is_stale(lock_path) {
        return Ok(false);
    }

    log::warn!("Removing stale cache write lock {}", lock_path.display());
    match fs::remove_file(lock_path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(true),
        Err(error) => Err(format!(
            "Failed to remove stale cache write lock {}: {}",
            lock_path.display(),
            error
        )),
    }
}

fn acquire_cache_write_lock(lock_path: &Path) -> Result<Option<CacheWriteLock>, String> {
    ensure_cache_parent_dir(lock_path)?;
    if let Some(lock) = try_create_cache_write_lock(lock_path)? {
        return Ok(Some(lock));
    }
    if !remove_stale_cache_write_lock(lock_path)? {
        return Ok(None);
    }
    try_create_cache_write_lock(lock_path)
}

fn remove_cache_file(path: &Path, reason: &str) {
    if let Err(error) = fs::remove_file(path) {
        if error.kind() != ErrorKind::NotFound {
            log::warn!("Failed to remove {reason} {}: {}", path.display(), error);
        }
    }
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) -> Result<(), String> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    fs::File::open(parent)
        .and_then(|dir| dir.sync_all())
        .map_err(|error| {
            format!(
                "Failed to sync cache directory {}: {}",
                parent.display(),
                error
            )
        })
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) -> Result<(), String> {
    Ok(())
}

/// Replace the cache file using a temp file + rename, but only if the on-disk
/// cache still matches the version we loaded earlier.
fn write_cache(
    vault: &Path,
    cache: &VaultCache,
    expected_previous: Option<CacheFileFingerprint>,
) -> Result<CacheWriteOutcome, String> {
    let final_path = cache_path(vault);
    let lock_path = cache_lock_path(vault);
    let Some(_lock) = acquire_cache_write_lock(&lock_path)? else {
        return Ok(CacheWriteOutcome::SkippedActiveWriter);
    };

    let current_fingerprint = read_cache_fingerprint(&final_path)?;
    let still_matches_loaded_state = match expected_previous.as_ref() {
        Some(expected) => current_fingerprint.as_ref() == Some(expected),
        None => current_fingerprint.is_none(),
    };
    if !still_matches_loaded_state {
        return Ok(CacheWriteOutcome::SkippedConcurrentUpdate);
    }

    ensure_cache_parent_dir(&final_path)?;

    let data = serde_json::to_vec(cache).map_err(|error| {
        format!(
            "Failed to serialize cache {}: {}",
            final_path.display(),
            error
        )
    })?;
    let tmp_path = cache_temp_path(&final_path);
    let mut tmp_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp_path)
        .map_err(|error| {
            format!(
                "Failed to create temp cache file {}: {}",
                tmp_path.display(),
                error
            )
        })?;

    if let Err(error) = tmp_file.write_all(&data).and_then(|_| tmp_file.sync_all()) {
        remove_cache_file(&tmp_path, "temp cache file");
        return Err(format!(
            "Failed to flush temp cache file {}: {}",
            tmp_path.display(),
            error
        ));
    }
    drop(tmp_file);

    if let Err(error) = fs::rename(&tmp_path, &final_path) {
        remove_cache_file(&tmp_path, "temp cache file");
        return Err(format!(
            "Failed to replace cache {}: {}",
            final_path.display(),
            error
        ));
    }

    if let Err(error) = sync_parent_directory(&final_path) {
        log::warn!("{error}");
    }

    Ok(CacheWriteOutcome::Replaced)
}

/// Normalize an absolute path to a relative path for comparison with git output.
fn to_relative_path(abs_path: &str, vault: &Path) -> String {
    vault_relative_path_string(vault, Path::new(abs_path))
        .unwrap_or_else(|_| normalize_path_for_identity(abs_path))
}

fn to_relative_path_key(abs_path: &str, vault: &Path) -> String {
    relative_path_key(&to_relative_path(abs_path, vault))
}

/// Parse files from a list of relative paths, skipping any that don't exist.
/// Dispatches to the appropriate parser based on file extension.
fn parse_files_at(
    vault: &Path,
    rel_paths: &[String],
    git_dates: &HashMap<String, GitDates>,
) -> Vec<VaultEntry> {
    rel_paths
        .iter()
        .filter_map(|rel| {
            let abs = vault.join(rel);
            if abs.is_file() {
                let dates = git_dates
                    .get(rel.as_str())
                    .map(|d| (d.modified_at, d.created_at));
                if is_md_file(&abs) {
                    parse_md_file(&abs, dates).ok()
                } else {
                    parse_non_md_file(&abs, dates).ok()
                }
            } else {
                None
            }
        })
        .collect()
}

/// Copy legacy cache data to the new external location via temp file + rename.
fn copy_legacy_cache_to(legacy: &Path, dest: &Path) {
    if let Some(parent) = dest.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let tmp_path = dest.with_extension("tmp");
    if let Ok(data) = fs::read_to_string(legacy) {
        if fs::write(&tmp_path, &data).is_ok() {
            let _ = fs::rename(&tmp_path, dest);
        }
    }
}

/// Migrate legacy cache from inside the vault to the new external location.
/// Also removes the legacy file from git tracking if present.
fn migrate_legacy_cache(vault: &Path) {
    let legacy = legacy_cache_path(vault);
    if !legacy.exists() {
        return;
    }

    let new_path = cache_path(vault);
    if !new_path.exists() {
        copy_legacy_cache_to(&legacy, &new_path);
    }

    // Remove legacy file from git tracking if present
    let _ = crate::hidden_command("git")
        .args([
            "rm",
            "--cached",
            "--quiet",
            "--ignore-unmatch",
            ".laputa-cache.json",
        ])
        .current_dir(vault)
        .output();

    // Delete the legacy file from disk
    let _ = fs::remove_file(&legacy);
}

/// Remove entries for files that no longer exist on disk and deduplicate
/// by case-folded relative path (handles case-insensitive filesystems like macOS APFS).
/// Returns `true` if any entries were removed.
fn prune_stale_entries(vault: &Path, entries: &mut Vec<VaultEntry>) -> bool {
    let before = entries.len();
    // Remove entries whose files no longer exist on disk
    entries.retain(|e| std::path::Path::new(&e.path).is_file());
    // Deduplicate by case-folded relative path
    let mut seen = std::collections::HashSet::new();
    entries.retain(|e| {
        let rel = to_relative_path_key(&e.path, vault);
        seen.insert(rel)
    });
    entries.len() != before
}

/// Sort entries by modified_at descending and write the cache.
fn finalize_and_cache(
    vault: &Path,
    mut entries: Vec<VaultEntry>,
    hash: String,
    expected_previous: Option<CacheFileFingerprint>,
) -> Vec<VaultEntry> {
    prune_stale_entries(vault, &mut entries);
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.modified_at));
    let outcome = write_cache(
        vault,
        &VaultCache {
            version: CACHE_VERSION,
            vault_path: vault.to_string_lossy().to_string(),
            commit_hash: hash,
            entries: entries.clone(),
        },
        expected_previous,
    );
    match outcome {
        Ok(CacheWriteOutcome::Replaced) => {}
        Ok(CacheWriteOutcome::SkippedConcurrentUpdate) => log::info!(
            "Skipped replacing cache {} because another scan refreshed it first",
            cache_path(vault).display()
        ),
        Ok(CacheWriteOutcome::SkippedActiveWriter) => log::info!(
            "Skipped replacing cache {} because another writer is active",
            cache_path(vault).display()
        ),
        Err(error) => log::warn!("{error}"),
    }
    entries
}

/// Handle same-commit cache hit: re-parse any uncommitted changes (new or modified files).
/// Always prunes stale entries even when git reports no changes, so that files
/// deleted outside git (e.g., via Finder) are removed from the cache on vault open.
fn update_same_commit(
    vault: &Path,
    loaded_cache: LoadedCache,
    git_dates: &HashMap<String, GitDates>,
) -> Vec<VaultEntry> {
    let LoadedCache { cache, fingerprint } = loaded_cache;
    let changed = git_uncommitted_files(vault);
    let mut entries = cache.entries;
    if !changed.is_empty() {
        let changed_set: std::collections::HashSet<String> =
            changed.iter().map(|path| relative_path_key(path)).collect();
        entries.retain(|e| !changed_set.contains(&to_relative_path_key(&e.path, vault)));
        entries.extend(parse_files_at(vault, &changed, git_dates));
    }
    // Always finalize: prune_stale_entries inside finalize_and_cache removes
    // entries for files deleted outside git (e.g., via Finder or another app).
    finalize_and_cache(vault, entries, cache.commit_hash, Some(fingerprint))
}

/// Handle different-commit cache: incremental update via git diff.
fn update_different_commit(
    vault: &Path,
    loaded_cache: LoadedCache,
    current_hash: String,
    git_dates: &HashMap<String, GitDates>,
) -> Vec<VaultEntry> {
    let LoadedCache { cache, fingerprint } = loaded_cache;
    let changed_files = git_changed_files(vault, &cache.commit_hash, &current_hash);
    let changed_set: std::collections::HashSet<String> = changed_files
        .iter()
        .map(|path| relative_path_key(path))
        .collect();

    let mut entries: Vec<VaultEntry> = cache
        .entries
        .into_iter()
        .filter(|e| !changed_set.contains(&to_relative_path_key(&e.path, vault)))
        .collect();
    entries.extend(parse_files_at(vault, &changed_files, git_dates));

    finalize_and_cache(vault, entries, current_hash, Some(fingerprint))
}

fn cache_requires_full_rescan(cache: &VaultCache, vault_path: &Path) -> bool {
    let current_vault_str = normalize_path_for_identity(&vault_path.to_string_lossy());
    cache.version != CACHE_VERSION
        || (!cache.vault_path.is_empty()
            && normalize_path_for_identity(&cache.vault_path) != current_vault_str)
}

fn scan_and_cache_full(
    vault_path: &Path,
    git_dates: &HashMap<String, GitDates>,
    current_hash: String,
    expected_previous: Option<CacheFileFingerprint>,
) -> Result<Vec<VaultEntry>, String> {
    let entries = scan_vault(vault_path, git_dates)?;
    Ok(finalize_and_cache(
        vault_path,
        entries,
        current_hash,
        expected_previous,
    ))
}

/// Delete the cache file for a vault, forcing a full rescan on the next
/// call to `scan_vault_cached`. Used by the `reload_vault` command so that
/// explicit user-triggered reloads always read from the filesystem.
pub fn invalidate_cache(vault_path: &Path) {
    let path = cache_path(vault_path);
    remove_cache_file(&path, "cache file");
}

/// Scan vault with incremental caching via git.
/// Falls back to full scan if cache is missing/corrupt or git is unavailable.
pub fn scan_vault_cached(vault_path: &Path) -> Result<Vec<VaultEntry>, String> {
    if !vault_path.exists() || !vault_path.is_dir() {
        return Err(format!(
            "Vault path does not exist or is not a directory: {}",
            vault_path.display()
        ));
    }

    // Migrate legacy in-vault cache to external location on first run
    migrate_legacy_cache(vault_path);

    let current_hash = match git_head_hash(vault_path) {
        Some(h) => h,
        None => return scan_vault(vault_path, &HashMap::new()),
    };

    // Build git dates map once — used by all code paths below
    let git_dates = get_all_file_dates(vault_path);

    match load_cache(vault_path) {
        CacheLoadState::Missing => {}
        CacheLoadState::Unreadable(error) => log::warn!("{error}"),
        CacheLoadState::Invalid(error) => {
            log::warn!("{error}");
            remove_cache_file(&cache_path(vault_path), "invalid cache file");
        }
        CacheLoadState::Loaded(loaded_cache) => {
            if cache_requires_full_rescan(&loaded_cache.cache, vault_path) {
                return scan_and_cache_full(
                    vault_path,
                    &git_dates,
                    current_hash,
                    Some(loaded_cache.fingerprint),
                );
            }
            return if loaded_cache.cache.commit_hash == current_hash {
                Ok(update_same_commit(vault_path, loaded_cache, &git_dates))
            } else {
                Ok(update_different_commit(
                    vault_path,
                    loaded_cache,
                    current_hash,
                    &git_dates,
                ))
            };
        }
    }

    // No cache — full scan and write cache
    scan_and_cache_full(vault_path, &git_dates, current_hash, None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::Mutex;
    use tempfile::TempDir;

    /// Serialize all cache tests that mutate the LAPUTA_CACHE_DIR env var.
    /// `std::env::set_var` is process-global, so parallel tests would race.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    /// Set up a temporary cache directory for test isolation.
    /// Caller MUST hold `ENV_LOCK` for the duration of the test.
    fn set_test_cache_dir(dir: &Path) {
        std::env::set_var("LAPUTA_CACHE_DIR", dir.to_string_lossy().as_ref());
    }

    fn create_test_file(dir: &Path, name: &str, content: &str) {
        let file_path = dir.join(name);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut file = fs::File::create(file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();
    }

    fn init_git_repo(vault: &Path) {
        crate::hidden_command("git")
            .args(["init"])
            .current_dir(vault)
            .output()
            .unwrap();
        crate::hidden_command("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(vault)
            .output()
            .unwrap();
        crate::hidden_command("git")
            .args(["config", "user.name", "Test"])
            .current_dir(vault)
            .output()
            .unwrap();
    }

    /// Common setup: acquire env lock, create temp cache dir + git-initialised vault.
    /// Returns (lock_guard, cache_tmpdir, vault_tmpdir) — keep all alive for the test.
    fn setup_git_vault() -> (std::sync::MutexGuard<'static, ()>, TempDir, TempDir) {
        let lock = ENV_LOCK.lock().unwrap();
        let cache_tmp = TempDir::new().unwrap();
        set_test_cache_dir(cache_tmp.path());
        let vault_tmp = TempDir::new().unwrap();
        init_git_repo(vault_tmp.path());
        (lock, cache_tmp, vault_tmp)
    }

    fn git_add_commit(vault: &Path, msg: &str) {
        crate::hidden_command("git")
            .args(["add", "."])
            .current_dir(vault)
            .output()
            .unwrap();
        crate::hidden_command("git")
            .args(["commit", "-m", msg])
            .current_dir(vault)
            .output()
            .unwrap();
    }

    fn force_quoted_git_paths(vault: &Path) {
        crate::hidden_command("git")
            .args(["config", "core.quotePath", "true"])
            .current_dir(vault)
            .output()
            .unwrap();
    }

    #[test]
    fn test_cache_path_is_outside_vault() {
        let _lock = ENV_LOCK.lock().unwrap();
        let cache_dir = TempDir::new().unwrap();
        set_test_cache_dir(cache_dir.path());

        let vault = Path::new("/Users/test/MyVault");
        let path = cache_path(vault);

        // Cache must NOT be inside the vault
        assert!(
            !path.starts_with(vault),
            "cache path must be outside the vault, got: {}",
            path.display()
        );
        // Cache must be under the cache directory
        assert!(
            path.starts_with(cache_dir.path()),
            "cache path must be under cache dir, got: {}",
            path.display()
        );
        // Must end with .json
        assert_eq!(path.extension().unwrap(), "json");
    }

    #[test]
    fn test_vault_path_hash_is_deterministic() {
        let hash1 = vault_path_hash(Path::new("/Users/test/MyVault"));
        let hash2 = vault_path_hash(Path::new("/Users/test/MyVault"));
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_to_relative_path_normalizes_aliases_and_separators() {
        assert_eq!(
            to_relative_path(
                "/tmp/tolaria-vault/projects\\active.md",
                Path::new("/private/tmp/tolaria-vault")
            ),
            "projects/active.md"
        );
    }

    #[test]
    fn test_different_vaults_get_different_hashes() {
        let hash1 = vault_path_hash(Path::new("/Users/test/Vault1"));
        let hash2 = vault_path_hash(Path::new("/Users/test/Vault2"));
        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_cache_write_no_tmp_file_left() {
        let _lock = ENV_LOCK.lock().unwrap();
        let cache_dir = TempDir::new().unwrap();
        set_test_cache_dir(cache_dir.path());

        let vault_dir = TempDir::new().unwrap();
        let vault = vault_dir.path();

        let cache = VaultCache {
            version: CACHE_VERSION,
            vault_path: vault.to_string_lossy().to_string(),
            commit_hash: "abc123".to_string(),
            entries: vec![],
        };

        write_cache(vault, &cache, None).unwrap();

        // Final file should exist
        let final_path = cache_path(vault);
        assert!(final_path.exists(), "cache file must exist after write");

        // Tmp files should NOT remain beside the cache file
        let tmp_count = fs::read_dir(cache_dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp"))
            .count();
        assert_eq!(tmp_count, 0, "cache write must not leave tmp files behind");

        // Content must be valid JSON
        let data = fs::read_to_string(&final_path).unwrap();
        let loaded: VaultCache = serde_json::from_str(&data).unwrap();
        assert_eq!(loaded.commit_hash, "abc123");
    }

    #[test]
    fn test_legacy_cache_migration() {
        let (_lock, _cache_tmp, vault_dir) = setup_git_vault();
        let vault = vault_dir.path();

        // Create a legacy cache file inside the vault
        let legacy = legacy_cache_path(vault);
        let cache = VaultCache {
            version: CACHE_VERSION,
            vault_path: vault.to_string_lossy().to_string(),
            commit_hash: "old123".to_string(),
            entries: vec![],
        };
        fs::write(&legacy, serde_json::to_string(&cache).unwrap()).unwrap();

        // Run migration
        migrate_legacy_cache(vault);

        // New cache file should exist with migrated data
        let new_path = cache_path(vault);
        assert!(new_path.exists(), "migrated cache must exist");
        let data = fs::read_to_string(&new_path).unwrap();
        let loaded: VaultCache = serde_json::from_str(&data).unwrap();
        assert_eq!(loaded.commit_hash, "old123");

        // Legacy file should be deleted
        assert!(!legacy.exists(), "legacy cache file must be removed");
    }

    #[test]
    fn test_scan_vault_cached_no_git() {
        let _lock = ENV_LOCK.lock().unwrap();
        let cache_dir = TempDir::new().unwrap();
        set_test_cache_dir(cache_dir.path());

        // Without git, scan_vault_cached falls back to scan_vault
        let dir = TempDir::new().unwrap();
        create_test_file(dir.path(), "note.md", "# Note\n\nContent here.");

        let entries = scan_vault_cached(dir.path()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].title, "Note");
        assert_eq!(entries[0].snippet, "Content here.");
    }

    #[test]
    fn test_scan_vault_cached_with_git() {
        let (_lock, _cache_tmp, dir) = setup_git_vault();
        let vault = dir.path();

        create_test_file(vault, "note.md", "# Note\n\nFirst version.");
        git_add_commit(vault, "init");

        // First call: full scan, writes cache
        let entries = scan_vault_cached(vault).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(cache_path(vault).exists());

        // Cache must NOT be inside the vault
        assert!(
            !cache_path(vault).starts_with(vault),
            "cache must be outside the vault"
        );

        // Second call: uses cache (same HEAD)
        let entries2 = scan_vault_cached(vault).unwrap();
        assert_eq!(entries2.len(), 1);
        assert_eq!(entries2[0].title, "Note");
    }

    #[test]
    fn test_scan_vault_cached_invalidates_stale_vault_path() {
        let (_lock, _cache_tmp, dir) = setup_git_vault();
        let vault = dir.path();

        create_test_file(vault, "note.md", "# Note\n\nContent.");
        git_add_commit(vault, "init");

        // Build cache normally
        let entries = scan_vault_cached(vault).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(
            entries[0]
                .path
                .starts_with(vault.to_string_lossy().as_ref()),
            "Entry path should start with vault path"
        );

        // Tamper with cache to simulate a clone from a different machine
        let cache_file = cache_path(vault);
        let cache_data = fs::read_to_string(&cache_file).unwrap();
        let tampered = cache_data.replace(
            vault.to_string_lossy().as_ref(),
            "/Users/other-machine/OtherVault",
        );
        fs::write(&cache_file, tampered).unwrap();

        // Rescanning should invalidate the stale cache and produce correct paths
        let entries2 = scan_vault_cached(vault).unwrap();
        assert_eq!(entries2.len(), 1);
        assert!(
            entries2[0]
                .path
                .starts_with(vault.to_string_lossy().as_ref()),
            "After stale-cache invalidation, paths should use the current vault path, got: {}",
            entries2[0].path
        );
    }

    #[test]
    fn test_scan_vault_cached_incremental_different_commit() {
        let (_lock, _cache_tmp, dir) = setup_git_vault();
        let vault = dir.path();

        create_test_file(vault, "first.md", "# First\n\nFirst note.");
        git_add_commit(vault, "first");

        // Build cache
        let entries = scan_vault_cached(vault).unwrap();
        assert_eq!(entries.len(), 1);

        // Add a second file and commit
        create_test_file(vault, "second.md", "# Second\n\nSecond note.");
        git_add_commit(vault, "second");

        // Incremental update: cache has old commit, new commit adds second.md
        let entries2 = scan_vault_cached(vault).unwrap();
        assert_eq!(entries2.len(), 2);
        let titles: Vec<&str> = entries2.iter().map(|e| e.title.as_str()).collect();
        assert!(titles.contains(&"First"));
        assert!(titles.contains(&"Second"));
    }

    #[test]
    fn test_update_same_commit_picks_up_modified_file() {
        let (_lock, _cache_tmp, dir) = setup_git_vault();
        let vault = dir.path();

        // Commit a type note without sidebar label
        create_test_file(vault, "news.md", "---\ntype: Type\n---\n# News\n");
        git_add_commit(vault, "init");

        // Prime the cache (same commit hash)
        let entries = scan_vault_cached(vault).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].sidebar_label, None);

        // User edits the type note to add sidebar label (uncommitted)
        create_test_file(
            vault,
            "news.md",
            "---\ntype: Type\nsidebar label: News\n---\n# News\n",
        );

        // Reload with same git HEAD — must pick up the modification
        let entries2 = scan_vault_cached(vault).unwrap();
        assert_eq!(entries2.len(), 1);
        assert_eq!(
            entries2[0].sidebar_label,
            Some("News".to_string()),
            "sidebarLabel must reflect the uncommitted edit"
        );
    }

    #[test]
    fn test_git_uncommitted_files_preserves_chinese_markdown_path() {
        let (_lock, _cache_tmp, dir) = setup_git_vault();
        let vault = dir.path();
        let relative_path = "中文笔记.md";

        force_quoted_git_paths(vault);
        create_test_file(vault, relative_path, "# 初始\n");
        git_add_commit(vault, "init");
        create_test_file(vault, relative_path, "# 初始\n\n更新\n");

        let changed = git_uncommitted_files(vault);

        assert_eq!(changed, vec![relative_path.to_string()]);
    }

    #[test]
    fn test_update_same_commit_new_file_still_added() {
        let (_lock, _cache_tmp, dir) = setup_git_vault();
        let vault = dir.path();

        create_test_file(vault, "existing.md", "# Existing\n");
        git_add_commit(vault, "init");

        // Prime cache
        let entries = scan_vault_cached(vault).unwrap();
        assert_eq!(entries.len(), 1);

        // Create new untracked file
        create_test_file(vault, "new-note.md", "# New Note\n");

        // Cache still same commit — new untracked file must appear
        let entries2 = scan_vault_cached(vault).unwrap();
        assert_eq!(entries2.len(), 2);
        let titles: Vec<&str> = entries2.iter().map(|e| e.title.as_str()).collect();
        assert!(titles.contains(&"Existing"));
        assert!(titles.contains(&"New Note"));
    }

    #[test]
    fn test_update_same_commit_new_files_in_new_subdirectory() {
        let (_lock, _cache_tmp, dir) = setup_git_vault();
        let vault = dir.path();

        create_test_file(
            vault,
            "existing.md",
            "---\ntitle: Existing\n---\n# Existing\n",
        );
        git_add_commit(vault, "init");

        // Prime cache
        let entries = scan_vault_cached(vault).unwrap();
        assert_eq!(entries.len(), 1);

        // Create files in a new protected subdirectory (simulates asset creation)
        create_test_file(
            vault,
            "assets/default-theme.md",
            "---\ntitle: Default Theme\nIs A: Theme\n---\n# Default Theme\n",
        );
        create_test_file(
            vault,
            "assets/dark-theme.md",
            "---\ntitle: Dark Theme\nIs A: Theme\n---\n# Dark Theme\n",
        );

        // Cache same commit — files in new subdirectory must appear
        let entries2 = scan_vault_cached(vault).unwrap();
        assert_eq!(
            entries2.len(),
            3,
            "must pick up files in new untracked subdirectory"
        );
        let titles: Vec<&str> = entries2.iter().map(|e| e.title.as_str()).collect();
        assert!(titles.contains(&"Existing"));
        assert!(titles.contains(&"Default Theme"));
        assert!(titles.contains(&"Dark Theme"));
    }

    #[test]
    fn test_update_same_commit_visible_removed_from_type_note() {
        let (_lock, _cache_tmp, dir) = setup_git_vault();
        let vault = dir.path();

        // Commit a type note with visible: false
        create_test_file(
            vault,
            "topic.md",
            "---\ntype: Type\nvisible: false\n---\n# Topic\n",
        );
        git_add_commit(vault, "init");

        // Prime the cache
        let entries = scan_vault_cached(vault).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].visible,
            Some(false),
            "visible must be false initially"
        );

        // User removes visible field (uncommitted edit)
        create_test_file(vault, "topic.md", "---\ntype: Type\n---\n# Topic\n");

        // Reload — must reflect the removal (visible defaults to None)
        let entries2 = scan_vault_cached(vault).unwrap();
        assert_eq!(entries2.len(), 1);
        assert_eq!(
            entries2[0].visible, None,
            "visible must be None after removing the field"
        );
    }

    #[test]
    fn test_deleted_file_removed_from_cache_on_rescan() {
        let (_lock, _cache_tmp, dir) = setup_git_vault();
        let vault = dir.path();

        create_test_file(vault, "keep.md", "# Keep\n\nStays.");
        create_test_file(vault, "remove.md", "# Remove\n\nGoes away.");
        git_add_commit(vault, "init");

        // Prime cache with both files
        let entries = scan_vault_cached(vault).unwrap();
        assert_eq!(entries.len(), 2);

        // Delete file via filesystem (simulates Finder delete)
        fs::remove_file(vault.join("remove.md")).unwrap();
        // Also stage the deletion so git status is clean for this file
        crate::hidden_command("git")
            .args(["add", "remove.md"])
            .current_dir(vault)
            .output()
            .unwrap();

        // Rescan — deleted file must be pruned
        let entries2 = scan_vault_cached(vault).unwrap();
        assert_eq!(entries2.len(), 1, "deleted file must be pruned on rescan");
        assert_eq!(entries2[0].title, "Keep");
    }

    #[test]
    fn test_deleted_untracked_file_removed_from_cache() {
        let (_lock, _cache_tmp, dir) = setup_git_vault();
        let vault = dir.path();

        create_test_file(vault, "tracked.md", "# Tracked\n\nCommitted.");
        git_add_commit(vault, "init");

        // Create untracked file and prime cache
        create_test_file(vault, "temp.md", "# Temp\n\nUntracked.");
        let entries = scan_vault_cached(vault).unwrap();
        assert_eq!(entries.len(), 2);

        // Delete the untracked file via filesystem
        fs::remove_file(vault.join("temp.md")).unwrap();

        // Rescan — untracked deleted file must be pruned
        let entries2 = scan_vault_cached(vault).unwrap();
        assert_eq!(
            entries2.len(),
            1,
            "deleted untracked file must be pruned on rescan"
        );
        assert_eq!(entries2[0].title, "Tracked");
    }

    #[test]
    fn test_case_rename_no_duplicates() {
        let (_lock, _cache_tmp, dir) = setup_git_vault();
        let vault = dir.path();

        create_test_file(vault, "Note.md", "# Note\n\nOriginal case.");
        git_add_commit(vault, "init");

        // Prime cache
        let entries = scan_vault_cached(vault).unwrap();
        assert_eq!(entries.len(), 1);

        // Simulate case-only rename on case-insensitive FS: delete old, create new
        fs::remove_file(vault.join("Note.md")).unwrap();
        create_test_file(vault, "note.md", "# Note\n\nRenamed case.");
        git_add_commit(vault, "rename");

        // Rescan — must not have duplicates
        let entries2 = scan_vault_cached(vault).unwrap();
        assert_eq!(
            entries2.len(),
            1,
            "case-only rename must not create duplicates"
        );
    }

    #[test]
    fn test_invalidate_cache_deletes_cache_file() {
        let (_lock, _cache_tmp, dir) = setup_git_vault();
        let vault = dir.path();

        create_test_file(vault, "note.md", "# Note\n\nContent.");
        git_add_commit(vault, "init");

        // Build cache
        let _ = scan_vault_cached(vault).unwrap();
        assert!(cache_path(vault).exists(), "cache file must exist");

        // Invalidate
        invalidate_cache(vault);
        assert!(
            !cache_path(vault).exists(),
            "cache file must be deleted after invalidation"
        );
    }

    #[test]
    fn test_invalidate_then_scan_forces_full_rescan() {
        let (_lock, _cache_tmp, dir) = setup_git_vault();
        let vault = dir.path();

        create_test_file(vault, "note.md", "---\n_archived: false\n---\n# Note\n");
        git_add_commit(vault, "init");

        // Build cache — note is not archived
        let entries = scan_vault_cached(vault).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].archived, "note must not be archived initially");

        // Simulate archiving the note on disk (update frontmatter directly)
        create_test_file(vault, "note.md", "---\n_archived: true\n---\n# Note\n");
        // Stage the change so git sees it
        git_add_commit(vault, "archive");

        // Without invalidation, scan_vault_cached uses incremental update.
        // With invalidation, it must do a full rescan from disk.
        invalidate_cache(vault);
        let entries2 = scan_vault_cached(vault).unwrap();
        assert_eq!(entries2.len(), 1);
        assert!(
            entries2[0].archived,
            "note must be archived after invalidate + rescan"
        );
    }

    /// Integration test: a note with `Archived: Yes` (string, not boolean)
    /// must be recognized as archived through the full cached vault load path.
    /// This catches the scenario where a stale cache stores `archived: false`
    /// and the cache version bump forces a correct re-parse.
    #[test]
    fn test_cached_vault_archived_yes_string() {
        let (_lock, _cache_tmp, dir) = setup_git_vault();
        let vault = dir.path();

        create_test_file(
            vault,
            "archived-note.md",
            "---\nArchived: Yes\n---\n# Old Note\n",
        );
        git_add_commit(vault, "init");

        let entries = scan_vault_cached(vault).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(
            entries[0].archived,
            "'Archived: Yes' must be parsed as true through the cached vault path"
        );
    }

    /// Integration test: stale cache with old version is invalidated and
    /// re-parses `Archived: Yes` correctly after cache version bump.
    #[test]
    fn test_stale_cache_version_forces_rescan_of_archived_yes() {
        let (_lock, _cache_tmp, dir) = setup_git_vault();
        let vault = dir.path();

        create_test_file(vault, "note.md", "---\nArchived: Yes\n---\n# Note\n");
        git_add_commit(vault, "init");

        let hash = git_head_hash(vault).unwrap();

        // Simulate a stale cache written by old code that parsed Archived: Yes as false
        let stale_entry = {
            let mut e = parse_md_file(&vault.join("note.md"), None).unwrap();
            e.archived = false; // simulate old parser behavior
            e
        };
        let stale_cache = VaultCache {
            version: CACHE_VERSION - 1, // old version
            vault_path: vault.to_string_lossy().to_string(),
            commit_hash: hash,
            entries: vec![stale_entry],
        };
        write_cache(vault, &stale_cache, None).unwrap();

        // Load via cached path — stale version must trigger full rescan
        let entries = scan_vault_cached(vault).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(
            entries[0].archived,
            "stale cache with old version must be invalidated, re-parsing 'Archived: Yes' as true"
        );
    }

    #[test]
    fn test_update_same_commit_picks_up_new_yml_file() {
        let (_lock, _cache_tmp, dir) = setup_git_vault();
        let vault = dir.path();

        create_test_file(vault, "note.md", "# Note\n\nContent.");
        git_add_commit(vault, "init");

        // Prime cache
        let entries = scan_vault_cached(vault).unwrap();
        assert_eq!(entries.len(), 1);

        // Create a new .yml view file (untracked, like save_view does)
        create_test_file(vault, "views/my-view.yml", "name: My View\nfilters: []\n");

        // Same commit — new .yml file must appear in entries
        let entries2 = scan_vault_cached(vault).unwrap();
        assert!(
            entries2.len() >= 2,
            "new .yml file must be picked up by cache update, got {} entries",
            entries2.len()
        );
        assert!(
            entries2.iter().any(|e| e.path.contains("my-view.yml")),
            "entries must include the new .yml file"
        );
    }

    #[test]
    fn test_incremental_different_commit_picks_up_yml_file() {
        let (_lock, _cache_tmp, dir) = setup_git_vault();
        let vault = dir.path();

        create_test_file(vault, "note.md", "# Note\n\nContent.");
        git_add_commit(vault, "init");

        // Prime cache
        let entries = scan_vault_cached(vault).unwrap();
        assert_eq!(entries.len(), 1);

        // Add a .yml file and commit
        create_test_file(vault, "views/my-view.yml", "name: My View\nfilters: []\n");
        git_add_commit(vault, "add view");

        // Different commit — .yml file must appear in entries
        let entries2 = scan_vault_cached(vault).unwrap();
        assert!(
            entries2.iter().any(|e| e.path.contains("my-view.yml")),
            "committed .yml file must be picked up by incremental cache update"
        );
    }

    #[test]
    fn test_load_cache_marks_invalid_json() {
        let (_lock, _cache_tmp, dir) = setup_git_vault();
        let vault = dir.path();

        fs::write(cache_path(vault), "{ not-json").unwrap();

        let load = load_cache(vault);
        assert!(
            matches!(load, CacheLoadState::Invalid(_)),
            "invalid cache JSON must be distinguished from a cache miss"
        );
    }

    #[test]
    fn test_write_cache_skips_overwriting_newer_cache() {
        let (_lock, _cache_tmp, dir) = setup_git_vault();
        let vault = dir.path();

        let original = VaultCache {
            version: CACHE_VERSION,
            vault_path: vault.to_string_lossy().to_string(),
            commit_hash: "original".to_string(),
            entries: vec![],
        };
        write_cache(vault, &original, None).unwrap();

        let CacheLoadState::Loaded(loaded) = load_cache(vault) else {
            panic!("expected original cache to load");
        };

        let newer = VaultCache {
            commit_hash: "newer".to_string(),
            ..original
        };
        write_cache(vault, &newer, Some(loaded.fingerprint.clone())).unwrap();

        let stale = VaultCache {
            commit_hash: "stale".to_string(),
            ..newer
        };
        let outcome = write_cache(vault, &stale, Some(loaded.fingerprint)).unwrap();
        assert_eq!(outcome, CacheWriteOutcome::SkippedConcurrentUpdate);

        let CacheLoadState::Loaded(final_cache) = load_cache(vault) else {
            panic!("expected final cache to load");
        };
        assert_eq!(final_cache.cache.commit_hash, "newer");
    }

    #[test]
    fn test_write_cache_skips_when_writer_lock_is_held() {
        let (_lock, _cache_tmp, dir) = setup_git_vault();
        let vault = dir.path();

        let lock_path = cache_lock_path(vault);
        if let Some(parent) = lock_path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&lock_path, "busy").unwrap();

        let cache = VaultCache {
            version: CACHE_VERSION,
            vault_path: vault.to_string_lossy().to_string(),
            commit_hash: "busy".to_string(),
            entries: vec![],
        };
        let outcome = write_cache(vault, &cache, None).unwrap();
        assert_eq!(outcome, CacheWriteOutcome::SkippedActiveWriter);
        assert!(
            !cache_path(vault).exists(),
            "active writer lock must prevent a competing cache write"
        );
    }
}
