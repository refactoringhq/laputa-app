use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, Runtime, Url};
use tauri_plugin_updater::UpdaterExt;

const RELEASES_BASE_URL: &str = "https://refactoringhq.github.io/tolaria";

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

fn build_updater<R: Runtime>(
    app_handle: &AppHandle<R>,
    release_channel: ReleaseChannel,
) -> Result<tauri_plugin_updater::Updater, String> {
    app_handle
        .updater_builder()
        .endpoints(vec![release_channel.updater_endpoint()?])
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

pub async fn check_for_app_update<R: Runtime>(
    app_handle: AppHandle<R>,
    release_channel: Option<String>,
) -> Result<Option<AppUpdateMetadata>, String> {
    let channel = ReleaseChannel::from_settings_value(release_channel.as_deref());
    let updater = build_updater(&app_handle, channel)?;
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
    let updater = build_updater(&app_handle, channel)?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("Failed to refresh update metadata: {e}"))?
        .ok_or_else(|| "No update is currently available".to_string())?;

    if update.version != expected_version {
        return Err(format!(
            "Expected update version {}, found {}",
            expected_version, update.version
        ));
    }

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

#[cfg(test)]
mod tests {
    use super::{AppUpdateDownloadEvent, AppUpdateMetadata, ReleaseChannel};
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
}
