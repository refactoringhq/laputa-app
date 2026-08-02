use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{ipc::Channel, AppHandle, Runtime, Url};
use tauri_plugin_updater::UpdaterExt;

const ALPHA_METADATA_ASSET_NAME: &str = "alpha-latest.json";
const GITHUB_RELEASES_API_URL: &str =
    "https://api.github.com/repos/refactoringhq/tolaria/releases?per_page=100";
const RELEASES_BASE_URL: &str = "https://refactoringhq.github.io/tolaria";
const UPDATER_HTTP_TIMEOUT: Duration = Duration::from_secs(5);
const UPDATER_USER_AGENT: &str = concat!("Tolaria/", env!("CARGO_PKG_VERSION"));

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateMetadata {
    pub current_version: String,
    pub version: String,
    pub date: Option<String>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum AppUpdateDownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReleaseChannel {
    Alpha,
    Stable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct AlphaReleaseVersion {
    year: i32,
    month: u32,
    day: u32,
    sequence: u32,
}

#[derive(Debug, Clone, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    draft: bool,
    published_at: chrono::DateTime<chrono::Utc>,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

impl ReleaseChannel {
    fn from_settings_value(value: Option<&str>) -> Self {
        match crate::settings::effective_release_channel(value) {
            "alpha" => Self::Alpha,
            _ => Self::Stable,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Alpha => "alpha",
            Self::Stable => "stable",
        }
    }

    fn updater_endpoint(self) -> Result<Url, String> {
        let endpoint = format!("{}/{}/latest.json", RELEASES_BASE_URL, self.as_str());
        Url::parse(&endpoint).map_err(|e| format!("Invalid updater endpoint: {e}"))
    }
}

impl AlphaReleaseVersion {
    fn parse_tag(tag_name: &str) -> Option<Self> {
        let release = tag_name.strip_prefix("alpha-v")?;
        let (date, sequence) = release.split_once("-alpha.")?;
        let sequence = sequence.parse().ok()?;
        let (year, month, day) = parse_calendar_date(date)?;
        chrono::NaiveDate::from_ymd_opt(year, month, day)?;

        Some(Self {
            year,
            month,
            day,
            sequence,
        })
    }
}

fn parse_calendar_date(value: &str) -> Option<(i32, u32, u32)> {
    let mut parts = value.split('.');
    let year = parts.next()?.parse().ok()?;
    let month = parts.next()?.parse().ok()?;
    let day = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }

    Some((year, month, day))
}

fn calendar_version_date(version: &str) -> Option<chrono::NaiveDate> {
    let core = version.split_once('-').map_or(version, |(value, _)| value);
    let (year, month, day) = parse_calendar_date(core)?;
    chrono::NaiveDate::from_ymd_opt(year, month, day)
}

fn should_recover_poisoned_calendar_version(
    current_version: &str,
    remote_version: &str,
    today: chrono::NaiveDate,
) -> bool {
    let Some(current_date) = calendar_version_date(current_version) else {
        return false;
    };
    let Some(remote_date) = calendar_version_date(remote_version) else {
        return false;
    };
    let tomorrow = today.succ_opt().unwrap_or(today);

    current_date > tomorrow && remote_date >= today && remote_date <= tomorrow
}

fn latest_alpha_release_metadata_url(releases: &[GitHubRelease]) -> Option<Url> {
    releases
        .iter()
        .filter(|release| !release.draft)
        .filter_map(alpha_release_metadata_candidate)
        .max_by_key(|(_, published_at, _)| *published_at)
        .map(|(_, _, url)| url)
}

fn alpha_release_metadata_candidate(
    release: &GitHubRelease,
) -> Option<(AlphaReleaseVersion, chrono::DateTime<chrono::Utc>, Url)> {
    let version = AlphaReleaseVersion::parse_tag(&release.tag_name)?;
    let asset = release
        .assets
        .iter()
        .find(|asset| asset.name == ALPHA_METADATA_ASSET_NAME)?;
    let url = Url::parse(&asset.browser_download_url).ok()?;

    Some((version, release.published_at, url))
}

async fn alpha_release_metadata_endpoint() -> Result<Url, String> {
    let client = reqwest::Client::builder()
        .timeout(UPDATER_HTTP_TIMEOUT)
        .user_agent(UPDATER_USER_AGENT)
        .build()
        .map_err(|e| format!("Failed to create updater metadata client: {e}"))?;

    let releases = client
        .get(GITHUB_RELEASES_API_URL)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch GitHub releases: {e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub releases request failed: {e}"))?
        .json::<Vec<GitHubRelease>>()
        .await
        .map_err(|e| format!("Failed to parse GitHub releases: {e}"))?;

    latest_alpha_release_metadata_url(&releases)
        .ok_or_else(|| "No alpha updater metadata asset found in GitHub releases".to_string())
}

async fn updater_endpoint(release_channel: ReleaseChannel) -> Result<Url, String> {
    match release_channel {
        ReleaseChannel::Stable => release_channel.updater_endpoint(),
        ReleaseChannel::Alpha => alpha_release_metadata_endpoint()
            .await
            .or_else(|_| release_channel.updater_endpoint()),
    }
}

fn build_updater<R: Runtime>(
    app_handle: &AppHandle<R>,
    endpoint: Url,
) -> Result<tauri_plugin_updater::Updater, String> {
    app_handle
        .updater_builder()
        .version_comparator(|current, release| {
            release.version > current
                || should_recover_poisoned_calendar_version(
                    &current.to_string(),
                    &release.version.to_string(),
                    chrono::Utc::now().date_naive(),
                )
        })
        .endpoints(vec![endpoint])
        .map_err(|e| format!("Failed to configure updater endpoint: {e}"))?
        .build()
        .map_err(|e| format!("Failed to build updater: {e}"))
}

fn to_update_metadata(update: tauri_plugin_updater::Update) -> AppUpdateMetadata {
    AppUpdateMetadata {
        current_version: update.current_version,
        version: update.version,
        date: update.date.map(|value| value.to_string()),
        body: update.body,
    }
}

fn ensure_expected_update_version(
    update: &tauri_plugin_updater::Update,
    expected_version: &str,
) -> Result<(), String> {
    if update.version == expected_version {
        return Ok(());
    }

    Err(format!(
        "Expected update version {}, found {}",
        expected_version, update.version
    ))
}

async fn install_update(
    update: tauri_plugin_updater::Update,
    on_event: Channel<AppUpdateDownloadEvent>,
) -> Result<(), String> {
    let mut started = false;
    update
        .download_and_install(
            |chunk_length, content_length| {
                if !started {
                    started = true;
                    let _ = on_event.send(AppUpdateDownloadEvent::Started { content_length });
                }

                let _ = on_event.send(AppUpdateDownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(AppUpdateDownloadEvent::Finished);
            },
        )
        .await
        .map_err(|e| format!("Failed to download and install update: {e}"))
}

pub async fn check_for_app_update<R: Runtime>(
    app_handle: AppHandle<R>,
    release_channel: Option<String>,
) -> Result<Option<AppUpdateMetadata>, String> {
    let channel = ReleaseChannel::from_settings_value(release_channel.as_deref());
    let updater = build_updater(&app_handle, updater_endpoint(channel).await?)?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("Failed to check for updates: {e}"))?;

    Ok(update.map(to_update_metadata))
}

pub async fn download_and_install_app_update<R: Runtime>(
    app_handle: AppHandle<R>,
    release_channel: Option<String>,
    expected_version: String,
    on_event: Channel<AppUpdateDownloadEvent>,
) -> Result<(), String> {
    let channel = ReleaseChannel::from_settings_value(release_channel.as_deref());
    let updater = build_updater(&app_handle, updater_endpoint(channel).await?)?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("Failed to refresh update metadata: {e}"))?
        .ok_or_else(|| "No update is currently available".to_string())?;

    ensure_expected_update_version(&update, &expected_version)?;

    install_update(update, on_event).await
}

#[cfg(test)]
mod tests {
    use super::{
        latest_alpha_release_metadata_url, should_recover_poisoned_calendar_version,
        AppUpdateDownloadEvent, AppUpdateMetadata, GitHubAsset, GitHubRelease, ReleaseChannel,
    };
    use serde_json::json;

    #[test]
    fn release_channel_defaults_to_stable() {
        assert_eq!(
            ReleaseChannel::from_settings_value(None),
            ReleaseChannel::Stable
        );
        assert_eq!(
            ReleaseChannel::from_settings_value(Some("stable")),
            ReleaseChannel::Stable
        );
        assert_eq!(
            ReleaseChannel::from_settings_value(Some("beta")),
            ReleaseChannel::Stable
        );
        assert_eq!(
            ReleaseChannel::from_settings_value(Some("invalid")),
            ReleaseChannel::Stable
        );
    }

    #[test]
    fn release_channel_accepts_alpha() {
        assert_eq!(
            ReleaseChannel::from_settings_value(Some("alpha")),
            ReleaseChannel::Alpha
        );
        assert_eq!(
            ReleaseChannel::from_settings_value(Some("  alpha  ")),
            ReleaseChannel::Alpha
        );
    }

    #[test]
    fn release_channel_endpoints_match_expected_paths() {
        assert_eq!(
            ReleaseChannel::Alpha.updater_endpoint().unwrap().as_str(),
            "https://refactoringhq.github.io/tolaria/alpha/latest.json"
        );
        assert_eq!(
            ReleaseChannel::Stable.updater_endpoint().unwrap().as_str(),
            "https://refactoringhq.github.io/tolaria/stable/latest.json"
        );
    }

    #[test]
    fn alpha_release_metadata_url_uses_highest_calendar_sequence_tag() {
        let releases = vec![
            github_alpha_release(
                "alpha-v2026.5.8-alpha.0007",
                "2026-05-08T07:00:00Z",
                "https://github.com/refactoringhq/tolaria/releases/download/alpha-v2026.5.8-alpha.0007/alpha-latest.json",
            ),
            github_alpha_release(
                "alpha-v2026.5.8-alpha.0017",
                "2026-05-08T17:00:00Z",
                "https://github.com/refactoringhq/tolaria/releases/download/alpha-v2026.5.8-alpha.0017/alpha-latest.json",
            ),
            github_alpha_release(
                "alpha-v2026.5.7-alpha.0099",
                "2026-05-07T23:00:00Z",
                "https://github.com/refactoringhq/tolaria/releases/download/alpha-v2026.5.7-alpha.0099/alpha-latest.json",
            ),
        ];

        assert_eq!(
            latest_alpha_release_metadata_url(&releases)
                .unwrap()
                .as_str(),
            "https://github.com/refactoringhq/tolaria/releases/download/alpha-v2026.5.8-alpha.0017/alpha-latest.json"
        );
    }

    #[test]
    fn alpha_release_metadata_url_prefers_the_most_recently_published_recovery_release() {
        let releases = vec![
            github_alpha_release(
                "alpha-v2027.8.2-alpha.0001",
                "2026-08-02T08:00:00Z",
                "https://example.com/recovery-bridge.json",
            ),
            github_alpha_release(
                "alpha-v2026.8.2-alpha.0001",
                "2026-08-02T09:00:00Z",
                "https://example.com/corrected-release.json",
            ),
        ];

        assert_eq!(
            latest_alpha_release_metadata_url(&releases)
                .unwrap()
                .as_str(),
            "https://example.com/corrected-release.json"
        );
    }

    #[test]
    fn updater_allows_only_the_targeted_future_calendar_recovery() {
        let today = chrono::NaiveDate::from_ymd_opt(2026, 8, 2).unwrap();

        assert!(should_recover_poisoned_calendar_version(
            "2027.8.2-alpha.1",
            "2026.8.2-alpha.1",
            today,
        ));
        assert!(!should_recover_poisoned_calendar_version(
            "2026.8.1-alpha.1",
            "2026.8.2-alpha.1",
            today,
        ));
        assert!(!should_recover_poisoned_calendar_version(
            "2027.8.2-alpha.1",
            "2025.8.2-alpha.1",
            today,
        ));
    }

    #[test]
    fn alpha_release_metadata_url_ignores_drafts_and_non_alpha_assets() {
        let releases = vec![
            GitHubRelease {
                tag_name: "alpha-v2026.5.8-alpha.0018".into(),
                draft: true,
                published_at: "2026-05-08T18:00:00Z".parse().unwrap(),
                assets: vec![GitHubAsset {
                    name: "alpha-latest.json".into(),
                    browser_download_url: "https://example.com/draft.json".into(),
                }],
            },
            GitHubRelease {
                tag_name: "stable-v2026.5.8".into(),
                draft: false,
                published_at: "2026-05-08T19:00:00Z".parse().unwrap(),
                assets: vec![GitHubAsset {
                    name: "stable-latest.json".into(),
                    browser_download_url: "https://example.com/stable.json".into(),
                }],
            },
            github_alpha_release(
                "alpha-v2026.5.8-alpha.0017",
                "2026-05-08T17:00:00Z",
                "https://example.com/alpha-latest.json",
            ),
        ];

        assert_eq!(
            latest_alpha_release_metadata_url(&releases)
                .unwrap()
                .as_str(),
            "https://example.com/alpha-latest.json"
        );
    }

    #[test]
    fn update_metadata_serializes_for_frontend_consumers() {
        let metadata = AppUpdateMetadata {
            current_version: "2026.4.1".into(),
            version: "2026.4.2".into(),
            date: Some("2026-04-30T12:00:00Z".into()),
            body: Some("Bug fixes".into()),
        };

        assert_eq!(
            serde_json::to_value(metadata).unwrap(),
            json!({
                "currentVersion": "2026.4.1",
                "version": "2026.4.2",
                "date": "2026-04-30T12:00:00Z",
                "body": "Bug fixes"
            })
        );
    }

    #[test]
    fn download_events_serialize_as_tagged_frontend_events() {
        let events = [
            (
                AppUpdateDownloadEvent::Started {
                    content_length: Some(4096),
                },
                json!({
                    "event": "Started",
                    "data": { "contentLength": 4096 }
                }),
            ),
            (
                AppUpdateDownloadEvent::Progress { chunk_length: 512 },
                json!({
                    "event": "Progress",
                    "data": { "chunkLength": 512 }
                }),
            ),
            (
                AppUpdateDownloadEvent::Finished,
                json!({ "event": "Finished" }),
            ),
        ];

        for (event, expected) in events {
            assert_eq!(serde_json::to_value(event).unwrap(), expected);
        }
    }

    fn github_alpha_release(
        tag_name: &str,
        published_at: &str,
        browser_download_url: &str,
    ) -> GitHubRelease {
        GitHubRelease {
            tag_name: tag_name.into(),
            draft: false,
            published_at: published_at.parse().unwrap(),
            assets: vec![GitHubAsset {
                name: "alpha-latest.json".into(),
                browser_download_url: browser_download_url.into(),
            }],
        }
    }
}
