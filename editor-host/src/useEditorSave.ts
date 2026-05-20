// ---------------------------------------------------------------------------
// Editor save lifecycle hook (ADR-0115 Phase 8.30)
// ---------------------------------------------------------------------------
//
// The React-side `useEditorSave` is tightly coupled to the Tauri vault
// (`invoke('save_note_content', ...)`, frontmatter parsing, toast i18n,
// scope validation, `setTabs`).  The editor-host has no vault — it
// pushes a `FromHost::Save { id, body }` envelope and lets the native
// shell persist through `vault::Vault`.  This adapter preserves the
// *external contract* of the React hook (debounced auto-save, immediate
// Cmd+S flush, `handleContentChange` + `handleSave` API) but routes
// every persistence call through a caller-supplied `persistSave` thunk
// — in the editor-host the thunk just emits the bridge envelope.
//
// What stayed:
// - Pending-content ref keyed by `(id, body)`.
// - 1.5 s auto-save debounce (`AUTO_SAVE_DEBOUNCE_MS`).
// - `handleSave` flushes pending immediately and resolves to `true` when
//   the buffer was dirty.
// - `cancelAutoSave` cleanup on unmount.
//
// What changed (vs React reference):
// - Keys are `NoteId`s (numbers), not vault paths.  The bridge already
//   ships ids, so the rename-vs-content-change ambiguity that drives
//   the React `resolvePath` / `resolvePathBeforeSave` machinery does
//   not exist here.
// - No `setTabs` / `setToastMessage` / `updateVaultContent` /
//   `canPersist` / `persistenceScope`.  Toast surfaces live above the
//   bridge boundary, and the editor-host is always allowed to push a
//   save envelope (the native shell decides what to do with it).
// - No frontmatter / wikilink syncing (those land in
//   `useEditorSaveWithLinks`).

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";

export const AUTO_SAVE_DEBOUNCE_MS = 1_500;

/** Per-id pending buffer awaiting persistence. */
export interface PendingContent {
    id: number;
    body: string;
}

/** Callable thunk that persists a buffer.  Returns a promise so the
 *  hook can await failure handling on the immediate-save path. */
export type PersistSave = (id: number, body: string) => void | Promise<void>;

interface UseEditorSaveOptions {
    /** Persistence sink — in the editor-host this is the bridge
     *  `send({ k: "save", v: { id, body } })` call. */
    persistSave: PersistSave;
    /** Optional callback invoked after every successful flush.
     *  Mirrors the React reference's `onAfterSave`. */
    onAfterSave?: () => void;
    /** Auto-save debounce override (tests / future tuning). */
    autoSaveDebounceMs?: number;
}

interface PendingFlushContext {
    pendingContentRef: MutableRefObject<PendingContent | null>;
    persistSaveRef: MutableRefObject<PersistSave>;
}

async function flushPendingContent(
    ctx: PendingFlushContext,
    idFilter?: number,
): Promise<boolean> {
    const pending = ctx.pendingContentRef.current;
    if (!pending) return false;
    if (idFilter !== undefined && pending.id !== idFilter) return false;
    // Clear *before* awaiting so a re-entrant change handler can
    // queue a fresh pending record while the persist call is in flight.
    ctx.pendingContentRef.current = null;
    await ctx.persistSaveRef.current(pending.id, pending.body);
    return true;
}

function useLatestRef<T>(value: T): MutableRefObject<T> {
    const ref = useRef(value);
    useEffect(() => {
        ref.current = value;
    }, [value]);
    return ref;
}

/**
 * Save lifecycle for the editor-host.
 *
 * - `handleContentChange(id, body)`: caller invokes on every keystroke.
 *   Stores the latest body in a per-id pending slot and arms a
 *   debounced flush.  No-op (other than ref bookkeeping) if the same
 *   `(id, body)` is recorded twice.
 * - `handleSave()`: flushes the pending slot immediately.  Returns
 *   `true` if anything was persisted, `false` otherwise.
 * - `savePendingForId(id)`: targeted flush — used by 8.30 tab-swap to
 *   persist the outgoing note before switching.
 * - `cancelAutoSave()`: cancels any armed timer.  Called automatically
 *   on unmount and on every immediate save.
 */
export function useEditorSave({
    persistSave,
    onAfterSave,
    autoSaveDebounceMs = AUTO_SAVE_DEBOUNCE_MS,
}: UseEditorSaveOptions) {
    const pendingContentRef = useRef<PendingContent | null>(null);
    const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const persistSaveRef = useLatestRef(persistSave);
    const onAfterSaveRef = useLatestRef(onAfterSave);

    const cancelAutoSave = useCallback(() => {
        if (autoSaveTimerRef.current === null) return;
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
    }, []);

    // Cleanup the auto-save timer on unmount so React StrictMode +
    // editor-host hot reload don't leak setTimeout handles.
    useEffect(() => cancelAutoSave, [cancelAutoSave]);

    const flushPending = useCallback(
        (idFilter?: number) =>
            flushPendingContent({ pendingContentRef, persistSaveRef }, idFilter),
        [persistSaveRef],
    );

    const scheduleAutoSave = useCallback(() => {
        autoSaveTimerRef.current = setTimeout(() => {
            autoSaveTimerRef.current = null;
            void flushPending().then((saved) => {
                if (saved) onAfterSaveRef.current?.();
            }).catch((err) => {
                // Auto-save failures stay non-fatal: the editor stays
                // dirty and the next change or Cmd+S retries.
                console.error("[editor-host:save] auto-save failed", err);
            });
        }, autoSaveDebounceMs);
    }, [autoSaveDebounceMs, flushPending, onAfterSaveRef]);

    const handleContentChange = useCallback(
        (id: number, body: string): void => {
            const existing = pendingContentRef.current;
            if (existing?.id === id && existing.body === body) {
                // Idempotent — same body recorded twice (e.g. on focus
                // restoration).  Don't re-arm the timer.
                return;
            }
            pendingContentRef.current = { id, body };
            cancelAutoSave();
            scheduleAutoSave();
        },
        [cancelAutoSave, scheduleAutoSave],
    );

    const handleSave = useCallback(async (): Promise<boolean> => {
        cancelAutoSave();
        const saved = await flushPending();
        if (saved) onAfterSaveRef.current?.();
        return saved;
    }, [cancelAutoSave, flushPending, onAfterSaveRef]);

    const savePendingForId = useCallback(
        async (id: number): Promise<boolean> => {
            cancelAutoSave();
            const saved = await flushPending(id);
            if (saved) onAfterSaveRef.current?.();
            return saved;
        },
        [cancelAutoSave, flushPending, onAfterSaveRef],
    );

    return {
        handleContentChange,
        handleSave,
        savePendingForId,
        cancelAutoSave,
        // Expose the ref so 8.30 tab-swap can inspect / drop the pending
        // slot when navigation invalidates a buffered change.
        pendingContentRef,
    };
}
