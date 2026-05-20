//! Hardcoded note vault mirroring `demo-vault-v2/` for Phase 2 chrome rendering.
//!
//! [`MockVault`] implements GPUI's [`Global`] trait so chrome crates can
//! access it via `cx.global::<MockVault>()` and mutate it via
//! `cx.global_mut::<MockVault>()`.  The latter automatically triggers
//! `observe_global::<MockVault>` subscribers, causing dependent views to
//! re-render — the same mechanism Phase 3 real services will use.

use std::{collections::HashMap, path::PathBuf};

use chrono::{DateTime, TimeZone as _, Utc};
use gpui::{Global, SharedString, Task};
use serde_json::Value;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

// `NoteId` and `NoteKind` are re-exported from the `vault` crate so chrome
// panels can accept either a real `vault::Vault` or a `MockVault` without
// type-juggling at the boundary.  See ADR-0115 Phase 5a.
pub use vault::{NoteId, NoteKind, VaultChanged};

/// A single in-memory note record.  Carries the real-vault fields plus
/// `content`, `created`, and `properties` for mock-specific chrome surfaces
/// (inspector ToC, properties panel, etc.).
#[derive(Debug, Clone)]
pub struct MockNote {
    pub id: NoteId,
    pub title: SharedString,
    pub path: PathBuf,
    pub content: String,
    pub kind: NoteKind,
    pub created: DateTime<Utc>,
    pub modified: DateTime<Utc>,
    pub properties: HashMap<String, Value>,
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/// Errors returned by [`MockVault`] mutation methods.
#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    /// The requested note does not exist in the vault.
    #[error("note {0:?} not found")]
    NotFound(NoteId),
}

// ---------------------------------------------------------------------------
// MockVault
// ---------------------------------------------------------------------------

/// In-memory vault holding 30 hardcoded notes that mirror `demo-vault-v2/`.
///
/// Install once at app startup:
/// ```rust,ignore
/// cx.set_global(MockVault::seeded());
/// ```
/// Chrome crates read notes via `cx.global::<MockVault>()` and mutate via
/// `cx.global_mut::<MockVault>()`, which automatically fires observer
/// callbacks registered with `cx.observe_global::<MockVault>`.
#[derive(Clone)]
pub struct MockVault {
    pub(crate) notes: Vec<MockNote>,
}

impl Global for MockVault {}

impl MockVault {
    /// Build a [`MockVault`] pre-populated with 30 fixture notes.
    pub fn seeded() -> Self {
        Self {
            notes: seed_notes(),
        }
    }

    /// Build a [`MockVault`] from an explicit note list — primarily a
    /// test helper so unit tests can exercise the resolver against
    /// minimal hand-crafted fixtures without touching the seeded set.
    pub fn from_notes(notes: Vec<MockNote>) -> Self {
        Self { notes }
    }

    /// IDs of every note currently in the vault.
    pub fn notes(&self) -> Task<Vec<NoteId>> {
        Task::ready(self.notes.iter().map(|n| n.id).collect())
    }

    /// Look up a note by `id`; returns `None` if not found.
    pub fn note(&self, id: NoteId) -> Task<Option<MockNote>> {
        Task::ready(self.notes.iter().find(|n| n.id == id).cloned())
    }

    /// Overwrite the body of a note.  Returns `Err` for unknown IDs.
    ///
    /// Call via `cx.global_mut::<MockVault>().save(…)` so GPUI notifies
    /// observers after the mutation.
    pub fn save(&mut self, id: NoteId, content: impl Into<String>) -> Task<Result<(), VaultError>> {
        let content = content.into();
        log::debug!("MockVault: saving note {}", id.get());
        match self.notes.iter_mut().find(|n| n.id == id) {
            Some(note) => {
                note.content = content;
                Task::ready(Ok(()))
            }
            None => Task::ready(Err(VaultError::NotFound(id))),
        }
    }

    /// Remove a note from the vault.  Returns `Err` for unknown IDs.
    ///
    /// Call via `cx.global_mut::<MockVault>().delete(…)` so GPUI notifies
    /// observers after the mutation.
    pub fn delete(&mut self, id: NoteId) -> Task<Result<(), VaultError>> {
        log::debug!("MockVault: deleting note {}", id.get());
        let before = self.notes.len();
        self.notes.retain(|n| n.id != id);
        if self.notes.len() < before {
            Task::ready(Ok(()))
        } else {
            Task::ready(Err(VaultError::NotFound(id)))
        }
    }

    /// Mirror [`vault::Vault::watch_events`]: returns an inert receiver
    /// that never emits.  Lets chrome surfaces consume the same shape
    /// against the mock or the real vault without conditional code.
    #[must_use]
    pub fn watch_events(&self) -> flume::Receiver<VaultChanged> {
        // Hand back the receiver from a fresh unbounded channel and
        // drop the sender, so the receiver is closed cleanly the
        // moment a subscriber tries to recv — same observable shape
        // as a watcher that simply never saw any events.
        let (_tx, rx) = flume::unbounded::<VaultChanged>();
        rx
    }

    /// IDs of notes whose **titles** contain `query` (case-insensitive substring).
    pub fn search_titles(&self, query: &str) -> Task<Vec<NoteId>> {
        let q = query.to_lowercase();
        let ids = self
            .notes
            .iter()
            .filter(|n| n.title.to_lowercase().contains(&q))
            .map(|n| n.id)
            .collect();
        Task::ready(ids)
    }
}

// ---------------------------------------------------------------------------
// Seed data — 30 notes mirroring demo-vault-v2/
// ---------------------------------------------------------------------------

fn ts(year: i32, month: u32, day: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(year, month, day, 12, 0, 0)
        .single()
        .expect("fixture timestamp components are valid (compile-time constants)")
}

fn props(note_type: &str) -> HashMap<String, Value> {
    [("type".to_string(), Value::String(note_type.to_string()))]
        .into_iter()
        .collect()
}

fn mk(
    id: u64,
    title: &'static str,
    path: &'static str,
    note_type: &'static str,
    content: &'static str,
    created: (i32, u32, u32),
) -> MockNote {
    MockNote {
        id: NoteId::from_raw(id),
        title: SharedString::from(title),
        path: PathBuf::from(path),
        content: content.to_string(),
        kind: NoteKind::Markdown,
        created: ts(created.0, created.1, created.2),
        modified: ts(2026, 5, 17),
        properties: props(note_type),
    }
}

#[rustfmt::skip]
fn seed_notes() -> Vec<MockNote> {
    vec![
        // ── Topics (1-5) ────────────────────────────────────────────────────
        mk(1,  "Writing",              "topic-writing.md",
            "Topic",
            "---\ntype: Topic\naliases:\n  - \"[[Writing]]\"\n---\n\n# Writing\n\nThe exact-match Quick Open target for search ranking QA.\n\n- [[note-on-clear-prose]]\n",
            (2024, 10, 1)),
        mk(2,  "Product",              "topic-product.md",
            "Topic",
            "---\ntype: Topic\n---\n\n# Product\n\nProduct thinking, strategy, and roadmap planning.\n",
            (2024, 10, 1)),
        mk(3,  "Engineering",          "topic-engineering.md",
            "Topic",
            "---\ntype: Topic\n---\n\n# Engineering\n\nEngineering practices, tooling, and architecture notes.\n",
            (2024, 10, 2)),
        mk(4,  "Design",               "topic-design.md",
            "Topic",
            "---\ntype: Topic\n---\n\n# Design\n\nDesign system, visual language, and UX research.\n",
            (2024, 10, 2)),
        mk(5,  "Architecture",         "topic-architecture.md",
            "Topic",
            "---\ntype: Topic\n---\n\n# Architecture\n\nSoftware architecture decisions and patterns.\n",
            (2024, 10, 3)),

        // ── People (6-10) ───────────────────────────────────────────────────
        mk(6,  "Luca Rossi",           "person-luca-rossi.md",
            "Person",
            "---\ntype: Person\naliases:\n  - \"[[Luca Rossi]]\"\ntier: 1st\n---\n\n# Luca Rossi\n\nOwns the Laputa product work and is the primary project owner.\n",
            (2024, 10, 5)),
        mk(7,  "Matteo Cellini",       "person-matteo-cellini.md",
            "Person",
            "---\ntype: Person\naliases:\n  - \"[[Matteo Cellini]]\"\ntier: 1st\n---\n\n# Matteo Cellini\n\nOwns the Laputa sponsorship pipeline.\n",
            (2024, 10, 5)),
        mk(8,  "Sofia Chen",           "person-sofia-chen.md",
            "Person",
            "---\ntype: Person\naliases:\n  - \"[[Sofia Chen]]\"\ntier: 2nd\n---\n\n# Sofia Chen\n\nLeads engineering quality and test infrastructure.\n",
            (2024, 11, 1)),
        mk(9,  "James Okafor",         "person-james-okafor.md",
            "Person",
            "---\ntype: Person\naliases:\n  - \"[[James Okafor]]\"\ntier: 2nd\n---\n\n# James Okafor\n\nOwns internationalisation and accessibility.\n",
            (2024, 11, 1)),
        mk(10, "Alex Kim",             "person-alex-kim.md",
            "Person",
            "---\ntype: Person\naliases:\n  - \"[[Alex Kim]]\"\ntier: 2nd\n---\n\n# Alex Kim\n\nLeads the design system and visual language.\n",
            (2024, 11, 2)),

        // ── Quarters (11-13) ────────────────────────────────────────────────
        mk(11, "2024 Q4",              "24q4.md",
            "Quarter",
            "---\ntype: Quarter\n---\n\n# 2024 Q4\n\nFourth quarter 2024 — spike and proof-of-concept phase.\n",
            (2024, 10, 1)),
        mk(12, "2025 Q1",              "25q1.md",
            "Quarter",
            "---\ntype: Quarter\n---\n\n# 2025 Q1\n\nFirst quarter 2025 — initial usable release.\n",
            (2025, 1, 1)),
        mk(13, "2025 Q2",              "25q2.md",
            "Quarter",
            "---\ntype: Quarter\n---\n\n# 2025 Q2\n\nSecond quarter 2025 — feature-complete v2 release.\n",
            (2025, 4, 1)),

        // ── Projects (14-16) ────────────────────────────────────────────────
        mk(14, "Start Laputa App Project", "24q4-laputa-start.md",
            "Project",
            "---\ntype: Project\naliases:\n  - \"[[Start Laputa App Project]]\"\nbelongs_to: \"[[24q4]]\"\nowner: \"[[person-luca-rossi]]\"\nstatus: Done\n---\n\n# Start Laputa App Project\n\nThe original spike that proved Tolaria could read a markdown vault, render note metadata, and support keyboard-first navigation.\n\n- Set the initial four-panel layout.\n- Proved the note list, editor, and inspector could coexist in one flow.\n- Led directly into [[25q1-laputa-v1]].\n",
            (2024, 10, 10)),
        mk(15, "Laputa App V1",        "25q1-laputa-v1.md",
            "Project",
            "---\ntype: Project\naliases:\n  - \"[[Laputa App V1]]\"\nbelongs_to: \"[[25q1]]\"\nowner: \"[[person-luca-rossi]]\"\nstatus: Done\n---\n\n# Laputa App V1\n\nThe first usable release for daily browsing, quick open, and note-property editing.\n\n- Shipped the working command palette.\n- Made the inspector practical for real frontmatter editing.\n- Captured enough confidence to continue with [[25q2-laputa-v2]].\n",
            (2025, 1, 15)),
        mk(16, "Laputa App V2",        "25q2-laputa-v2.md",
            "Project",
            "---\ntype: Project\naliases:\n  - \"[[Laputa App V2]]\"\nbelongs_to: \"[[25q2]]\"\nowner: \"[[person-luca-rossi]]\"\nstatus: In Progress\n---\n\n# Laputa App V2\n\nShips wikilink autocomplete, live inspector, and the full command-palette action set.\n\n- Native GPUI chrome replaces Tauri shell.\n- TODO: finalise dock layout and Phase 3 service wiring.\n",
            (2025, 4, 5)),

        // ── Measures (17-19) ────────────────────────────────────────────────
        mk(17, "Sponsorship Close Rate", "measure-close-rate.md",
            "Measure",
            "---\ntype: Measure\naliases:\n  - \"[[Sponsorship Close Rate]]\"\nbelongs_to: \"[[responsibility-sponsorships]]\"\nunit: percent\n---\n\n# Sponsorship Close Rate\n\nTracks how many qualified sponsor conversations become signed deals.\n",
            (2024, 11, 10)),
        mk(18, "Sponsorship MRR",      "measure-sponsorship-mrr.md",
            "Measure",
            "---\ntype: Measure\naliases:\n  - \"[[Sponsorship MRR]]\"\nbelongs_to: \"[[responsibility-sponsorships]]\"\nunit: USD\n---\n\n# Sponsorship MRR\n\nMonthly recurring revenue from active sponsors.\n",
            (2024, 11, 10)),
        mk(19, "Test Coverage",        "measure-test-coverage.md",
            "Measure",
            "---\ntype: Measure\naliases:\n  - \"[[Test Coverage]]\"\nbelongs_to: \"[[topic-engineering]]\"\nunit: percent\n---\n\n# Test Coverage\n\nTracks frontend (≥70 %) and Rust line coverage (≥85 %) percentages.\n",
            (2025, 1, 20)),

        // ── Procedures (20-23) ──────────────────────────────────────────────
        mk(20, "Quarterly Sponsor Outreach", "procedure-quarterly-sponsor-outreach.md",
            "Procedure",
            "---\ntype: Procedure\naliases:\n  - \"[[Quarterly Sponsor Outreach]]\"\nbelongs_to: \"[[responsibility-sponsorships]]\"\nowner: \"[[person-matteo-cellini]]\"\ncadence: Quarterly\n---\n\n# Quarterly Sponsor Outreach\n\nReview the pipeline, choose the next target companies, and send a fresh outreach batch each quarter.\n\n- Start from last quarter's warm leads.\n- Share the shortlist with [[person-matteo-cellini]] before sending outreach.\n",
            (2024, 10, 15)),
        mk(21, "Sponsor Onboarding",   "procedure-sponsor-onboarding.md",
            "Procedure",
            "---\ntype: Procedure\naliases:\n  - \"[[Sponsor Onboarding]]\"\nbelongs_to: \"[[responsibility-sponsorships]]\"\nowner: \"[[person-matteo-cellini]]\"\n---\n\n# Sponsor Onboarding\n\nOnboard a new sponsor after the contract is signed.\n\n- Send the welcome kit and invoice.\n- Schedule the kick-off call.\n",
            (2024, 10, 15)),
        mk(22, "Release Checklist",    "procedure-release-checklist.md",
            "Procedure",
            "---\ntype: Procedure\naliases:\n  - \"[[Release Checklist]]\"\nbelongs_to: \"[[topic-engineering]]\"\n---\n\n# Release Checklist\n\nSteps to validate a release before publishing.\n\n- Run full test suite and check CodeScene gate.\n- Verify Codacy has no new Critical/High findings.\n- Tag the release commit and push.\n",
            (2025, 2, 1)),
        mk(23, "Incident Response",    "procedure-incident-response.md",
            "Procedure",
            "---\ntype: Procedure\naliases:\n  - \"[[Incident Response]]\"\nbelongs_to: \"[[topic-engineering]]\"\n---\n\n# Incident Response\n\nSteps to follow when a production incident is detected.\n\n- Page the on-call engineer.\n- Open an incident channel and post a status update.\n- Run the post-mortem within 48 hours.\n",
            (2025, 2, 1)),

        // ── Responsibility (24) ─────────────────────────────────────────────
        mk(24, "Sponsorships",         "responsibility-sponsorships.md",
            "Responsibility",
            "---\ntype: Responsibility\naliases:\n  - \"[[Sponsorships]]\"\n---\n\n# Sponsorships\n\nOwns the Laputa sponsorship pipeline end-to-end.\n\n- [[procedure-quarterly-sponsor-outreach]]\n- [[procedure-sponsor-onboarding]]\n",
            (2024, 10, 1)),

        // ── Areas (25-26) ───────────────────────────────────────────────────
        mk(25, "Building",             "area-building.md",
            "Area",
            "---\ntype: Area\naliases:\n  - \"[[Building]]\"\n---\n\n# Building\n\nPhysical office and coworking space management.\n",
            (2024, 10, 1)),
        mk(26, "Developer Experience", "area-developer-experience.md",
            "Area",
            "---\ntype: Area\naliases:\n  - \"[[Developer Experience]]\"\n---\n\n# Developer Experience\n\nTooling, onboarding, and developer productivity.\n",
            (2025, 1, 5)),

        // ── Event (27) ──────────────────────────────────────────────────────
        mk(27, "Team Sync 2025-01-13", "event-team-sync-2025-01-13.md",
            "Event",
            "---\ntype: Event\ndate: 2025-01-13\n---\n\n# Team Sync 2025-01-13\n\nWeekly team sync covering Q1 kickoff and project assignments.\n\n- [[25q1-laputa-v1]] handed off to [[person-luca-rossi]].\n- Sponsorship targets reviewed by [[person-matteo-cellini]].\n",
            (2025, 1, 13)),

        // ── Reference (28) ──────────────────────────────────────────────────
        mk(28, "Laputa QA Reference",  "laputa-qa-reference.md",
            "Reference",
            "---\ntype: Reference\n---\n\n# Laputa QA Reference\n\nReference guide for QA scripts and native testing procedures.\n",
            (2025, 3, 1)),

        // ── Notes (29-30) ───────────────────────────────────────────────────
        mk(29, "Note on Clear Prose",  "note-on-clear-prose.md",
            "Note",
            "---\ntype: Note\n---\n\n# Note on Clear Prose\n\nWriting clearly means writing to be understood, not to be admired.\n\nCut every word that does not carry weight.\n",
            (2025, 3, 15)),
        mk(30, "RTL Mixed-Direction QA", "rtl-mixed-direction-qa.md",
            "Note",
            "---\ntype: Note\n---\n\n# RTL Mixed-Direction QA\n\nQA checklist for right-to-left and mixed-direction text rendering.\n\n- Verify BiDi algorithm applies correctly in the note editor.\n- Check that the inspector labels don't flip unexpectedly.\n",
            (2025, 4, 20)),
    ]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::TestAppContext;

    #[gpui::test]
    fn seeded_vault_has_30_notes(_cx: &mut TestAppContext) {
        let vault = MockVault::seeded();
        assert_eq!(
            vault.notes.len(),
            30,
            "seeded vault must contain exactly 30 notes"
        );
    }

    #[gpui::test]
    async fn notes_returns_all_ids(_cx: &mut TestAppContext) {
        let vault = MockVault::seeded();
        let ids = vault.notes().await;
        assert_eq!(ids.len(), 30);
        assert!(ids.contains(&NoteId::from_raw(1)));
        assert!(ids.contains(&NoteId::from_raw(30)));
    }

    #[gpui::test]
    async fn note_lookup_returns_correct_title(_cx: &mut TestAppContext) {
        let vault = MockVault::seeded();
        let note = vault
            .note(NoteId::from_raw(1))
            .await
            .expect("note 1 must exist");
        assert_eq!(note.title.as_ref(), "Writing");
    }

    #[gpui::test]
    async fn save_round_trips_through_get(_cx: &mut TestAppContext) {
        let mut vault = MockVault::seeded();
        vault
            .save(NoteId::from_raw(1), "updated content".to_string())
            .await
            .expect("save must succeed for known id");
        let note = vault
            .note(NoteId::from_raw(1))
            .await
            .expect("note must still exist after save");
        assert_eq!(note.content, "updated content");
    }

    #[gpui::test]
    async fn save_returns_error_for_unknown_id(_cx: &mut TestAppContext) {
        let mut vault = MockVault::seeded();
        let result = vault.save(NoteId::from_raw(999), "x".to_string()).await;
        assert!(result.is_err(), "save must fail for unknown id");
    }

    #[gpui::test]
    async fn delete_removes_note(_cx: &mut TestAppContext) {
        let mut vault = MockVault::seeded();
        vault
            .delete(NoteId::from_raw(30))
            .await
            .expect("delete must succeed for known id");
        let ids = vault.notes().await;
        assert_eq!(ids.len(), 29);
        assert!(!ids.contains(&NoteId::from_raw(30)));
    }

    #[gpui::test]
    async fn search_titles_finds_known_match(_cx: &mut TestAppContext) {
        let vault = MockVault::seeded();
        let ids = vault.search_titles("laputa").await;
        // Notes 14, 15, 16 all have "Laputa" in their title.
        assert!(ids.contains(&NoteId::from_raw(14)));
        assert!(ids.contains(&NoteId::from_raw(15)));
        assert!(ids.contains(&NoteId::from_raw(16)));
    }

    #[gpui::test]
    async fn search_titles_is_case_insensitive(_cx: &mut TestAppContext) {
        let vault = MockVault::seeded();
        let lower = vault.search_titles("writing").await;
        let upper = vault.search_titles("WRITING").await;
        assert_eq!(lower, upper);
        assert!(lower.contains(&NoteId::from_raw(1)));
    }

    #[gpui::test]
    async fn search_titles_returns_empty_for_no_match(_cx: &mut TestAppContext) {
        let vault = MockVault::seeded();
        let ids = vault.search_titles("xyzzy").await;
        assert!(ids.is_empty());
    }

    #[gpui::test]
    fn mock_vault_installs_as_global(cx: &mut TestAppContext) {
        cx.update(|cx| {
            cx.set_global(MockVault::seeded());
            assert_eq!(cx.global::<MockVault>().notes.len(), 30);
        });
    }
}
