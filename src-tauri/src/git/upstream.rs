use std::path::Path;

use super::command::{git_output, git_output_result, stdout_text};

const DETACHED_HEAD_BRANCH: &str = "Detached HEAD";

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct UpstreamTarget {
    pub remote: String,
    pub branch: String,
    pub display: String,
}

pub(crate) fn branch_label(vault: &Path) -> Result<String, String> {
    Ok(current_branch(vault)?.unwrap_or_else(|| DETACHED_HEAD_BRANCH.to_string()))
}

pub(crate) fn missing_upstream_message(vault: &Path) -> Result<String, String> {
    let branch = branch_label(vault)?;
    if branch == DETACHED_HEAD_BRANCH {
        return Ok(
            "This vault is in detached HEAD. Check out a branch and configure its upstream before syncing in Tolaria."
                .to_string(),
        );
    }
    Ok(format!(
        "No upstream branch configured for '{branch}'. Set a tracking branch with external Git tooling, then sync again in Tolaria."
    ))
}

pub(crate) fn sync_target(vault: &Path) -> Result<Option<UpstreamTarget>, String> {
    let Some(branch_name) = current_branch(vault)? else {
        return Ok(None);
    };
    let Some(remote) = config_value(vault, &format!("branch.{branch_name}.remote"))? else {
        return Ok(None);
    };
    let Some(merge_ref) = config_value(vault, &format!("branch.{branch_name}.merge"))? else {
        return Ok(None);
    };
    let branch = merge_ref
        .strip_prefix("refs/heads/")
        .unwrap_or(merge_ref.as_str())
        .to_string();
    if remote.is_empty() || branch.is_empty() {
        return Ok(None);
    }
    Ok(Some(UpstreamTarget {
        display: format!("{remote}/{branch}"),
        remote,
        branch,
    }))
}

fn current_branch(vault: &Path) -> Result<Option<String>, String> {
    let output = git_output(vault, &["branch", "--show-current"])
        .map_err(|e| format!("Failed to get branch: {}", e))?;
    let branch = stdout_text(&output);
    if branch.is_empty() {
        Ok(None)
    } else {
        Ok(Some(branch))
    }
}

fn config_value(vault: &Path, key: &str) -> Result<Option<String>, String> {
    let output = git_output_result(vault, &["config", "--get", key])?;
    if !output.status.success() {
        return Ok(None);
    }
    let value = stdout_text(&output);
    if value.is_empty() {
        Ok(None)
    } else {
        Ok(Some(value))
    }
}
