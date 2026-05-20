// ---------------------------------------------------------------------------
// Editor save with rename-ripple (ADR-0115 Phase 8.30, STUB)
// ---------------------------------------------------------------------------
//
// The React reference (`src/hooks/useEditorSaveWithLinks.ts`) wraps
// `useEditorSave` with three side-effects that depend on vault entries:
//
// 1. `extractOutgoingLinks` → `updateEntry(path, { outgoingLinks })` so
//    the backlink graph stays current.
// 2. Frontmatter sync (`detectFrontmatterState`,
//    `deriveRawEditorEntryState`) → `updateEntry(path, { ... })`.
// 3. Display-title sync (`deriveDisplayTitleState`).
//
// The native shell owns the vault graph, so all three side-effects must
// happen *outside* the WKWebView once a save lands.  That requires two
// new bridge envelopes:
//
//   ToHost::RenameReady   { id, new_path }     (native ⇒ host, ack)
//   FromHost::RenameRequest { id, new_path }  (host ⇒ native)
//
// **Audit result (Phase 8.30):** neither variant exists in
// `crates/editor_bridge/src/lib.rs` today.  The roadmap explicitly
// forbids adding bridge variants on this row, so the rename-ripple
// hook ships as a thin pass-through over `useEditorSave` with a
// `TODO(rename-bridge)` marker.  When the bridge gains the variants
// (Phase 9 or later), this file is the single seam to wire them in.
//
// Behavioural contract preserved:
// - Returns the same shape as `useEditorSave` (`handleContentChange`,
//   `handleSave`, `savePendingForId`, `cancelAutoSave`,
//   `pendingContentRef`).
// - Accepts an `onLinksChanged` callback so a future bridge variant
//   doesn't require a fresh public API.

import { useCallback, useRef } from "react";
import { useEditorSave } from "./useEditorSave.ts";

export interface OutgoingLinksChange {
    id: number;
    body: string;
    /** Wikilink targets present in the latest body.  Captured here so
     *  whoever wires the rename-ripple bridge in Phase 9+ can ship the
     *  list down without re-parsing.  Today the parser is `null`
     *  because the editor-host does not own a wikilink scanner — that
     *  ships with the rename-ripple bridge envelope itself. */
    links: string[] | null;
}

interface UseEditorSaveWithLinksOptions {
    persistSave: Parameters<typeof useEditorSave>[0]["persistSave"];
    onAfterSave?: () => void;
    /** Fires on every persisted save.  No-op stub today; will receive
     *  the wikilink graph delta once the rename-ripple bridge variant
     *  exists.
     *
     *  TODO(rename-bridge): replace the `links: null` payload with the
     *  scanned outgoing-link list once a `FromHost::RenameRequest`
     *  envelope is added to `editor_bridge`. */
    onLinksChanged?: (change: OutgoingLinksChange) => void;
}

/**
 * Save lifecycle + rename-ripple seam.
 *
 * Today this is a thin shim over [`useEditorSave`] that wires an
 * `onLinksChanged` callback into the save flow.  When the editor-host
 * grows a rename-ripple bridge variant the wikilink scanning, snippet
 * extraction, and frontmatter / display-title side-effects from the
 * React reference will land here without changing the public API.
 */
export function useEditorSaveWithLinks({
    persistSave,
    onAfterSave,
    onLinksChanged,
}: UseEditorSaveWithLinksOptions) {
    const onLinksChangedRef = useRef(onLinksChanged);
    onLinksChangedRef.current = onLinksChanged;

    const wrappedPersistSave = useCallback(
        async (id: number, body: string): Promise<void> => {
            await persistSave(id, body);
            // Fire the link-changed seam *after* the persist call so
            // observers see the saved state, not the buffered one.
            onLinksChangedRef.current?.({ id, body, links: null });
        },
        [persistSave],
    );

    return useEditorSave({ persistSave: wrappedPersistSave, onAfterSave });
}
