use crate::commands::expand_tilde;
use crate::vault::{self, DetectedRename, RenameResult};
use serde::Deserialize;
use std::path::Path;

use super::boundary::{
    with_boundary, with_existing_path_in_requested_vault, with_validated_path, ValidatedPathMode,
};

struct RequestedNotePath<'a> {
    vault_path: &'a str,
    note_path: &'a str,
}

struct ValidatedNotePath<'a> {
    vault_path: &'a str,
    note_path: &'a str,
}

impl<'a> RequestedNotePath<'a> {
    fn new(vault_path: &'a str, note_path: &'a str) -> Self {
        Self {
            vault_path,
            note_path,
        }
    }
}

fn with_note_path_in_vault<T>(
    request: RequestedNotePath<'_>,
    action: impl FnOnce(ValidatedNotePath<'_>) -> Result<T, String>,
) -> Result<T, String> {
    with_existing_path_in_requested_vault(
        request.vault_path,
        request.note_path,
        |requested_root, validated_path| {
            action(ValidatedNotePath {
                vault_path: requested_root,
                note_path: validated_path,
            })
        },
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveNoteToWorkspaceCommandArgs {
    source_vault_path: String,
    destination_vault_path: String,
    old_path: String,
    replacement_target: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameNoteCommandArgs {
    vault_path: String,
    old_path: String,
    new_title: String,
    old_title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameNoteFilenameCommandArgs {
    vault_path: String,
    old_path: String,
    new_filename_stem: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveNoteToFolderCommandArgs {
    vault_path: String,
    old_path: String,
    folder_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoRenameUntitledCommandArgs {
    vault_path: String,
    note_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultPathCommandArgs {
    vault_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWikilinksForRenamesCommandArgs {
    vault_path: String,
    renames: Vec<DetectedRename>,
}

enum NoteRenameCommandArgs {
    Title {
        new_title: String,
        old_title: Option<String>,
    },
    Filename {
        new_filename_stem: String,
    },
}

impl NoteRenameCommandArgs {
    fn run(self, note: ValidatedNotePath<'_>) -> Result<RenameResult, String> {
        match self {
            Self::Title {
                new_title,
                old_title,
            } => vault::rename_note(vault::RenameNoteRequest {
                vault_path: note.vault_path,
                old_path: note.note_path,
                new_title: &new_title,
                old_title_hint: old_title.as_deref(),
            }),
            Self::Filename { new_filename_stem } => {
                vault::rename_note_filename(vault::RenameNoteFilenameRequest {
                    vault_path: note.vault_path,
                    old_path: note.note_path,
                    new_filename_stem: &new_filename_stem,
                })
            }
        }
    }
}

struct PendingNoteRenameCommand {
    vault_path: String,
    old_path: String,
    args: NoteRenameCommandArgs,
}

enum PublicNoteRenameCommandArgs {
    Title(RenameNoteCommandArgs),
    Filename(RenameNoteFilenameCommandArgs),
}

fn pending_note_rename(
    vault_path: String,
    old_path: String,
    args: NoteRenameCommandArgs,
) -> PendingNoteRenameCommand {
    PendingNoteRenameCommand {
        vault_path,
        old_path,
        args,
    }
}

fn rename_existing_note(command: PendingNoteRenameCommand) -> Result<RenameResult, String> {
    let request = RequestedNotePath::new(&command.vault_path, &command.old_path);
    with_note_path_in_vault(request, |note| command.args.run(note))
}

fn rename_public_note(args: PublicNoteRenameCommandArgs) -> Result<RenameResult, String> {
    let command = match args {
        PublicNoteRenameCommandArgs::Title(args) => pending_note_rename(
            args.vault_path,
            args.old_path,
            NoteRenameCommandArgs::Title {
                new_title: args.new_title,
                old_title: args.old_title,
            },
        ),
        PublicNoteRenameCommandArgs::Filename(args) => pending_note_rename(
            args.vault_path,
            args.old_path,
            NoteRenameCommandArgs::Filename {
                new_filename_stem: args.new_filename_stem,
            },
        ),
    };
    rename_existing_note(command)
}

#[tauri::command]
pub fn rename_note(args: RenameNoteCommandArgs) -> Result<RenameResult, String> {
    rename_public_note(PublicNoteRenameCommandArgs::Title(args))
}

#[tauri::command]
pub fn rename_note_filename(args: RenameNoteFilenameCommandArgs) -> Result<RenameResult, String> {
    rename_public_note(PublicNoteRenameCommandArgs::Filename(args))
}

fn run_folder_move(args: MoveNoteToFolderCommandArgs) -> Result<RenameResult, String> {
    let request = RequestedNotePath::new(&args.vault_path, &args.old_path);
    with_note_path_in_vault(request, |note| {
        let trimmed_folder_path = args.folder_path.trim();
        let folder_absolute_path = Path::new(note.vault_path).join(trimmed_folder_path);
        with_validated_path(
            folder_absolute_path.to_string_lossy().as_ref(),
            Some(args.vault_path.as_str()),
            ValidatedPathMode::Existing,
            |validated_folder_path| {
                let validated_folder = Path::new(validated_folder_path);
                if !validated_folder.is_dir() {
                    return Err(format!("Folder does not exist: {}", trimmed_folder_path));
                }
                vault::move_note_to_folder(vault::MoveNoteToFolderRequest {
                    vault_path: note.vault_path,
                    old_path: note.note_path,
                    destination_folder_path: validated_folder_path,
                })
            },
        )
    })
}

#[tauri::command]
pub fn move_note_to_folder(args: MoveNoteToFolderCommandArgs) -> Result<RenameResult, String> {
    run_folder_move(args)
}

#[tauri::command]
pub fn move_note_to_workspace(
    args: MoveNoteToWorkspaceCommandArgs,
) -> Result<RenameResult, String> {
    let request = RequestedNotePath::new(&args.source_vault_path, &args.old_path);
    with_note_path_in_vault(request, |note| {
        let source_root_path = Path::new(note.vault_path);
        let old_file = Path::new(note.note_path);
        let relative_path = old_file
            .strip_prefix(source_root_path)
            .map_err(|_| "Path must stay inside the source vault".to_string())?;
        let relative_path = relative_path.to_string_lossy();

        with_boundary(Some(&args.destination_vault_path), |destination_boundary| {
            let destination_path = destination_boundary.child_path(relative_path.as_ref())?;
            let destination_root = destination_boundary
                .requested_root()
                .to_string_lossy()
                .into_owned();
            let destination_path = destination_path.to_string_lossy().into_owned();
            vault::move_note_to_workspace(vault::MoveNoteToWorkspaceRequest {
                source_vault_path: note.vault_path,
                destination_vault_path: &destination_root,
                old_path: note.note_path,
                destination_path: &destination_path,
                replacement_target: args.replacement_target.as_deref(),
            })
        })
    })
}

#[tauri::command]
pub fn auto_rename_untitled(
    args: AutoRenameUntitledCommandArgs,
) -> Result<Option<RenameResult>, String> {
    with_existing_path_in_requested_vault(
        &args.vault_path,
        &args.note_path,
        |requested_root, validated_path| {
            vault::auto_rename_untitled(vault::AutoRenameUntitledRequest {
                vault_path: requested_root,
                note_path: validated_path,
            })
        },
    )
}

#[tauri::command]
pub fn detect_renames(args: VaultPathCommandArgs) -> Result<Vec<DetectedRename>, String> {
    let vault_path = expand_tilde(&args.vault_path);
    vault::detect_renames(Path::new(vault_path.as_ref()))
}

#[tauri::command]
pub fn update_wikilinks_for_renames(
    args: UpdateWikilinksForRenamesCommandArgs,
) -> Result<usize, String> {
    let vault_path = expand_tilde(&args.vault_path);
    vault::update_wikilinks_for_renames(Path::new(vault_path.as_ref()), &args.renames)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn vault_path(dir: &TempDir) -> String {
        dir.path().to_string_lossy().into_owned()
    }

    fn write_note(dir: &TempDir, relative_path: &str, content: &str) -> String {
        let path = dir.path().join(relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&path, content).unwrap();
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn rename_note_command_updates_title_file_and_links() {
        let dir = TempDir::new().unwrap();
        let vault = vault_path(&dir);
        let old_path = write_note(
            &dir,
            "old-title.md",
            "---\ntitle: Old Title\n---\n# Old Title\n",
        );
        let linked_path = write_note(&dir, "linked.md", "See [[Old Title]].\n");

        let result = rename_note(RenameNoteCommandArgs {
            vault_path: vault.clone(),
            old_path: old_path.clone(),
            new_title: "New Title".to_string(),
            old_title: None,
        })
        .unwrap();

        assert!(result.new_path.ends_with("new-title.md"));
        assert!(!Path::new(&old_path).exists());
        assert!(Path::new(&result.new_path).exists());
        assert!(fs::read_to_string(linked_path)
            .unwrap()
            .contains("[[new-title]]"));
        assert_eq!(result.failed_updates, 0);
    }

    #[test]
    fn filename_and_folder_commands_preserve_note_content() {
        let dir = TempDir::new().unwrap();
        let vault = vault_path(&dir);
        let old_path = write_note(
            &dir,
            "draft.md",
            "---\ntitle: Draft Title\n---\n# Draft Title\n",
        );

        let renamed = rename_note_filename(RenameNoteFilenameCommandArgs {
            vault_path: vault.clone(),
            old_path,
            new_filename_stem: "custom-name".to_string(),
        })
        .unwrap();
        assert!(renamed.new_path.ends_with("custom-name.md"));

        fs::create_dir(dir.path().join("Projects")).unwrap();
        let moved = move_note_to_folder(MoveNoteToFolderCommandArgs {
            vault_path: vault.clone(),
            old_path: renamed.new_path.clone(),
            folder_path: "Projects".to_string(),
        })
        .unwrap();

        assert!(moved.new_path.ends_with("Projects/custom-name.md"));
        assert!(fs::read_to_string(moved.new_path)
            .unwrap()
            .contains("Draft Title"));
    }

    #[test]
    fn move_note_to_workspace_command_preserves_relative_path() {
        let source = TempDir::new().unwrap();
        let destination = TempDir::new().unwrap();
        let source_vault = vault_path(&source);
        let destination_vault = vault_path(&destination);
        let old_path = write_note(
            &source,
            "Projects/draft.md",
            "---\ntitle: Draft Title\n---\n# Draft Title\n",
        );
        let linked_path = write_note(&source, "linked.md", "See [[Draft Title]].\n");

        let moved = move_note_to_workspace(MoveNoteToWorkspaceCommandArgs {
            source_vault_path: source_vault,
            destination_vault_path: destination_vault.clone(),
            old_path: old_path.clone(),
            replacement_target: Some("team/Projects/draft".to_string()),
        })
        .unwrap();

        assert!(!Path::new(&old_path).exists());
        assert!(moved.new_path.ends_with("Projects/draft.md"));
        assert!(moved.new_path.starts_with(&destination_vault));
        assert!(fs::read_to_string(moved.new_path)
            .unwrap()
            .contains("Draft Title"));
        assert!(fs::read_to_string(linked_path)
            .unwrap()
            .contains("[[team/Projects/draft]]"));
    }

    #[test]
    fn auto_rename_and_detected_rename_commands_route_through_vault() {
        let dir = TempDir::new().unwrap();
        let vault = vault_path(&dir);
        let untitled = write_note(&dir, "untitled-note-123.md", "# Project Plan\n");

        let auto = auto_rename_untitled(AutoRenameUntitledCommandArgs {
            vault_path: vault.clone(),
            note_path: untitled,
        })
        .unwrap()
        .unwrap();
        assert!(auto.new_path.ends_with("project-plan.md"));

        crate::git::init_repo(&vault).unwrap();
        let old_path = dir.path().join("project-plan.md");
        let new_path = dir.path().join("plans.md");
        fs::rename(&old_path, &new_path).unwrap();
        crate::hidden_command("git")
            .args(["add", "-A"])
            .current_dir(dir.path())
            .output()
            .unwrap();

        let renames = detect_renames(VaultPathCommandArgs {
            vault_path: vault.clone(),
        })
        .unwrap();
        assert_eq!(renames.len(), 1);
        assert_eq!(renames[0].old_path, "project-plan.md");
        assert_eq!(renames[0].new_path, "plans.md");

        assert_eq!(
            update_wikilinks_for_renames(UpdateWikilinksForRenamesCommandArgs {
                vault_path: vault,
                renames,
            })
            .unwrap(),
            0,
        );
    }

    #[test]
    fn move_note_to_folder_accepts_empty_folder_as_vault_root() {
        let dir = TempDir::new().unwrap();
        let vault = vault_path(&dir);
        let note = write_note(&dir, "projects/note.md", "# Note\n");

        let result = move_note_to_folder(MoveNoteToFolderCommandArgs {
            vault_path: vault,
            old_path: note,
            folder_path: "  ".to_string(),
        })
        .unwrap();

        assert!(result.new_path.ends_with("note.md"));
        assert!(dir.path().join("note.md").exists());
        assert!(!dir.path().join("projects/note.md").exists());
    }
}
