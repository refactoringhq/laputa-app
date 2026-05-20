#![forbid(unsafe_code)]
//! Note properties / type / icon editor panel (ADR-0115 Phase 8.15, Strand B).
//!
//! Mirrors the Tauri-era properties surface assembled from:
//!
//! - `DynamicPropertiesPanel.tsx` — list of key/value rows with add/remove
//! - `AddPropertyForm.tsx` — add-property row at the bottom
//! - `EditableValue.tsx` — generic editable cell
//! - `PropertyValueCells.tsx` — typed value cells
//!   (text, number, date, list, wikilink, bool, color)
//! - `TypeSelector.tsx` — note "type" combobox
//! - `TypeCustomizePopover.tsx` — customize a type's accent / icon
//! - `IconEditableValue.tsx` — single-row icon edit
//! - `ColorInput.tsx` — hex color input
//! - `AccentColorPicker.tsx` — accent swatch grid
//! - `NoteIcon.tsx` / `NoteTitleIcon.tsx` — render-only icon helpers
//!
//! Phase 8 ships the **scaffold only**: the public view + typed
//! event surface + `from_or_empty` precedence + a placeholder
//! row-per-property render.  Real value editing (mutable text input
//! wired to each typed value cell) lands once frontmatter parsing
//! is exposed by `vault` in Phase 8.11; until then `from_vault` and
//! `from_mock` both return an empty placeholder so the constructor
//! surface is locked in and the workspace can mount the panel.
//!
//! # Usage
//!
//! ```rust,ignore
//! let panel = cx.new(|_window, cx| FrontmatterPanel::from_or_empty(cx));
//! cx.subscribe(&panel, |_, e: &PropertyAdded, _cx| {
//!     log::info!("property added: {}", e.key);
//! }).detach();
//! ```

use gpui::{
    div, px, App, Context, EventEmitter, InteractiveElement as _, IntoElement, ParentElement,
    Render, SharedString, Styled, Window,
};
use gpui_component::{v_flex, ActiveTheme};
use mock_fixtures::MockVault;
use vault::Vault;

// ---------------------------------------------------------------------------
// PropertyValue
// ---------------------------------------------------------------------------

/// Typed value cell.  Carries the React-side type discriminant so the
/// future-real `EditableValue` renderer can dispatch to the right input
/// (text field, number field, date picker, list editor, wikilink
/// autocomplete, boolean toggle, color picker).
#[derive(Debug, Clone, PartialEq)]
pub enum PropertyValue {
    /// Plain text — rendered by `EditableValue` as a single-line input.
    Text(SharedString),
    /// Numeric — `EditableValue` shows a number input.
    Number(f64),
    /// Boolean — `EditableValue` shows a toggle.
    Bool(bool),
    /// ISO 8601 date placeholder; refined in Phase 8.11 once the
    /// `vault` frontmatter parser surfaces real `chrono` values.
    Date(SharedString),
    /// Ordered list of strings — `EditableValue` shows a chips editor.
    List(Vec<SharedString>),
    /// Wikilink target — `EditableValue` shows the wikilink
    /// autocomplete component.
    Wikilink(SharedString),
    /// Hex color (`"#RRGGBB"`) — `EditableValue` shows the color
    /// swatch picker.
    Color(SharedString),
}

impl PropertyValue {
    /// Short, human-readable summary used by the scaffold render and
    /// by `property_value_summary_round_trips_across_variants`.  Match
    /// arms are exhaustive so a new variant immediately surfaces in
    /// both render and tests without a silent fallback.
    #[must_use]
    pub fn value_summary(&self) -> SharedString {
        match self {
            Self::Text(s) | Self::Date(s) | Self::Wikilink(s) | Self::Color(s) => s.clone(),
            Self::Number(n) => SharedString::from(n.to_string()),
            Self::Bool(b) => SharedString::new_static(if *b { "true" } else { "false" }),
            Self::List(items) => {
                let joined = items
                    .iter()
                    .map(SharedString::as_ref)
                    .collect::<Vec<_>>()
                    .join(", ");
                SharedString::from(format!("[{joined}]"))
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

/// One frontmatter key/value pair as it appears in the editor.
#[derive(Debug, Clone, PartialEq)]
pub struct Property {
    /// Frontmatter key (e.g. `"type"`, `"status"`, `"tags"`).
    pub key: SharedString,
    /// Typed value cell.
    pub value: PropertyValue,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// Emitted when [`FrontmatterPanel::add_property`] appends a new row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PropertyAdded {
    /// Key of the newly-added row.
    pub key: SharedString,
}

/// Emitted when [`FrontmatterPanel::remove_property`] drops an existing
/// row.  Not emitted when the key is missing — that's a silent no-op
/// so callers can dispatch optimistically.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PropertyRemoved {
    /// Key of the removed row.
    pub key: SharedString,
}

/// Emitted when [`FrontmatterPanel::set_note_type`] changes the value.
/// Same-value writes are silent no-ops so observers don't churn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteTypeChanged {
    /// New note type, or `None` when cleared.
    pub note_type: Option<SharedString>,
}

/// Emitted when [`FrontmatterPanel::set_icon`] changes the value.
/// Same-value writes are silent no-ops.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IconChanged {
    /// New icon identifier (emoji or icon-name), or `None` when cleared.
    pub icon: Option<SharedString>,
}

/// Emitted when [`FrontmatterPanel::set_accent_color`] changes the
/// value.  Same-value writes are silent no-ops.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccentColorChanged {
    /// New accent color hex (`"#RRGGBB"`), or `None` when cleared.
    pub color: Option<SharedString>,
}

// ---------------------------------------------------------------------------
// FrontmatterPanel
// ---------------------------------------------------------------------------

/// Phase 8.15 frontmatter editor view.
///
/// Construct via [`FrontmatterPanel::from_or_empty`] to inherit the
/// Phase-5 `Vault > MockVault > empty` precedence;
/// [`FrontmatterPanel::from_vault`] / [`FrontmatterPanel::from_mock`]
/// build from a specific global for tests / mock-mode launches.
pub struct FrontmatterPanel {
    properties: Vec<Property>,
    note_type: Option<SharedString>,
    icon: Option<SharedString>,
    accent_color: Option<SharedString>,
}

impl EventEmitter<PropertyAdded> for FrontmatterPanel {}
impl EventEmitter<PropertyRemoved> for FrontmatterPanel {}
impl EventEmitter<NoteTypeChanged> for FrontmatterPanel {}
impl EventEmitter<IconChanged> for FrontmatterPanel {}
impl EventEmitter<AccentColorChanged> for FrontmatterPanel {}

impl FrontmatterPanel {
    /// Construct from an explicit property list — used by tests and by
    /// the future-real Phase 8.11 wiring once `vault` exposes parsed
    /// frontmatter.  `note_type` / `icon` / `accent_color` start as
    /// `None` so the corresponding rows render the muted placeholder.
    #[must_use]
    pub fn new(properties: Vec<Property>) -> Self {
        Self {
            properties,
            note_type: None,
            icon: None,
            accent_color: None,
        }
    }

    /// An empty panel — no properties, no type/icon/accent.
    #[must_use]
    pub fn empty() -> Self {
        Self::new(Vec::new())
    }

    /// Build from the registered globals.  Phase-5 precedence:
    /// `vault::Vault > MockVault > empty`.
    pub fn from_or_empty(cx: &mut App) -> Self {
        if cx.try_global::<Vault>().is_some() {
            Self::from_vault(cx)
        } else if cx.try_global::<MockVault>().is_some() {
            Self::from_mock(cx)
        } else {
            Self::empty()
        }
    }

    /// Build from the real `vault::Vault` global.
    ///
    /// Currently returns an empty placeholder: `vault::Vault` doesn't
    /// yet expose parsed frontmatter — that lands in Phase 8.11.  The
    /// constructor exists so `from_or_empty` has a branch shape that
    /// matches every other chrome crate, and so future-Phase 8.11
    /// wiring lands with the call-site already in place.
    ///
    /// # Panics
    ///
    /// Panics if no `Vault` global is installed.  Use
    /// [`FrontmatterPanel::from_or_empty`] instead when uncertain.
    pub fn from_vault(cx: &mut App) -> Self {
        // TODO(phase-8.11): swap this for a real frontmatter parse once
        // `vault` exposes the parsed key/value tree per note.  Today we
        // just panic-check the global so the precedence branch is live.
        let _ = cx.global::<Vault>();
        Self::empty()
    }

    /// Build from the [`MockVault`] global.  Currently returns an
    /// empty placeholder for the same reason as
    /// [`FrontmatterPanel::from_vault`]: the mock launch path doesn't
    /// yet seed parsed frontmatter.  The constructor exists so
    /// `from_or_empty` has a live mock branch.
    ///
    /// # Panics
    ///
    /// Panics if no `MockVault` global is installed.
    pub fn from_mock(cx: &mut App) -> Self {
        let _ = cx.global::<MockVault>();
        Self::empty()
    }

    /// The current property list.
    #[must_use]
    pub fn properties(&self) -> &[Property] {
        &self.properties
    }

    /// The current note type, if any.
    #[must_use]
    pub fn note_type(&self) -> Option<&SharedString> {
        self.note_type.as_ref()
    }

    /// The current icon, if any.
    #[must_use]
    pub fn icon(&self) -> Option<&SharedString> {
        self.icon.as_ref()
    }

    /// The current accent color hex, if any.
    #[must_use]
    pub fn accent_color(&self) -> Option<&SharedString> {
        self.accent_color.as_ref()
    }

    /// Append a property and emit [`PropertyAdded`].  Duplicate keys
    /// are intentionally kept — de-duplication is a consumer concern
    /// (the same React surface allows shadowed keys while editing).
    pub fn add_property(&mut self, prop: Property, cx: &mut Context<Self>) {
        let key = prop.key.clone();
        self.properties.push(prop);
        cx.emit(PropertyAdded { key });
        cx.notify();
    }

    /// Remove the first property whose key equals `key`.  Silent no-op
    /// when no row matches so optimistic callers don't churn observers.
    pub fn remove_property(&mut self, key: &str, cx: &mut Context<Self>) {
        let Some(ix) = self.properties.iter().position(|p| p.key.as_ref() == key) else {
            return;
        };
        let removed = self.properties.remove(ix);
        cx.emit(PropertyRemoved { key: removed.key });
        cx.notify();
    }

    /// Set the note type.  Emits [`NoteTypeChanged`] only when the
    /// value differs so same-value writes are silent.
    pub fn set_note_type(&mut self, t: Option<SharedString>, cx: &mut Context<Self>) {
        if self.note_type == t {
            return;
        }
        self.note_type = t.clone();
        cx.emit(NoteTypeChanged { note_type: t });
        cx.notify();
    }

    /// Set the icon.  Emits [`IconChanged`] only when the value
    /// differs.
    pub fn set_icon(&mut self, icon: Option<SharedString>, cx: &mut Context<Self>) {
        if self.icon == icon {
            return;
        }
        self.icon = icon.clone();
        cx.emit(IconChanged { icon });
        cx.notify();
    }

    /// Set the accent color.  Emits [`AccentColorChanged`] only when
    /// the value differs.
    pub fn set_accent_color(&mut self, color: Option<SharedString>, cx: &mut Context<Self>) {
        if self.accent_color == color {
            return;
        }
        self.accent_color = color.clone();
        cx.emit(AccentColorChanged { color });
        cx.notify();
    }
}

impl Default for FrontmatterPanel {
    fn default() -> Self {
        Self::empty()
    }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/// Render the placeholder text for an `Option<SharedString>` row.
fn option_display(value: Option<&SharedString>) -> SharedString {
    value
        .cloned()
        .unwrap_or_else(|| SharedString::new_static("—"))
}

impl Render for FrontmatterPanel {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let fg = theme.foreground;
        let muted = theme.muted_foreground;
        let divider = theme.border;

        let type_text =
            SharedString::from(format!("Type: {}", option_display(self.note_type.as_ref())));
        let icon_text = SharedString::from(format!("Icon: {}", option_display(self.icon.as_ref())));
        let accent_text = SharedString::from(format!(
            "Accent: {}",
            option_display(self.accent_color.as_ref())
        ));

        v_flex()
            .id("frontmatter-panel")
            .p(px(12.0))
            .gap(px(4.0))
            .text_sm()
            .text_color(fg)
            .child(
                div()
                    .id("frontmatter-type-row")
                    .py(px(2.0))
                    .child(type_text),
            )
            .child(
                div()
                    .id("frontmatter-icon-row")
                    .py(px(2.0))
                    .child(icon_text),
            )
            .child(
                div()
                    .id("frontmatter-accent-row")
                    .py(px(2.0))
                    .child(accent_text),
            )
            .child(div().my(px(6.0)).h(px(1.0)).bg(divider))
            .children(self.properties.iter().map(|prop| {
                let row_id = SharedString::from(format!("frontmatter-property-{}", prop.key));
                let row_text =
                    SharedString::from(format!("{}: {}", prop.key, prop.value.value_summary()));
                div().id(row_id).py(px(2.0)).child(row_text)
            }))
            .child(
                div()
                    .id("frontmatter-add-row")
                    .py(px(4.0))
                    .mt(px(6.0))
                    .text_color(muted)
                    .cursor_pointer()
                    .child(SharedString::new_static("+ Add property")),
            )
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::AppContext as _;
    use gpui::Entity;
    use gpui::TestAppContext;

    fn install_theme(cx: &mut TestAppContext) {
        cx.update(gpui_component::init);
    }

    fn sample_properties() -> Vec<Property> {
        vec![
            Property {
                key: SharedString::new_static("status"),
                value: PropertyValue::Text(SharedString::new_static("draft")),
            },
            Property {
                key: SharedString::new_static("tags"),
                value: PropertyValue::List(vec![
                    SharedString::new_static("rust"),
                    SharedString::new_static("ui"),
                ]),
            },
        ]
    }

    /// Construct with two properties and mount in a window — render
    /// must not panic.
    #[gpui::test]
    fn panel_renders_without_panic(cx: &mut TestAppContext) {
        install_theme(cx);
        let _window = cx.add_window(|_window, _cx| FrontmatterPanel::new(sample_properties()));
        cx.run_until_parked();
    }

    /// `from_or_empty` returns an empty panel when no `Vault` and no
    /// `MockVault` global is installed.
    #[gpui::test]
    fn from_or_empty_falls_through_to_empty_when_no_globals(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            let panel = FrontmatterPanel::from_or_empty(cx);
            assert!(panel.properties().is_empty());
            assert!(panel.note_type().is_none());
            assert!(panel.icon().is_none());
            assert!(panel.accent_color().is_none());
        });
    }

    /// `from_or_empty` takes the `from_mock` branch when only a
    /// `MockVault` global is installed.  Currently `from_mock` returns
    /// an empty placeholder (real population lands in Phase 8.11), but
    /// the branch must still be live so future fixture-seeding lands
    /// with test coverage already in place.
    #[gpui::test]
    fn from_or_empty_takes_mock_branch_when_mock_present(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            cx.set_global(MockVault::seeded());
            let panel = FrontmatterPanel::from_or_empty(cx);
            assert!(
                panel.properties().is_empty(),
                "from_mock returns empty until Phase 8.11 seeds parsed frontmatter"
            );
        });
    }

    /// `add_property` appends and emits [`PropertyAdded`] carrying the
    /// new row's key.
    #[gpui::test]
    fn add_property_emits_and_appends(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let panel: Entity<FrontmatterPanel> = cx.update(|cx| cx.new(|_| FrontmatterPanel::empty()));

        let received: Rc<RefCell<Vec<PropertyAdded>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&panel, move |_, event: &PropertyAdded, _| {
                recv.borrow_mut().push(event.clone());
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            panel.update(cx, |p, cx| {
                p.add_property(
                    Property {
                        key: SharedString::new_static("status"),
                        value: PropertyValue::Text(SharedString::new_static("draft")),
                    },
                    cx,
                );
            });
        });
        cx.run_until_parked();

        let got = received.borrow();
        assert_eq!(got.len(), 1, "exactly one PropertyAdded must fire");
        assert_eq!(got[0].key.as_ref(), "status");
        cx.update(|cx| {
            let panel = panel.read(cx);
            assert_eq!(panel.properties().len(), 1);
            assert_eq!(panel.properties()[0].key.as_ref(), "status");
        });
    }

    /// `remove_property` with an existing key drops the row and emits
    /// [`PropertyRemoved`] carrying that key.
    #[gpui::test]
    fn remove_property_existing_key_emits_and_drops(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let panel: Entity<FrontmatterPanel> =
            cx.update(|cx| cx.new(|_| FrontmatterPanel::new(sample_properties())));

        let received: Rc<RefCell<Vec<PropertyRemoved>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&panel, move |_, event: &PropertyRemoved, _| {
                recv.borrow_mut().push(event.clone());
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            panel.update(cx, |p, cx| p.remove_property("status", cx));
        });
        cx.run_until_parked();

        let got = received.borrow();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].key.as_ref(), "status");
        cx.update(|cx| {
            let panel = panel.read(cx);
            assert_eq!(panel.properties().len(), 1);
            assert_eq!(panel.properties()[0].key.as_ref(), "tags");
        });
    }

    /// `remove_property` with a missing key is a silent no-op — no
    /// event, no mutation.
    #[gpui::test]
    fn remove_property_missing_key_is_silent_no_op(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let panel: Entity<FrontmatterPanel> =
            cx.update(|cx| cx.new(|_| FrontmatterPanel::new(sample_properties())));

        let received: Rc<RefCell<u32>> = Rc::new(RefCell::new(0));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&panel, move |_, _event: &PropertyRemoved, _| {
                *recv.borrow_mut() += 1;
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            panel.update(cx, |p, cx| p.remove_property("missing", cx));
        });
        cx.run_until_parked();

        assert_eq!(*received.borrow(), 0, "missing key must not emit");
        cx.update(|cx| {
            assert_eq!(panel.read(cx).properties().len(), 2, "no mutation");
        });
    }

    /// `set_note_type` to a different value emits [`NoteTypeChanged`]
    /// exactly once.
    #[gpui::test]
    fn set_note_type_to_different_value_emits(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let panel: Entity<FrontmatterPanel> = cx.update(|cx| cx.new(|_| FrontmatterPanel::empty()));

        let received: Rc<RefCell<Vec<NoteTypeChanged>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&panel, move |_, event: &NoteTypeChanged, _| {
                recv.borrow_mut().push(event.clone());
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            panel.update(cx, |p, cx| {
                p.set_note_type(Some(SharedString::new_static("Person")), cx);
            });
        });
        cx.run_until_parked();

        let got = received.borrow();
        assert_eq!(got.len(), 1);
        assert_eq!(
            got[0].note_type.as_ref().map(SharedString::as_ref),
            Some("Person")
        );
    }

    /// `set_note_type` to the current value is a silent no-op — no
    /// event fires.
    #[gpui::test]
    fn set_note_type_to_same_value_is_silent_no_op(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let panel: Entity<FrontmatterPanel> = cx.update(|cx| cx.new(|_| FrontmatterPanel::empty()));

        cx.update(|cx| {
            panel.update(cx, |p, cx| {
                p.set_note_type(Some(SharedString::new_static("Person")), cx);
            });
        });

        let received: Rc<RefCell<u32>> = Rc::new(RefCell::new(0));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&panel, move |_, _event: &NoteTypeChanged, _| {
                *recv.borrow_mut() += 1;
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            panel.update(cx, |p, cx| {
                p.set_note_type(Some(SharedString::new_static("Person")), cx);
            });
        });
        cx.run_until_parked();

        assert_eq!(*received.borrow(), 0, "same-value write must not emit");
    }

    /// `set_icon` and `set_accent_color` each emit their own event
    /// when the value actually changes.
    #[gpui::test]
    fn set_icon_set_accent_color_each_emit_on_change(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let panel: Entity<FrontmatterPanel> = cx.update(|cx| cx.new(|_| FrontmatterPanel::empty()));

        let icons: Rc<RefCell<Vec<IconChanged>>> = Rc::new(RefCell::new(Vec::new()));
        let accents: Rc<RefCell<Vec<AccentColorChanged>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = icons.clone();
            cx.subscribe(&panel, move |_, event: &IconChanged, _| {
                recv.borrow_mut().push(event.clone());
            })
            .detach();
            let recv = accents.clone();
            cx.subscribe(&panel, move |_, event: &AccentColorChanged, _| {
                recv.borrow_mut().push(event.clone());
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            panel.update(cx, |p, cx| {
                p.set_icon(Some(SharedString::new_static("📓")), cx);
                p.set_accent_color(Some(SharedString::new_static("#ff8800")), cx);
            });
        });
        cx.run_until_parked();

        assert_eq!(icons.borrow().len(), 1, "icon change emits once");
        assert_eq!(accents.borrow().len(), 1, "accent change emits once");
        assert_eq!(
            icons.borrow()[0].icon.as_ref().map(SharedString::as_ref),
            Some("📓")
        );
        assert_eq!(
            accents.borrow()[0].color.as_ref().map(SharedString::as_ref),
            Some("#ff8800")
        );
    }

    /// Pure test exercising every [`PropertyValue`] discriminant via
    /// [`PropertyValue::value_summary`].  The render path consumes the
    /// same helper, so this guards every visible row format.
    #[test]
    fn property_value_summary_round_trips_across_variants() {
        let cases = [
            (
                PropertyValue::Text(SharedString::new_static("hello")),
                "hello",
            ),
            (PropertyValue::Number(1.5), "1.5"),
            (PropertyValue::Bool(true), "true"),
            (PropertyValue::Bool(false), "false"),
            (
                PropertyValue::Date(SharedString::new_static("2026-05-19")),
                "2026-05-19",
            ),
            (
                PropertyValue::List(vec![
                    SharedString::new_static("a"),
                    SharedString::new_static("b"),
                    SharedString::new_static("c"),
                ]),
                "[a, b, c]",
            ),
            (
                PropertyValue::Wikilink(SharedString::new_static("note-on-clear-prose")),
                "note-on-clear-prose",
            ),
            (
                PropertyValue::Color(SharedString::new_static("#ff8800")),
                "#ff8800",
            ),
        ];
        for (value, expected) in cases {
            assert_eq!(
                value.value_summary().as_ref(),
                expected,
                "value_summary mismatch for {value:?}"
            );
        }
    }
}
