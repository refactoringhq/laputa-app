pub(crate) fn tolaria_node_mcp_server(
    mcp_server_path: &str,
    vault_path: &str,
    vault_paths: &[String],
    include_ui_bridge_env: bool,
) -> serde_json::Value {
    let mut env = serde_json::json!({
        "VAULT_PATH": vault_path,
        "VAULT_PATHS": super::active_vault_paths_json(vault_path, vault_paths)
    });

    if include_ui_bridge_env {
        env["WS_UI_PORT"] = serde_json::json!("9711");
    }

    serde_json::json!({
        "command": "node",
        "args": [mcp_server_path],
        "env": env
    })
}
