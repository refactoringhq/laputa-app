import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { defineMock } = vi.hoisted(() => ({
    defineMock: vi.fn((factory: (view: unknown) => unknown) => factory),
}));

vi.mock("@codemirror/view", () => ({
    EditorView: class EditorView {},
    ViewPlugin: {
        define: defineMock,
    },
}));

import { getDocumentZoom, zoomCursorFix } from "./zoomCursorFix";

function mockComputedZoom(value: string) {
    const real = window.getComputedStyle.bind(window);
    return vi.spyOn(window, "getComputedStyle").mockImplementation((elt, pseudo) => {
        const style = real(elt, pseudo);
        if (elt === document.documentElement) {
            return new Proxy(style, {
                get(target, prop) {
                    if (prop === "zoom") return value;
                    const next = Reflect.get(target, prop);
                    return typeof next === "function" ? next.bind(target) : next;
                },
            });
        }
        return style;
    });
}

function mockInlineZoom(value: string) {
    return vi
        .spyOn(document.documentElement.style, "getPropertyValue")
        .mockImplementation((name: string) => {
            if (name === "zoom") return value;
            return "";
        });
}

function createView() {
    const contentDOM = document.createElement("div");
    const textNode = document.createTextNode("hello");
    contentDOM.appendChild(textNode);

    const origPosAtCoords = vi.fn(() => 11);
    const origPosAndSideAtCoords = vi.fn(() => ({ pos: 13, assoc: -1 as const }));
    const prototype = {
        posAtCoords: origPosAtCoords,
        posAndSideAtCoords: origPosAndSideAtCoords,
    };

    const view = Object.assign(Object.create(prototype), {
        contentDOM,
        posAtDOM: vi.fn(() => 17),
    });

    return {
        view,
        textNode,
        origPosAtCoords,
        origPosAndSideAtCoords,
    };
}

describe("zoomCursorFix behavior", () => {
    beforeEach(() => {
        document.documentElement.style.removeProperty("zoom");
        // The test environment installs `caretRangeFromPoint` per
        // case; clear it via `Reflect.deleteProperty` (TypeScript
        // refuses the `delete` operator because the property is
        // marked non-optional on the lib DOM `Document` type).
        Reflect.deleteProperty(document, "caretRangeFromPoint");
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("reads inline percentage zoom values when computed zoom is normal", () => {
        const computedSpy = mockComputedZoom("normal");
        const inlineSpy = mockInlineZoom("125%");

        expect(getDocumentZoom()).toBe(1.25);

        inlineSpy.mockRestore();
        computedSpy.mockRestore();
    });

    it("falls back to 1 for invalid inline zoom values", () => {
        const computedSpy = mockComputedZoom("normal");
        const inlineSpy = mockInlineZoom("banana");

        expect(getDocumentZoom()).toBe(1);

        inlineSpy.mockRestore();
        computedSpy.mockRestore();
    });

    it("uses caretRangeFromPoint when CSS zoom is active and restores prototype methods on destroy", () => {
        const computedSpy = mockComputedZoom("normal");
        const inlineSpy = mockInlineZoom("150%");
        const created = createView();
        const { view, textNode } = created;

        Object.defineProperty(document, "caretRangeFromPoint", {
            configurable: true,
            value: vi.fn(() => ({ startContainer: textNode, startOffset: 2 })),
        });

        const pluginFactory = zoomCursorFix() as unknown as (
            v: typeof view,
        ) => { destroy: () => void };
        const plugin = pluginFactory(view);

        expect(view.posAtCoords({ x: 30, y: 40 }, true)).toBe(17);
        expect(view.posAndSideAtCoords({ x: 30, y: 40 }, false)).toEqual({
            pos: 17,
            assoc: 1,
        });
        expect(view.posAtDOM).toHaveBeenCalledWith(textNode, 2);
        expect(Object.hasOwn(view, "posAtCoords")).toBe(true);

        plugin.destroy();

        expect(Object.hasOwn(view, "posAtCoords")).toBe(false);
        expect(view.posAtCoords({ x: 5, y: 6 }, false)).toBe(11);

        inlineSpy.mockRestore();
        computedSpy.mockRestore();
    });

    it("falls back to adjusted coordinates when the browser API is unavailable or returns an unusable range", () => {
        const computedSpy = mockComputedZoom("normal");
        const inlineSpy = mockInlineZoom("200%");

        const pluginFactory = zoomCursorFix() as unknown as (
            view: ReturnType<typeof createView>["view"],
        ) => { destroy: () => void };

        const first = createView();
        pluginFactory(first.view);
        expect(first.view.posAtCoords({ x: 40, y: 60 }, true)).toBe(11);
        expect(first.origPosAtCoords).toHaveBeenCalledWith({ x: 20, y: 30 }, true);
        expect(first.view.posAndSideAtCoords({ x: 40, y: 60 }, false)).toEqual({
            pos: 13,
            assoc: -1,
        });
        expect(first.origPosAndSideAtCoords).toHaveBeenCalledWith({ x: 20, y: 30 }, false);

        const second = createView();
        Object.defineProperty(document, "caretRangeFromPoint", {
            configurable: true,
            value: vi.fn(() => ({
                startContainer: document.createTextNode("outside"),
                startOffset: 0,
            })),
        });
        pluginFactory(second.view);
        expect(second.view.posAtCoords({ x: 50, y: 70 }, false)).toBe(11);
        expect(second.origPosAtCoords).toHaveBeenCalledWith({ x: 25, y: 35 }, false);

        const third = createView();
        third.view.posAtDOM.mockImplementation(() => {
            throw new Error("boom");
        });
        Object.defineProperty(document, "caretRangeFromPoint", {
            configurable: true,
            value: vi.fn(() => ({ startContainer: third.textNode, startOffset: 1 })),
        });
        pluginFactory(third.view);
        expect(third.view.posAtCoords({ x: 60, y: 80 }, false)).toBe(11);
        expect(third.origPosAtCoords).toHaveBeenCalledWith({ x: 30, y: 40 }, false);

        inlineSpy.mockRestore();
        computedSpy.mockRestore();
    });
});
