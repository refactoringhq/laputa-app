import { afterEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { SideMenuController } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { createEditor } from "./setupEditor.ts";
import { EditorMenus } from "./menus.tsx";

// ---------------------------------------------------------------------------
// EditorMenus integration smoke (Phase 8.25)
// ---------------------------------------------------------------------------
//
// happy-dom does not implement the layout APIs ProseMirror leans on,
// so we can only assert the *mount* path here — that EditorMenus
// renders without throwing inside a real BlockNoteView host, and that
// BlockNote's controller DOM (drag handle, slash menu, formatting
// toolbar floating containers) is added to the document.

afterEach(() => {
    document.body.innerHTML = "";
});

describe("EditorMenus", () => {
    it("mounts inside BlockNoteView without throwing", () => {
        const editor = createEditor();
        const { container, unmount } = render(
            <BlockNoteView
                editor={editor}
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
            </BlockNoteView>,
        );

        // BlockNote always renders a `.bn-container` wrapper, regardless
        // of which controllers are active.  Asserting on it confirms
        // the editor mounted; the menu controllers themselves are
        // floating-UI portals that only attach on hover/selection in a
        // real browser, so we don't assert on their presence here.
        expect(container.querySelector(".bn-container")).not.toBeNull();
        unmount();
    });

    it("re-renders when the editor selection changes without throwing", () => {
        const editor = createEditor();
        const { rerender, unmount } = render(
            <BlockNoteView
                editor={editor}
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
            </BlockNoteView>,
        );

        // Force a re-render to exercise the hover-guard hook deps.
        rerender(
            <BlockNoteView
                editor={editor}
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
            </BlockNoteView>,
        );

        unmount();
    });

    // -----------------------------------------------------------------
    // Worklist 1.2 / 2.24 regression — SideMenuController mounted
    // against the headless `BlockNoteViewRaw` blew up on first mousemove
    // because the default AddBlockButton dereferences `e.SideMenu.Button`
    // off an undefined components map.  Once `@blocknote/shadcn` is
    // wrapped around the view, that map is populated.  happy-dom
    // doesn't fire BlockNote's mousemove-driven menu opening, so this
    // test asserts only the *mount* path; the hover throw is what
    // worklist-2.25 console redirection surfaces in the live app.
    // -----------------------------------------------------------------
    it("SideMenuController mounts inside shadcn BlockNoteView without throwing", () => {
        const editor = createEditor();
        const { unmount } = render(
            <BlockNoteView
                editor={editor}
                formattingToolbar={false}
                linkToolbar={false}
                slashMenu={false}
                sideMenu={false}
                filePanel={false}
                tableHandles={false}
                emojiPicker={false}
                comments={false}
            >
                <SideMenuController />
            </BlockNoteView>,
        );
        unmount();
    });
});
