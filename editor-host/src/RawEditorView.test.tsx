import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RawEditorView } from "./RawEditorView";

const defaultProps = {
    content: "---\ntitle: My Note\n---\n\n# My Note\n\nSome content.",
    path: "/vault/note/my-note.yaml",
    onContentChange: vi.fn(),
    onSave: vi.fn(),
};

describe("RawEditorView", () => {
    it("renders the CodeMirror container", () => {
        render(<RawEditorView {...defaultProps} />);
        expect(screen.getByTestId("raw-editor-codemirror")).toBeInTheDocument();
    });

    it("renders CodeMirror editor with line numbers", () => {
        render(<RawEditorView {...defaultProps} />);
        const container = screen.getByTestId("raw-editor-codemirror");
        expect(container.querySelector(".cm-editor")).toBeInTheDocument();
        expect(container.querySelector(".cm-gutters")).toBeInTheDocument();
        expect(container.querySelector(".cm-lineNumbers")).toBeInTheDocument();
    });

    it("initializes the editor with the provided content", () => {
        render(<RawEditorView {...defaultProps} />);
        const container = screen.getByTestId("raw-editor-codemirror");
        const content = container.querySelector(".cm-content");
        expect(content?.textContent).toContain("title: My Note");
    });

    it("shows a YAML error banner for unclosed frontmatter", () => {
        render(
            <RawEditorView {...defaultProps} content="---\ntitle: Bad\n\n# Title" />,
        );
        expect(screen.getByTestId("raw-editor-yaml-error")).toBeInTheDocument();
        expect(screen.getByTestId("raw-editor-yaml-error")).toHaveTextContent(
            "Unclosed frontmatter",
        );
    });

    it("does not show a YAML error for valid content", () => {
        render(<RawEditorView {...defaultProps} />);
        expect(screen.queryByTestId("raw-editor-yaml-error")).not.toBeInTheDocument();
    });

    it("destroys the CodeMirror view on unmount without throwing", () => {
        const { unmount } = render(<RawEditorView {...defaultProps} />);
        const container = screen.getByTestId("raw-editor-codemirror");
        expect(container.querySelector(".cm-editor")).toBeInTheDocument();
        // The view registers itself on `parent.__cmView`; verify it's
        // there before unmount and absent after, so a regression that
        // skips `view.destroy()` would fail this assertion.
        const liveView = (
            container as unknown as { __cmView?: unknown }
        ).__cmView;
        expect(liveView).toBeDefined();
        unmount();
        const afterView = (
            container as unknown as { __cmView?: unknown }
        ).__cmView;
        expect(afterView).toBeUndefined();
    });

    it("updates `latestContentRef` immediately on every doc change", async () => {
        const latestContentRef = {
            current: null as string | null,
        };
        render(
            <RawEditorView
                {...defaultProps}
                content="initial body"
                latestContentRef={latestContentRef}
            />,
        );

        // The hook seeds the ref with the initial content via an effect;
        // wait a tick for React to flush.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(latestContentRef.current).toBe("initial body");
    });
});
