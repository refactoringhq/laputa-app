import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachEditorLinkActivation } from "./linkActivation.ts";

// ---------------------------------------------------------------------------
// Link activation (Phase 8.26)
// ---------------------------------------------------------------------------
//
// The link-activation installer attaches mousedown / click / modifier
// listeners that translate user gestures into `FromHost::LinkClick`
// envelopes posted through the bridge.  These tests fake the bridge's
// `window.ipc.postMessage` so we can assert the exact wire payloads
// without spinning up a native shell.

type PostedMessage = { k: string; v?: Record<string, unknown> };

function installFakeIpc(): { posted: PostedMessage[]; restore: () => void } {
    const posted: PostedMessage[] = [];
    const w = window as unknown as {
        ipc?: { postMessage(m: string): void };
    };
    const prev = w.ipc;
    w.ipc = {
        postMessage(m: string) {
            posted.push(JSON.parse(m) as PostedMessage);
        },
    };
    return {
        posted,
        restore() {
            w.ipc = prev;
        },
    };
}

function appendWikilink(container: HTMLElement, target: string): HTMLElement {
    const wikilink = document.createElement("span");
    wikilink.className = "wikilink";
    wikilink.dataset.target = target;
    container.appendChild(wikilink);
    return wikilink;
}

function appendEditableWikilink(container: HTMLElement, target: string) {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    // Bare `<div contenteditable>` doesn't expose `isContentEditable`
    // in happy-dom's older draft of HTMLElement, so we patch the
    // getter for the test fixture.  The runtime DOM has the property
    // built in.
    Object.defineProperty(editable, "isContentEditable", {
        configurable: true,
        get: () => true,
    });
    // happy-dom doesn't focus arbitrary contenteditable divs unless
    // they're tab-stoppable.
    editable.tabIndex = 0;
    const wikilink = appendWikilink(editable, target);
    container.appendChild(editable);
    return { editable, wikilink };
}

function appendUrl(container: HTMLElement, href: string): HTMLAnchorElement {
    const link = document.createElement("a");
    link.setAttribute("href", href);
    link.textContent = href;
    container.appendChild(link);
    return link;
}

function dispatchMouseEvent(
    target: Node,
    type: string,
    options: MouseEventInit = {},
): MouseEvent {
    const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        ...options,
    });
    target.dispatchEvent(event);
    return event;
}

describe("attachEditorLinkActivation", () => {
    let container: HTMLDivElement;
    let cleanup: () => void;
    let fake: ReturnType<typeof installFakeIpc>;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        cleanup = attachEditorLinkActivation(container);
        fake = installFakeIpc();
    });

    afterEach(() => {
        cleanup();
        container.remove();
        fake.restore();
    });

    it("emits link_click only on Cmd+click after the native click stack settles", async () => {
        const wikilink = appendWikilink(container, "Alpha Project");

        dispatchMouseEvent(wikilink, "click");
        expect(fake.posted).toEqual([]);

        const modifiedClick = dispatchMouseEvent(wikilink, "click", {
            metaKey: true,
        });
        expect(modifiedClick.defaultPrevented).toBe(true);
        // Dispatch is deferred to a microtask so the synchronous
        // expectation observes nothing yet.
        expect(fake.posted).toEqual([]);

        await Promise.resolve();
        expect(fake.posted).toEqual([
            { k: "link_click", v: { target: "Alpha Project" } },
        ]);
    });

    it("consumes plain wikilink mousedown and click before editor internals see stale link nodes", () => {
        const wikilink = appendWikilink(container, "Alpha Project");

        const mouseDown = dispatchMouseEvent(wikilink, "mousedown");
        const click = dispatchMouseEvent(wikilink, "click");

        expect(mouseDown.defaultPrevented).toBe(true);
        expect(click.defaultPrevented).toBe(true);
        expect(fake.posted).toEqual([]);
    });

    it("blurs an active editable before dispatching a Cmd-clicked wikilink", async () => {
        const { editable, wikilink } = appendEditableWikilink(
            container,
            "Alpha Project",
        );

        editable.focus();
        expect(document.activeElement).toBe(editable);

        fireEvent.click(wikilink, { metaKey: true });

        expect(document.activeElement).not.toBe(editable);
        await Promise.resolve();
        expect(fake.posted).toEqual([
            { k: "link_click", v: { target: "Alpha Project" } },
        ]);
    });

    it("emits link_click only on Cmd+click for plain anchor URLs", () => {
        const link = appendUrl(container, "https://example.com");

        const plainClick = dispatchMouseEvent(link, "click");
        expect(plainClick.defaultPrevented).toBe(true);
        expect(fake.posted).toEqual([]);

        const modifiedClick = dispatchMouseEvent(link, "click", {
            metaKey: true,
        });
        expect(modifiedClick.defaultPrevented).toBe(true);
        expect(fake.posted).toEqual([
            { k: "link_click", v: { target: "https://example.com" } },
        ]);
    });

    it("dispatches once per Cmd+mousedown+click pair (mousedown wins, click dedupes)", () => {
        const link = appendUrl(container, "https://example.com");

        const modifiedMouseDown = dispatchMouseEvent(link, "mousedown", {
            metaKey: true,
        });
        expect(modifiedMouseDown.defaultPrevented).toBe(true);
        expect(fake.posted).toHaveLength(1);

        const click = dispatchMouseEvent(link, "click", { metaKey: true });
        expect(click.defaultPrevented).toBe(true);
        // The click handler must recognise that mousedown already
        // dispatched this href and skip the duplicate.
        expect(fake.posted).toHaveLength(1);
        expect(fake.posted[0]).toEqual({
            k: "link_click",
            v: { target: "https://example.com" },
        });
    });

    it("handles URL events that originate on link text nodes", () => {
        const link = appendUrl(container, "https://example.com");
        const textNode = link.firstChild;
        // happy-dom's `Text` global does not match the window's
        // `Text` constructor by identity, so we assert the node
        // type code rather than the constructor.
        expect(textNode?.nodeType).toBe(3 /* Node.TEXT_NODE */);

        dispatchMouseEvent(textNode!, "mousedown", { metaKey: true });
        const click = dispatchMouseEvent(textNode!, "click", {
            metaKey: true,
        });

        expect(click.defaultPrevented).toBe(true);
        expect(fake.posted).toHaveLength(1);
        expect(fake.posted[0]).toEqual({
            k: "link_click",
            v: { target: "https://example.com" },
        });
    });

    it("ignores links inside code blocks even with the follow modifier", () => {
        const codeBlock = document.createElement("div");
        codeBlock.setAttribute("data-content-type", "codeBlock");
        appendWikilink(codeBlock, "Inside Code");
        container.appendChild(codeBlock);

        fireEvent.click(codeBlock.firstElementChild!, { metaKey: true });

        expect(fake.posted).toEqual([]);
    });

    it("toggles follow-link cursor mode while Cmd is held", () => {
        expect(container.hasAttribute("data-follow-links")).toBe(false);
        fireEvent.keyDown(window, { key: "Meta", metaKey: true });
        expect(container.hasAttribute("data-follow-links")).toBe(true);
        fireEvent.keyUp(window, { key: "Meta" });
        expect(container.hasAttribute("data-follow-links")).toBe(false);
    });

    it("cleanup removes all listeners and resets follow-link state", () => {
        fireEvent.keyDown(window, { key: "Meta", metaKey: true });
        expect(container.hasAttribute("data-follow-links")).toBe(true);

        cleanup();

        // After cleanup, modifier toggles must no longer affect the
        // container — listeners are gone, state is reset.
        expect(container.hasAttribute("data-follow-links")).toBe(false);
        fireEvent.keyDown(window, { key: "Meta", metaKey: true });
        expect(container.hasAttribute("data-follow-links")).toBe(false);

        // Re-install a fresh cleanup so the afterEach call doesn't
        // double-tear-down.
        cleanup = attachEditorLinkActivation(container);
    });
});
