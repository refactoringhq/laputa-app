use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{
    App, AppHandle, LogicalPosition, LogicalSize, Manager, Position, RunEvent, Size, WebviewWindow,
    WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const WINDOW_STATE_FILE: &str = "window-state.json";
const MIN_WINDOW_WIDTH: u32 = 480;
const MIN_WINDOW_HEIGHT: u32 = 400;

#[derive(Debug, Default)]
pub(crate) struct MainWindowFrameState(Mutex<Option<WindowFrame>>);

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
struct WindowFrame {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
struct ScreenArea {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct PersistedWindowState {
    main: Option<WindowFrame>,
    #[serde(default)]
    coordinate_space: WindowFrameCoordinateSpace,
}

#[derive(Debug, Default, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum WindowFrameCoordinateSpace {
    #[default]
    Physical,
    Logical,
}

pub(crate) fn restore_main_window_state(app: &mut App) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    restore_main_window_frame(app.handle(), &window, "during setup");
}

pub(crate) fn handle_run_event(app_handle: &AppHandle, event: &RunEvent) {
    match event {
        event if restores_window_frame_after_runtime_ready(event) => {
            restore_main_window_state_from_handle(app_handle)
        }
        RunEvent::WindowEvent {
            label,
            event:
                WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. },
            ..
        } if label == MAIN_WINDOW_LABEL => cache_current_normal_frame(app_handle),
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed,
            ..
        } if label == MAIN_WINDOW_LABEL => save_main_window_frame(app_handle),
        RunEvent::Exit => save_main_window_frame(app_handle),
        _ => {}
    }
}

fn restores_window_frame_after_runtime_ready(event: &RunEvent) -> bool {
    matches!(event, RunEvent::Ready)
}

fn restore_main_window_state_from_handle(app_handle: &AppHandle) {
    let Some(window) = app_handle.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    restore_main_window_frame(app_handle, &window, "after runtime ready");
}

fn restore_main_window_frame(app_handle: &AppHandle, window: &WebviewWindow, phase: &str) {
    let Some(frame) = read_main_window_frame(window_scale_factor(window)) else {
        return;
    };
    let areas = current_screen_areas(window);
    let Some(restored_frame) = fit_frame_to_screens(frame, &areas) else {
        return;
    };

    if let Err(err) = apply_window_frame(window, restored_frame) {
        log::warn!("Failed to restore main window state {phase}: {err}");
        return;
    }

    cache_frame(app_handle, restored_frame);
}

fn cache_current_normal_frame(app_handle: &AppHandle) {
    if let Some(frame) = current_normal_main_window_frame(app_handle) {
        cache_frame(app_handle, frame);
    }
}

fn save_main_window_frame(app_handle: &AppHandle) {
    let frame = current_normal_main_window_frame(app_handle).or_else(|| cached_frame(app_handle));
    if let Some(frame) = frame {
        if let Err(err) = write_main_window_frame(frame) {
            log::warn!("Failed to save main window state: {err}");
        }
    }
}

fn current_normal_main_window_frame(app_handle: &AppHandle) -> Option<WindowFrame> {
    let window = app_handle.get_webview_window(MAIN_WINDOW_LABEL)?;
    if !is_normal_window(&window) {
        return None;
    }
    read_window_frame(&window).filter(is_valid_saved_frame)
}

fn is_normal_window(window: &WebviewWindow) -> bool {
    let is_fullscreen = window.is_fullscreen().unwrap_or(false);
    let is_maximized = window.is_maximized().unwrap_or(false);
    let is_minimized = window.is_minimized().unwrap_or(false);
    !is_fullscreen && !is_maximized && !is_minimized
}

fn read_window_frame(window: &WebviewWindow) -> Option<WindowFrame> {
    let scale_factor = window_scale_factor(window);
    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    Some(WindowFrame::from_logical_geometry(
        position.to_logical::<f64>(scale_factor),
        size.to_logical::<f64>(scale_factor),
    ))
}

fn apply_window_frame(window: &WebviewWindow, frame: WindowFrame) -> tauri::Result<()> {
    window.set_size(Size::Logical(LogicalSize::new(
        frame.width as f64,
        frame.height as f64,
    )))?;
    window.set_position(Position::Logical(LogicalPosition::new(
        frame.x as f64,
        frame.y as f64,
    )))
}

fn current_screen_areas(window: &WebviewWindow) -> Vec<ScreenArea> {
    let scale_factor = window_scale_factor(window);
    window
        .available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|monitor| {
            let area = monitor.work_area();
            let position = area.position.to_logical::<f64>(scale_factor);
            let size = area.size.to_logical::<f64>(scale_factor);
            ScreenArea {
                x: rounded_i32(position.x),
                y: rounded_i32(position.y),
                width: rounded_u32(size.width),
                height: rounded_u32(size.height),
            }
        })
        .filter(ScreenArea::has_area)
        .collect()
}

fn window_scale_factor(window: &WebviewWindow) -> f64 {
    window.scale_factor().unwrap_or(1.0).max(1.0)
}

fn fit_frame_to_screens(frame: WindowFrame, screens: &[ScreenArea]) -> Option<WindowFrame> {
    if frame_is_visible(frame, screens) {
        return Some(frame);
    }

    let screen = best_screen_for_frame(frame, screens)?;
    let width = clamp_dimension(frame.width, MIN_WINDOW_WIDTH, screen.width);
    let height = clamp_dimension(frame.height, MIN_WINDOW_HEIGHT, screen.height);
    Some(WindowFrame {
        x: clamp_axis(frame.x, width, screen.x, screen.width),
        y: clamp_axis(frame.y, height, screen.y, screen.height),
        width,
        height,
    })
}

fn frame_is_visible(frame: WindowFrame, screens: &[ScreenArea]) -> bool {
    frame_corners(frame)
        .into_iter()
        .all(|point| screens.iter().any(|screen| screen.contains(point)))
}

fn frame_corners(frame: WindowFrame) -> [(i32, i32); 4] {
    let right = frame.right() - 1;
    let bottom = frame.bottom() - 1;
    [
        (frame.x, frame.y),
        (right, frame.y),
        (frame.x, bottom),
        (right, bottom),
    ]
}

fn best_screen_for_frame(frame: WindowFrame, screens: &[ScreenArea]) -> Option<ScreenArea> {
    screens
        .iter()
        .copied()
        .filter(ScreenArea::has_area)
        .max_by_key(|screen| intersection_area(frame, *screen))
}

fn intersection_area(frame: WindowFrame, screen: ScreenArea) -> u64 {
    let left = frame.x.max(screen.x);
    let top = frame.y.max(screen.y);
    let right = frame.right().min(screen.right());
    let bottom = frame.bottom().min(screen.bottom());
    if right <= left || bottom <= top {
        return 0;
    }
    (right - left) as u64 * (bottom - top) as u64
}

fn clamp_dimension(value: u32, min: u32, max: u32) -> u32 {
    if max < min {
        max
    } else {
        value.clamp(min, max)
    }
}

fn clamp_axis(value: i32, size: u32, area_start: i32, area_size: u32) -> i32 {
    let max_start = area_start + area_size as i32 - size as i32;
    if max_start < area_start {
        return area_start;
    }
    value.clamp(area_start, max_start)
}

fn cache_frame(app_handle: &AppHandle, frame: WindowFrame) {
    let state: tauri::State<'_, MainWindowFrameState> = app_handle.state();
    if let Ok(mut cached_frame) = state.0.lock() {
        *cached_frame = Some(frame);
    };
}

fn cached_frame(app_handle: &AppHandle) -> Option<WindowFrame> {
    let state: tauri::State<'_, MainWindowFrameState> = app_handle.state();
    state.0.lock().ok().and_then(|cached_frame| *cached_frame)
}

fn window_state_path() -> Result<PathBuf, String> {
    crate::settings::preferred_app_config_path(WINDOW_STATE_FILE)
}

fn read_main_window_frame(scale_factor: f64) -> Option<WindowFrame> {
    read_main_window_frame_at(&window_state_path().ok()?, scale_factor)
}

fn read_main_window_frame_at(path: &Path, scale_factor: f64) -> Option<WindowFrame> {
    let content = fs::read_to_string(path).ok()?;
    let persisted: PersistedWindowState = serde_json::from_str(&content).ok()?;
    persisted
        .main
        .map(|frame| {
            persisted
                .coordinate_space
                .to_logical_frame(frame, scale_factor)
        })
        .filter(is_valid_saved_frame)
}

fn write_main_window_frame(frame: WindowFrame) -> Result<(), String> {
    write_main_window_frame_at(&window_state_path()?, frame)
}

fn write_main_window_frame_at(path: &Path, frame: WindowFrame) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create window state directory: {e}"))?;
    }

    let persisted = PersistedWindowState {
        main: Some(frame),
        coordinate_space: WindowFrameCoordinateSpace::Logical,
    };
    let json = serde_json::to_string_pretty(&persisted)
        .map_err(|e| format!("Failed to serialize window state: {e}"))?;
    fs::write(path, json).map_err(|e| format!("Failed to write window state: {e}"))
}

fn is_valid_saved_frame(frame: &WindowFrame) -> bool {
    frame.width >= MIN_WINDOW_WIDTH && frame.height >= MIN_WINDOW_HEIGHT
}

fn rounded_i32(value: f64) -> i32 {
    value.round() as i32
}

fn rounded_u32(value: f64) -> u32 {
    value.round().max(0.0) as u32
}

impl WindowFrame {
    fn from_logical_geometry(position: LogicalPosition<f64>, size: LogicalSize<f64>) -> Self {
        Self {
            x: rounded_i32(position.x),
            y: rounded_i32(position.y),
            width: rounded_u32(size.width),
            height: rounded_u32(size.height),
        }
    }

    fn to_logical(self, scale_factor: f64) -> Self {
        let scale_factor = scale_factor.max(1.0);
        Self {
            x: rounded_i32(self.x as f64 / scale_factor),
            y: rounded_i32(self.y as f64 / scale_factor),
            width: rounded_u32(self.width as f64 / scale_factor),
            height: rounded_u32(self.height as f64 / scale_factor),
        }
    }

    fn right(self) -> i32 {
        self.x + self.width as i32
    }

    fn bottom(self) -> i32 {
        self.y + self.height as i32
    }
}

impl WindowFrameCoordinateSpace {
    fn to_logical_frame(self, frame: WindowFrame, scale_factor: f64) -> WindowFrame {
        match self {
            Self::Logical => frame,
            Self::Physical => frame.to_logical(scale_factor),
        }
    }
}

impl ScreenArea {
    fn right(self) -> i32 {
        self.x + self.width as i32
    }

    fn bottom(self) -> i32 {
        self.y + self.height as i32
    }

    fn has_area(&self) -> bool {
        self.width > 0 && self.height > 0
    }

    fn contains(&self, point: (i32, i32)) -> bool {
        let (x, y) = point;
        x >= self.x && x < self.right() && y >= self.y && y < self.bottom()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(x: i32, y: i32, width: u32, height: u32) -> WindowFrame {
        WindowFrame {
            x,
            y,
            width,
            height,
        }
    }

    fn screen(x: i32, y: i32, width: u32, height: u32) -> ScreenArea {
        ScreenArea {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn records_logical_window_geometry_for_persistence() {
        let saved = WindowFrame::from_logical_geometry(
            LogicalPosition::new(80.0, 120.0),
            LogicalSize::new(1100.0, 700.0),
        );

        assert_eq!(saved, frame(80, 120, 1100, 700));
    }

    #[test]
    fn migrates_legacy_physical_frames_to_logical_points() {
        let saved = frame(160, 240, 2200, 1400);

        assert_eq!(
            WindowFrameCoordinateSpace::Physical.to_logical_frame(saved, 2.0),
            frame(80, 120, 1100, 700)
        );
    }

    #[test]
    fn keeps_explicit_logical_frames_unscaled() {
        let saved = frame(80, 120, 1100, 700);

        assert_eq!(
            WindowFrameCoordinateSpace::Logical.to_logical_frame(saved, 2.0),
            saved
        );
    }

    #[test]
    fn keeps_valid_frame_unchanged() {
        let saved = frame(120, 80, 1400, 900);
        let screens = [screen(0, 0, 1920, 1080)];

        assert_eq!(fit_frame_to_screens(saved, &screens), Some(saved));
    }

    #[test]
    fn clamps_oversized_frame_to_current_work_area() {
        let saved = frame(-100, -80, 2600, 1800);
        let screens = [screen(0, 0, 1440, 900)];

        assert_eq!(
            fit_frame_to_screens(saved, &screens),
            Some(frame(0, 0, 1440, 900))
        );
    }

    #[test]
    fn moves_offscreen_frame_back_to_a_visible_screen() {
        let saved = frame(3200, 1800, 900, 700);
        let screens = [screen(0, 0, 1440, 900)];

        assert_eq!(
            fit_frame_to_screens(saved, &screens),
            Some(frame(540, 200, 900, 700))
        );
    }

    #[test]
    fn picks_the_screen_with_the_largest_visible_overlap() {
        let saved = frame(1700, 100, 900, 700);
        let screens = [screen(0, 0, 1920, 1080), screen(1920, 0, 1440, 900)];

        assert_eq!(fit_frame_to_screens(saved, &screens), Some(saved));
    }

    #[test]
    fn ignores_empty_screen_areas_when_restoring() {
        let saved = frame(100, 100, 800, 600);
        let screens = [screen(0, 0, 0, 900), screen(0, 0, 1440, 900)];

        assert_eq!(fit_frame_to_screens(saved, &screens), Some(saved));
    }

    #[test]
    fn returns_none_when_no_usable_screens_exist() {
        let saved = frame(100, 100, 800, 600);

        assert_eq!(fit_frame_to_screens(saved, &[]), None);
        assert_eq!(fit_frame_to_screens(saved, &[screen(0, 0, 0, 0)]), None);
    }

    #[test]
    fn fits_to_tiny_work_area_when_it_is_smaller_than_minimum_size() {
        let saved = frame(100, 100, 800, 600);
        let screens = [screen(0, 0, 320, 240)];

        assert_eq!(
            fit_frame_to_screens(saved, &screens),
            Some(frame(0, 0, 320, 240))
        );
    }

    #[test]
    fn reports_visibility_across_adjacent_screens() {
        let screens = [screen(0, 0, 1920, 1080), screen(1920, 0, 1440, 900)];

        assert!(frame_is_visible(frame(1700, 100, 900, 700), &screens));
        assert!(!frame_is_visible(frame(1700, 850, 900, 300), &screens));
    }

    #[test]
    fn computes_frame_and_screen_edges_for_overlap_checks() {
        let saved = frame(10, 20, 800, 600);
        let area = screen(0, 0, 500, 400);

        assert_eq!(saved.right(), 810);
        assert_eq!(saved.bottom(), 620);
        assert_eq!(area.right(), 500);
        assert_eq!(area.bottom(), 400);
        assert_eq!(intersection_area(saved, area), 490 * 380);
        assert_eq!(intersection_area(saved, screen(900, 900, 200, 200)), 0);
    }

    #[test]
    fn rejects_corrupted_tiny_saved_frames() {
        assert!(!is_valid_saved_frame(&frame(100, 100, 1, 900)));
        assert!(!is_valid_saved_frame(&frame(100, 100, 1400, 1)));
    }

    #[test]
    fn restores_again_after_runtime_ready() {
        assert!(restores_window_frame_after_runtime_ready(&RunEvent::Ready));
        assert!(!restores_window_frame_after_runtime_ready(
            &RunEvent::Resumed
        ));
    }

    #[test]
    fn persists_and_reads_logical_frame_from_disk() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("nested/window-state.json");
        let saved = frame(80, 120, 1100, 700);

        write_main_window_frame_at(&path, saved).unwrap();

        let json = std::fs::read_to_string(&path).unwrap();
        assert!(json.contains("\"coordinate_space\": \"logical\""));
        assert_eq!(read_main_window_frame_at(&path, 2.0), Some(saved));
    }

    #[test]
    fn reads_legacy_physical_frame_from_disk_as_logical_points() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("window-state.json");
        std::fs::write(
            &path,
            r#"{
              "main": { "x": 160, "y": 240, "width": 2200, "height": 1400 },
              "coordinate_space": "physical"
            }"#,
        )
        .unwrap();

        assert_eq!(
            read_main_window_frame_at(&path, 2.0),
            Some(frame(80, 120, 1100, 700))
        );
    }

    #[test]
    fn ignores_missing_corrupt_or_tiny_window_state_files() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("window-state.json");

        assert_eq!(read_main_window_frame_at(&path, 1.0), None);

        std::fs::write(&path, "not json").unwrap();
        assert_eq!(read_main_window_frame_at(&path, 1.0), None);

        std::fs::write(&path, r#"{"main":{"x":0,"y":0,"width":100,"height":100}}"#).unwrap();
        assert_eq!(read_main_window_frame_at(&path, 1.0), None);
    }
}
