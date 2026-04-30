use crate::vault::{self, ViewDefinition, ViewFile};
use std::path::Path;

use super::boundary::{with_boundary, with_view_file};

#[tauri::command]
pub fn list_views(vault_path: String) -> Result<Vec<ViewFile>, String> {
    with_boundary(Some(vault_path.as_str()), |boundary| {
        Ok(vault::scan_views(boundary.requested_root()))
    })
}

#[tauri::command]
pub fn save_view_cmd(
    vault_path: String,
    filename: String,
    definition: ViewDefinition,
) -> Result<(), String> {
    with_view_file(
        &vault_path,
        &filename,
        |requested_root, validated_filename| {
            vault::save_view(Path::new(requested_root), validated_filename, &definition)
        },
    )
}

#[tauri::command]
pub fn delete_view_cmd(vault_path: String, filename: String) -> Result<(), String> {
    with_view_file(
        &vault_path,
        &filename,
        |requested_root, validated_filename| {
            vault::delete_view(Path::new(requested_root), validated_filename)
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::{FilterCondition, FilterGroup, FilterNode, FilterOp};

    fn definition(name: &str) -> ViewDefinition {
        ViewDefinition {
            name: name.to_string(),
            icon: Some("star".to_string()),
            color: None,
            order: None,
            sort: Some("modified:desc".to_string()),
            list_properties_display: vec!["Priority".to_string()],
            filters: FilterGroup::All(vec![FilterNode::Condition(FilterCondition {
                field: "type".to_string(),
                op: FilterOp::Equals,
                value: Some(serde_yaml::Value::String("Project".to_string())),
                regex: false,
            })]),
        }
    }

    #[test]
    fn view_commands_roundtrip_through_validated_vault_paths() {
        let dir = tempfile::TempDir::new().unwrap();
        let vault_path = dir.path().to_string_lossy().to_string();

        assert!(list_views(vault_path.clone()).unwrap().is_empty());

        save_view_cmd(
            vault_path.clone(),
            "active-projects.yml".to_string(),
            definition("Active Projects"),
        )
        .unwrap();

        let views = list_views(vault_path.clone()).unwrap();
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].filename, "active-projects.yml");
        assert_eq!(views[0].definition.name, "Active Projects");

        delete_view_cmd(vault_path.clone(), "active-projects.yml".to_string()).unwrap();

        assert!(list_views(vault_path).unwrap().is_empty());
    }
}
