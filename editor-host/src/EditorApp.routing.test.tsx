import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { EditorApp } from "./EditorApp.tsx";
import type { ToHost } from "./bridge.ts";

/**
 * EditorApp routing — Phase 8.29.
 *
 * Asserts that a `NoteOpen` envelope flips the visible editor surface
 * based on the file extension:
 *  - `.md` (and unsuffixed) notes mount the BlockNote editor body.
 *  - `.yaml`, `.json`, `.txt`, etc. mount the CodeMirror raw editor
 *    (RawEditorView).
 *  - Toggling between the two on consecutive `NoteOpen` envelopes
 *    swaps the active surface reactively.
 */

function deliver(msg: ToHost) {
    const bridge = (
        window as unknown as {
            tolariaBridge?: { receive: (json: string) => void };
        }
    ).tolariaBridge;
    expect(bridge).toBeDefined();
    bridge!.receive(JSON.stringify(msg));
}

function getMode(container: HTMLElement) {
    const root = container.querySelector(".editor-host-container") as HTMLElement;
    return root.dataset.mode;
}

describe("EditorApp routing", () => {
    beforeEach(() => {
        delete (window as { tolariaBridge?: unknown }).tolariaBridge;
    });

    it("mounts BlockNote for a `.md` note", () => {
        const { container } = render(<EditorApp />);

        act(() => {
            deliver({
                k: "note_open",
                v: { id: 1, path: "/vault/note.md", body: "# Heading\n" },
            });
        });

        expect(getMode(container)).toBe("rich");
        expect(screen.queryByTestId("raw-editor-codemirror")).not.toBeInTheDocument();
        // BlockNote renders a contenteditable; confirm the rich tree is
        // present (the host container exists either way, so use the
        // explicit raw surface check above as the primary signal).
        expect(container.querySelector(".bn-container")).toBeTruthy();
    });

    it("mounts the raw editor for `.yaml`, `.json`, and `.txt` notes", () => {
        const { container } = render(<EditorApp />);

        for (const { path, body } of [
            { path: "/vault/config.yaml", body: "key: 1\n" },
            { path: "/vault/data.json", body: '{"a":1}' },
            { path: "/vault/notes.txt", body: "plain text" },
        ]) {
            act(() => {
                deliver({
                    k: "note_open",
                    v: { id: 1, path, body },
                });
            });

            expect(getMode(container)).toBe("raw");
            expect(screen.getByTestId("raw-editor-codemirror")).toBeInTheDocument();
        }
    });

    it("toggles back to BlockNote when a markdown note follows a raw note", () => {
        const { container } = render(<EditorApp />);

        act(() => {
            deliver({
                k: "note_open",
                v: { id: 1, path: "/vault/raw.yaml", body: "a: 1\n" },
            });
        });
        expect(getMode(container)).toBe("raw");
        expect(screen.getByTestId("raw-editor-codemirror")).toBeInTheDocument();

        act(() => {
            deliver({
                k: "note_open",
                v: { id: 2, path: "/vault/rich.md", body: "# rich\n" },
            });
        });

        expect(getMode(container)).toBe("rich");
        expect(screen.queryByTestId("raw-editor-codemirror")).not.toBeInTheDocument();
    });
});
