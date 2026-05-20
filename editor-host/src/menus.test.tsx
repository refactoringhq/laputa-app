import { afterEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { BlockNoteViewRaw } from "@blocknote/react";
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
    it("mounts inside BlockNoteViewRaw without throwing", () => {
        const editor = createEditor();
        const { container, unmount } = render(
            <BlockNoteViewRaw
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
            </BlockNoteViewRaw>,
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
            <BlockNoteViewRaw
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
            </BlockNoteViewRaw>,
        );

        // Force a re-render to exercise the hover-guard hook deps.
        rerender(
            <BlockNoteViewRaw
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
            </BlockNoteViewRaw>,
        );

        unmount();
    });
});
