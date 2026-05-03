use std::fs;
use std::path::{Path, PathBuf};

/// Public starter vault cloned when the user chooses Getting Started.
pub const GETTING_STARTED_REPO_URL: &str =
    "https://github.com/refactoringhq/tolaria-getting-started.git";

/// Default location for the Getting Started vault.
pub fn default_vault_path() -> Result<PathBuf, String> {
    dirs::document_dir()
        .map(|d| d.join("Getting Started"))
        .ok_or_else(|| "Could not determine Documents directory".to_string())
}

const GETTING_STARTED_REQUIRED_CONFIG_FILES: [&str; 2] = ["type.md", "note.md"];
const GETTING_STARTED_TEMPLATE_MARKERS: [&str; 2] = ["welcome.md", "views/active-projects.yml"];

/// Check whether a vault path exists on disk.
pub fn vault_exists(path: &str) -> bool {
    let default_path = default_vault_path().ok();
    vault_exists_with_default_path(Path::new(path), default_path.as_deref())
}

fn vault_exists_with_default_path(path: &Path, default_path: Option<&Path>) -> bool {
    if !path.is_dir() {
        return false;
    }

    if !is_canonical_getting_started_path(path, default_path) {
        return true;
    }

    canonical_getting_started_vault_exists(path)
}

fn is_canonical_getting_started_path(path: &Path, default_path: Option<&Path>) -> bool {
    default_path.is_some_and(|candidate| candidate == path)
}

fn canonical_getting_started_vault_exists(path: &Path) -> bool {
    has_getting_started_config_files(path) && has_getting_started_template_marker(path)
}

fn has_getting_started_config_files(path: &Path) -> bool {
    GETTING_STARTED_REQUIRED_CONFIG_FILES
        .iter()
        .all(|file| path.join(file).is_file())
}

fn has_getting_started_template_marker(path: &Path) -> bool {
    GETTING_STARTED_TEMPLATE_MARKERS
        .iter()
        .any(|file| path.join(file).is_file())
}

/// Previous default AGENTS.md content seeded by Tolaria itself. Existing vaults
/// can still contain this exact text, so Tolaria treats it as managed content
/// that is safe to refresh automatically.
const STALE_AGENTS_MD: &str = r##"# AGENTS.md — Tolaria Vault

This is a [Tolaria](https://github.com/refactoringhq/tolaria) vault - a folder of markdown files with YAML frontmatter forming a personal knowledge graph.

Keep edits compatible with Tolaria's current conventions. Prefer small, human-readable changes over heavy restructuring.

## Core rules

- One markdown note per file.
- The first H1 in the body is the note title. Do not add `title:` frontmatter.
- Most notes live at the vault root as flat `.md` files. Type definitions live in `type/`. Saved views live in `views/`.
- Use wikilinks for note-to-note references, both in frontmatter and in the body.
- Frontmatter properties that start with `_` are usually Tolaria-managed state. Leave them alone unless the user explicitly asks for them to change.

## Notes

```yaml
---
type: Project
status: Active
belongs_to:
  - "[[area-operations]]"
related_to:
  - "[[goal-q2-launch]]"
---

# Q2 Launch Plan

Body content in markdown.
```

Tolaria still understands some legacy aliases such as `Is A`, but prefer `type:` for new or edited notes.

## Types

Type definitions are regular notes stored in `type/`. Use `type: Type` in frontmatter:

```yaml
---
type: Type
icon: books
color: blue
order: 20
sidebar label: Projects
---

# Project
```

Useful type metadata includes `icon`, `color`, `order`, `sidebar label`, `template`, `sort`, `view`, and `visible`.

## Relationships

Any frontmatter property whose value is a wikilink is treated as a relationship. Common names include `belongs_to`, `related_to`, and `has`, but custom relationship names are valid too.

## Wikilinks

- `[[filename]]` or `[[Note Title]]` - link by filename or title
- `[[filename|display text]]` - with custom display text
- Works in frontmatter values and markdown body

## Views

Saved filters live in `views/` as `.view.json` files:

```json
{
  "title": "Active Notes",
  "filters": [
    {"property": "type", "operator": "equals", "value": "Note"},
    {"property": "status", "operator": "equals", "value": "Active"}
  ],
  "sort": {"property": "title", "direction": "asc"}
}
```

## Filenames

Use kebab-case: `my-note-title.md`. One note per file.

## What agents should do

- Create and edit notes using the frontmatter and H1 conventions above.
- Create and edit type documents in `type/`.
- Add or modify relationships without breaking existing wikilinks.
- Create and edit saved views in `views/`.
- Update `AGENTS.md` only when the user asks for agent guidance changes.

## What agents should avoid

- Do not infer note type from folders other than the dedicated `type/` directory for type definitions.
- Do not silently overwrite an existing custom `AGENTS.md`.
- Do not rewrite installation-specific app config unless the user explicitly asks.
"##;

/// Older Tolaria-managed AGENTS.md content from before the `type:` migration.
/// Existing vaults can still contain this exact text, so Tolaria treats it as
/// managed content that is safe to refresh automatically.
const PRE_TYPE_AGENTS_MD: &str = r##"# AGENTS.md — Tolaria Vault

This is a [Tolaria](https://github.com/refactoringhq/tolaria) vault — a folder of markdown files with YAML frontmatter forming a personal knowledge graph.

## Note structure

Every note is a markdown file. The **first H1 heading in the body is the title** — there is no `title:` frontmatter field.

```yaml
---
is_a: TypeName        # the note's type (must match the title of a type file in the vault)
url: https://...      # example property
belongs_to: "[[other-note]]"
related_to:
  - "[[note-a]]"
  - "[[note-b]]"
---

# Note Title

Body content in markdown.
```

System properties are prefixed with `_` (e.g. `_organized`, `_pinned`, `_icon`) — these are app-managed, do not set or show them to users unless specifically asked.

## Types

A type is a note with `is_a: Type`. Type files live in the vault root:

```yaml
---
is_a: Type
_icon: books          # Phosphor icon name in kebab-case
_color: "#8b5cf6"     # hex color
---

# TypeName
```

To find what types exist: look for files with `is_a: Type` in the vault root.

## Relationships

Any frontmatter property whose value is a wikilink is a relationship. Backlinks are computed automatically.

Standard names: `belongs_to`, `related_to`, `has`. Custom names are valid.

## Wikilinks

- `[[filename]]` or `[[Note Title]]` — link by filename or title
- `[[filename|display text]]` — with custom display text
- Works in frontmatter values and markdown body

## Views

Saved filters live in `views/` as `.view.json` files:

```json
{
  "title": "Active Notes",
  "filters": [
    {"property": "is_a", "operator": "equals", "value": "Note"},
    {"property": "status", "operator": "equals", "value": "Active"}
  ],
  "sort": {"property": "title", "direction": "asc"}
}
```

## Filenames

Use kebab-case: `my-note-title.md`. One note per file.

## What you can do

- Create/edit notes with correct frontmatter and H1 title
- Create new type files
- Add or modify relationships
- Create/edit views in `views/`
- Edit `AGENTS.md` (this file)

Do not modify app configuration files — those are local to each installation.
"##;

const OUTDATED_AGENTS_MARKERS: [&str; 3] = [
    "# AGENTS.md — Tolaria Vault",
    "Legacy `title:` frontmatter is still read as a fallback",
    "Tolaria still understands legacy aliases such as `Is A`.",
];

const STALE_TITLE_FRONTMATTER_MARKER: &str = "Do not add `title:` frontmatter.";
const LEGACY_VIEWS_SECTION_MARKER: &str = "## Views";
const LEGACY_VIEW_FILE_MARKERS: [&str; 2] = [".view.json", "```json"];

struct AgentsContent<'a>(&'a str);

impl<'a> AgentsContent<'a> {
    fn new(content: &'a str) -> Self {
        Self(content)
    }

    fn contains(&self, marker: &str) -> bool {
        self.0.contains(marker)
    }

    fn contains_all(&self, markers: &[&str]) -> bool {
        markers.iter().all(|marker| self.contains(marker))
    }

    fn is_known_legacy_template(&self) -> bool {
        self.0.trim().is_empty()
            || self.0 == PRE_TYPE_AGENTS_MD
            || self.0 == LEGACY_AGENTS_MD
            || self.0 == STALE_AGENTS_MD
    }

    fn has_stale_title_stub(&self) -> bool {
        self.contains(STALE_TITLE_FRONTMATTER_MARKER)
    }

    fn has_legacy_json_view_guidance(&self) -> bool {
        self.contains(LEGACY_VIEWS_SECTION_MARKER)
            && LEGACY_VIEW_FILE_MARKERS
                .iter()
                .any(|marker| self.contains(marker))
    }

    fn can_be_refreshed(&self) -> bool {
        self.is_known_legacy_template()
            || self.has_stale_title_stub()
            || self.has_legacy_json_view_guidance()
            || self.contains_all(&OUTDATED_AGENTS_MARKERS)
    }
}

pub(super) fn agents_content_can_be_refreshed(content: &str) -> bool {
    AgentsContent::new(content).can_be_refreshed()
}

/// Default AGENTS.md content — vault instructions for AI agents.
/// Describes Tolaria vault mechanics only; no user-specific structure.
/// The vault scanner will pick this up as a regular entry.
pub(super) const AGENTS_MD: &str = r##"---
type: Note
_organized: true
---

# AGENTS.md — Tolaria Vault

This is a [Tolaria](https://github.com/refactoringhq/tolaria) vault, a folder of Markdown files with YAML frontmatter forming a personal knowledge graph.

Keep edits compatible with this starter vault's current conventions. Prefer small, human-readable changes over heavy restructuring.

## Core conventions

- One Markdown note per file.
- The first H1 in the body is the preferred display title. Legacy `title:` frontmatter is still read as a fallback when a note has no H1, but do not add it to new notes.
- Store note type in the `type:` frontmatter field.
- In this starter vault, type definitions currently live at the vault root, for example `project.md`, `person.md`, `note.md`, and `type.md`. Keep new type files at the vault root unless the user explicitly asks to reorganize them.
- Saved views live in `views/*.yml`.
- Files in `attachments/` are assets, not notes. Reference them from notes, but do not treat them as notes or types.
- Frontmatter properties that start with `_` are usually Tolaria-managed state. Leave them alone unless the user explicitly asks for them to change.

## Notes

```yaml
---
type: Note
related_to: "[[tolaria]]"
status: Active
url: https://example.com
---

# Example note

Body content in Markdown.
```

## Types

In this starter vault, types are regular notes stored at the vault root and use `type: Type`.

```yaml
---
type: Type
_icon: rocket
_color: "#3b82f6"
_order: 0
_list_properties_display:
  - related_to
_sort: "property:onboarding:asc"
---

# Project
```

Useful type metadata in this vault includes `icon`/`_icon`, `color`/`_color`, `order`/`_order`, `sidebar label`, `_list_properties_display`, `_sort`, `template`, `view`, and `visible`. When editing an existing file, preserve the key style already used there instead of mass-normalizing underscored keys.

## Relationships

Any frontmatter property whose value contains `[[wikilinks]]` is treated as a relationship. In this starter vault, common relationship keys include `related_to` and `belongs_to`, but custom relationship names are valid too.

Preserve older relationship labels such as `Belongs to:` when editing existing notes that already use them.

Use quoted wikilinks for scalar frontmatter values and YAML lists for multi-value relationships.

## Wikilinks

- `[[filename]]` or `[[Note Title]]` for normal links
- `[[filename|display text]]` for custom display text
- Works in frontmatter values and Markdown body

## Views

Saved views live in `views/*.yml` and are written as YAML. Tolaria scans every `.yml` file in `views/`, and the filename is the stable view id, so use kebab-case filenames such as `active-projects.yml`.

A view definition looks like this:

```yaml
name: Active Projects
icon: null
color: null
sort: "property:onboarding:asc"
filters:
  any:
    - field: type
      op: equals
      value: Project
    - field: related_to
      op: contains
      value: "[[tolaria]]"
```

View rules that matter when creating or editing files:
- `name` is required. `icon`, `color`, and `sort` are optional.
- `sort` uses `option:direction`. Built-in options are `modified`, `created`, `title`, and `status`. Custom-property sorts use `property:<Property Name>`, for example `property:onboarding:asc`.
- `filters` must be a tree whose root is exactly one `all:` group or one `any:` group.
- Each filter condition uses `field`, `op`, and usually `value`.
- `field` can target built-ins like `type`, `status`, `title`, `favorite`, and `body`, plus actual frontmatter keys used in this vault such as `related_to`, `belongs_to`, or `url`.
- Supported operators are `equals`, `not_equals`, `contains`, `not_contains`, `any_of`, `none_of`, `is_empty`, `is_not_empty`, `before`, and `after`.
- `any_of` and `none_of` expect `value` to be a YAML list.
- `regex: true` is supported with `equals`, `not_equals`, `contains`, and `not_contains` when pattern matching is needed.
- Relationship filters can use wikilinks in `value`, for example `"[[tolaria]]"`.
- Do not create JSON view files or `.view.json` filenames.

## Filenames

Use kebab-case: `my-note-title.md`. One note per file.

## What agents should do

- Create and edit notes using the frontmatter and H1 conventions above.
- Create and edit type documents at the vault root.
- Add or modify relationships without breaking existing wikilinks.
- Create and edit saved views in `views/`.
- Update `AGENTS.md` only when the user asks for vault-level guidance changes.

## What agents should avoid

- Do not move existing type files out of the vault root unless the user explicitly asks.
- Do not treat files in `attachments/` as notes, types, or view definitions.
- Do not silently overwrite an existing custom `AGENTS.md`.
- Do not rewrite installation-specific app configuration unless the user explicitly asks.
"##;

pub(super) const LEGACY_AGENTS_MD: &str = r##"# AGENTS.md — Tolaria Vault

This is a [Tolaria](https://github.com/refactoringhq/tolaria) vault — a folder of markdown files with YAML frontmatter forming a personal knowledge graph.

## Note structure

Every note is a markdown file. The **first H1 heading in the body is the title** — there is no `title:` frontmatter field.

```yaml
---
type: TypeName        # the note's type (must match the title of a type file in the vault)
url: https://...      # example property
belongs_to: "[[other-note]]"
related_to:
  - "[[note-a]]"
  - "[[note-b]]"
---

# Note Title

Body content in markdown.
```

System properties are prefixed with `_` (e.g. `_organized`, `_pinned`, `_icon`) — these are app-managed, do not set or show them to users unless specifically asked.

## Types

A type is a note with `type: Type`. Type files live in the vault root:

```yaml
---
type: Type
_icon: books          # Phosphor icon name in kebab-case
_color: "#8b5cf6"     # hex color
---

# TypeName
```

To find what types exist: look for files with `type: Type` in the vault root.

## Relationships

Any frontmatter property whose value is a wikilink is a relationship. Backlinks are computed automatically.

Standard names: `belongs_to`, `related_to`, `has`. Custom names are valid.

## Wikilinks

- `[[filename]]` or `[[Note Title]]` — link by filename or title
- `[[filename|display text]]` — with custom display text
- Works in frontmatter values and markdown body

## Views

Saved filters live in `views/` as `.view.json` files:

```json
{
  "title": "Active Notes",
  "filters": [
    {"property": "type", "operator": "equals", "value": "Note"},
    {"property": "status", "operator": "equals", "value": "Active"}
  ],
  "sort": {"property": "title", "direction": "asc"}
}
```

## Filenames

Use kebab-case: `my-note-title.md`. One note per file.

## What you can do

- Create/edit notes with correct frontmatter and H1 title
- Create new type files
- Add or modify relationships
- Create/edit views in `views/`
- Edit `AGENTS.md` (this file)

Do not modify app configuration files — those are local to each installation.
"##;

/// Clone the public starter vault into the requested path.
pub fn create_getting_started_vault(target_path: &str) -> Result<String, String> {
    let vault_path = create_getting_started_vault_from_repo(
        Path::new(target_path),
        &getting_started_repo_url(),
    )?;
    Ok(vault_path.to_string_lossy().to_string())
}

fn create_getting_started_vault_from_repo(
    target_path: &Path,
    repo_url: &str,
) -> Result<PathBuf, String> {
    let target_path_str = target_path.to_string_lossy();
    if target_path_str.trim().is_empty() {
        return Err("Target path is required".to_string());
    }

    crate::git::clone_repo(repo_url, &target_path_str)?;
    let vault_path = canonical_vault_path(target_path)?;
    crate::git::disconnect_all_remotes(path_to_utf8(&vault_path, "Vault path")?)?;
    refresh_cloned_vault_config_files(&vault_path)?;
    Ok(vault_path)
}

fn getting_started_repo_url() -> String {
    std::env::var("TOLARIA_GETTING_STARTED_REPO_URL")
        .or_else(|_| std::env::var("LAPUTA_GETTING_STARTED_REPO_URL"))
        .unwrap_or_else(|_| GETTING_STARTED_REPO_URL.to_string())
}

fn canonical_vault_path(target_path: &Path) -> Result<PathBuf, String> {
    target_path.canonicalize().map_err(|e| {
        format!(
            "Failed to resolve vault path '{}': {}",
            target_path.display(),
            e
        )
    })
}

fn path_to_utf8<'a>(path: &'a Path, context: &str) -> Result<&'a str, String> {
    path.to_str()
        .ok_or_else(|| format!("{context} '{}' is not valid UTF-8", path.display()))
}

fn refresh_cloned_vault_config_files(vault_path: &Path) -> Result<(), String> {
    let agents_path = vault_path.join("AGENTS.md");
    let refresh_agents = if !agents_path.exists() {
        true
    } else {
        let content = fs::read_to_string(&agents_path)
            .map_err(|e| format!("Failed to read {}: {e}", agents_path.display()))?;
        agents_content_can_be_refreshed(&content)
    };

    if refresh_agents {
        fs::write(&agents_path, AGENTS_MD)
            .map_err(|e| format!("Failed to write {}: {e}", agents_path.display()))?;
    }

    crate::vault::repair_config_files(path_to_utf8(vault_path, "Vault path")?)?;

    if !vault_has_pending_changes(vault_path)? {
        return Ok(());
    }

    crate::git::ensure_author_config(vault_path)?;
    crate::git::git_commit(
        path_to_utf8(vault_path, "Vault path")?,
        "Initialize Tolaria config files",
    )?;
    Ok(())
}

fn vault_has_pending_changes(vault_path: &Path) -> Result<bool, String> {
    let output = crate::hidden_command("git")
        .args(["status", "--porcelain"])
        .current_dir(vault_path)
        .output()
        .map_err(|e| format!("Failed to inspect cloned vault status: {e}"))?;

    if output.status.success() {
        return Ok(!String::from_utf8_lossy(&output.stdout).trim().is_empty());
    }

    Err(format!(
        "git status failed: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use std::process::Command as StdCommand;

    fn init_source_repo(path: &Path, agents_content: Option<&str>) {
        fs::create_dir_all(path.join("views")).unwrap();
        fs::write(
            path.join("welcome.md"),
            "# Welcome to Tolaria\n\nThis is the starter vault.\n",
        )
        .unwrap();
        fs::write(
            path.join("views").join("active-projects.yml"),
            "title: Active Projects\nfilters: []\n",
        )
        .unwrap();
        if let Some(content) = agents_content {
            fs::write(path.join("AGENTS.md"), content).unwrap();
        }

        StdCommand::new("git")
            .args(["init"])
            .current_dir(path)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["config", "user.email", "tolaria@app.local"])
            .current_dir(path)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["config", "user.name", "Tolaria App"])
            .current_dir(path)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(path)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "Initial starter vault"])
            .current_dir(path)
            .output()
            .unwrap();
    }

    fn write_tolaria_config_files(path: &Path) {
        fs::create_dir_all(path).unwrap();
        fs::write(path.join("AGENTS.md"), AGENTS_MD).unwrap();
        fs::write(path.join("type.md"), "# Type\n").unwrap();
        fs::write(path.join("note.md"), "# Note\n").unwrap();
    }

    fn assert_getting_started_vault_replaces_template(agents_content: &str) {
        let dir = tempfile::TempDir::new().unwrap();
        let source = dir.path().join("starter");
        let dest = dir.path().join("Getting Started");
        init_source_repo(&source, Some(agents_content));

        create_getting_started_vault_from_repo(dest.as_path(), source.to_str().unwrap()).unwrap();

        let content = fs::read_to_string(dest.join("AGENTS.md")).unwrap();
        assert_eq!(content, AGENTS_MD);
        assert!(dest.join("type.md").exists());
        assert!(dest.join("note.md").exists());
    }

    #[test]
    fn test_default_vault_path_appends_getting_started() {
        let path = default_vault_path().unwrap();
        let path_str = path.to_string_lossy();
        assert!(path_str.ends_with("Getting Started"));
    }

    #[test]
    fn test_default_getting_started_repo_url_uses_tolaria_slug() {
        assert_eq!(
            GETTING_STARTED_REPO_URL,
            "https://github.com/refactoringhq/tolaria-getting-started.git"
        );
    }

    #[test]
    fn test_canonical_getting_started_path_rejects_plain_tolaria_folder() {
        let dir = tempfile::TempDir::new().unwrap();
        let default_path = dir.path().join("Getting Started");

        write_tolaria_config_files(&default_path);

        assert!(!vault_exists_with_default_path(
            default_path.as_path(),
            Some(default_path.as_path())
        ));
    }

    #[test]
    fn test_non_canonical_vault_path_stays_permissive() {
        let dir = tempfile::TempDir::new().unwrap();
        let default_path = dir.path().join("Getting Started");
        let other_vault_path = dir.path().join("Existing Vault");

        fs::create_dir_all(&other_vault_path).unwrap();

        assert!(vault_exists_with_default_path(
            other_vault_path.as_path(),
            Some(default_path.as_path())
        ));
    }

    #[test]
    fn test_create_getting_started_vault_clones_repo() {
        let dir = tempfile::TempDir::new().unwrap();
        let source = dir.path().join("starter");
        let dest = dir.path().join("Getting Started");
        init_source_repo(&source, None);

        let result =
            create_getting_started_vault_from_repo(dest.as_path(), source.to_str().unwrap())
                .unwrap();

        assert_eq!(result, dest.canonicalize().unwrap());
        assert!(dest.join("welcome.md").exists());
        assert!(dest.join("views").join("active-projects.yml").exists());
        assert!(dest.join(".git").exists());
        assert_eq!(
            fs::read_to_string(dest.join("AGENTS.md")).unwrap(),
            AGENTS_MD
        );
        assert!(dest.join("type.md").exists());
        assert!(dest.join("note.md").exists());
    }

    #[test]
    fn test_canonical_getting_started_path_accepts_cloned_starter_vault() {
        let dir = tempfile::TempDir::new().unwrap();
        let source = dir.path().join("starter");
        let default_path = dir.path().join("Getting Started");
        init_source_repo(&source, None);

        create_getting_started_vault_from_repo(default_path.as_path(), source.to_str().unwrap())
            .unwrap();

        assert!(vault_exists_with_default_path(
            default_path.as_path(),
            Some(default_path.as_path())
        ));
    }

    #[test]
    fn test_create_getting_started_vault_rejects_nonempty_destination() {
        let dir = tempfile::TempDir::new().unwrap();
        let source = dir.path().join("starter");
        let dest = dir.path().join("Getting Started");
        init_source_repo(&source, None);
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("existing.md"), "# Existing\n").unwrap();

        let err = create_getting_started_vault_from_repo(dest.as_path(), source.to_str().unwrap())
            .unwrap_err();

        assert!(err.contains("already exists and is not empty"));
    }

    #[test]
    fn test_create_getting_started_vault_cleans_partial_clone_on_failure() {
        let dir = tempfile::TempDir::new().unwrap();
        let missing_repo = dir.path().join("missing");
        let dest = dir.path().join("Getting Started");

        let err =
            create_getting_started_vault_from_repo(dest.as_path(), missing_repo.to_str().unwrap())
                .unwrap_err();

        assert!(err.contains("git clone failed"));
        assert!(!dest.exists());
    }

    #[test]
    fn test_create_getting_started_vault_leaves_clean_worktree() {
        let dir = tempfile::TempDir::new().unwrap();
        let source = dir.path().join("starter");
        let dest = dir.path().join("Getting Started");
        init_source_repo(&source, None);

        create_getting_started_vault_from_repo(dest.as_path(), source.to_str().unwrap()).unwrap();

        let output = StdCommand::new("git")
            .args(["status", "--porcelain"])
            .current_dir(&dest)
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&output.stdout).trim().is_empty());
    }

    #[test]
    fn test_create_getting_started_vault_removes_the_starter_remote() {
        let dir = tempfile::TempDir::new().unwrap();
        let source = dir.path().join("starter");
        let dest = dir.path().join("Getting Started");
        init_source_repo(&source, None);

        create_getting_started_vault_from_repo(dest.as_path(), source.to_str().unwrap()).unwrap();

        assert!(!crate::git::has_remote(dest.to_str().unwrap()).unwrap());
    }

    #[test]
    fn test_create_getting_started_vault_replaces_legacy_agents_template() {
        assert_getting_started_vault_replaces_template(LEGACY_AGENTS_MD);
    }

    #[test]
    fn test_create_getting_started_vault_replaces_pre_type_agents_template() {
        assert_getting_started_vault_replaces_template(PRE_TYPE_AGENTS_MD);
    }

    #[test]
    fn test_agents_refresh_detection_accepts_pre_type_managed_template() {
        assert!(agents_content_can_be_refreshed(PRE_TYPE_AGENTS_MD));
    }

    #[test]
    fn test_agents_refresh_detection_accepts_legacy_json_view_guidance() {
        let stale = r#"# AGENTS.md — Tolaria Vault

## Views

Saved filters live in `views/` as `.view.json` files:

```json
{"title":"Active Notes"}
```
"#;
        assert!(agents_content_can_be_refreshed(stale));
    }

    #[test]
    fn test_agents_template_matches_current_tolaria_vault_conventions() {
        assert!(AGENTS_MD.starts_with("---\ntype: Note\n_organized: true\n---\n"));
        assert!(AGENTS_MD.contains("# AGENTS.md — Tolaria Vault"));
        assert!(AGENTS_MD.contains("Legacy `title:` frontmatter is still read as a fallback"));
        assert!(AGENTS_MD.contains("Store note type in the `type:` frontmatter field."));
        assert!(AGENTS_MD.contains("type definitions currently live at the vault root"));
        assert!(AGENTS_MD.contains("attachments/"));
        assert!(AGENTS_MD.contains("views/*.yml"));
        assert!(AGENTS_MD.contains("option:direction"));
        assert!(AGENTS_MD.contains("property:<Property Name>"));
        assert!(AGENTS_MD.contains("actual frontmatter keys used in this vault such as `related_to`, `belongs_to`, or `url`."));
        assert!(AGENTS_MD.contains("Belongs to:"));
        assert!(AGENTS_MD.contains("Do not create JSON view files or `.view.json` filenames."));
        assert!(!AGENTS_MD.contains("Laputa"));
        assert!(!AGENTS_MD.contains("Is A"));
        assert!(!AGENTS_MD.contains("is_a"));
    }
}
