// ---------------------------------------------------------------------------
// Editor tab-swap state preservation (ADR-0115 Phase 8.30)
// ---------------------------------------------------------------------------
//
// The React reference (`src/hooks/useEditorTabSwap.ts`) is a 1.2 kloc
// orchestrator for vault-aware tab swapping: it parses markdown into
// BlockNote blocks, manages a swap-token queue, threads frontmatter
// through, and serializes the rich editor body on change.  The
// editor-host doesn't need any of that — `dispatchToHost` already
// handles the `note_open` envelope by calling `markdownToBlocks` +
// `replaceDocument`, and the bridge ships note ids, not vault paths.
//
// What the editor-host *does* need is the small slice the React row
// calls "state preservation": when the native shell sends an opening
// envelope for a note we've already seen, restore the BlockNote cursor
// position and scroll offset the user left there.  When it sends one
// for a brand-new note, accept it fresh.  And — critical for
// performance — cap the in-memory state map so an open-everything-in-
// the-vault session doesn't grow unbounded.
//
// This file is a small id-keyed LRU + signal seam.  The
// `signalEditorTabSwapped` helper preserves the React reference's
// `laputa:editor-tab-swapped` custom event so the focus / position-
// sync hooks listen for the same DOM signal.

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";

/** Window event the React reference dispatches when a swap completes.
 *  Kept identical so `useEditorFocus` + `useEditorModePositionSync`
 *  receive the same DOM signal in both apps. */
export const TAB_SWAP_EVENT_NAME = "laputa:editor-tab-swapped";

/** Hard cap on how many note states we keep around.  The React
 *  reference relies on the React Router-style "close to remove from
 *  cache" model; the editor-host has no concept of close, so we drop
 *  the least-recently-touched entry when the map fills up. */
export const DEFAULT_TAB_STATE_LRU_SIZE = 32;

/** Snapshot a caller stashes per note id at swap-out time. */
export interface TabSwapSnapshot {
    /** Active selection anchor (e.g. CodeMirror offset or block id). */
    anchor: unknown;
    /** Active selection head. */
    head: unknown;
    /** Document scroll offset.  Stored as-is so the editor surface can
     *  apply it without per-mode coercion. */
    scrollTop: number;
    /** Optional opaque payload — `useEditorModePositionSync` writes
     *  block-restoration data here. */
    extra?: unknown;
}

interface TabSwapStateMap {
    get(id: number): TabSwapSnapshot | undefined;
    set(id: number, snapshot: TabSwapSnapshot): void;
    drop(id: number): boolean;
    size(): number;
    /** Test seam — read the LRU order (oldest first). */
    keys(): number[];
}

/**
 * Bounded LRU over `(NoteId → TabSwapSnapshot)`.  Insertion order
 * follows the `Map` iteration spec, so re-`set`ting an existing key
 * effectively bumps it to the most-recently-used slot.
 */
export function createTabSwapStateMap(capacity = DEFAULT_TAB_STATE_LRU_SIZE): TabSwapStateMap {
    if (capacity < 1) {
        throw new Error(`createTabSwapStateMap: capacity must be >= 1, got ${capacity}`);
    }
    const map = new Map<number, TabSwapSnapshot>();

    function bumpRecency(id: number, snapshot: TabSwapSnapshot): void {
        map.delete(id);
        map.set(id, snapshot);
    }

    function evictIfOverCapacity(): void {
        while (map.size > capacity) {
            const oldestKey = map.keys().next().value as number | undefined;
            if (oldestKey === undefined) return;
            map.delete(oldestKey);
        }
    }

    return {
        get(id) {
            const snapshot = map.get(id);
            if (snapshot !== undefined) bumpRecency(id, snapshot);
            return snapshot;
        },
        set(id, snapshot) {
            bumpRecency(id, snapshot);
            evictIfOverCapacity();
        },
        drop(id) {
            return map.delete(id);
        },
        size() {
            return map.size;
        },
        keys() {
            return Array.from(map.keys());
        },
    };
}

/** Dispatch the React-reference-compatible swap signal.  Listeners
 *  (focus / position-sync hooks) filter by `detail.path`; the editor-
 *  host has no path at swap time, so we ship the id stringified. */
export function signalEditorTabSwapped(id: number): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
        new CustomEvent(TAB_SWAP_EVENT_NAME, {
            detail: { path: String(id), id },
        }),
    );
}

interface UseEditorTabSwapOptions {
    /** Current note id (or `null` when no note is loaded).  Tracked in
     *  a ref so consumers can call `snapshotOutgoing` synchronously
     *  during a swap. */
    activeIdRef: MutableRefObject<number | null>;
    /** Optional capacity override for the snapshot LRU. */
    capacity?: number;
    /** Capture the current editor state to be stashed for `id`.
     *  Called immediately before the swap.  Returning `null` skips the
     *  stash (e.g. when there is no live surface yet). */
    captureSnapshot?: (id: number) => TabSwapSnapshot | null;
    /** Restore a stashed snapshot when a previously-seen note is
     *  re-opened.  Called *after* the swap completes (and after the
     *  next animation frame so the editor surface has mounted). */
    restoreSnapshot?: (id: number, snapshot: TabSwapSnapshot) => void;
}

/**
 * Tab-swap state preservation seam.
 *
 * Returns:
 * - `recordSwap(nextId)`: invoke with the incoming note id when the
 *   bridge sends `NoteOpen` for a different note than the current
 *   active id.  Captures the outgoing note's snapshot (if any) and
 *   restores the incoming note's previously-stashed snapshot
 *   (if any), then dispatches the `laputa:editor-tab-swapped` event
 *   so focus / position-sync hooks can react.
 * - `dropSnapshot(id)`: invoke when a note id is invalidated (e.g.
 *   delete).  No-op if nothing was stashed.
 * - `getSnapshot(id)`: peek at the stored snapshot (test seam).
 * - `stateMap`: the underlying LRU, exposed for tests so they can
 *   assert eviction behaviour without poking React internals.
 */
export function useEditorTabSwap({
    activeIdRef,
    capacity = DEFAULT_TAB_STATE_LRU_SIZE,
    captureSnapshot,
    restoreSnapshot,
}: UseEditorTabSwapOptions) {
    const stateMapRef = useRef<TabSwapStateMap | null>(null);
    if (stateMapRef.current === null) {
        stateMapRef.current = createTabSwapStateMap(capacity);
    }

    // Capture callbacks via refs so `recordSwap` stays stable for the
    // bridge dispatch wiring that captures it once on mount.
    const captureRef = useRef(captureSnapshot);
    const restoreRef = useRef(restoreSnapshot);
    useEffect(() => {
        captureRef.current = captureSnapshot;
    }, [captureSnapshot]);
    useEffect(() => {
        restoreRef.current = restoreSnapshot;
    }, [restoreSnapshot]);

    const recordSwap = useCallback((nextId: number): void => {
        const map = stateMapRef.current;
        if (!map) return;

        const outgoingId = activeIdRef.current;
        if (outgoingId !== null && outgoingId !== nextId) {
            const snapshot = captureRef.current?.(outgoingId) ?? null;
            if (snapshot !== null) map.set(outgoingId, snapshot);
        }

        const stashed = map.get(nextId) ?? null;
        // Dispatch the swap signal *after* the active id is updated by
        // the caller.  Defer the restore to the next frame so the
        // editor surface has mounted (mirrors the React reference's
        // `signalEditorTabSwapped` timing).
        if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
            signalEditorTabSwapped(nextId);
            if (stashed !== null) restoreRef.current?.(nextId, stashed);
            return;
        }

        window.requestAnimationFrame(() => {
            signalEditorTabSwapped(nextId);
            if (stashed !== null) restoreRef.current?.(nextId, stashed);
        });
    }, [activeIdRef]);

    const dropSnapshot = useCallback((id: number): boolean => {
        return stateMapRef.current?.drop(id) ?? false;
    }, []);

    const getSnapshot = useCallback((id: number): TabSwapSnapshot | undefined => {
        return stateMapRef.current?.get(id);
    }, []);

    return {
        recordSwap,
        dropSnapshot,
        getSnapshot,
        // Test seam.
        stateMap: stateMapRef.current,
    };
}
