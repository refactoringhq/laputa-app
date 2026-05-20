#![forbid(unsafe_code)]
//! Minimal vault service for Tolaria (ADR-0115 Phase 3-MVP).
//!
//! Provides read / list / save over a directory of Markdown files.  The
//! public API mirrors [`mock_fixtures::MockVault`] so chrome panels can be
//! swapped with minimal call-site changes (Phase 5-MVP wires the swap into
//! `sidebar_panel` / `note_list_pane` / the `tolaria` binary).
//!
//! # Limitations (Phase 3-MVP)
//!
//! - **Synchronous IO** on the calling thread.  All `Task<T>` returns are
//!   currently `Task::ready(...)`.  Phase 8 ("Service expansion") will move
//!   long-running operations onto `cx.background_executor().spawn(...)` and
//!   wire a file-system watcher for live invalidation.
//! - **No watcher**.  Callers invoke [`Vault::rescan`] after external
//!   mutations until the watcher lands.
//! - **No symlink traversal**.  Symlinked directories are skipped during
//!   `rescan` to avoid loops.
//! - **No frontmatter parsing**.  `Note` ships title + path + kind +
//!   modified-time + byte-size only.  The `frontmatter` service in Phase 8
//!   will add structured properties.
//! - **Markdown only**.  Assets (`.png`, `.pdf`, …) and folders are not
//!   surfaced through `notes()` for MVP; they arrive with the asset/folder
//!   tree work in later phases.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};
use chrono::{DateTime, Utc};
use gpui::{Global, SharedString, Task};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub mod frontmatter;
pub use frontmatter::{Frontmatter, FrontmatterValue};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Stable identifier for a note within a single [`Vault`] instance.
///
/// IDs are monotonically increasing for the lifetime of the `Vault` and are
/// **never reused** even when a note is dropped (deleted on disk + rescan).
/// They are also **not persisted** — reopening the same vault from disk
/// restarts ID assignment at `0`.  Treat `NoteId` as ephemeral, valid for
/// the current process's `Vault` instance only.
///
/// Serialises as a bare integer (`7`, not `{"NoteId":7}`) so the
/// [`editor_bridge`](https://docs.rs/editor_bridge) wire format stays
/// numeric.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct NoteId(u64);

impl NoteId {
    /// Raw numeric value (for logging / display only — do not depend on the
    /// numeric layout being stable across `Vault` instances).
    #[must_use]
    pub fn get(self) -> u64 {
        self.0
    }

    /// Fabricate a [`NoteId`] from a raw integer.
    ///
    /// Production code obtains `NoteId`s exclusively from [`Vault`]'s
    /// constructors and rescan paths.  This constructor exists for two
    /// legitimate callers:
    ///
    /// 1. **`mock_fixtures::MockVault`** — needs to seed deterministic IDs
    ///    at startup so chrome panels populated from mocks compare equal
    ///    to those populated from a real `Vault`.
    /// 2. **Downstream test fixtures** in `editor_bridge` and `note_item`
    ///    — building a `Note` for a unit test without a real on-disk
    ///    vault.
    #[must_use]
    pub fn from_raw(n: u64) -> Self {
        Self(n)
    }
}

/// Coarse category of a vault entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoteKind {
    /// `.md` file — the only kind surfaced through [`Vault::notes`] for MVP.
    Markdown,
    /// Any other file (images, PDFs, …).  Reserved for Phase 8 when the
    /// asset tree lands.
    Asset,
    /// A subdirectory.  Reserved for Phase 8 when the folder tree lands.
    Folder,
}

/// Metadata for a single note.  The body is fetched lazily via
/// [`Vault::note_content`]; cache management belongs to the caller (the
/// `editor_host` crate in Phase 4-MVP).
///
/// `frontmatter` carries the parsed YAML block (Phase 8.11).  Empty for
/// notes that don't begin with `---\n…\n---\n`; populated during the
/// initial scan + on rescan so chrome surfaces can render properties
/// without re-reading the file.
#[derive(Debug, Clone)]
pub struct Note {
    pub id: NoteId,
    pub title: SharedString,
    pub path: PathBuf,
    pub kind: NoteKind,
    pub modified: DateTime<Utc>,
    pub byte_size: u64,
    pub frontmatter: Frontmatter,
}

impl Note {
    /// Parsed YAML frontmatter for this note.  Empty `Frontmatter` when
    /// the note doesn't begin with a `---\n…\n---\n` block.
    #[must_use]
    pub fn frontmatter(&self) -> &Frontmatter {
        &self.frontmatter
    }
}

/// Recoverable errors from vault operations.
#[derive(Debug, Error)]
pub enum VaultError {
    #[error("note {0:?} not found in vault")]
    NotFound(NoteId),
    #[error("io error reading {path:?}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
}

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

/// The Tolaria vault service.  Installed as a GPUI `Global` by the `tolaria`
/// binary after `--vault <path>` is processed (Phase 5-MVP).
pub struct Vault {
    root: PathBuf,
    notes: HashMap<NoteId, Note>,
    next_id: u64,
    /// Vault-root-relative paths of every directory below `root`,
    /// sorted lexicographically.  Populated by `rescan_internal`.
    folders: Vec<PathBuf>,
    /// Vault-root-relative paths of every non-markdown file (images,
    /// PDFs, plain catch-all).  Sorted lexicographically.  Populated by
    /// `rescan_internal`.
    assets: Vec<PathBuf>,
}

impl Global for Vault {}

impl Vault {
    /// Open a vault rooted at `root`.  Walks the directory tree (depth limit
    /// 32), indexes every `.md` file, and returns a ready `Vault`.
    ///
    /// # Errors
    ///
    /// Returns an error if `root` cannot be canonicalised or read.
    pub fn open_at(root: impl AsRef<Path>) -> Result<Self> {
        let root = root
            .as_ref()
            .canonicalize()
            .with_context(|| format!("canonicalising vault root {:?}", root.as_ref()))?;
        let mut vault = Self {
            root,
            notes: HashMap::new(),
            next_id: 0,
            folders: Vec::new(),
            assets: Vec::new(),
        };
        vault.rescan_internal()?;
        log::info!(
            "opened vault at {:?} with {} note(s)",
            vault.root,
            vault.notes.len()
        );
        Ok(vault)
    }

    /// Vault root directory (canonicalised).
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// All note IDs in the vault.  Order is unspecified.
    pub fn notes(&self) -> Task<Vec<NoteId>> {
        Task::ready(self.note_ids_vec())
    }

    /// Internal sync helper backing both [`notes`] and the test accessor.
    /// Kept here so the two call sites can't drift apart.
    fn note_ids_vec(&self) -> Vec<NoteId> {
        self.notes.keys().copied().collect()
    }

    /// Metadata for a single note, or `None` if the ID is unknown.
    pub fn note(&self, id: NoteId) -> Task<Option<Note>> {
        Task::ready(self.notes.get(&id).cloned())
    }

    /// Read the on-disk body of a note.  Synchronous IO for MVP.
    pub fn note_content(&self, id: NoteId) -> Task<Result<String, VaultError>> {
        let Some(note) = self.notes.get(&id) else {
            return Task::ready(Err(VaultError::NotFound(id)));
        };
        let path = note.path.clone();
        let result = std::fs::read_to_string(&path).map_err(|source| VaultError::Io {
            path: path.clone(),
            source,
        });
        Task::ready(result)
    }

    /// Persist `content` to a note's on-disk path and refresh its modified
    /// timestamp + byte size.  Synchronous IO for MVP.
    pub fn save(&mut self, id: NoteId, content: &str) -> Task<Result<(), VaultError>> {
        Task::ready(self.save_sync(id, content))
    }

    /// Synchronous body of [`save`] — exposed under `#[cfg(test)]` so unit
    /// tests can assert against the `Result` directly without needing a
    /// `TestAppContext` to drive the `Task`.
    fn save_sync(&mut self, id: NoteId, content: &str) -> Result<(), VaultError> {
        let Some(note) = self.notes.get(&id) else {
            return Err(VaultError::NotFound(id));
        };
        let path = note.path.clone();
        std::fs::write(&path, content).map_err(|source| VaultError::Io {
            path: path.clone(),
            source,
        })?;
        // Refresh in-memory metadata.  IO failure here is non-fatal — the
        // write itself succeeded — but we log so divergence between memory
        // and disk doesn't go silent.
        if let Some(note) = self.notes.get_mut(&id) {
            match std::fs::metadata(&note.path) {
                Ok(meta) => {
                    note.byte_size = meta.len();
                    match meta.modified() {
                        Ok(t) => note.modified = DateTime::<Utc>::from(t),
                        Err(err) => log::warn!(
                            "vault::save: modified() unavailable for {:?}: {err}",
                            note.path,
                        ),
                    }
                }
                Err(err) => log::warn!(
                    "vault::save: metadata refresh failed for {:?}: {err}",
                    note.path,
                ),
            }
        }
        Ok(())
    }

    /// Case-insensitive substring search over note titles.
    pub fn search_titles(&self, query: &str) -> Task<Vec<NoteId>> {
        let q = query.to_lowercase();
        let ids = self
            .notes
            .iter()
            .filter(|(_, n)| n.title.to_lowercase().contains(&q))
            .map(|(id, _)| *id)
            .collect();
        Task::ready(ids)
    }

    /// Rescan the on-disk vault, rebuilding the note index.  Reuses existing
    /// [`NoteId`]s for notes whose path is unchanged; assigns fresh IDs for
    /// newly-discovered notes and drops IDs for notes whose files vanished.
    ///
    /// # Errors
    ///
    /// Returns an error if any directory along the walk cannot be read.
    pub fn rescan(&mut self) -> Result<()> {
        self.rescan_internal()
    }

    /// Vault-root-relative directory paths discovered during the most
    /// recent scan, in lexicographic order.  Empty for a freshly-opened
    /// vault with no subdirectories.
    ///
    /// Cheap accessor over cached state — call freely.
    #[must_use]
    pub fn folders(&self) -> &[PathBuf] {
        &self.folders
    }

    /// Vault-root-relative paths of every non-markdown file discovered
    /// during the most recent scan, in lexicographic order.  Includes
    /// recognised assets (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`,
    /// `.svg`, `.pdf`) and any other arbitrary file the user keeps
    /// alongside notes.
    ///
    /// Cheap accessor over cached state — call freely.
    #[must_use]
    pub fn assets(&self) -> &[PathBuf] {
        &self.assets
    }

    fn rescan_internal(&mut self) -> Result<()> {
        let mut scan = ScanResult::default();
        walk_vault(&self.root, 32, &mut scan)?;
        let ScanResult {
            mut notes,
            mut folders,
            mut assets,
        } = scan;
        notes.sort();
        folders.sort();
        assets.sort();
        let paths = notes;

        let mut old_by_path: HashMap<PathBuf, NoteId> = self
            .notes
            .iter()
            .map(|(id, n)| (n.path.clone(), *id))
            .collect();
        let mut new_notes = HashMap::new();

        for path in paths {
            let id = match old_by_path.remove(&path) {
                Some(id) => id,
                None => {
                    let id = NoteId(self.next_id);
                    self.next_id += 1;
                    id
                }
            };
            let meta = std::fs::metadata(&path).ok();
            let modified = meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .map(DateTime::<Utc>::from)
                .unwrap_or_else(Utc::now);
            let byte_size = meta.as_ref().map(std::fs::Metadata::len).unwrap_or(0);
            let title = path
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| SharedString::from(s.to_owned()))
                .unwrap_or_default();
            let fm = std::fs::read_to_string(&path)
                .ok()
                .map(|raw| frontmatter::parse(&raw).0)
                .unwrap_or_default();
            new_notes.insert(
                id,
                Note {
                    id,
                    title,
                    path,
                    kind: NoteKind::Markdown,
                    modified,
                    byte_size,
                    frontmatter: fm,
                },
            );
        }

        self.notes = new_notes;
        // Make folder / asset paths vault-root-relative so consumers
        // (folder_tree, asset browsers) don't have to strip the prefix.
        self.folders = folders
            .into_iter()
            .filter_map(|p| p.strip_prefix(&self.root).ok().map(Path::to_path_buf))
            .collect();
        self.assets = assets
            .into_iter()
            .filter_map(|p| p.strip_prefix(&self.root).ok().map(Path::to_path_buf))
            .collect();
        Ok(())
    }

    /// Number of notes in the index (test-only accessor — production code
    /// should use [`Vault::notes`] and resolve the returned task).
    #[cfg(test)]
    pub fn note_count(&self) -> usize {
        self.notes.len()
    }

    /// All note IDs as a `Vec`, no `Task` wrapper (test-only accessor).
    #[cfg(test)]
    pub fn note_ids_sync(&self) -> Vec<NoteId> {
        self.note_ids_vec()
    }
}

// ---------------------------------------------------------------------------
// Internal: directory walker
// ---------------------------------------------------------------------------

/// Result of one [`walk_vault`] pass — keeps the three sibling lists
/// in a single allocation so callers can destructure them cleanly.
#[derive(Default)]
struct ScanResult {
    notes: Vec<PathBuf>,
    folders: Vec<PathBuf>,
    assets: Vec<PathBuf>,
}

/// Visit every entry under `root` (depth-limited).  Markdown files
/// land in `out.notes`; subdirectories in `out.folders`; everything
/// else in `out.assets`.  Hidden directories (`.git`, `.obsidian`, …)
/// are skipped to avoid indexing tool metadata.
fn walk_vault(root: &Path, max_depth: usize, out: &mut ScanResult) -> Result<()> {
    fn recurse(dir: &Path, depth: usize, max: usize, out: &mut ScanResult) -> Result<()> {
        if depth > max {
            return Ok(());
        }
        let entries = std::fs::read_dir(dir).with_context(|| format!("reading {dir:?}"))?;
        for entry in entries {
            let entry = entry.with_context(|| format!("iterating {dir:?}"))?;
            let file_type = entry.file_type()?;
            let path = entry.path();
            if file_type.is_dir() {
                if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                    if name.starts_with('.') {
                        continue;
                    }
                }
                out.folders.push(path.clone());
                recurse(&path, depth + 1, max, out)?;
            } else if file_type.is_file() {
                if is_markdown_extension(&path) {
                    out.notes.push(path);
                } else {
                    out.assets.push(path);
                }
            }
        }
        Ok(())
    }
    recurse(root, 0, max_depth, out)
}

/// Markdown extensions Tolaria treats as notes.  `.md` is the canonical
/// form, `.markdown` is accepted so vaults imported from other editors
/// don't lose entries.
fn is_markdown_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("md") | Some("markdown")
    )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write(dir: &Path, rel: &str, body: &str) -> PathBuf {
        let p = dir.join(rel);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&p, body).unwrap();
        p
    }

    #[test]
    fn opens_empty_vault() {
        let dir = tempdir().unwrap();
        let v = Vault::open_at(dir.path()).unwrap();
        assert_eq!(v.note_count(), 0);
        assert!(v.root().is_absolute(), "root must be canonicalised");
    }

    #[test]
    fn indexes_markdown_files() {
        let dir = tempdir().unwrap();
        write(dir.path(), "a.md", "alpha");
        write(dir.path(), "b.md", "beta");
        write(dir.path(), "sub/c.md", "gamma");
        let v = Vault::open_at(dir.path()).unwrap();
        assert_eq!(v.note_count(), 3);
    }

    #[test]
    fn skips_hidden_directories() {
        let dir = tempdir().unwrap();
        write(dir.path(), ".git/HEAD", "ref: refs/heads/main");
        write(dir.path(), ".obsidian/x.md", "should not appear");
        write(dir.path(), "visible.md", "ok");
        let v = Vault::open_at(dir.path()).unwrap();
        assert_eq!(v.note_count(), 1, "only visible.md should index");
    }

    #[test]
    fn skips_non_markdown_files() {
        let dir = tempdir().unwrap();
        write(dir.path(), "n.md", "x");
        write(dir.path(), "image.png", "fake");
        write(dir.path(), "doc.txt", "fake");
        let v = Vault::open_at(dir.path()).unwrap();
        assert_eq!(v.note_count(), 1);
    }

    #[test]
    fn save_writes_to_disk_and_updates_byte_size() {
        let dir = tempdir().unwrap();
        let path = write(dir.path(), "n.md", "old");
        let mut v = Vault::open_at(dir.path()).unwrap();
        let id = v.note_ids_sync()[0];
        let original_size = std::fs::metadata(&path).unwrap().len();
        v.save_sync(id, "much longer content body")
            .expect("save_sync must succeed");
        let after = std::fs::read_to_string(&path).unwrap();
        assert_eq!(after, "much longer content body");
        let new_size = std::fs::metadata(&path).unwrap().len();
        assert!(new_size > original_size);
    }

    #[test]
    fn save_unknown_id_returns_not_found() {
        let dir = tempdir().unwrap();
        let mut v = Vault::open_at(dir.path()).unwrap();
        let err = v
            .save_sync(NoteId(99), "x")
            .expect_err("save_sync on unknown id must error");
        assert!(
            matches!(err, VaultError::NotFound(NoteId(99))),
            "expected NotFound(99), got {err:?}",
        );
    }

    #[test]
    fn rescan_preserves_ids_for_unchanged_paths() {
        let dir = tempdir().unwrap();
        write(dir.path(), "a.md", "x");
        let mut v = Vault::open_at(dir.path()).unwrap();
        let original_id = v.note_ids_sync()[0];
        // Add another file.
        write(dir.path(), "b.md", "y");
        v.rescan().unwrap();
        assert_eq!(v.note_count(), 2);
        // The id for a.md must still be in the index.
        assert!(v.note_ids_sync().contains(&original_id));
    }

    #[test]
    fn rescan_drops_vanished_notes() {
        let dir = tempdir().unwrap();
        let path = write(dir.path(), "a.md", "x");
        write(dir.path(), "b.md", "y");
        let mut v = Vault::open_at(dir.path()).unwrap();
        assert_eq!(v.note_count(), 2);
        fs::remove_file(&path).unwrap();
        v.rescan().unwrap();
        assert_eq!(v.note_count(), 1);
    }

    #[test]
    fn note_frontmatter_populated_on_open() {
        let dir = tempdir().unwrap();
        write(
            dir.path(),
            "n.md",
            "---\ntype: Note\nstatus: Done\n---\n\n# body\n",
        );
        let v = Vault::open_at(dir.path()).unwrap();
        let id = v.note_ids_sync()[0];
        let note = v.notes.get(&id).expect("note exists");
        assert_eq!(note.frontmatter().len(), 2);
        assert!(note.frontmatter().get("type").is_some());
        assert!(note.frontmatter().get("status").is_some());
    }

    #[test]
    fn note_frontmatter_empty_when_absent() {
        let dir = tempdir().unwrap();
        write(dir.path(), "n.md", "no frontmatter here\n");
        let v = Vault::open_at(dir.path()).unwrap();
        let id = v.note_ids_sync()[0];
        let note = v.notes.get(&id).expect("note exists");
        assert!(note.frontmatter().is_empty());
    }

    #[test]
    fn open_nonexistent_dir_errors() {
        let dir = tempdir().unwrap();
        let bogus = dir.path().join("does-not-exist");
        assert!(Vault::open_at(&bogus).is_err());
    }

    #[test]
    fn surfaces_folders_and_assets() {
        let dir = tempdir().unwrap();
        write(dir.path(), "notes/a.md", "alpha");
        write(dir.path(), "notes/sub/b.md", "beta");
        write(dir.path(), "images/c.png", "fake-png");
        write(dir.path(), "d.pdf", "fake-pdf");
        write(dir.path(), "random.bin", "blob");
        let v = Vault::open_at(dir.path()).unwrap();

        let folders: Vec<&str> = v
            .folders()
            .iter()
            .map(|p| p.to_str().unwrap_or_default())
            .collect();
        assert!(folders.contains(&"notes"), "folders: {folders:?}");
        assert!(folders.contains(&"notes/sub"), "folders: {folders:?}");
        assert!(folders.contains(&"images"), "folders: {folders:?}");

        let assets: Vec<&str> = v
            .assets()
            .iter()
            .map(|p| p.to_str().unwrap_or_default())
            .collect();
        assert!(assets.contains(&"images/c.png"), "assets: {assets:?}");
        assert!(assets.contains(&"d.pdf"), "assets: {assets:?}");
        assert!(assets.contains(&"random.bin"), "assets: {assets:?}");
    }

    #[test]
    fn folders_and_assets_are_sorted() {
        let dir = tempdir().unwrap();
        write(dir.path(), "zeta/n.md", "x");
        write(dir.path(), "alpha/n.md", "y");
        write(dir.path(), "mango/n.md", "z");
        write(dir.path(), "zzz.png", "p");
        write(dir.path(), "aaa.pdf", "p");
        let v = Vault::open_at(dir.path()).unwrap();
        let mut folders = v.folders().to_vec();
        let mut sorted_folders = folders.clone();
        sorted_folders.sort();
        assert_eq!(folders, sorted_folders, "folders must be sorted");
        let mut assets = v.assets().to_vec();
        let mut sorted_assets = assets.clone();
        sorted_assets.sort();
        assert_eq!(assets, sorted_assets, "assets must be sorted");
        // Silence unused warnings on the `mut` bindings above.
        folders.clear();
        assets.clear();
    }
}
