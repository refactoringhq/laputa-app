import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BlockNoteEditor } from "@blocknote/core";
import { BlockNoteViewRaw, SuggestionMenuController } from "@blocknote/react";
import { onReceive, send, type ThemeMode, type ToHost } from "./bridge.ts";
import { createEditor } from "./setupEditor.ts";
import { blocksToMarkdown, markdownToBlocks, replaceDocument } from "./richEditorMarkdown.ts";
import { EditorMenus } from "./menus.tsx";
import { attachEditorLinkActivation } from "./linkActivation.ts";
import {
    WIKILINK_MIN_QUERY_LENGTH,
    buildWikilinkGetItems,
} from "./wikilinkSuggestion.ts";
import { useEditorComposing } from "./useEditorComposing.ts";
import { RawEditorView } from "./RawEditorView.tsx";
import { shouldUseRawEditor } from "./rawEditorUtils.ts";

// ---------------------------------------------------------------------------
// Bridge dispatch (pure-logic helper, exported for tests)
// ---------------------------------------------------------------------------

/**
 * Side-effects that a [`ToHost`] message produces on the editor.
 *
 * Factored out so `bridge.test.ts` can drive the same code path the
 * React component uses without rendering a real DOM tree.
 *
 * Phase 8.29 adds raw-mode routing: when a `NoteOpen` envelope lands
 * with a non-markdown path, the dispatch records the path / body in
 * raw state instead of pushing through the BlockNote editor.  The
 * React tree reads that state and mounts either `BlockNoteViewRaw`
 * (markdown) or `RawEditorView` (yaml / json / css / shell / toml /
 * plaintext).
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
    /** Phase 8.29 raw-mode hand-off — invoked on every `NoteOpen` so
     *  the React tree can decide whether to mount BlockNote or the
     *  CodeMirror raw editor based on the file extension.  Pass
     *  `null` to clear (e.g. on a markdown open the raw buffer must
     *  be discarded so the next raw open starts clean). */
    setRawNote(note: RawNoteState | null): void;
    /** Raw-mode buffer read at save time — returns the latest doc
     *  string the CodeMirror editor has flushed to React, or `null`
     *  when the active note is markdown-shaped. */
    getRawBuffer(): string | null;
}

/**
 * Snapshot of a non-markdown note loaded into the raw-mode editor.
 * Carried in React state so component re-renders pick the right
 * editor surface.
 */
export interface RawNoteState {
    id: number;
    path: string;
    body: string;
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
            if (shouldUseRawEditor(msg.v.path)) {
                // Park the raw note in React state; the editor body
                // mounts `<RawEditorView />` against it.  Don't touch
                // the BlockNote editor so a back-and-forth between a
                // `.md` and a `.yaml` doesn't churn its lifecycle.
                handlers.setRawNote({
                    id: msg.v.id,
                    path: msg.v.path,
                    body: msg.v.body,
                });
            } else {
                handlers.setRawNote(null);
                const parsed = markdownToBlocks(editor, msg.v.body);
                replaceDocument(editor, parsed);
            }
            break;
        }
        case "focus_editor": {
            editor.focus();
            break;
        }
        case "save_request": {
            const id = handlers.getActiveId();
            if (id === null) return;
            // Raw note? Read the live CodeMirror buffer; otherwise
            // serialise the BlockNote document to markdown.  Both
            // paths emit the same `Save` envelope so the native
            // shell doesn't need a discriminant.
            const rawBody = handlers.getRawBuffer();
            const body = rawBody ?? blocksToMarkdown(editor);
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
 * - The editor container ref consumed by `attachEditorLinkActivation`
 *   so Cmd+click on a wikilink / URL routes through the bridge.
 *
 * Phase 8.27–8.30 hang IME / lifecycle hooks off this component.
 * Keep state additions in the existing module shape: editor
 * construction in `setupEditor.ts`, markdown helpers in
 * `richEditorMarkdown.ts`, dispatch logic in `dispatchToHost`,
 * wikilink suggestion machinery in `wikilinkSuggestion.ts`, link
 * activation in `linkActivation.ts`.
 */
export function EditorApp() {
    // Editor lifecycle is *deliberately* independent of prop changes
    // — re-creating the editor would lose cursor / history state every
    // time React re-renders.  See 8.30 for a planned tab-swap-aware
    // lifecycle reset.
    const editor = useMemo(() => createEditor(), []);
    const [theme, setTheme] = useState<ThemeMode>("light");
    const [rawNote, setRawNote] = useState<RawNoteState | null>(null);
    const activeIdRef = useRef<number | null>(null);
    const dirtyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dirtyAnnouncedForIdRef = useRef<number | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    // Raw-mode latest-content mirror.  The CodeMirror view updates this
    // every keystroke through `latestContentRef`; the bridge reads it
    // on `save_request`.  Kept as a ref instead of state so the save
    // path doesn't suffer a re-render of the (potentially-large) doc.
    const rawBufferRef = useRef<string | null>(null);

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
            setRawNote(note) {
                // Reset the latest-content mirror so a fresh open or a
                // markdown-driven clear doesn't accidentally save the
                // previous raw buffer.
                rawBufferRef.current = note?.body ?? null;
                setRawNote(note);
            },
            getRawBuffer() {
                return rawBufferRef.current;
            },
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

    // Install link-activation listeners on the editor container.
    // Cmd+click on a wikilink span or anchor posts
    // `FromHost::LinkClick { target }` over the bridge; the native
    // shell handles wikilink lookup / URL routing.  Cleanup runs on
    // unmount so StrictMode double-mount doesn't leak listeners.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        return attachEditorLinkActivation(container);
    }, []);

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

    // IME composition tracking (Phase 8.27).  The hook installs
    // capture-phase listeners on `document` so composition events
    // from any descendant of the editor element register, then exposes
    // an `isComposing` flag.  We surface the flag on the wrapper
    // `data-` attribute so menus / future shortcut handlers can read
    // it without prop-drilling through the menu controllers.
    //
    // The IME *key* guard (Enter-during-composition) is wired as a
    // BlockNote extension in `setupEditor.ts`; this hook is the
    // higher-level state signal used by the React side.
    const isComposing = useEditorComposing(editor);

    // Wikilink suggestion menu (Phase 8.26).  Stable `getItems`
    // closure for the editor's lifetime — the underlying provider
    // currently returns an empty list because the native bridge does
    // not yet expose `FromHost::WikilinkQuery` /
    // `ToHost::WikilinkSuggestions` (TODO 8.26-bridge).  The menu
    // surface still opens on `[[` so 8.27+ regressions don't have to
    // re-add the controller.
    const getWikilinkItems = useMemo(
        () => buildWikilinkGetItems(editor),
        [editor],
    );

    // Raw-mode change handler — debounce `Dirty` the same way the
    // BlockNote subscription does, and keep the latest-content mirror
    // current so `save_request` can ship the live buffer.
    const handleRawContentChange = useCallback((_path: string, body: string): void => {
        rawBufferRef.current = body;
        const id = activeIdRef.current;
        if (id === null) return;
        cancelDirty();
        dirtyTimerRef.current = setTimeout(() => {
            dirtyTimerRef.current = null;
            if (activeIdRef.current !== id) return;
            if (dirtyAnnouncedForIdRef.current === id) return;
            dirtyAnnouncedForIdRef.current = id;
            send({ k: "dirty", v: { id } });
        }, DIRTY_DEBOUNCE_MS);
    }, []);

    // Raw-mode `Cmd+S` handler — flushes the current buffer to a
    // `Save` envelope.  Mirrors the `save_request` branch in
    // `dispatchToHost` so the native shell only ever sees one
    // envelope shape.
    const handleRawSave = useCallback((): void => {
        const id = activeIdRef.current;
        if (id === null) return;
        const body = rawBufferRef.current;
        if (body === null) return;
        send({ k: "save", v: { id, body } });
    }, []);

    return (
        // The wrapper div hosts the link-activation listeners and
        // gives 8.28+ a natural seat for image-drop / lightbox /
        // copy-target overlays.  Sized to fill the WKWebView via the
        // existing `style.css` rules.
        //
        // Phase 8.29 routes between two editor surfaces — BlockNote
        // (rich markdown) and `RawEditorView` (CodeMirror raw-text).
        // The choice is driven by `rawNote`, which the bridge sets on
        // every `NoteOpen` via `shouldUseRawEditor(path)`.  Both
        // surfaces share the same outer container so theme + IME +
        // link activation cascade uniformly; only one is mounted at
        // a time.
        <div
            ref={containerRef}
            className="editor-host-container"
            data-composing={isComposing ? "true" : "false"}
            data-mode={rawNote ? "raw" : "rich"}
        >
            {rawNote ? (
                <RawEditorView
                    content={rawNote.body}
                    path={rawNote.path}
                    onContentChange={handleRawContentChange}
                    onSave={handleRawSave}
                    latestContentRef={rawBufferRef}
                />
            ) : (
                <BlockNoteViewRaw
                    editor={editor}
                    theme={theme}
                    // Default menu surfaces are *disabled* on the host —
                    // `EditorMenus` mounts the three controllers explicitly
                    // so we can attach the hover guards (see `menus.tsx`).
                    // Link toolbar / file panel / table handles / emoji
                    // picker / comments stay off until later rows wire
                    // them.
                    formattingToolbar={false}
                    linkToolbar={false}
                    slashMenu={false}
                    sideMenu={false}
                    filePanel={false}
                    tableHandles={false}
                    emojiPicker={false}
                    comments={false}
                >
                    <EditorMenus editor={editor} />
                    <SuggestionMenuController
                        triggerCharacter="[["
                        getItems={getWikilinkItems}
                        minQueryLength={WIKILINK_MIN_QUERY_LENGTH}
                    />
                </BlockNoteViewRaw>
            )}
        </div>
    );
}
