import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BlockNoteEditor } from "@blocknote/core";
import { BlockNoteViewRaw, SuggestionMenuController } from "@blocknote/react";
import { onReceive, send, type ThemeMode, type ToHost } from "./bridge.ts";
import { createEditor } from "./setupEditor.ts";
import { blocksToMarkdown, markdownToBlocks, replaceDocument } from "./richEditorMarkdown.ts";
import { splitFrontmatter } from "./frontmatter.ts";
import { EditorMenus } from "./menus.tsx";
import { attachEditorLinkActivation } from "./linkActivation.ts";
import {
    WIKILINK_MIN_QUERY_LENGTH,
    buildWikilinkGetItems,
} from "./wikilinkSuggestion.ts";
import { useEditorComposing } from "./useEditorComposing.ts";
import { RawEditorView } from "./RawEditorView.tsx";
import { shouldUseRawEditor } from "./rawEditorUtils.ts";
import { useEditorSave } from "./useEditorSave.ts";
import { useEditorTabSwap, type TabSwapSnapshot } from "./useEditorTabSwap.ts";
import { useEditorFocus } from "./useEditorFocus.ts";
import { useEditorMemoryProbeController } from "./useEditorMemoryProbeController.ts";
import {
    captureRawCodeMirrorRestoreState,
    captureRichEditorPositionSnapshot,
    type CodeMirrorRestoreState,
    type RichEditorPositionSnapshot,
    restoreCodeMirrorView,
} from "./editorModePosition.ts";
import {
    createEditorModeRestoreTransition,
    useEditorModePositionSync,
} from "./useEditorModePositionSync.ts";

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
    /** Stash the frontmatter prefix from the current note so a
     *  subsequent `save_request` can prepend it byte-for-byte and
     *  avoid BlockNote's lossy YAML reformat (worklist 2.26). */
    setFrontmatter(prefix: string): void;
    /** Read the stashed frontmatter prefix at save time. */
    getFrontmatter(): string;
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
                // Peel YAML frontmatter off before handing the body to
                // BlockNote — the parser/serialiser pair is lossy on
                // YAML and would reformat the block as paragraph text
                // on save.  We stash the original prefix and prepend
                // it back on `save_request` (worklist 2.26).  Raw-mode
                // notes ship the buffer as-is, so this branch is the
                // only one that needs the split.
                const [frontmatter, body] = splitFrontmatter(msg.v.body);
                handlers.setFrontmatter(frontmatter);
                const parsed = markdownToBlocks(editor, body);
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
            // Markdown notes prepend the stashed YAML prefix (worklist
            // 2.26) so the frontmatter block survives byte-for-byte;
            // raw notes already ship the original buffer untouched.
            const body =
                rawBody ?? `${handlers.getFrontmatter()}${blocksToMarkdown(editor)}`;
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
    // time React re-renders.  The 8.30 tab-swap snapshot LRU handles
    // selection / scroll preservation across `NoteOpen` envelopes
    // without recreating the editor instance.
    const editor = useMemo(() => createEditor(), []);
    const [theme, setTheme] = useState<ThemeMode>("light");
    const [rawNote, setRawNote] = useState<RawNoteState | null>(null);
    const activeIdRef = useRef<number | null>(null);
    const dirtyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dirtyAnnouncedForIdRef = useRef<number | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const editorMountedRef = useRef(true);
    // Raw-mode latest-content mirror.  The CodeMirror view updates this
    // every keystroke through `latestContentRef`; the bridge reads it
    // on `save_request`.  Kept as a ref instead of state so the save
    // path doesn't suffer a re-render of the (potentially-large) doc.
    const rawBufferRef = useRef<string | null>(null);
    // Stashed YAML frontmatter prefix from the current markdown note.
    // Set on every `note_open` (markdown branch) by `splitFrontmatter`
    // and prepended back on `save_request` so the on-disk YAML
    // survives BlockNote's lossy round-trip (worklist 2.26).  Empty
    // string when the note has no frontmatter.  A ref (not state) so
    // the save path doesn't churn through React for a non-rendered
    // value.
    const frontmatterRef = useRef<string>("");
    // Tracks the raw-vs-rich mode of the *previous* note so the
    // position-sync hook can capture the outgoing snapshot on the
    // correct surface during a mode flip.
    const previousRawModeRef = useRef<boolean>(false);
    const restoreTransitionRef = useRef(createEditorModeRestoreTransition());

    const cancelDirty = (): void => {
        if (dirtyTimerRef.current !== null) {
            clearTimeout(dirtyTimerRef.current);
            dirtyTimerRef.current = null;
        }
    };

    // ----------------------------------------------------------------
    // Save lifecycle (Phase 8.30) — delegated to `useEditorSave`.
    // The bridge handler still owns the `save_request` envelope, but
    // the actual persist call now flows through one canonical path so
    // the auto-save debounce + dirty bookkeeping live in one place.
    // ----------------------------------------------------------------
    const persistSave = useCallback((id: number, body: string): void => {
        send({ k: "save", v: { id, body } });
    }, []);
    const saveLifecycle = useEditorSave({ persistSave });

    // ----------------------------------------------------------------
    // Tab-swap snapshot LRU (Phase 8.30).  `useEditorTabSwap` captures
    // the outgoing note's cursor + scroll position and restores the
    // incoming note's state when the bridge re-opens a note we've
    // already seen.
    // ----------------------------------------------------------------
    const captureSnapshot = useCallback((id: number): TabSwapSnapshot | null => {
        // Read the *current* (about-to-be-replaced) mode from the
        // previous-render mirror — by the time recordSwap runs the
        // React state has already flipped to the incoming note's
        // mode, so we cannot use `rawNote` directly here.
        const wasRawMode = previousRawModeRef.current;
        if (wasRawMode) {
            const cmState = captureRawCodeMirrorRestoreState(document);
            if (cmState === null) return null;
            return {
                anchor: cmState.anchor,
                head: cmState.head,
                scrollTop: cmState.scrollTop,
                extra: { kind: "raw", state: cmState },
            };
        }
        const snapshot = captureRichEditorPositionSnapshot(editor as never, document);
        if (snapshot === null) return null;
        return {
            anchor: snapshot.anchorBlockIndex,
            head: snapshot.headBlockIndex,
            scrollTop: snapshot.scrollTop,
            extra: { kind: "rich", snapshot, id },
        };
    }, [editor]);

    const restoreSnapshot = useCallback((_id: number, snapshot: TabSwapSnapshot): void => {
        const extra = snapshot.extra as
            | { kind: "raw"; state: CodeMirrorRestoreState }
            | { kind: "rich"; snapshot: RichEditorPositionSnapshot }
            | undefined;
        if (!extra) return;
        if (extra.kind === "raw") {
            restoreCodeMirrorView(document, extra.state);
        }
        // Rich-mode restoration is driven by `useEditorModePositionSync`'s
        // own `richRestore` slot, which fires off the
        // `laputa:editor-tab-swapped` event the tab-swap hook emits.
    }, []);

    const tabSwap = useEditorTabSwap({
        activeIdRef,
        captureSnapshot,
        restoreSnapshot,
    });

    const handlers = useMemo<EditorBridgeHandlers>(
        () => ({
            setActiveId(id) {
                if (id !== null && activeIdRef.current !== id) {
                    // Cache outgoing + restore incoming snapshot.
                    tabSwap.recordSwap(id);
                }
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
                previousRawModeRef.current = note !== null;
                setRawNote(note);
            },
            getRawBuffer() {
                return rawBufferRef.current;
            },
            setFrontmatter(prefix) {
                frontmatterRef.current = prefix;
            },
            getFrontmatter() {
                return frontmatterRef.current;
            },
        }),
        [tabSwap],
    );

    // ----------------------------------------------------------------
    // Focus lifecycle — listens for `laputa:focus-editor` events.  The
    // native shell can dispatch them via `evaluate_script` after a
    // tab swap that originated outside the editor (e.g. quick-open).
    // ----------------------------------------------------------------
    useEditorFocus(editor as never, editorMountedRef);

    // ----------------------------------------------------------------
    // Memory probe — runs while the editor is mounted.  Telemetry
    // forwarding to native lands in Phase 10.6; today the probe just
    // logs through the `telemetry.ts` shim.
    // ----------------------------------------------------------------
    const memoryProbe = useEditorMemoryProbeController();
    useEffect(() => {
        memoryProbe.start();
        return () => memoryProbe.stop();
    }, [memoryProbe]);

    // ----------------------------------------------------------------
    // Mode-position sync — restores cursor/scroll across rich ↔ raw
    // flips.  The transition ref carries the pending restore slot.
    // ----------------------------------------------------------------
    useEditorModePositionSync({
        activeTabPath: rawNote ? rawNote.path : (activeIdRef.current === null ? null : String(activeIdRef.current)),
        editor: editor as never,
        restoreTransitionRef,
        rawMode: rawNote !== null,
    });

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

    // Wire the BlockNote `onChange` -> debounced `Dirty` + save
    // lifecycle pending buffer.  Subscribe in an effect so the
    // subscription tears down with the component (and so React
    // StrictMode double-mount doesn't leak two listeners).
    //
    // Phase 8.30: in addition to the dirty signal, every change is
    // recorded in `saveLifecycle` so the auto-save debounce sees the
    // latest buffer.  The lifecycle hook owns the 1.5 s flush window;
    // the inline `Dirty` debounce above is purely a UI signal.
    useEffect(() => {
        const unsubscribe = editor.onChange(() => {
            const id = activeIdRef.current;
            if (id === null) return;
            // Hand the latest buffer to the save lifecycle.  Skipped
            // for raw notes — the raw branch wires `handleContentChange`
            // directly off the CodeMirror change handler below.
            if (!rawNote) {
                saveLifecycle.handleContentChange(id, blocksToMarkdown(editor));
            }
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
    }, [editor, rawNote, saveLifecycle]);

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
    //
    // Phase 8.30: also hand the buffer to `saveLifecycle.handleContentChange`
    // so the auto-save debounce fires on raw notes too.
    const handleRawContentChange = useCallback((_path: string, body: string): void => {
        rawBufferRef.current = body;
        const id = activeIdRef.current;
        if (id === null) return;
        saveLifecycle.handleContentChange(id, body);
        cancelDirty();
        dirtyTimerRef.current = setTimeout(() => {
            dirtyTimerRef.current = null;
            if (activeIdRef.current !== id) return;
            if (dirtyAnnouncedForIdRef.current === id) return;
            dirtyAnnouncedForIdRef.current = id;
            send({ k: "dirty", v: { id } });
        }, DIRTY_DEBOUNCE_MS);
    }, [saveLifecycle]);

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
