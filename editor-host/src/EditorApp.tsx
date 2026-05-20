import { useEffect, useMemo, useRef, useState } from "react";
import type { BlockNoteEditor } from "@blocknote/core";
import { BlockNoteViewRaw } from "@blocknote/react";
import { onReceive, send, type ThemeMode, type ToHost } from "./bridge.ts";
import { createEditor } from "./setupEditor.ts";
import { blocksToMarkdown, markdownToBlocks, replaceDocument } from "./richEditorMarkdown.ts";

// ---------------------------------------------------------------------------
// Bridge dispatch (pure-logic helper, exported for tests)
// ---------------------------------------------------------------------------

/**
 * Side-effects that a [`ToHost`] message produces on the editor.
 *
 * Factored out so `bridge.test.ts` can drive the same code path the
 * React component uses without rendering a real DOM tree.
 */
export interface EditorBridgeHandlers {
    /** Set the active note id; used by debounced `Dirty` / `Save`. */
    setActiveId(id: number | null): void;
    /** Active note id, read at send time. */
    getActiveId(): number | null;
    /** Set the rendered theme mode. */
    setTheme(mode: ThemeMode): void;
    /** Cancel any in-flight debounced dirty notification. */
    cancelDirty(): void;
}

/**
 * Dispatch a single [`ToHost`] envelope onto the editor + side-effect
 * sinks.  Exhaustive `switch` over the envelope discriminants — the
 * TypeScript compiler treats a future variant as a type error here, so
 * the dispatch loop can never silently drop a new message kind.
 */
export function dispatchToHost(
    editor: BlockNoteEditor,
    msg: ToHost,
    handlers: EditorBridgeHandlers,
): void {
    switch (msg.k) {
        case "note_open": {
            // A fresh NoteOpen invalidates any pending dirty timer —
            // the next change must be associated with the *new* id.
            handlers.cancelDirty();
            handlers.setActiveId(msg.v.id);
            const parsed = markdownToBlocks(editor, msg.v.body);
            replaceDocument(editor, parsed);
            break;
        }
        case "focus_editor": {
            editor.focus();
            break;
        }
        case "save_request": {
            const id = handlers.getActiveId();
            if (id === null) return;
            const body = blocksToMarkdown(editor);
            // `Saved` vs `Save` discrimination would require a clean-body
            // ledger; for 8.24 we always emit `Save` (matches the React
            // app's "every save is a write" semantics). Cheap dirty
            // tracking lands in 8.30 (lifecycle hooks).
            send({ k: "save", v: { id, body } });
            break;
        }
        case "theme_set": {
            handlers.setTheme(msg.v.mode);
            break;
        }
    }
}

// ---------------------------------------------------------------------------
// React mount
// ---------------------------------------------------------------------------

/** Debounce window for `Dirty` notifications.  Mirrors the React-side
 *  auto-save debounce; tight enough that the status bar lights up
 *  responsively, loose enough that fast typists don't spam IPC. */
const DIRTY_DEBOUNCE_MS = 150;

/**
 * Top-level React component for the editor host.
 *
 * Owns:
 * - The single BlockNoteEditor instance (constructed once via
 *   `createEditor`).
 * - The active note id (kept in a ref so `onChange` doesn't capture
 *   stale closures across `NoteOpen` swaps).
 * - The theme state (drives the `theme` prop on `BlockNoteViewRaw`).
 * - The bridge handler installed on `window.tolariaBridge.receive`.
 *
 * Phase 8.25–8.30 hang menus / wikilinks / IME / lifecycle hooks off
 * this component.  Keep state additions in the existing module shape:
 * editor construction in `setupEditor.ts`, markdown helpers in
 * `richEditorMarkdown.ts`, dispatch logic in `dispatchToHost`.
 */
export function EditorApp() {
    // Editor lifecycle is *deliberately* independent of prop changes
    // — re-creating the editor would lose cursor / history state every
    // time React re-renders.  See 8.30 for a planned tab-swap-aware
    // lifecycle reset.
    const editor = useMemo(() => createEditor(), []);
    const [theme, setTheme] = useState<ThemeMode>("light");
    const activeIdRef = useRef<number | null>(null);
    const dirtyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dirtyAnnouncedForIdRef = useRef<number | null>(null);

    const cancelDirty = (): void => {
        if (dirtyTimerRef.current !== null) {
            clearTimeout(dirtyTimerRef.current);
            dirtyTimerRef.current = null;
        }
    };

    const handlers = useMemo<EditorBridgeHandlers>(
        () => ({
            setActiveId(id) {
                activeIdRef.current = id;
                dirtyAnnouncedForIdRef.current = null;
            },
            getActiveId() {
                return activeIdRef.current;
            },
            setTheme,
            cancelDirty,
        }),
        [],
    );

    // Theme also mirrored onto `document.documentElement.dataset.theme`
    // so background CSS variables in `style.css` flip in lockstep with
    // the BlockNote-internal `theme` prop.
    useEffect(() => {
        document.documentElement.dataset.theme = theme;
    }, [theme]);

    // Install bridge receive handler.  Only runs once — the handler
    // closure captures stable refs / handlers so re-installing on every
    // render would just churn `window.tolariaBridge`.
    useEffect(() => {
        onReceive((msg: ToHost) => dispatchToHost(editor, msg, handlers));
    }, [editor, handlers]);

    // Wire the BlockNote `onChange` -> debounced `Dirty`.  Subscribe in
    // an effect so the subscription tears down with the component (and
    // so React StrictMode double-mount doesn't leak two listeners).
    useEffect(() => {
        const unsubscribe = editor.onChange(() => {
            const id = activeIdRef.current;
            if (id === null) return;
            // Coalesce rapid edits — `Dirty` is purely a UI signal, the
            // native side debounces its own state on top of this.
            cancelDirty();
            dirtyTimerRef.current = setTimeout(() => {
                dirtyTimerRef.current = null;
                if (activeIdRef.current !== id) return;
                if (dirtyAnnouncedForIdRef.current === id) return;
                dirtyAnnouncedForIdRef.current = id;
                send({ k: "dirty", v: { id } });
            }, DIRTY_DEBOUNCE_MS);
        });
        return () => {
            cancelDirty();
            unsubscribe?.();
        };
    }, [editor]);

    return (
        <BlockNoteViewRaw
            editor={editor}
            theme={theme}
            // 8.25 will replace these with real menus.  Disable for
            // 8.24 so the bare mount doesn't render unstyled floating
            // popovers (the default UI assumes Mantine).
            formattingToolbar={false}
            linkToolbar={false}
            slashMenu={false}
            sideMenu={false}
            filePanel={false}
            tableHandles={false}
            emojiPicker={false}
            comments={false}
        />
    );
}
