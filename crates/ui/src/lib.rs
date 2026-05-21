#![deny(missing_docs)]
#![warn(clippy::all)]
//! Tolaria-specific UI compounds (ADR-0115 Phase 1 → Phase 2).
//!
//! In Phase 1 this crate was a placeholder exporting only `init`.
//! Phase 2 adds a vendored minimal port of Zed's `Picker<Delegate>` for the
//! command-palette, quick-open, and wikilink-combobox surfaces.
//!
//! Future additions (Phase 2+):
//! - `RichTooltip` — tooltip with an embedded shortcut badge.
//! - `IconPicker` — icon chooser built over the Phosphor icon set.
//! - `ShortcutBadge` — small keyboard-shortcut label.
//! - `FocusRing` — consistent focus indicator overlay.

pub mod picker;
pub mod tree_dump;
pub use picker::{Picker, PickerDelegate};
