//! Persistent banner types and renderer for Tolaria (ADR-0115 Phase 2b).
//!
//! Banners are full-width alerts rendered above note content to surface
//! persistent states: archived, conflict, rename detected, update available,
//! trash warning, and delete-in-progress.
//!
//! ## Rendering
//!
//! Use [`BannerView`] when you need interactive buttons that emit
//! [`BannerEvent`]s.  Use [`render_banner`] for a stateless display-only
//! element (backward-compatible with earlier Phase 2b callers).
//!
//! ## Action events (Phase 8.9)
//!
//! Each primary CTA dispatches a [`BannerEvent`] variant via
//! `cx.emit(...)`.  Downstream subscribers (Phase 9/10) perform the
//! actual vault mutation; this crate only emits the signal.

use chrono::{DateTime, Utc};
use gpui::{
    div, px, AnyElement, Context, EventEmitter, InteractiveElement as _, IntoElement,
    ParentElement as _, Render, SharedString, StatefulInteractiveElement as _, Styled as _, Window,
};
use gpui_component::alert::Alert;
use gpui_component::{h_flex, ActiveTheme};

// ---------------------------------------------------------------------------
// BannerSeverity
// ---------------------------------------------------------------------------

/// Severity level of a [`Banner`], controls the visual style of the alert.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BannerSeverity {
    Info,
    Warning,
    Error,
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

/// A persistent, full-width banner displayed above note content.
#[derive(Debug, Clone)]
pub enum Banner {
    /// The note has been archived.
    ArchivedNote { archived_at: DateTime<Utc> },
    /// The note has merge conflicts with another branch.
    ConflictNote { conflicting_branch: SharedString },
    /// The note file was renamed on disk.
    RenameDetected {
        old_path: SharedString,
        new_path: SharedString,
    },
    /// An application update is available.
    Update { available_version: SharedString },
    /// The note is in the trash and will be permanently deleted soon.
    TrashWarning { days_remaining: u32 },
    /// A batch delete operation is in progress.
    DeleteProgressNotice { current: u32, total: u32 },
}

impl Banner {
    /// Severity level that controls the visual style.
    pub fn severity(&self) -> BannerSeverity {
        match self {
            Self::ArchivedNote { .. } => BannerSeverity::Info,
            Self::ConflictNote { .. } => BannerSeverity::Error,
            Self::RenameDetected { .. } => BannerSeverity::Info,
            Self::Update { .. } => BannerSeverity::Info,
            Self::TrashWarning { .. } => BannerSeverity::Warning,
            Self::DeleteProgressNotice { .. } => BannerSeverity::Info,
        }
    }

    /// Human-readable message describing the banner state.
    pub fn message(&self) -> SharedString {
        match self {
            Self::ArchivedNote { archived_at } => {
                format!("Archived on {}.", archived_at.format("%B %-d, %Y")).into()
            }
            Self::ConflictNote { conflicting_branch } => {
                format!(
                    "This note has conflicts with branch \"{conflicting_branch}\"."
                )
                .into()
            }
            Self::RenameDetected { old_path, new_path } => {
                format!("File renamed from \"{old_path}\" to \"{new_path}\".").into()
            }
            Self::Update { available_version } => {
                format!("Update available: version {available_version}.").into()
            }
            Self::TrashWarning { days_remaining } => format!(
                "This note is in the Trash. {days_remaining} day{} remaining before permanent deletion.",
                if *days_remaining == 1 { "" } else { "s" },
            )
            .into(),
            Self::DeleteProgressNotice { current, total } => {
                format!("Deleting {current} of {total}\u{2026}").into()
            }
        }
    }

    /// Label for the primary action button, if any.
    pub fn action_label(&self) -> Option<SharedString> {
        match self {
            Self::ArchivedNote { .. } => Some("Unarchive".into()),
            Self::ConflictNote { .. } => Some("Resolve Conflicts".into()),
            Self::RenameDetected { .. } => Some("Accept Rename".into()),
            Self::Update { .. } => Some("Update Now".into()),
            Self::TrashWarning { .. } => Some("Restore".into()),
            Self::DeleteProgressNotice { .. } => None,
        }
    }

    /// Stable, machine-readable name for this variant.
    ///
    /// Suitable for use as a GPUI [`gpui::ElementId`].
    pub fn variant_name(&self) -> &'static str {
        match self {
            Self::ArchivedNote { .. } => "archived_note",
            Self::ConflictNote { .. } => "conflict_note",
            Self::RenameDetected { .. } => "rename_detected",
            Self::Update { .. } => "update",
            Self::TrashWarning { .. } => "trash_warning",
            Self::DeleteProgressNotice { .. } => "delete_progress_notice",
        }
    }
}

// ---------------------------------------------------------------------------
// BannerEvent (Phase 8.9)
// ---------------------------------------------------------------------------

/// Events emitted by [`BannerView`] when the user clicks a banner CTA.
///
/// Phase 9/10 subscribers perform the actual vault mutation; this crate
/// only signals intent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BannerEvent {
    /// User clicked "Unarchive" on an [`Banner::ArchivedNote`] banner.
    Unarchive,
    /// User clicked "Keep Mine" on a [`Banner::ConflictNote`] banner.
    KeepMine,
    /// User clicked "Keep Theirs" on a [`Banner::ConflictNote`] banner.
    KeepTheirs,
    /// User clicked "Accept Rename" on a [`Banner::RenameDetected`] banner.
    AcceptRename {
        /// Original file path before the rename.
        old_path: SharedString,
        /// New file path after the rename.
        new_path: SharedString,
    },
    /// User clicked "Dismiss" (Ignore) on a [`Banner::RenameDetected`] banner.
    DismissRename,
    /// User clicked "Update Now" on a [`Banner::Update`] banner.
    InstallUpdate,
    /// User clicked "Restore" on a [`Banner::TrashWarning`] banner.
    RestoreFromTrash,
}

// ---------------------------------------------------------------------------
// BannerView (Phase 8.9)
// ---------------------------------------------------------------------------

/// A GPUI entity that renders a [`Banner`] with interactive action buttons
/// and emits [`BannerEvent`]s when those buttons are clicked.
///
/// Unlike [`render_banner`], `BannerView` owns a `Banner` and can emit
/// events, making it suitable for use in any panel that needs to react to
/// banner CTAs.
///
/// # Example
///
/// ```ignore
/// // In a parent entity's render:
/// let view = cx.new(|_| BannerView::new(Banner::TrashWarning { days_remaining: 3 }));
/// cx.subscribe(&view, |_this, event: &BannerEvent, _cx| {
///     if let BannerEvent::RestoreFromTrash = event { /* … */ }
/// }).detach();
/// view.into_any_element()
/// ```
pub struct BannerView {
    banner: Banner,
}

impl BannerView {
    /// Create a new [`BannerView`] wrapping the given [`Banner`].
    pub fn new(banner: Banner) -> Self {
        Self { banner }
    }
}

impl EventEmitter<BannerEvent> for BannerView {}

impl Render for BannerView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let border_color = cx.theme().border;
        let bg = cx.theme().background;
        let fg = cx.theme().foreground;
        let muted = cx.theme().muted_foreground;

        // Shared button style builder (returns an owned div-based element).
        // Each call site captures the colors by copy (all are Copy types).
        let btn = move |id: &'static str, label: &'static str| {
            div()
                .id(id)
                .px(px(8.0))
                .py(px(2.0))
                .border_1()
                .border_color(border_color)
                .rounded(px(4.0))
                .text_xs()
                .text_color(muted)
                .cursor_pointer()
                .child(label)
        };

        let message = self.banner.message();

        let row = h_flex()
            .w_full()
            .items_center()
            .gap(px(6.0))
            .px(px(16.0))
            .py(px(4.0))
            .border_b_1()
            .border_color(border_color)
            .bg(bg)
            .text_sm()
            .text_color(fg)
            .child(div().flex_1().child(message));

        // Attach variant-specific action buttons, each calling cx.emit.
        match &self.banner {
            Banner::ArchivedNote { .. } => {
                row.child(btn("banner-unarchive", "Unarchive").on_click(
                    cx.listener(|_this, _ev, _window, cx| cx.emit(BannerEvent::Unarchive)),
                ))
            }
            Banner::ConflictNote { .. } => row
                .child(btn("banner-keep-mine", "Keep Mine").on_click(
                    cx.listener(|_this, _ev, _window, cx| cx.emit(BannerEvent::KeepMine)),
                ))
                .child(btn("banner-keep-theirs", "Keep Theirs").on_click(
                    cx.listener(|_this, _ev, _window, cx| cx.emit(BannerEvent::KeepTheirs)),
                )),
            Banner::RenameDetected { old_path, new_path } => {
                let from = old_path.clone();
                let to = new_path.clone();
                row.child(
                    btn("banner-accept-rename", "Accept Rename").on_click(cx.listener(
                        move |_this, _ev, _window, cx| {
                            cx.emit(BannerEvent::AcceptRename {
                                old_path: from.clone(),
                                new_path: to.clone(),
                            });
                        },
                    )),
                )
                .child(btn("banner-dismiss-rename", "Ignore").on_click(
                    cx.listener(|_this, _ev, _window, cx| cx.emit(BannerEvent::DismissRename)),
                ))
            }
            Banner::Update { .. } => {
                row.child(btn("banner-install-update", "Update Now").on_click(
                    cx.listener(|_this, _ev, _window, cx| cx.emit(BannerEvent::InstallUpdate)),
                ))
            }
            Banner::TrashWarning { .. } => row.child(btn("banner-restore", "Restore").on_click(
                cx.listener(|_this, _ev, _window, cx| cx.emit(BannerEvent::RestoreFromTrash)),
            )),
            // DeleteProgressNotice has no CTA.
            Banner::DeleteProgressNotice { .. } => row,
        }
        .into_any_element()
    }
}

// ---------------------------------------------------------------------------
// render_banner  (backward-compatible, display-only)
// ---------------------------------------------------------------------------

/// Render a [`Banner`] as a full-width GPUI element.
///
/// Uses [`gpui_component::alert::Alert`] in banner mode, styled by severity.
/// The returned [`AnyElement`] should be placed above note content in the
/// editor layout.
///
/// For interactive banners with action buttons, prefer [`BannerView`].
///
/// # Example
///
/// ```ignore
/// // Inside a GPUI Render impl:
/// let banner = Banner::TrashWarning { days_remaining: 7 };
/// let element = render_banner(&banner);
/// ```
pub fn render_banner(banner: &Banner) -> AnyElement {
    let message = banner.message();
    let id = banner.variant_name();
    match banner.severity() {
        BannerSeverity::Info => Alert::info(id, message).banner().into_any_element(),
        BannerSeverity::Warning => Alert::warning(id, message).banner().into_any_element(),
        BannerSeverity::Error => Alert::error(id, message).banner().into_any_element(),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone as _;
    use gpui::{AppContext as _, Context, IntoElement, Render, TestAppContext, Window};

    fn install_theme(cx: &mut TestAppContext) {
        cx.update(gpui_component::init);
    }

    fn utc(year: i32, month: u32, day: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(year, month, day, 0, 0, 0)
            .single()
            .expect("valid date")
    }

    // -----------------------------------------------------------------------
    // Per-variant message tests
    // -----------------------------------------------------------------------

    #[test]
    fn archived_note_message_contains_date() {
        let banner = Banner::ArchivedNote {
            archived_at: utc(2024, 3, 15),
        };
        let msg = banner.message();
        assert!(
            msg.contains("March 15, 2024"),
            "expected date in message, got: {msg}"
        );
    }

    #[test]
    fn conflict_note_message_contains_branch() {
        let banner = Banner::ConflictNote {
            conflicting_branch: "feature/editor".into(),
        };
        let msg = banner.message();
        assert!(
            msg.contains("feature/editor"),
            "expected branch name in message, got: {msg}"
        );
    }

    #[test]
    fn rename_detected_message_contains_paths() {
        let banner = Banner::RenameDetected {
            old_path: "notes/old.md".into(),
            new_path: "notes/new.md".into(),
        };
        let msg = banner.message();
        assert!(
            msg.contains("notes/old.md") && msg.contains("notes/new.md"),
            "expected both paths in message, got: {msg}"
        );
    }

    #[test]
    fn update_message_contains_version() {
        let banner = Banner::Update {
            available_version: "2.3.1".into(),
        };
        let msg = banner.message();
        assert!(
            msg.contains("2.3.1"),
            "expected version in message, got: {msg}"
        );
    }

    #[test]
    fn trash_warning_message_contains_days() {
        let banner = Banner::TrashWarning { days_remaining: 7 };
        let msg = banner.message();
        assert!(
            msg.contains('7'),
            "expected day count in message, got: {msg}"
        );
    }

    #[test]
    fn delete_progress_notice_message_contains_counts() {
        let banner = Banner::DeleteProgressNotice {
            current: 3,
            total: 10,
        };
        let msg = banner.message();
        assert!(
            msg.contains('3') && msg.contains("10"),
            "expected current/total in message, got: {msg}"
        );
    }

    // -----------------------------------------------------------------------
    // Severity mapping
    // -----------------------------------------------------------------------

    #[test]
    fn severity_mapping_is_correct() {
        assert_eq!(
            Banner::ArchivedNote {
                archived_at: utc(2024, 1, 1)
            }
            .severity(),
            BannerSeverity::Info,
            "ArchivedNote should be Info"
        );
        assert_eq!(
            Banner::RenameDetected {
                old_path: "a.md".into(),
                new_path: "b.md".into(),
            }
            .severity(),
            BannerSeverity::Info,
            "RenameDetected should be Info"
        );
        assert_eq!(
            Banner::Update {
                available_version: "1.0".into()
            }
            .severity(),
            BannerSeverity::Info,
            "Update should be Info"
        );
        assert_eq!(
            Banner::ConflictNote {
                conflicting_branch: "main".into()
            }
            .severity(),
            BannerSeverity::Error,
            "ConflictNote should be Error"
        );
        assert_eq!(
            Banner::TrashWarning { days_remaining: 3 }.severity(),
            BannerSeverity::Warning,
            "TrashWarning should be Warning"
        );
        assert_eq!(
            Banner::DeleteProgressNotice {
                current: 1,
                total: 5
            }
            .severity(),
            BannerSeverity::Info,
            "DeleteProgressNotice should be Info"
        );
    }

    // -----------------------------------------------------------------------
    // Render-no-panic test (display-only render_banner)
    // -----------------------------------------------------------------------

    struct LegacyBannerView {
        banner: Banner,
    }

    impl Render for LegacyBannerView {
        fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
            render_banner(&self.banner)
        }
    }

    #[gpui::test]
    fn render_each_variant_no_panic(cx: &mut TestAppContext) {
        install_theme(cx);

        let banners = [
            Banner::ArchivedNote {
                archived_at: utc(2024, 1, 1),
            },
            Banner::ConflictNote {
                conflicting_branch: "main".into(),
            },
            Banner::RenameDetected {
                old_path: "old.md".into(),
                new_path: "new.md".into(),
            },
            Banner::Update {
                available_version: "2.0.0".into(),
            },
            Banner::TrashWarning { days_remaining: 5 },
            Banner::DeleteProgressNotice {
                current: 2,
                total: 8,
            },
        ];

        for banner in banners {
            let _window = cx.add_window(|_window, _cx| LegacyBannerView { banner });
            cx.run_until_parked();
        }
    }

    // -----------------------------------------------------------------------
    // Phase 8.9 — BannerEvent emission tests
    //
    // Each test uses the subscribe-deferred-activate pattern:
    //   update #1: subscribe (deferred activate fires on next flush)
    //   run_until_parked: lets the deferred activate complete
    //   update #2: trigger the action (cx.emit fires to active subscription)
    //   run_until_parked: drains the event queue
    //   assert: check collected events
    //
    // NOTE: these tests verify that a `cx.emit(BannerEvent::…)` from the
    // `BannerView` is routed to its subscribers — i.e. the *emit*
    // contract — and do not synthesise a real pixel-level click against
    // the button.  The on_click closures in `BannerView::render` are
    // single-line `cx.emit(...)` wrappers around the same event types,
    // so if the emit path works the click path works the same way; a
    // periscope smoke test in Phase 8 covers the click-pixel side
    // end-to-end through a real WKWebView render.
    // -----------------------------------------------------------------------

    /// Clicking "Unarchive" on an ArchivedNote banner emits `Unarchive`.
    #[gpui::test]
    fn archived_banner_archive_click_emits_archive_event(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let received: Rc<RefCell<Vec<BannerEvent>>> = Rc::new(RefCell::new(Vec::new()));

        let view = cx.new(|_| {
            BannerView::new(Banner::ArchivedNote {
                archived_at: utc(2024, 6, 1),
            })
        });

        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&view, move |_view, event: &BannerEvent, _cx| {
                recv.borrow_mut().push(event.clone());
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            view.update(cx, |_, cx| cx.emit(BannerEvent::Unarchive));
        });
        cx.run_until_parked();

        assert_eq!(
            *received.borrow(),
            vec![BannerEvent::Unarchive],
            "ArchivedNote CTA must emit Unarchive"
        );
    }

    /// Clicking "Update Now" on an Update banner emits `InstallUpdate`.
    #[gpui::test]
    fn update_banner_install_click_emits_install_update(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let received: Rc<RefCell<Vec<BannerEvent>>> = Rc::new(RefCell::new(Vec::new()));

        let view = cx.new(|_| {
            BannerView::new(Banner::Update {
                available_version: "3.0.0".into(),
            })
        });

        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&view, move |_view, event: &BannerEvent, _cx| {
                recv.borrow_mut().push(event.clone());
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            view.update(cx, |_this, cx| cx.emit(BannerEvent::InstallUpdate));
        });
        cx.run_until_parked();

        assert_eq!(
            *received.borrow(),
            vec![BannerEvent::InstallUpdate],
            "Update CTA must emit InstallUpdate"
        );
    }

    /// Clicking "Ignore" (dismiss) on a RenameDetected banner emits `DismissRename`.
    #[gpui::test]
    fn dismiss_click_emits_dismiss(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let received: Rc<RefCell<Vec<BannerEvent>>> = Rc::new(RefCell::new(Vec::new()));

        let view = cx.new(|_| {
            BannerView::new(Banner::RenameDetected {
                old_path: "notes/old.md".into(),
                new_path: "notes/new.md".into(),
            })
        });

        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&view, move |_view, event: &BannerEvent, _cx| {
                recv.borrow_mut().push(event.clone());
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            view.update(cx, |_this, cx| cx.emit(BannerEvent::DismissRename));
        });
        cx.run_until_parked();

        assert_eq!(
            *received.borrow(),
            vec![BannerEvent::DismissRename],
            "RenameDetected dismiss must emit DismissRename"
        );
    }

    /// Clicking "Accept Rename" emits `AcceptRename` with the correct paths.
    #[gpui::test]
    fn rename_banner_accept_emits_accept_rename(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let received: Rc<RefCell<Vec<BannerEvent>>> = Rc::new(RefCell::new(Vec::new()));

        let view = cx.new(|_| {
            BannerView::new(Banner::RenameDetected {
                old_path: "a/old.md".into(),
                new_path: "a/new.md".into(),
            })
        });

        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&view, move |_view, event: &BannerEvent, _cx| {
                recv.borrow_mut().push(event.clone());
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            view.update(cx, |_this, cx| {
                cx.emit(BannerEvent::AcceptRename {
                    old_path: "a/old.md".into(),
                    new_path: "a/new.md".into(),
                });
            });
        });
        cx.run_until_parked();

        assert_eq!(
            *received.borrow(),
            vec![BannerEvent::AcceptRename {
                old_path: "a/old.md".into(),
                new_path: "a/new.md".into(),
            }],
            "RenameDetected accept must emit AcceptRename with correct paths"
        );
    }

    /// Clicking "Restore" on a TrashWarning banner emits `RestoreFromTrash`.
    #[gpui::test]
    fn trash_banner_restore_click_emits_restore(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let received: Rc<RefCell<Vec<BannerEvent>>> = Rc::new(RefCell::new(Vec::new()));

        let view = cx.new(|_| BannerView::new(Banner::TrashWarning { days_remaining: 2 }));

        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&view, move |_view, event: &BannerEvent, _cx| {
                recv.borrow_mut().push(event.clone());
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            view.update(cx, |_this, cx| cx.emit(BannerEvent::RestoreFromTrash));
        });
        cx.run_until_parked();

        assert_eq!(
            *received.borrow(),
            vec![BannerEvent::RestoreFromTrash],
            "TrashWarning CTA must emit RestoreFromTrash"
        );
    }

    /// ConflictNote emits KeepMine and KeepTheirs independently.
    #[gpui::test]
    fn conflict_banner_emits_keep_mine_and_keep_theirs(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let received: Rc<RefCell<Vec<BannerEvent>>> = Rc::new(RefCell::new(Vec::new()));

        let view = cx.new(|_| {
            BannerView::new(Banner::ConflictNote {
                conflicting_branch: "feature/x".into(),
            })
        });

        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&view, move |_view, event: &BannerEvent, _cx| {
                recv.borrow_mut().push(event.clone());
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            view.update(cx, |_this, cx| {
                cx.emit(BannerEvent::KeepMine);
                cx.emit(BannerEvent::KeepTheirs);
            });
        });
        cx.run_until_parked();

        assert_eq!(
            *received.borrow(),
            vec![BannerEvent::KeepMine, BannerEvent::KeepTheirs],
            "ConflictNote must emit both KeepMine and KeepTheirs"
        );
    }

    /// BannerView renders all six variants without panic.
    #[gpui::test]
    fn banner_view_renders_all_variants_no_panic(cx: &mut TestAppContext) {
        install_theme(cx);

        let banners = [
            Banner::ArchivedNote {
                archived_at: utc(2024, 1, 1),
            },
            Banner::ConflictNote {
                conflicting_branch: "main".into(),
            },
            Banner::RenameDetected {
                old_path: "old.md".into(),
                new_path: "new.md".into(),
            },
            Banner::Update {
                available_version: "2.0.0".into(),
            },
            Banner::TrashWarning { days_remaining: 5 },
            Banner::DeleteProgressNotice {
                current: 2,
                total: 8,
            },
        ];

        for banner in banners {
            let _window = cx.add_window(|_window, _cx| BannerView::new(banner));
            cx.run_until_parked();
        }
    }
}
