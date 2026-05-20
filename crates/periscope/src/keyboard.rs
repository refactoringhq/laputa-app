//! Pure mapping layer between human-readable key / modifier names and the
//! `CGKeyCode` / `CGEventFlags` constants `CGEventCreateKeyboardEvent`
//! expects.
//!
//! Kept separate from [`crate::input`] so the mapping logic is testable on
//! every platform (no `#[cfg(target_os = "macos")]` here).  The downstream
//! callers that actually post events are macOS-gated; this module just hands
//! them numeric codes.
//!
//! Why a dedicated layer:
//!
//! - `osascript keystroke` is blocked inside the WKWebView editor body
//!   (`AGENTS.md` §4 macOS gotchas), so the harness can't lean on AppleEvent
//!   keyboard input for editor-body scenarios.  Raw `CGEvent` keyboard
//!   events go through the same system event queue WKWebView listens on,
//!   which is the only synthetic-input path that reaches the editor body.
//! - Periscope's CLI takes string names (`Return`, `cmd`, …) rather than
//!   numeric keycodes so smoke scripts stay readable.  This module is the
//!   one place that owns that translation.

#![allow(clippy::doc_markdown)]

use anyhow::{anyhow, Result};

/// A macOS Carbon virtual keycode.  Re-exports `core_graphics::CGKeyCode`
/// on macOS; on other platforms we keep the same `u16` shape so the pure
/// mapping logic compiles and tests run everywhere.
pub type KeyCode = u16;

/// Bitflag set for keyboard modifier keys.  Wraps a `u64` matching
/// `CGEventFlags`' representation so callers can hand the value straight
/// to `CGEvent::set_flags(CGEventFlags::from_bits_truncate(flags.bits()))`
/// without re-deriving the bit layout.
///
/// The pure mapping is platform-agnostic; the actual `set_flags` call
/// lives behind the macOS gate in [`crate::input`].
///
/// Construction is via the associated `const` constants (`SHIFT`,
/// `CONTROL`, `OPTION`, `COMMAND`, `SECONDARY_FN`, `NONE`) combined with
/// `|`; there is no public `from_bits` because the only legitimate
/// source of new bit patterns is `parse_modifier` / `parse_modifier_list`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub struct ModifierFlags(u64);

impl ModifierFlags {
    /// Empty set — no modifiers held.
    pub const NONE: Self = Self(0);
    /// `Shift` modifier (`CGEventFlagShift`).
    pub const SHIFT: Self = Self(0x0002_0000);
    /// `Control` modifier (`CGEventFlagControl`).
    pub const CONTROL: Self = Self(0x0004_0000);
    /// `Option` / `Alt` modifier (`CGEventFlagAlternate`).
    pub const OPTION: Self = Self(0x0008_0000);
    /// `Command` modifier (`CGEventFlagCommand`).
    pub const COMMAND: Self = Self(0x0010_0000);
    /// `Fn` secondary-function modifier (`CGEventFlagSecondaryFn`).
    pub const SECONDARY_FN: Self = Self(0x0080_0000);

    /// Extract the raw `u64` bit pattern.  Use this only at the
    /// `CGEventFlags::from_bits_truncate` handoff in [`crate::input`].
    #[must_use]
    pub const fn bits(self) -> u64 {
        self.0
    }

    /// `true` when `self` has every bit `other` has set.  Useful in tests
    /// that want to assert "the parsed result contains the SHIFT bit"
    /// without caring about other modifiers.
    #[must_use]
    pub const fn contains(self, other: Self) -> bool {
        (self.0 & other.0) == other.0
    }
}

impl std::ops::BitOr for ModifierFlags {
    type Output = Self;
    fn bitor(self, rhs: Self) -> Self {
        Self(self.0 | rhs.0)
    }
}

impl std::ops::BitOrAssign for ModifierFlags {
    fn bitor_assign(&mut self, rhs: Self) {
        self.0 |= rhs.0;
    }
}

// Build-time guard against an accidental edit that zeroes the
// individual modifier bits or the `NONE` invariant.  Stays outside the
// `#[cfg(test)]` block so the assertion fires on every build, not just
// `cargo test`.
const _: () = {
    assert!(ModifierFlags::NONE.bits() == 0);
    assert!(ModifierFlags::SHIFT.bits() == 0x0002_0000);
    assert!(ModifierFlags::CONTROL.bits() == 0x0004_0000);
    assert!(ModifierFlags::OPTION.bits() == 0x0008_0000);
    assert!(ModifierFlags::COMMAND.bits() == 0x0010_0000);
    assert!(ModifierFlags::SECONDARY_FN.bits() == 0x0080_0000);
};

/// Parse a single modifier name (`cmd`, `shift`, `opt`, `ctrl`, `fn`) into
/// its `CGEventFlags` bit value.
///
/// Accepts both the short alias and a few common synonyms:
///
/// | Name(s)                    | Bit                        |
/// |----------------------------|----------------------------|
/// | `cmd`, `command`, `meta`   | `ModifierFlags::COMMAND`   |
/// | `shift`                    | `ModifierFlags::SHIFT`     |
/// | `opt`, `option`, `alt`     | `ModifierFlags::OPTION`    |
/// | `ctrl`, `control`          | `ModifierFlags::CONTROL`   |
/// | `fn`, `function`           | `ModifierFlags::SECONDARY_FN` |
///
/// Matching is ASCII-case-insensitive.  Unknown names return an
/// [`anyhow::Error`] listing the valid set.
///
/// # Errors
///
/// - `name` is not one of the recognised modifier strings.
pub fn parse_modifier(name: &str) -> Result<ModifierFlags> {
    match name.to_ascii_lowercase().as_str() {
        "cmd" | "command" | "meta" => Ok(ModifierFlags::COMMAND),
        "shift" => Ok(ModifierFlags::SHIFT),
        "opt" | "option" | "alt" => Ok(ModifierFlags::OPTION),
        "ctrl" | "control" => Ok(ModifierFlags::CONTROL),
        "fn" | "function" => Ok(ModifierFlags::SECONDARY_FN),
        other => Err(anyhow!(
            "unknown modifier {other:?}: expected one of \
             cmd/shift/opt/ctrl/fn (with synonyms command/meta/option/alt/control/function)"
        )),
    }
}

/// Parse a comma-separated modifier list into a combined [`ModifierFlags`]
/// bit-set.  Whitespace around each name is ignored; an empty string is a
/// valid input and returns [`ModifierFlags::NONE`].
///
/// # Errors
///
/// - Any individual element fails [`parse_modifier`].
pub fn parse_modifier_list(list: &str) -> Result<ModifierFlags> {
    let mut acc = ModifierFlags::NONE;
    for raw in list.split(',') {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        acc |= parse_modifier(trimmed)?;
    }
    Ok(acc)
}

/// Resolve a human-readable key name (`Return`, `Tab`, `a`, `f1`, `[`, …)
/// to its macOS Carbon virtual keycode.
///
/// Supports:
///
/// - **Named keys**: `Return`, `Tab`, `Escape`, `Space`, `Delete`,
///   `Backspace` (alias for `Delete`), `Up`, `Down`, `Left`, `Right`,
///   `Home`, `End`, `PageUp`, `PageDown`, `F1`–`F20`.  Match is
///   ASCII-case-insensitive.
/// - **Single ASCII letters** `a`–`z` (case-insensitive — shift-modifier
///   handling is the caller's responsibility).
/// - **Digits** `0`–`9` on the main number row.
/// - **Common punctuation**: ``  `  ``, `-`, `=`, `[`, `]`, `\`, `;`,
///   `'`, `,`, `.`, `/`.
///
/// # Errors
///
/// - `name` doesn't match any of the supported names / characters.
///   The error message names the input verbatim so smoke-script typos
///   are easy to spot.
pub fn key_name_to_keycode(name: &str) -> Result<KeyCode> {
    // Named key lookups (case-insensitive).
    let normalised = name.to_ascii_lowercase();
    if let Some(code) = named_key_to_code(&normalised) {
        return Ok(code);
    }

    // Single-character lookups — but only when the original input is one
    // character long; otherwise "Return" with a missing entry above would
    // fall through to char_to_keycode('R') and silently click "R".
    if name.chars().count() == 1 {
        if let Some(ch) = name.chars().next() {
            if let Some(code) = char_to_keycode(ch) {
                return Ok(code);
            }
        }
    }

    Err(anyhow!(
        "unknown key {name:?}: expected a named key (Return, Tab, …, F1-F20) \
         or a single character (a-z, 0-9, punctuation)"
    ))
}

/// Lookup for the named-key table.  Matching is on the already-lowercased
/// input — see [`key_name_to_keycode`].
#[must_use]
fn named_key_to_code(lower: &str) -> Option<KeyCode> {
    Some(match lower {
        "return" | "enter" => 0x24,
        "tab" => 0x30,
        "space" => 0x31,
        "delete" | "backspace" => 0x33,
        "escape" | "esc" => 0x35,
        "forwarddelete" | "forward-delete" => 0x75,
        "up" | "uparrow" | "up-arrow" => 0x7E,
        "down" | "downarrow" | "down-arrow" => 0x7D,
        "left" | "leftarrow" | "left-arrow" => 0x7B,
        "right" | "rightarrow" | "right-arrow" => 0x7C,
        "home" => 0x73,
        "end" => 0x77,
        "pageup" | "page-up" => 0x74,
        "pagedown" | "page-down" => 0x79,
        "f1" => 0x7A,
        "f2" => 0x78,
        "f3" => 0x63,
        "f4" => 0x76,
        "f5" => 0x60,
        "f6" => 0x61,
        "f7" => 0x62,
        "f8" => 0x64,
        "f9" => 0x65,
        "f10" => 0x6D,
        "f11" => 0x67,
        "f12" => 0x6F,
        "f13" => 0x69,
        "f14" => 0x6B,
        "f15" => 0x71,
        "f16" => 0x6A,
        "f17" => 0x40,
        "f18" => 0x4F,
        "f19" => 0x50,
        "f20" => 0x5A,
        _ => return None,
    })
}

/// Lookup for single-character keys.  Letters fold to lower case so callers
/// don't need to worry about the input casing; an upper-case letter
/// needs `--modifiers shift` to actually type a capital.
#[must_use]
fn char_to_keycode(ch: char) -> Option<KeyCode> {
    let lowered = ch.to_ascii_lowercase();
    Some(match lowered {
        'a' => 0x00,
        's' => 0x01,
        'd' => 0x02,
        'f' => 0x03,
        'h' => 0x04,
        'g' => 0x05,
        'z' => 0x06,
        'x' => 0x07,
        'c' => 0x08,
        'v' => 0x09,
        'b' => 0x0B,
        'q' => 0x0C,
        'w' => 0x0D,
        'e' => 0x0E,
        'r' => 0x0F,
        'y' => 0x10,
        't' => 0x11,
        'o' => 0x1F,
        'u' => 0x20,
        'i' => 0x22,
        'p' => 0x23,
        'l' => 0x25,
        'j' => 0x26,
        'k' => 0x28,
        'n' => 0x2D,
        'm' => 0x2E,
        '1' => 0x12,
        '2' => 0x13,
        '3' => 0x14,
        '4' => 0x15,
        '5' => 0x17,
        '6' => 0x16,
        '7' => 0x1A,
        '8' => 0x1C,
        '9' => 0x19,
        '0' => 0x1D,
        '-' => 0x1B,
        '=' => 0x18,
        '[' => 0x21,
        ']' => 0x1E,
        '\\' => 0x2A,
        ';' => 0x29,
        '\'' => 0x27,
        ',' => 0x2B,
        '.' => 0x2F,
        '/' => 0x2C,
        '`' => 0x32,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modifier_aliases_resolve_to_same_bit() {
        assert_eq!(parse_modifier("cmd").unwrap(), ModifierFlags::COMMAND);
        assert_eq!(parse_modifier("Command").unwrap(), ModifierFlags::COMMAND);
        assert_eq!(parse_modifier("META").unwrap(), ModifierFlags::COMMAND);

        assert_eq!(parse_modifier("alt").unwrap(), ModifierFlags::OPTION);
        assert_eq!(parse_modifier("Option").unwrap(), ModifierFlags::OPTION);

        assert_eq!(parse_modifier("ctrl").unwrap(), ModifierFlags::CONTROL);
        assert_eq!(parse_modifier("control").unwrap(), ModifierFlags::CONTROL);

        assert_eq!(parse_modifier("shift").unwrap(), ModifierFlags::SHIFT);
        assert_eq!(parse_modifier("fn").unwrap(), ModifierFlags::SECONDARY_FN);
    }

    #[test]
    fn unknown_modifier_errors_with_friendly_message() {
        let err = parse_modifier("hyper").unwrap_err().to_string();
        assert!(err.contains("hyper"), "error mentions input: {err}");
        assert!(err.contains("cmd"), "error lists valid set: {err}");
    }

    #[test]
    fn parse_modifier_list_combines_bits() {
        let bits = parse_modifier_list("cmd,shift").unwrap();
        assert_eq!(bits, ModifierFlags::COMMAND | ModifierFlags::SHIFT);

        let with_spaces = parse_modifier_list(" shift , opt ").unwrap();
        assert_eq!(with_spaces, ModifierFlags::SHIFT | ModifierFlags::OPTION);

        // Empty list is valid: zero modifiers, not an error.
        assert_eq!(parse_modifier_list("").unwrap(), ModifierFlags::NONE);
        assert_eq!(parse_modifier_list(" , ").unwrap(), ModifierFlags::NONE);
    }

    #[test]
    fn parse_modifier_list_propagates_first_unknown() {
        let err = parse_modifier_list("cmd,bogus,shift")
            .unwrap_err()
            .to_string();
        assert!(err.contains("bogus"), "error mentions bad token: {err}");
    }

    #[test]
    fn named_keys_resolve_canonical_carbon_codes() {
        // Spot-check the documented headline keys.
        assert_eq!(key_name_to_keycode("Return").unwrap(), 0x24);
        assert_eq!(key_name_to_keycode("Enter").unwrap(), 0x24);
        assert_eq!(key_name_to_keycode("tab").unwrap(), 0x30);
        assert_eq!(key_name_to_keycode("Escape").unwrap(), 0x35);
        assert_eq!(key_name_to_keycode("esc").unwrap(), 0x35);
        assert_eq!(key_name_to_keycode("Space").unwrap(), 0x31);
        assert_eq!(key_name_to_keycode("Backspace").unwrap(), 0x33);
        assert_eq!(key_name_to_keycode("Delete").unwrap(), 0x33);
        assert_eq!(key_name_to_keycode("ForwardDelete").unwrap(), 0x75);
    }

    #[test]
    fn arrow_keys_resolve() {
        assert_eq!(key_name_to_keycode("Up").unwrap(), 0x7E);
        assert_eq!(key_name_to_keycode("Down").unwrap(), 0x7D);
        assert_eq!(key_name_to_keycode("Left").unwrap(), 0x7B);
        assert_eq!(key_name_to_keycode("Right").unwrap(), 0x7C);
    }

    #[test]
    fn function_keys_f1_through_f20_resolve() {
        for n in 1..=20u32 {
            let name = format!("F{n}");
            key_name_to_keycode(&name).unwrap_or_else(|err| panic!("F{n} should resolve: {err}"));
        }
        assert_eq!(key_name_to_keycode("F1").unwrap(), 0x7A);
        assert_eq!(key_name_to_keycode("F12").unwrap(), 0x6F);
        assert_eq!(key_name_to_keycode("F20").unwrap(), 0x5A);
    }

    #[test]
    fn single_letters_are_case_insensitive() {
        // The mapping returns the same physical key for both cases; the
        // caller is expected to add `shift` to get the upper-case glyph.
        let lower = key_name_to_keycode("a").unwrap();
        let upper = key_name_to_keycode("A").unwrap();
        assert_eq!(lower, upper);
        assert_eq!(lower, 0x00);
    }

    #[test]
    fn digits_and_punctuation_resolve() {
        assert_eq!(key_name_to_keycode("0").unwrap(), 0x1D);
        assert_eq!(key_name_to_keycode("9").unwrap(), 0x19);
        assert_eq!(key_name_to_keycode("/").unwrap(), 0x2C);
        assert_eq!(key_name_to_keycode("[").unwrap(), 0x21);
        assert_eq!(key_name_to_keycode("]").unwrap(), 0x1E);
        assert_eq!(key_name_to_keycode("`").unwrap(), 0x32);
    }

    #[test]
    fn unknown_name_errors_without_silent_fallthrough() {
        // Regression guard for the obvious bug: a multi-char name that
        // misses the named table must not fall through to char_to_keycode
        // and silently click 'R' for "Return-ish".
        let err = key_name_to_keycode("Returnish").unwrap_err().to_string();
        assert!(err.contains("Returnish"), "error mentions input: {err}");
    }

    #[test]
    fn unknown_single_char_errors() {
        // Characters outside the punctuation allowlist (e.g. non-ASCII)
        // must error rather than silently mapping to something arbitrary.
        let err = key_name_to_keycode("§").unwrap_err().to_string();
        assert!(err.contains('§'.to_string().as_str()));
    }

    #[test]
    fn pageup_pagedown_aliases() {
        // Both compact and hyphenated forms must resolve so the smoke
        // scripts can match the case used in surrounding code.
        assert_eq!(key_name_to_keycode("PageUp").unwrap(), 0x74);
        assert_eq!(key_name_to_keycode("page-up").unwrap(), 0x74);
        assert_eq!(key_name_to_keycode("PageDown").unwrap(), 0x79);
        assert_eq!(key_name_to_keycode("page-down").unwrap(), 0x79);
    }

    #[test]
    fn modifier_flag_constants_match_cgevent_bits() {
        // Regression guard for the bit-value table.  These constants
        // mirror `CGEventFlags`; drifting them silently would break
        // shortcuts where the modifier doesn't end up set on the post.
        // The build-time `const _` block above asserts the same; this
        // test exists so the failure shows up by name in `cargo test`
        // output rather than as a generic build error.
        assert_eq!(ModifierFlags::SHIFT.bits(), 0x0002_0000);
        assert_eq!(ModifierFlags::CONTROL.bits(), 0x0004_0000);
        assert_eq!(ModifierFlags::OPTION.bits(), 0x0008_0000);
        assert_eq!(ModifierFlags::COMMAND.bits(), 0x0010_0000);
        assert_eq!(ModifierFlags::SECONDARY_FN.bits(), 0x0080_0000);
        assert_eq!(ModifierFlags::NONE.bits(), 0);
    }

    #[test]
    fn modifier_flags_default_is_none() {
        // Common-trait invariant (C-COMMON-TRAITS): the derived `Default`
        // must agree with the documented `NONE` constant so that
        // `ModifierFlags::default()` and `ModifierFlags::NONE` are
        // interchangeable.
        assert_eq!(ModifierFlags::default(), ModifierFlags::NONE);
    }

    #[test]
    fn modifier_flags_bitor_and_contains() {
        let combo = ModifierFlags::COMMAND | ModifierFlags::SHIFT;
        assert!(combo.contains(ModifierFlags::COMMAND));
        assert!(combo.contains(ModifierFlags::SHIFT));
        assert!(!combo.contains(ModifierFlags::OPTION));
        assert!(combo.contains(ModifierFlags::NONE));

        // BitOrAssign accumulates without overwriting.
        let mut acc = ModifierFlags::NONE;
        acc |= ModifierFlags::CONTROL;
        acc |= ModifierFlags::SHIFT;
        assert_eq!(acc, ModifierFlags::CONTROL | ModifierFlags::SHIFT);
    }
}
