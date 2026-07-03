use serde::Serialize;
use std::path::Path;

use super::command::git_output_result;
use super::run_git;

pub(crate) const FALLBACK_AUTHOR_NAME: &str = "Tolaria";
pub(crate) const FALLBACK_AUTHOR_EMAIL: &str = "vault@tolaria.default";
pub(crate) const LEGACY_FALLBACK_EMAIL: &str = "vault@tolaria.md";

const SOURCE_FALLBACK: &str = "fallback";
const SOURCE_GLOBAL: &str = "global";
const SOURCE_REPOSITORY: &str = "repository";
const SOURCE_SYSTEM: &str = "system";
const SOURCE_UNKNOWN: &str = "unknown";
const SOURCE_ENVIRONMENT: &str = "environment";
const WARNING_LOCAL_OVERRIDES_GLOBAL: &str = "local_overrides_global";

#[derive(Clone, Copy)]
pub(crate) enum AuthorConfigKey {
    Name,
    Email,
}

#[derive(Clone, Copy)]
enum ConfigScope {
    Local,
    Global,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct GitAuthorIdentity {
    pub name: String,
    pub email: String,
    pub source: String,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AuthorIdentity {
    name: String,
    email: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ScopedConfigValue {
    scope: String,
    value: String,
}

pub fn git_author_identity(vault_path: &str) -> Result<GitAuthorIdentity, String> {
    let dir = Path::new(vault_path);

    ensure_author_config(dir)?;
    let identity = resolved_git_author_identity(dir)?;
    let source = author_identity_source(dir, &identity.email)?;
    let warning = local_global_identity_warning(dir)?;

    Ok(GitAuthorIdentity {
        name: identity.name,
        email: identity.email,
        source,
        warning,
    })
}

pub(crate) fn ensure_author_config(dir: &Path) -> Result<(), String> {
    heal_legacy_local_identity(dir)?;

    for (key, fallback, skip_legacy) in [
        (AuthorConfigKey::Name, FALLBACK_AUTHOR_NAME, false),
        (AuthorConfigKey::Email, FALLBACK_AUTHOR_EMAIL, true),
    ] {
        let key_name = match key {
            AuthorConfigKey::Name => "user.name",
            AuthorConfigKey::Email => "user.email",
        };
        let resolved = git_output_result(dir, &["config", key_name])
            .map_err(|e| format!("Failed to check git config {key_name}: {e}"))?;

        let value = String::from_utf8_lossy(&resolved.stdout);
        let value = value.trim();
        if resolved.status.success() && resolved_author_value_is_usable(value, skip_legacy) {
            continue;
        }

        run_git(dir, &["config", "--local", key_name, fallback])?;
    }
    Ok(())
}

fn resolved_author_value_is_usable(value: &str, skip_legacy: bool) -> bool {
    if value.is_empty() {
        return false;
    }

    !skip_legacy || value != LEGACY_FALLBACK_EMAIL
}

fn heal_legacy_local_identity(dir: &Path) -> Result<(), String> {
    let local_email = local_config_value(dir, AuthorConfigKey::Email)?;
    if local_email.as_deref() != Some(LEGACY_FALLBACK_EMAIL) {
        return Ok(());
    }

    run_git(dir, &["config", "--local", "--unset-all", "user.email"])?;
    if local_config_value(dir, AuthorConfigKey::Name)?.as_deref() == Some(FALLBACK_AUTHOR_NAME) {
        run_git(dir, &["config", "--local", "--unset-all", "user.name"])?;
    }
    Ok(())
}

pub(crate) fn local_config_value(
    dir: &Path,
    key: AuthorConfigKey,
) -> Result<Option<String>, String> {
    config_value(dir, ConfigScope::Local, key)
}

fn global_config_value(dir: &Path, key: AuthorConfigKey) -> Result<Option<String>, String> {
    config_value(dir, ConfigScope::Global, key)
}

fn config_value(
    dir: &Path,
    scope: ConfigScope,
    key: AuthorConfigKey,
) -> Result<Option<String>, String> {
    let scope_flag = match scope {
        ConfigScope::Local => "--local",
        ConfigScope::Global => "--global",
    };
    let key_name = match key {
        AuthorConfigKey::Name => "user.name",
        AuthorConfigKey::Email => "user.email",
    };
    let output = git_output_result(dir, &["config", scope_flag, key_name])
        .map_err(|e| format!("Failed to check git config {key_name}: {e}"))?;

    let value = String::from_utf8_lossy(&output.stdout);
    let value = value.trim();
    Ok((output.status.success() && !value.is_empty()).then(|| value.to_string()))
}

fn resolved_git_author_identity(dir: &Path) -> Result<AuthorIdentity, String> {
    let output = git_output_result(dir, &["var", "GIT_AUTHOR_IDENT"])
        .map_err(|e| format!("Failed to resolve git author identity: {e}"))?;

    if !output.status.success() {
        return Err(author_identity_error(&output));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_author_ident(&stdout).ok_or_else(|| "Failed to parse git author identity".to_string())
}

fn author_identity_error(output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let detail = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    format!("Failed to resolve git author identity: {detail}")
}

fn parse_author_ident(value: &str) -> Option<AuthorIdentity> {
    let value = value.trim();
    let close = value.rfind('>')?;
    let before_email_close = &value[..close];
    let open = before_email_close.rfind('<')?;
    let name = before_email_close[..open].trim();
    let email = before_email_close[open + 1..].trim();

    if name.is_empty() || email.is_empty() {
        return None;
    }

    Some(AuthorIdentity {
        name: name.to_string(),
        email: email.to_string(),
    })
}

fn author_identity_source(dir: &Path, email: &str) -> Result<String, String> {
    if email == FALLBACK_AUTHOR_EMAIL {
        return Ok(SOURCE_FALLBACK.to_string());
    }

    let Some(config) = scoped_config_value(dir, AuthorConfigKey::Email)? else {
        return Ok(SOURCE_UNKNOWN.to_string());
    };

    if config.value != email {
        return Ok(SOURCE_ENVIRONMENT.to_string());
    }

    Ok(scope_source(&config.scope).to_string())
}

fn scoped_config_value(
    dir: &Path,
    key: AuthorConfigKey,
) -> Result<Option<ScopedConfigValue>, String> {
    let key_name = match key {
        AuthorConfigKey::Name => "user.name",
        AuthorConfigKey::Email => "user.email",
    };
    let output = git_output_result(dir, &["config", "--show-scope", "--get", key_name])
        .map_err(|e| format!("Failed to check git config {key_name}: {e}"))?;

    if !output.status.success() {
        return Ok(None);
    }

    Ok(parse_scoped_config_value(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

fn parse_scoped_config_value(stdout: &str) -> Option<ScopedConfigValue> {
    let line = stdout.lines().next()?.trim();
    let (scope, value) = line.split_once('\t')?;
    let value = value.trim();
    (!scope.is_empty() && !value.is_empty()).then(|| ScopedConfigValue {
        scope: scope.to_string(),
        value: value.to_string(),
    })
}

fn scope_source(scope: &str) -> &str {
    match scope {
        "local" | "worktree" => SOURCE_REPOSITORY,
        "global" => SOURCE_GLOBAL,
        "system" => SOURCE_SYSTEM,
        "command" => SOURCE_ENVIRONMENT,
        _ => SOURCE_UNKNOWN,
    }
}

fn local_global_identity_warning(dir: &Path) -> Result<Option<String>, String> {
    let Some(local) = config_identity(dir, local_config_value)? else {
        return Ok(None);
    };
    let Some(global) = config_identity(dir, global_config_value)? else {
        return Ok(None);
    };

    Ok((local != global).then(|| WARNING_LOCAL_OVERRIDES_GLOBAL.to_string()))
}

fn config_identity(
    dir: &Path,
    reader: fn(&Path, AuthorConfigKey) -> Result<Option<String>, String>,
) -> Result<Option<AuthorIdentity>, String> {
    let name = reader(dir, AuthorConfigKey::Name)?;
    let email = reader(dir, AuthorConfigKey::Email)?;

    Ok(match (name, email) {
        (Some(name), Some(email)) => Some(AuthorIdentity { name, email }),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_author_ident_with_spaces_in_name() {
        let identity = parse_author_ident("Vault Owner <owner@example.com> 1781170560 +0200")
            .expect("author identity should parse");

        assert_eq!(
            identity,
            AuthorIdentity {
                name: "Vault Owner".to_string(),
                email: "owner@example.com".to_string(),
            }
        );
    }

    #[test]
    fn parses_scoped_config_value() {
        assert_eq!(
            parse_scoped_config_value("local\towner@example.com\n"),
            Some(ScopedConfigValue {
                scope: "local".to_string(),
                value: "owner@example.com".to_string(),
            })
        );
    }
}
