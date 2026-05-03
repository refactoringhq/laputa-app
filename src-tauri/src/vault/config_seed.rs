use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use super::getting_started::{agents_content_can_be_refreshed, AGENTS_MD};

/// Content for `type.md` — describes the generic Type metamodel for the vault.
const TYPE_TYPE_DEFINITION: &str = "\
---
type: Type
order: 0
visible: false
---

# Type

A Type defines shared metadata and defaults for a category of notes in this vault.

## Common properties
- **Icon**: Sidebar icon for this type
- **Color**: Accent color for notes of this type
- **Order**: Sidebar ordering
- **Sidebar label**: Override the default plural label
- **Template**: Default body for new notes of this type
- **View**: Preferred note-list view for this type
";

/// Content for `note.md` — restores the default Note type definition when missing.
const NOTE_TYPE_DEFINITION: &str = "\
---
type: Type
---

# Note

A Note is a general-purpose document — research notes, meeting notes, strategy docs, or anything that doesn't fit a more specific type.
";

const LEGACY_CLAUDE_MD_SHIM: &str = "@AGENTS.md

This file is a Claude Code compatibility shim. Keep shared agent instructions in `AGENTS.md`.
";

const HEADING_CLAUDE_MD_SHIM: &str = "@AGENTS.md

# CLAUDE.md

This file is a Claude Code compatibility shim. Keep shared agent instructions in `AGENTS.md`.
";

const CLAUDE_MD_SHIM: &str = "---
type: Note
_organized: true
---

@AGENTS.md

This file is only a Claude Code compatibility shim. Keep shared agent instructions in `AGENTS.md`.
";

const GEMINI_MD_SHIM: &str = "---
type: Note
_organized: true
---

@AGENTS.md

This file is only a Gemini CLI compatibility shim. Keep shared agent instructions in `AGENTS.md`.
";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AiGuidanceFileState {
    Managed,
    Missing,
    Broken,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct VaultAiGuidanceStatus {
    pub agents_state: AiGuidanceFileState,
    pub claude_state: AiGuidanceFileState,
    pub gemini_state: AiGuidanceFileState,
    pub can_restore: bool,
}

struct GuidancePaths {
    agents: PathBuf,
    claude: PathBuf,
    gemini: PathBuf,
}

#[derive(Debug, Default)]
struct LegacyAgentsMigrationOutcome {
    copied_to_root: bool,
    removed_legacy: bool,
}

/// Write a file if it doesn't exist or is empty (corrupt). Returns true if written.
fn write_if_missing(path: &Path, content: &str) -> Result<bool, String> {
    let needs_write = !path.exists() || fs::metadata(path).map_or(true, |m| m.len() == 0);
    if needs_write {
        fs::write(path, content).map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    }
    Ok(needs_write)
}

fn read_file_or_empty(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

fn agents_content_can_be_replaced(content: &str) -> bool {
    content.contains("See config/agents.md") || agents_content_can_be_refreshed(content)
}

fn root_agents_can_be_replaced(path: &Path) -> bool {
    !path.exists() || agents_content_can_be_replaced(&read_file_or_empty(path))
}

fn matches_claude_shim(content: &str) -> bool {
    let trimmed = content.trim();
    trimmed == "@AGENTS.md"
        || trimmed == LEGACY_CLAUDE_MD_SHIM.trim()
        || trimmed == HEADING_CLAUDE_MD_SHIM.trim()
        || trimmed == CLAUDE_MD_SHIM.trim()
}

fn matches_gemini_shim(content: &str) -> bool {
    content.trim() == GEMINI_MD_SHIM.trim()
}

fn claude_shim_can_be_replaced(path: &Path) -> bool {
    !path.exists() || {
        let content = read_file_or_empty(path);
        content.trim().is_empty() || matches_claude_shim(&content)
    }
}

fn gemini_shim_can_be_replaced(path: &Path) -> bool {
    !path.exists() || {
        let content = read_file_or_empty(path);
        content.trim().is_empty() || matches_gemini_shim(&content)
    }
}

fn sync_managed_file(
    path: &Path,
    content: &str,
    can_replace: fn(&Path) -> bool,
) -> Result<bool, String> {
    if !can_replace(path) {
        return Ok(false);
    }

    fs::write(path, content).map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    Ok(true)
}

fn classify_guidance_file(
    path: &Path,
    matches_managed: fn(&str) -> bool,
    can_replace: fn(&Path) -> bool,
) -> AiGuidanceFileState {
    if !path.exists() {
        return AiGuidanceFileState::Missing;
    }

    let content = read_file_or_empty(path);
    if matches_managed(&content) {
        return AiGuidanceFileState::Managed;
    }

    if can_replace(path) {
        return AiGuidanceFileState::Broken;
    }

    AiGuidanceFileState::Custom
}

fn guidance_paths(vault_path: &Path) -> GuidancePaths {
    GuidancePaths {
        agents: vault_path.join("AGENTS.md"),
        claude: vault_path.join("CLAUDE.md"),
        gemini: vault_path.join("GEMINI.md"),
    }
}

fn classify_agents_file(path: &Path) -> AiGuidanceFileState {
    classify_guidance_file(
        path,
        |content| content == AGENTS_MD,
        root_agents_can_be_replaced,
    )
}

fn classify_claude_file(path: &Path) -> AiGuidanceFileState {
    classify_guidance_file(path, matches_claude_shim, claude_shim_can_be_replaced)
}

fn classify_gemini_file(path: &Path) -> AiGuidanceFileState {
    classify_guidance_file(path, matches_gemini_shim, gemini_shim_can_be_replaced)
}

fn guidance_file_needs_restore(state: AiGuidanceFileState) -> bool {
    matches!(
        state,
        AiGuidanceFileState::Missing | AiGuidanceFileState::Broken
    )
}

fn build_ai_guidance_status(vault_path: &Path) -> VaultAiGuidanceStatus {
    let paths = guidance_paths(vault_path);
    let agents_state = classify_agents_file(&paths.agents);
    let claude_state = classify_claude_file(&paths.claude);
    let gemini_state = classify_gemini_file(&paths.gemini);

    VaultAiGuidanceStatus {
        agents_state,
        claude_state,
        gemini_state,
        can_restore: guidance_file_needs_restore(agents_state)
            || guidance_file_needs_restore(claude_state)
            || guidance_file_needs_restore(gemini_state),
    }
}

fn sync_claude_shim_file(vault_path: &Path) -> Result<bool, String> {
    let paths = guidance_paths(vault_path);
    sync_managed_file(&paths.claude, CLAUDE_MD_SHIM, claude_shim_can_be_replaced)
}

fn sync_gemini_shim_file(vault_path: &Path) -> Result<bool, String> {
    let paths = guidance_paths(vault_path);
    sync_managed_file(&paths.gemini, GEMINI_MD_SHIM, gemini_shim_can_be_replaced)
}

fn sync_required_ai_guidance_files(vault_path: &Path) -> Result<bool, String> {
    let wrote_agents = sync_default_agents_file(vault_path)?;
    let wrote_claude = sync_claude_shim_file(vault_path)?;
    Ok(wrote_agents || wrote_claude)
}

fn sync_all_ai_guidance_files(vault_path: &Path) -> Result<bool, String> {
    let wrote_required = sync_required_ai_guidance_files(vault_path)?;
    let wrote_gemini = sync_gemini_shim_file(vault_path)?;
    Ok(wrote_required || wrote_gemini)
}

fn migrate_legacy_agents_file(
    root_agents: &Path,
    config_agents: &Path,
) -> Result<LegacyAgentsMigrationOutcome, String> {
    let mut outcome = LegacyAgentsMigrationOutcome::default();
    if !config_agents.exists() {
        return Ok(outcome);
    }

    let config_content = read_file_or_empty(config_agents);
    if !config_content.is_empty() && root_agents_can_be_replaced(root_agents) {
        fs::write(root_agents, &config_content)
            .map_err(|e| format!("Failed to write AGENTS.md: {e}"))?;
        outcome.copied_to_root = true;
    }

    fs::remove_file(config_agents)
        .map_err(|e| format!("Failed to remove config/agents.md: {e}"))?;
    outcome.removed_legacy = true;

    Ok(outcome)
}

fn cleanup_empty_config_dir(vault: &Path) -> Result<bool, String> {
    let config_dir = vault.join("config");
    if !config_dir.is_dir() {
        return Ok(false);
    }

    let is_empty = fs::read_dir(&config_dir)
        .map_err(|e| format!("Failed to inspect {}: {e}", config_dir.display()))?
        .next()
        .is_none();
    if !is_empty {
        return Ok(false);
    }

    fs::remove_dir(&config_dir)
        .map_err(|e| format!("Failed to remove {}: {e}", config_dir.display()))?;
    Ok(true)
}

pub(super) fn sync_default_agents_file(vault_path: &Path) -> Result<bool, String> {
    let paths = guidance_paths(vault_path);
    sync_managed_file(&paths.agents, AGENTS_MD, root_agents_can_be_replaced)
}

pub fn get_ai_guidance_status(
    vault_path: impl AsRef<str>,
) -> Result<VaultAiGuidanceStatus, String> {
    Ok(build_ai_guidance_status(Path::new(vault_path.as_ref())))
}

pub fn restore_ai_guidance_files(
    vault_path: impl AsRef<str>,
) -> Result<VaultAiGuidanceStatus, String> {
    let vault_path = Path::new(vault_path.as_ref());
    sync_all_ai_guidance_files(vault_path)?;
    Ok(build_ai_guidance_status(vault_path))
}

/// Seed `AGENTS.md` at vault root if missing or empty (idempotent, per-file).
/// Also seeds Tolaria-managed root type definitions used by repair/bootstrap flows.
pub fn seed_config_files(vault_path: impl AsRef<str>) {
    let vault_path = Path::new(vault_path.as_ref());
    if sync_required_ai_guidance_files(vault_path).unwrap_or(false) {
        log::info!("Seeded vault AI guidance files at vault root");
    }

    ensure_root_type_definitions(vault_path);
}

fn ensure_root_type_definition(vault_path: &Path, file_name: &str, content: &str) {
    let path = vault_path.join(file_name);
    let _ = write_if_missing(&path, content);
}

/// Ensure the default root type definitions exist for opened/repaired vaults.
fn ensure_root_type_definitions(vault_path: &Path) {
    ensure_root_type_definition(vault_path, "type.md", TYPE_TYPE_DEFINITION);
    ensure_root_type_definition(vault_path, "note.md", NOTE_TYPE_DEFINITION);
}

/// Migrate legacy `config/agents.md` → root `AGENTS.md` for existing vaults.
///
/// - If `config/agents.md` has real content and root `AGENTS.md` is missing/empty/stub:
///   move content to root, remove legacy file.
/// - If root `AGENTS.md` doesn't exist: write defaults.
/// - Cleans up empty `config/` directory after migration.
///
/// Always idempotent and silent.
pub fn migrate_agents_md(vault_path: impl AsRef<str>) {
    let vault = Path::new(vault_path.as_ref());
    let root_agents = vault.join("AGENTS.md");
    let config_agents = vault.join("config").join("agents.md");

    if let Ok(outcome) = migrate_legacy_agents_file(&root_agents, &config_agents) {
        if outcome.copied_to_root {
            log::info!("Migrated config/agents.md content to root AGENTS.md");
        }
        if outcome.removed_legacy {
            log::info!("Removed legacy config/agents.md");
        }
    }

    if cleanup_empty_config_dir(vault).unwrap_or(false) {
        log::info!("Removed empty config/ directory");
    }

    let _ = sync_required_ai_guidance_files(vault);
}

/// Repair config files: ensure `AGENTS.md` at vault root and root type definitions.
/// Migrates legacy `config/agents.md` to root if present.
/// Called by the "Repair Vault" command. Returns a status message.
pub fn repair_config_files(vault_path: impl AsRef<str>) -> Result<String, String> {
    let vault = Path::new(vault_path.as_ref());
    let root_agents = vault.join("AGENTS.md");
    let config_agents = vault.join("config").join("agents.md");

    migrate_legacy_agents_file(&root_agents, &config_agents)?;
    let _ = cleanup_empty_config_dir(vault)?;
    sync_required_ai_guidance_files(vault)?;

    write_if_missing(&vault.join("type.md"), TYPE_TYPE_DEFINITION)?;
    write_if_missing(&vault.join("note.md"), NOTE_TYPE_DEFINITION)?;

    Ok("Config files repaired".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn create_vault() -> (TempDir, PathBuf) {
        let dir = TempDir::new().unwrap();
        let vault = dir.path().join("vault");
        fs::create_dir_all(&vault).unwrap();
        (dir, vault)
    }

    fn config_dir(vault: &Path) -> PathBuf {
        let dir = vault.join("config");
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_root_agents(vault: &Path, content: &str) {
        fs::write(vault.join("AGENTS.md"), content).unwrap();
    }

    fn write_root_claude(vault: &Path, content: &str) {
        fs::write(vault.join("CLAUDE.md"), content).unwrap();
    }

    fn write_root_gemini(vault: &Path, content: &str) {
        fs::write(vault.join("GEMINI.md"), content).unwrap();
    }

    fn write_legacy_agents(vault: &Path, content: &str) {
        fs::write(config_dir(vault).join("agents.md"), content).unwrap();
    }

    fn read_root_agents(vault: &Path) -> String {
        fs::read_to_string(vault.join("AGENTS.md")).unwrap()
    }

    fn read_root_claude(vault: &Path) -> String {
        fs::read_to_string(vault.join("CLAUDE.md")).unwrap()
    }

    fn read_root_gemini(vault: &Path) -> String {
        fs::read_to_string(vault.join("GEMINI.md")).unwrap()
    }

    type VaultOperation = fn(&Path);

    fn run_seed(vault: &Path) {
        seed_config_files(vault.to_str().unwrap());
    }

    fn run_migrate(vault: &Path) {
        migrate_agents_md(vault.to_str().unwrap());
    }

    fn run_repair(vault: &Path) {
        repair_config_files(vault.to_str().unwrap()).unwrap();
    }

    fn run_with_agents(
        run: VaultOperation,
        root_agents: Option<&str>,
        legacy_agents: Option<&str>,
    ) -> (TempDir, PathBuf) {
        let (dir, vault) = create_vault();
        if let Some(content) = root_agents {
            write_root_agents(&vault, content);
        }
        if let Some(content) = legacy_agents {
            write_legacy_agents(&vault, content);
        }

        run(&vault);
        (dir, vault)
    }

    fn assert_preserves_custom_agents(run: VaultOperation) {
        let (_dir, vault) = run_with_agents(
            run,
            Some("# Custom Agent Config\nMy custom instructions\n"),
            None,
        );

        assert!(
            read_root_agents(&vault).contains("Custom Agent Config"),
            "must preserve existing content"
        );
    }

    fn assert_refreshes_outdated_managed_agents(run: VaultOperation) {
        let outdated_agents = AGENTS_MD.replacen(
            "Store note type in the `type:` frontmatter field.",
            "`type:` is the preferred type field. Tolaria still understands legacy aliases such as `Is A`.",
            1,
        );
        let (_dir, vault) = run_with_agents(run, Some(&outdated_agents), None);

        let content = read_root_agents(&vault);
        assert!(content.contains("Store note type in the `type:` frontmatter field."));
        assert!(!content.contains("Tolaria still understands legacy aliases such as `Is A`."));
    }

    fn assert_legacy_agents_move_to_root(
        run: VaultOperation,
        legacy_agents: &str,
        expected_root_text: &str,
        expect_config_dir_removed: bool,
    ) {
        let (_dir, vault) = run_with_agents(run, None, Some(legacy_agents));

        let config_dir = vault.join("config");
        let root_content = read_root_agents(&vault);
        assert!(root_content.contains(expected_root_text));
        assert!(!config_dir.join("agents.md").exists());
        assert_eq!(config_dir.exists(), !expect_config_dir_removed);
    }

    fn assert_stub_agents_are_replaced(
        run: VaultOperation,
        legacy_agents: &str,
        expected_root_text: &str,
    ) {
        let (_dir, vault) = run_with_agents(
            run,
            Some("# Agent Instructions\nSee config/agents.md for vault instructions.\n"),
            Some(legacy_agents),
        );

        let content = read_root_agents(&vault);
        assert!(content.contains(expected_root_text));
    }

    fn assert_required_agents_file_seeded(vault: &Path) {
        assert!(vault.join("AGENTS.md").exists());
        assert!(read_root_agents(vault).contains("Tolaria Vault"));
    }

    fn assert_required_guidance_shims_seeded(vault: &Path) {
        assert_eq!(read_root_claude(vault), CLAUDE_MD_SHIM);
        assert!(!vault.join("GEMINI.md").exists());
    }

    fn assert_required_guidance_files_seeded(vault: &Path) {
        assert_required_agents_file_seeded(vault);
        assert_required_guidance_shims_seeded(vault);
    }

    fn assert_root_type_definitions_seeded(vault: &Path) {
        assert!(vault.join("type.md").exists());
        assert!(vault.join("note.md").exists());
        assert!(!vault.join("config").exists());
    }

    fn assert_type_definition_content(vault: &Path) {
        let type_content = fs::read_to_string(vault.join("type.md")).unwrap();
        let note_content = fs::read_to_string(vault.join("note.md")).unwrap();
        assert_type_definition_body(&type_content);
        assert_note_definition_body(&note_content);
    }

    fn assert_type_definition_body(type_content: &str) {
        assert!(type_content.contains("type: Type"));
        assert!(type_content.contains("# Type"));
        assert!(type_content.contains("visible: false"));
    }

    fn assert_note_definition_body(note_content: &str) {
        assert!(note_content.contains("type: Type"));
        assert!(note_content.contains("# Note"));
    }

    #[test]
    fn test_seed_config_files_creates_guidance_files_at_root() {
        let (_dir, vault) = create_vault();

        seed_config_files(vault.to_str().unwrap());

        assert_required_guidance_files_seeded(&vault);
    }

    #[test]
    fn test_seed_config_files_creates_type_definitions() {
        let (_dir, vault) = create_vault();

        seed_config_files(vault.to_str().unwrap());

        assert_root_type_definitions_seeded(&vault);
        assert_type_definition_content(&vault);
    }

    #[test]
    fn test_seed_config_files_preserves_custom_agents() {
        assert_preserves_custom_agents(run_seed);
    }

    #[test]
    fn test_seed_config_files_reseeds_empty() {
        let (_dir, vault) = create_vault();
        write_root_agents(&vault, "");

        seed_config_files(vault.to_str().unwrap());
        assert!(read_root_agents(&vault).contains("Tolaria Vault"));
    }

    #[test]
    fn test_seed_config_files_refreshes_stale_default_agents() {
        let (_dir, vault) = create_vault();
        write_root_agents(
            &vault,
            "# AGENTS.md — Tolaria Vault\n\n- The first H1 in the body is the note title. Do not add `title:` frontmatter.\n",
        );

        seed_config_files(vault.to_str().unwrap());

        let content = read_root_agents(&vault);
        assert!(content.contains("Legacy `title:` frontmatter is still read as a fallback"));
        assert!(content.contains("views/*.yml"));
        assert!(content.contains("Belongs to:"));
    }

    #[test]
    fn test_seed_config_files_refreshes_outdated_managed_agents() {
        assert_refreshes_outdated_managed_agents(run_seed);
    }

    #[test]
    fn test_seed_config_files_preserves_custom_claude() {
        let (_dir, vault) = create_vault();
        write_root_claude(&vault, "# Custom Claude instructions\nDo not overwrite\n");

        seed_config_files(vault.to_str().unwrap());

        assert!(read_root_claude(&vault).contains("Custom Claude instructions"));
    }

    #[test]
    fn test_seed_config_files_refreshes_previous_managed_claude_shim() {
        let (_dir, vault) = create_vault();
        write_root_claude(&vault, HEADING_CLAUDE_MD_SHIM);

        seed_config_files(vault.to_str().unwrap());

        assert_eq!(read_root_claude(&vault), CLAUDE_MD_SHIM);
    }

    #[test]
    fn test_migrate_agents_md_moves_config_to_root() {
        assert_legacy_agents_move_to_root(
            run_migrate,
            "# My vault agent instructions\nCustom content\n",
            "My vault agent instructions",
            true,
        );
    }

    #[test]
    fn test_migrate_agents_md_preserves_existing_root() {
        let (_dir, vault) = create_vault();
        write_root_agents(&vault, "# My root agent config\nDo not overwrite\n");
        write_legacy_agents(&vault, "Legacy content");

        migrate_agents_md(vault.to_str().unwrap());

        let config_dir = vault.join("config");
        let content = read_root_agents(&vault);
        assert!(content.contains("My root agent config"));
        assert!(!config_dir.join("agents.md").exists());
    }

    #[test]
    fn test_migrate_agents_md_replaces_stub_with_config_content() {
        assert_stub_agents_are_replaced(
            run_migrate,
            "# Real Agent Config\nImportant instructions\n",
            "Real Agent Config",
        );
    }

    #[test]
    fn test_migrate_agents_md_idempotent_when_no_legacy() {
        let (_dir, vault) = create_vault();

        migrate_agents_md(vault.to_str().unwrap());

        assert!(vault.join("AGENTS.md").exists());
        let root = read_root_agents(&vault);
        assert!(root.contains("Tolaria Vault"));
        assert_eq!(read_root_claude(&vault), CLAUDE_MD_SHIM);
    }

    #[test]
    fn test_migrate_agents_md_keeps_nonempty_config_dir() {
        let (_dir, vault) = create_vault();
        let config_dir = config_dir(&vault);
        fs::write(config_dir.join("agents.md"), "Agent content").unwrap();
        fs::write(config_dir.join("other.md"), "Other file").unwrap();

        migrate_agents_md(vault.to_str().unwrap());

        assert!(config_dir.exists());
        assert!(config_dir.join("other.md").exists());
        assert!(!config_dir.join("agents.md").exists());
    }

    #[test]
    fn test_repair_config_files_creates_all() {
        let (_dir, vault) = create_vault();

        let msg = repair_config_files(vault.to_str().unwrap()).unwrap();
        assert_eq!(msg, "Config files repaired");

        assert_required_guidance_files_seeded(&vault);
        assert_root_type_definitions_seeded(&vault);
        assert_type_definition_content(&vault);
        assert!(fs::read_to_string(vault.join("note.md"))
            .unwrap()
            .contains("general-purpose document"));
    }

    #[test]
    fn test_repair_config_files_preserves_custom_content() {
        assert_preserves_custom_agents(run_repair);
    }

    #[test]
    fn test_repair_config_files_migrates_legacy_config() {
        assert_legacy_agents_move_to_root(
            run_repair,
            "# My vault agent instructions\nCustom content\n",
            "My vault agent instructions",
            true,
        );
    }

    #[test]
    fn test_repair_config_files_replaces_stub_with_legacy() {
        assert_stub_agents_are_replaced(
            run_repair,
            "# Real Instructions\nImportant stuff\n",
            "Real Instructions",
        );
    }

    #[test]
    fn test_repair_config_files_refreshes_outdated_managed_agents() {
        assert_refreshes_outdated_managed_agents(run_repair);
    }

    #[test]
    fn test_get_ai_guidance_status_reports_custom_and_repairable_files() {
        let (_dir, vault) = create_vault();
        write_root_agents(&vault, "# Custom Agent Config\nHands off\n");
        write_root_claude(&vault, "");

        let status = get_ai_guidance_status(vault.to_str().unwrap()).unwrap();
        assert_eq!(
            status,
            VaultAiGuidanceStatus {
                agents_state: AiGuidanceFileState::Custom,
                claude_state: AiGuidanceFileState::Broken,
                gemini_state: AiGuidanceFileState::Missing,
                can_restore: true,
            }
        );
    }

    #[test]
    fn test_restore_ai_guidance_files_repairs_without_overwriting_custom_agents() {
        let (_dir, vault) = create_vault();
        write_root_agents(&vault, "# Custom Agent Config\nHands off\n");
        write_root_claude(&vault, "");

        let status = restore_ai_guidance_files(vault.to_str().unwrap()).unwrap();
        assert_eq!(
            status,
            VaultAiGuidanceStatus {
                agents_state: AiGuidanceFileState::Custom,
                claude_state: AiGuidanceFileState::Managed,
                gemini_state: AiGuidanceFileState::Managed,
                can_restore: false,
            }
        );
        assert!(read_root_agents(&vault).contains("Custom Agent Config"));
        assert_eq!(read_root_claude(&vault), CLAUDE_MD_SHIM);
        assert_eq!(read_root_gemini(&vault), GEMINI_MD_SHIM);
    }

    #[test]
    fn test_restore_ai_guidance_files_repairs_broken_agents_and_missing_claude() {
        let (_dir, vault) = create_vault();
        write_root_agents(&vault, "");

        let status = restore_ai_guidance_files(vault.to_str().unwrap()).unwrap();
        assert_eq!(
            status,
            VaultAiGuidanceStatus {
                agents_state: AiGuidanceFileState::Managed,
                claude_state: AiGuidanceFileState::Managed,
                gemini_state: AiGuidanceFileState::Managed,
                can_restore: false,
            }
        );
    }

    #[test]
    fn test_restore_ai_guidance_files_preserves_custom_gemini() {
        let (_dir, vault) = create_vault();
        write_root_agents(&vault, AGENTS_MD);
        write_root_claude(&vault, CLAUDE_MD_SHIM);
        write_root_gemini(&vault, "# Custom Gemini instructions\nDo not overwrite\n");

        let status = restore_ai_guidance_files(vault.to_str().unwrap()).unwrap();

        assert_eq!(status.gemini_state, AiGuidanceFileState::Custom);
        assert!(!status.can_restore);
        assert!(read_root_gemini(&vault).contains("Custom Gemini instructions"));
    }
}
