#![forbid(unsafe_code)]
//! First-run onboarding prompts + telemetry consent (ADR-0115 Phase 8.22, Strand B).
//!
//! Mirrors the Tauri-era prompts in `src/components/onboarding/`:
//!
//! - `AiAgentsOnboardingPrompt.tsx` — invite the user to enable the AI panel.
//! - `ClaudeCodeOnboardingPrompt.tsx` — invite the user to install the
//!   Claude Code CLI integration.
//! - `OnboardingShell.tsx` — generic welcome panel shown on first launch.
//! - `TelemetryConsentDialog.tsx` — opt-in / opt-out for PostHog
//!   telemetry, blocked-required on first launch.
//!
//! This crate ships the scaffold: an enum of prompt variants, a
//! single-active-prompt view that emits an event per resolution, and
//! the `ModalView` impl so the workspace can mount the active prompt
//! through `ModalLayer::toggle_modal`.  Real prompt copy / illustrations
//! land in the visual-fidelity QA pass (Phase 8 close-out).
//!
//! # Usage
//!
//! ```rust,ignore
//! let view = cx.new(|_window, _cx| {
//!     OnboardingPromptView::new(OnboardingPrompt::TelemetryConsent)
//! });
//! cx.subscribe(&view, |_, e: &OnboardingResolution, _| {
//!     match e.outcome {
//!         OnboardingOutcome::Accepted => /* enable feature */ {},
//!         OnboardingOutcome::Declined => /* opt out */ {},
//!         OnboardingOutcome::Dismissed => /* defer */ {},
//!     }
//! }).detach();
//! ```

use gpui::{
    div, px, Context, EventEmitter, InteractiveElement as _, IntoElement, ParentElement, Render,
    SharedString, StatefulInteractiveElement as _, Styled, Window,
};
use gpui_component::{v_flex, ActiveTheme, StyledExt as _};

// ---------------------------------------------------------------------------
// OnboardingPrompt
// ---------------------------------------------------------------------------

/// One of the first-run prompts.  Each variant carries its own copy
/// stub; the workspace mounts whichever variant the
/// `vault_lifecycle`-derived first-run-state state machine reports as
/// next-to-show (Phase 9.6 will publish that state machine — for now
/// the workspace picks variants explicitly).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OnboardingPrompt {
    /// Generic welcome panel shown the first time a vault opens.
    Welcome,
    /// Invite the user to enable the AI panel and configure a backend.
    AiAgents,
    /// Invite the user to install the Claude Code CLI integration.
    ClaudeCode,
    /// Required telemetry opt-in / opt-out on first launch.
    TelemetryConsent,
}

impl OnboardingPrompt {
    /// Short title rendered in the prompt header.
    pub fn title(self) -> &'static str {
        match self {
            Self::Welcome => "Welcome to Tolaria",
            Self::AiAgents => "Enable AI Assistants?",
            Self::ClaudeCode => "Install Claude Code integration?",
            Self::TelemetryConsent => "Share anonymous usage data?",
        }
    }

    /// Body copy.  Placeholder for Phase 8 — final wording lands in
    /// the visual-fidelity QA pass.
    pub fn body(self) -> &'static str {
        match self {
            Self::Welcome => {
                "Tolaria is a local-first notes app.  Your notes stay on your machine."
            }
            Self::AiAgents => {
                "The AI panel can summarise notes and answer questions about your vault."
            }
            Self::ClaudeCode => {
                "Claude Code can edit notes from the command line and run repository tasks."
            }
            Self::TelemetryConsent => {
                "Tolaria can send anonymous usage events to help us prioritise improvements.  \
                 We never send note content."
            }
        }
    }

    /// Stable element id for the prompt's outer container — exposed so
    /// periscope can target the active prompt by name.
    pub const fn element_id(self) -> &'static str {
        match self {
            Self::Welcome => "onboarding-welcome",
            Self::AiAgents => "onboarding-ai-agents",
            Self::ClaudeCode => "onboarding-claude-code",
            Self::TelemetryConsent => "onboarding-telemetry-consent",
        }
    }
}

// ---------------------------------------------------------------------------
// OnboardingOutcome
// ---------------------------------------------------------------------------

/// How the user resolved the prompt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OnboardingOutcome {
    /// User clicked the affirmative CTA (Yes / Enable / I consent).
    Accepted,
    /// User clicked the negative CTA (No / Skip / Decline).
    Declined,
    /// User dismissed without choosing — workspace should re-show later.
    Dismissed,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// Emitted when the user resolves the active prompt.  Workspace
/// subscribers map outcomes to settings writes / feature toggles.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OnboardingResolution {
    /// Which prompt was resolved.
    pub prompt: OnboardingPrompt,
    /// How the user resolved it.
    pub outcome: OnboardingOutcome,
}

// ---------------------------------------------------------------------------
// OnboardingPromptView
// ---------------------------------------------------------------------------

/// Phase 8.22 onboarding prompt view.  Holds one active
/// [`OnboardingPrompt`] and emits [`OnboardingResolution`] on each
/// CTA click.
pub struct OnboardingPromptView {
    prompt: OnboardingPrompt,
}

impl EventEmitter<OnboardingResolution> for OnboardingPromptView {}

impl OnboardingPromptView {
    /// Construct a view that displays `prompt`.
    #[must_use]
    pub fn new(prompt: OnboardingPrompt) -> Self {
        Self { prompt }
    }

    /// The prompt currently shown.
    #[must_use]
    pub fn prompt(&self) -> OnboardingPrompt {
        self.prompt
    }

    /// Replace the active prompt and re-render.  Used by the
    /// workspace to chain prompts (e.g. Welcome → TelemetryConsent →
    /// AiAgents) without rebuilding the entity.
    pub fn set_prompt(&mut self, prompt: OnboardingPrompt, cx: &mut Context<Self>) {
        if self.prompt != prompt {
            self.prompt = prompt;
            cx.notify();
        }
    }

    /// Emit [`OnboardingResolution`] with the given outcome.
    pub fn resolve(&mut self, outcome: OnboardingOutcome, cx: &mut Context<Self>) {
        cx.emit(OnboardingResolution {
            prompt: self.prompt,
            outcome,
        });
    }
}

impl workspace::ModalView for OnboardingPromptView {}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

impl Render for OnboardingPromptView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let fg = theme.foreground;
        let muted = theme.muted_foreground;
        let entity = cx.entity();
        let prompt = self.prompt;

        let accept_entity = entity.clone();
        let decline_entity = entity.clone();
        let dismiss_entity = entity.clone();

        v_flex()
            .id(prompt.element_id())
            .p(px(24.0))
            .gap(px(12.0))
            .max_w(px(420.0))
            .text_sm()
            .text_color(fg)
            .child(div().font_semibold().text_lg().child(prompt.title()))
            .child(div().text_color(muted).child(prompt.body()))
            .child(
                div()
                    .flex()
                    .flex_row()
                    .gap(px(8.0))
                    .pt(px(8.0))
                    .child(
                        div()
                            .id("onboarding-accept")
                            .px(px(12.0))
                            .py(px(6.0))
                            .rounded(px(4.0))
                            .bg(theme.accent)
                            .text_color(theme.accent_foreground)
                            .cursor_pointer()
                            .on_click(move |_, _window, cx| {
                                accept_entity.update(cx, |this, cx| {
                                    this.resolve(OnboardingOutcome::Accepted, cx);
                                });
                            })
                            .child(SharedString::new_static("Yes")),
                    )
                    .child(
                        div()
                            .id("onboarding-decline")
                            .px(px(12.0))
                            .py(px(6.0))
                            .rounded(px(4.0))
                            .bg(theme.muted)
                            .text_color(fg)
                            .cursor_pointer()
                            .on_click(move |_, _window, cx| {
                                decline_entity.update(cx, |this, cx| {
                                    this.resolve(OnboardingOutcome::Declined, cx);
                                });
                            })
                            .child(SharedString::new_static("No")),
                    )
                    .child(
                        div()
                            .id("onboarding-dismiss")
                            .px(px(12.0))
                            .py(px(6.0))
                            .text_color(muted)
                            .cursor_pointer()
                            .on_click(move |_, _window, cx| {
                                dismiss_entity.update(cx, |this, cx| {
                                    this.resolve(OnboardingOutcome::Dismissed, cx);
                                });
                            })
                            .child(SharedString::new_static("Later")),
                    ),
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

    /// Each prompt variant must render without panic.
    #[gpui::test]
    fn every_prompt_renders(cx: &mut TestAppContext) {
        install_theme(cx);
        for prompt in [
            OnboardingPrompt::Welcome,
            OnboardingPrompt::AiAgents,
            OnboardingPrompt::ClaudeCode,
            OnboardingPrompt::TelemetryConsent,
        ] {
            let _window = cx.add_window(move |_window, _cx| OnboardingPromptView::new(prompt));
            cx.run_until_parked();
        }
    }

    /// `resolve(Accepted)` emits `OnboardingResolution` carrying the
    /// current prompt and the Accepted outcome.
    #[gpui::test]
    fn resolve_accept_emits(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let view: Entity<OnboardingPromptView> = cx
            .update(|cx| cx.new(|_| OnboardingPromptView::new(OnboardingPrompt::TelemetryConsent)));

        let received: Rc<RefCell<Vec<OnboardingResolution>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&view, move |_, event: &OnboardingResolution, _| {
                recv.borrow_mut().push(*event);
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            view.update(cx, |this, cx| this.resolve(OnboardingOutcome::Accepted, cx));
        });
        cx.run_until_parked();

        let got = received.borrow();
        assert_eq!(got.len(), 1);
        assert_eq!(
            got[0],
            OnboardingResolution {
                prompt: OnboardingPrompt::TelemetryConsent,
                outcome: OnboardingOutcome::Accepted,
            }
        );
    }

    /// `set_prompt` to a different variant changes the rendered
    /// prompt and notifies; `set_prompt` to the current variant is a
    /// silent no-op (no notify) so chaining the same prompt twice
    /// doesn't churn observers.
    #[gpui::test]
    fn set_prompt_idempotent_on_same_variant(cx: &mut TestAppContext) {
        install_theme(cx);
        let view: Entity<OnboardingPromptView> =
            cx.update(|cx| cx.new(|_| OnboardingPromptView::new(OnboardingPrompt::Welcome)));

        cx.update(|cx| {
            view.update(cx, |this, cx| {
                this.set_prompt(OnboardingPrompt::Welcome, cx); // same → no-op
                this.set_prompt(OnboardingPrompt::AiAgents, cx); // different → notify
            });
        });

        cx.update(|cx| {
            assert_eq!(view.read(cx).prompt(), OnboardingPrompt::AiAgents);
        });
    }

    /// Each `OnboardingOutcome` variant must round-trip through
    /// `resolve` to the matching subscriber.
    #[gpui::test]
    fn every_outcome_emits(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let view: Entity<OnboardingPromptView> =
            cx.update(|cx| cx.new(|_| OnboardingPromptView::new(OnboardingPrompt::AiAgents)));

        let received: Rc<RefCell<Vec<OnboardingOutcome>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&view, move |_, event: &OnboardingResolution, _| {
                recv.borrow_mut().push(event.outcome);
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            view.update(cx, |this, cx| {
                this.resolve(OnboardingOutcome::Accepted, cx);
                this.resolve(OnboardingOutcome::Declined, cx);
                this.resolve(OnboardingOutcome::Dismissed, cx);
            });
        });
        cx.run_until_parked();

        let got = received.borrow().clone();
        assert_eq!(
            got,
            vec![
                OnboardingOutcome::Accepted,
                OnboardingOutcome::Declined,
                OnboardingOutcome::Dismissed,
            ]
        );
    }

    /// Every prompt's `element_id` is unique so periscope can target
    /// the active prompt by name without collision.
    #[test]
    fn element_ids_are_unique() {
        let ids = [
            OnboardingPrompt::Welcome.element_id(),
            OnboardingPrompt::AiAgents.element_id(),
            OnboardingPrompt::ClaudeCode.element_id(),
            OnboardingPrompt::TelemetryConsent.element_id(),
        ];
        let mut seen = std::collections::HashSet::new();
        for id in ids {
            assert!(seen.insert(id), "duplicate element id: {id}");
        }
    }
}
