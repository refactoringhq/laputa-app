import { useCallback, useRef } from "react";
import type { BlockNoteEditor } from "@blocknote/core";
import { filterSuggestionItems } from "@blocknote/core/extensions";
import {
    FormattingToolbarController,
    SuggestionMenuController,
    getDefaultReactSlashMenuItems,
} from "@blocknote/react";
import { useBlockNoteSideMenuHoverGuard } from "./blockNoteSideMenuHoverGuard.ts";
import { useBlockNoteFormattingToolbarHoverGuard } from "./blockNoteFormattingToolbarHoverGuard.ts";

// ---------------------------------------------------------------------------
// EditorMenus — slash / side / formatting menus + hover guards (Phase 8.25)
// ---------------------------------------------------------------------------
//
// Mounts BlockNote's default menu surfaces (slash-triggered suggestion
// menu, side drag-handle, selection formatting toolbar) inside the host
// `<BlockNoteViewRaw>` tree and attaches the two hover-guard hooks
// ported from the React-era app.
//
// 8.25 deliberately uses the *default* item lists / UI shells so this
// row stays narrow.  Subsequent rows hook in:
// - 8.26 — wikilink + person-mention SuggestionMenuController (`[[`, `@`)
//          and link-click routing through `bridge.ts::FromHost::LinkClick`
// - 8.27 — IME composition guard (suspends the slash menu during
//          composition)
// - 8.28 — code-block / table / copy / checklist regressions
// - 8.30 — formatting toolbar's `isOpen` derivation (focus/hover/grace)
//
// For 8.25 we approximate the formatting-toolbar `isOpen` signal with a
// simple "selection currently has any non-empty range" check.  That's a
// safe over-approximation: the hover guard adds the mousemove listener
// whenever a selection exists, which is exactly when the toolbar might
// be visible.  The richer derivation (composition + focus + grace
// window) lands with the full controller port in 8.30.

const FILE_BLOCK_TYPES = new Set<string>(["audio", "file", "image", "video"]);

/**
 * Resolve the editor container element that the hover guard listeners
 * scope to.  We walk up from `editor.domElement` looking for a host
 * wrapper, then fall back to the editor element itself — the React-era
 * code does the same dance.
 */
function resolveEditorContainer(editor: BlockNoteEditor): HTMLElement | null {
    const dom = editor.domElement;
    if (!(dom instanceof HTMLElement)) return null;
    return (
        (dom.closest(".editor__blocknote-container") as HTMLElement | null) ?? dom
    );
}

/**
 * Compute the file-block id that the formatting-toolbar hover guard
 * should re-pin onto.  Phase 8.25 uses the *current selection*; later
 * rows track the toolbar-store bridge id directly.
 */
function currentFileBlockId(editor: BlockNoteEditor): string | null {
    let block: { id: string; type: string } | undefined;

    try {
        block = editor.getSelection()?.blocks[0] as
            | { id: string; type: string }
            | undefined;
    } catch {
        block = undefined;
    }

    if (!block) {
        try {
            block = editor.getTextCursorPosition().block as {
                id: string;
                type: string;
            };
        } catch {
            block = undefined;
        }
    }

    if (!block) return null;
    return FILE_BLOCK_TYPES.has(block.type) ? block.id : null;
}

export interface EditorMenusProps {
    editor: BlockNoteEditor;
}

/**
 * Render the three default BlockNote menu controllers wrapped by their
 * hover guards.  Must be mounted as a child of `<BlockNoteViewRaw>` so
 * the BlockNote React context is in scope.
 */
export function EditorMenus({ editor }: EditorMenusProps) {
    // Hold an HTMLElement ref pointing at the editor's host container
    // for the side-menu hover guard.  The ref is updated on every render
    // because BlockNote may reparent its DOM during lifecycle churn.
    const containerRef = useRef<HTMLElement | null>(null);
    containerRef.current = resolveEditorContainer(editor);

    // Side-menu hover guard: suppresses flicker on the editor / drag
    // handle bridge gutter.
    useBlockNoteSideMenuHoverGuard(containerRef);

    // Formatting-toolbar hover guard: keeps the toolbar pinned when the
    // pointer crosses from toolbar -> image and back.  For 8.25 we keep
    // the listener installed whenever a file block is selected; later
    // rows refine this with the toolbar-store `isOpen` derivation.
    const selectedFileBlockId = currentFileBlockId(editor);
    useBlockNoteFormattingToolbarHoverGuard({
        editor: editor as never,
        container: containerRef.current,
        selectedFileBlockId,
        isOpen: selectedFileBlockId !== null,
    });

    // Slash menu items closure — `getDefaultReactSlashMenuItems` returns
    // a fresh array each call so we memoize via the editor identity to
    // avoid rebuilding the array on every keystroke.
    const getSlashItems = useCallback(
        async (query: string) =>
            filterSuggestionItems(
                getDefaultReactSlashMenuItems(editor as never),
                query,
            ),
        [editor],
    );

    return (
        <>
            {/*
             * SideMenuController removed (worklist 1.2): without a
             * BlockNote UI package (e.g. @blocknote/shadcn) supplying a
             * ComponentsContext.Provider, the default AddBlockButton
             * inside SideMenuController dereferences `e.SideMenu.Button`
             * where `e` is the (missing) components map.  That throws on
             * the first mousemove over the editor — which AppKit reports
             * as the WKWebView going "blank on hover".  Restoring the
             * drag-handle gutter is tracked as worklist 2.24 (install
             * @blocknote/shadcn + ComponentsContext.Provider wiring).
             */}
            <FormattingToolbarController />
            <SuggestionMenuController
                triggerCharacter="/"
                getItems={getSlashItems}
            />
        </>
    );
}
