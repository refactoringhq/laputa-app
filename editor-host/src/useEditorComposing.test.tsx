// Focused unit tests for `useEditorComposing` (Phase 8.27, Strand C).
//
// The React reference repo does not ship a dedicated test file for
// this hook (it is exercised end-to-end by the formatting toolbar
// integration tests in `tolariaEditorFormatting.tsx`).  We add a
// focused test here so the embedded editor has direct regression
// coverage for the document-level composition lifecycle — the hook
// is the only signal the WKWebView shell has for IME state.

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockNoteEditor } from "@blocknote/core";
import { useEditorComposing } from "./useEditorComposing.ts";

function CompositionProbe({ editor }: { editor: BlockNoteEditor }) {
    const isComposing = useEditorComposing(editor);
    return <span data-testid="composing">{isComposing ? "yes" : "no"}</span>;
}

function buildEditor(): { editor: BlockNoteEditor; element: HTMLDivElement } {
    // `useEditorComposing` only reads `editor.domElement`; mock the
    // smallest shape that lets the hook attach its capture-phase
    // listeners.  A real `BlockNoteEditor` would require a full
    // ProseMirror mount in happy-dom and is overkill for this layer.
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = { domElement: element } as unknown as BlockNoteEditor;
    return { editor, element };
}

function dispatchComposition(
    target: EventTarget,
    type: "compositionstart" | "compositionupdate" | "compositionend",
    data = "",
) {
    const event = new CompositionEvent(type, { bubbles: true, cancelable: true, data });
    target.dispatchEvent(event);
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
});

describe("useEditorComposing", () => {
    it("reports false when no composition is in flight", () => {
        const { editor } = buildEditor();

        render(<CompositionProbe editor={editor} />);

        expect(screen.getByTestId("composing").textContent).toBe("no");
    });

    it("flips to true while a composition is active inside the editor", () => {
        const { editor, element } = buildEditor();
        render(<CompositionProbe editor={editor} />);

        act(() => {
            dispatchComposition(element, "compositionstart");
        });

        expect(screen.getByTestId("composing").textContent).toBe("yes");
    });

    it("settles back to false after the composition ends and the debounce elapses", () => {
        const { editor, element } = buildEditor();
        render(<CompositionProbe editor={editor} />);

        act(() => {
            dispatchComposition(element, "compositionstart");
        });
        act(() => {
            dispatchComposition(element, "compositionend");
        });

        expect(screen.getByTestId("composing").textContent).toBe("yes");

        act(() => {
            vi.advanceTimersByTime(260);
        });

        expect(screen.getByTestId("composing").textContent).toBe("no");
    });

    it("ignores composition events that target an unrelated DOM tree", () => {
        const { editor } = buildEditor();
        const outside = document.createElement("input");
        document.body.appendChild(outside);
        render(<CompositionProbe editor={editor} />);

        act(() => {
            dispatchComposition(outside, "compositionstart");
        });

        expect(screen.getByTestId("composing").textContent).toBe("no");
    });
});
