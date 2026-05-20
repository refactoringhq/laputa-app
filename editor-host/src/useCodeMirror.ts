import { useEffect, useRef } from "react";
import {
    Decoration,
    type DecorationSet,
    EditorView,
    highlightActiveLine,
    keymap,
    lineNumbers,
    ViewPlugin,
    type ViewUpdate,
} from "@codemirror/view";
import { EditorState, type Extension, Prec } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import {
    frontmatterHighlightPlugin,
    frontmatterHighlightTheme,
} from "./extensions/frontmatterHighlight.ts";
import { markdownLanguage } from "./extensions/markdownHighlight.ts";
import { zoomCursorFix } from "./extensions/zoomCursorFix.ts";

const FONT_FAMILY =
    '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

const RAW_EDITOR_COLORS = {
    activeLineBackground: "var(--state-hover-subtle)",
    background: "var(--surface-editor)",
    foreground: "var(--text-primary)",
    gutterBackground: "var(--surface-editor)",
    gutterBorder: "var(--border-subtle)",
    gutterText: "var(--text-muted)",
};

const AUTO_TEXT_DIRECTION_LINE = Decoration.line({
    attributes: { dir: "auto" },
});

export interface CodeMirrorCallbacks {
    onDocChange: (doc: string) => void;
    onCursorActivity: (view: EditorView) => void;
    onSave: () => void;
    onEscape: () => boolean;
    onOpenFind: () => boolean;
}

function buildBaseTheme() {
    return EditorView.theme({
        "&": {
            fontSize: "13px",
            fontFamily: FONT_FAMILY,
            backgroundColor: RAW_EDITOR_COLORS.background,
            color: RAW_EDITOR_COLORS.foreground,
            flex: "1",
            minHeight: "0",
        },
        ".cm-scroller": {
            fontFamily: FONT_FAMILY,
            lineHeight: "1.6",
            padding: "0",
            overflow: "auto",
        },
        ".cm-content": {
            padding: "16px 32px 16px 12px",
            caretColor: RAW_EDITOR_COLORS.foreground,
        },
        ".cm-gutters": {
            backgroundColor: RAW_EDITOR_COLORS.gutterBackground,
            color: RAW_EDITOR_COLORS.gutterText,
            borderRight: `1px solid ${RAW_EDITOR_COLORS.gutterBorder}`,
            minHeight: "100%",
            paddingTop: "0",
            paddingLeft: "6px",
        },
        ".cm-lineNumbers .cm-gutterElement": {
            paddingRight: "12px",
            minWidth: "28px",
            textAlign: "right",
        },
        ".cm-activeLine": {
            backgroundColor: RAW_EDITOR_COLORS.activeLineBackground,
        },
        ".cm-activeLineGutter": {
            backgroundColor: RAW_EDITOR_COLORS.activeLineBackground,
        },
        "&.cm-focused": { outline: "none" },
        ".cm-line": {
            padding: "0",
            unicodeBidi: "plaintext",
            textAlign: "start",
        },
    });
}

function buildAutoTextDirectionDecorations(view: EditorView): DecorationSet {
    const ranges = [];

    for (const visibleRange of view.visibleRanges) {
        for (let pos = visibleRange.from; pos <= visibleRange.to; ) {
            const line = view.state.doc.lineAt(pos);
            ranges.push(AUTO_TEXT_DIRECTION_LINE.range(line.from));
            pos = line.to + 1;
        }
    }

    return Decoration.set(ranges, true);
}

function buildAutoTextDirectionExtension(): Extension {
    return [
        EditorView.perLineTextDirection.of(true),
        ViewPlugin.fromClass(
            class {
                decorations: DecorationSet;

                constructor(view: EditorView) {
                    this.decorations = buildAutoTextDirectionDecorations(view);
                }

                update(update: ViewUpdate) {
                    if (update.docChanged || update.viewportChanged) {
                        this.decorations = buildAutoTextDirectionDecorations(update.view);
                    }
                }
            },
            {
                decorations: (plugin) => plugin.decorations,
            },
        ),
    ];
}

function buildKeymap(callbacks: { current: CodeMirrorCallbacks }) {
    // Cmd+S → save, Cmd+F → open find, Esc → close menus / find-bar.
    // Cmd+G / Shift+Cmd+G fall through to `@codemirror/search` keymap
    // so the built-in next / previous match commands light up once
    // the find-bar is open.
    return Prec.highest(
        keymap.of([
            {
                key: "Mod-s",
                run: () => {
                    callbacks.current.onSave();
                    return true;
                },
            },
            {
                key: "Mod-f",
                run: () => callbacks.current.onOpenFind(),
            },
            {
                key: "Escape",
                run: () => callbacks.current.onEscape(),
            },
        ]),
    );
}

export interface UseCodeMirrorOptions {
    /** Language-specific CodeMirror extension(s) appended after the
     *  baseline (gutters, history, theme, etc.). */
    language: Extension;
    /** When `true`, the markdown frontmatter highlight overlay is
     *  installed.  Wikilink-suggesting plain-text editing wants this
     *  off because the YAML highlight is misleading on non-markdown
     *  buffers. */
    enableFrontmatterHighlight: boolean;
}

/**
 * Mount a `CodeMirror EditorView` on `containerRef`.  Returns a mutable
 * ref that always points at the live view (or `null` when the parent
 * is unmounted).  The hook keeps the editor lifecycle out of React
 * renders: callbacks live in a ref so callers can update them without
 * tearing the view down.
 *
 * Mirrors the React-era `src/hooks/useCodeMirror.ts` semantics:
 *  - external `content` prop changes flow into the buffer through a
 *    flag-guarded dispatch so the `onDocChange` callback doesn't fire
 *    on the sync,
 *  - the `EditorView` is destroyed on unmount,
 *  - the language extension list is recomputed when `options.language`
 *    or `options.enableFrontmatterHighlight` change — that means
 *    swapping `.yaml` for `.md` rebuilds the editor, which is the
 *    right behaviour because the React reference also recreates the
 *    component on a path change.
 */
export function useCodeMirror(
    containerRef: React.RefObject<HTMLDivElement | null>,
    content: string,
    callbacks: CodeMirrorCallbacks,
    options: UseCodeMirrorOptions,
) {
    const viewRef = useRef<EditorView | null>(null);
    const callbacksRef = useRef(callbacks);
    callbacksRef.current = callbacks;
    const externalSyncRef = useRef(false);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        const current = view.state.doc.toString();
        if (current === content) return;
        externalSyncRef.current = true;
        view.dispatch({ changes: { from: 0, to: current.length, insert: content } });
        externalSyncRef.current = false;
    }, [content]);

    const { language, enableFrontmatterHighlight } = options;

    useEffect(() => {
        const parent = containerRef.current;
        if (!parent) return;

        const extensions: Extension[] = [
            lineNumbers(),
            highlightActiveLine(),
            EditorView.lineWrapping,
            buildAutoTextDirectionExtension(),
            history(),
            search(),
            keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
            buildKeymap(callbacksRef),
            buildBaseTheme(),
            language,
            zoomCursorFix(),
            EditorView.updateListener.of((update) => {
                if (update.docChanged && !externalSyncRef.current) {
                    callbacksRef.current.onDocChange(update.state.doc.toString());
                }
                if (update.selectionSet || update.docChanged) {
                    callbacksRef.current.onCursorActivity(update.view);
                }
            }),
        ];
        if (enableFrontmatterHighlight) {
            extensions.push(frontmatterHighlightTheme(), frontmatterHighlightPlugin);
        }

        const state = EditorState.create({
            doc: content,
            extensions,
        });

        const view = new EditorView({ state, parent });
        viewRef.current = view;
        // Test hook — Playwright / Vitest read the live EditorView off
        // the host container to drive selection / dispatch in
        // integration tests.
        (parent as unknown as { __cmView?: EditorView }).__cmView = view;

        return () => {
            delete (parent as unknown as { __cmView?: EditorView }).__cmView;
            view.destroy();
            viewRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [language, enableFrontmatterHighlight]);

    return viewRef;
}

/** Re-export so tests / call sites can use the markdown language pack
 *  by name without reaching into `./extensions/`. */
export { markdownLanguage };
