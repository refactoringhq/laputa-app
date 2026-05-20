import { send } from "./bridge.ts";

// ---------------------------------------------------------------------------
// Link activation (Phase 8.26)
// ---------------------------------------------------------------------------
//
// Click-to-navigate for the editor body.  Ported from the React-era
// `src/components/useEditorLinkActivation.ts`, simplified for the
// embedded host: the native shell owns *all* link routing now, so
// instead of calling `openExternalUrl` / `openLocalFile` directly we
// emit a single `FromHost::LinkClick { target }` envelope.  The native
// side runs the wikilink lookup / attachment resolution / external URL
// dispatch on its own.
//
// The Cmd / Ctrl modifier ("follow modifier") still gates navigation
// the way it does in the React reference — a plain click consumes the
// event and parks the cursor in the link, while a Cmd-click follows
// the target.  This matches the Obsidian-style muscle memory the
// existing app trained users on.

const CODE_CONTEXT_SELECTOR = '[data-content-type="codeBlock"], pre, code';

function hasFollowModifier(event: KeyboardEvent | MouseEvent): boolean {
    return event.metaKey || event.ctrlKey;
}

function isInsideCodeContext(target: HTMLElement): boolean {
    return !!target.closest(CODE_CONTEXT_SELECTOR);
}

/** `event.target` is a `Node`; walk up to the nearest `HTMLElement`
 *  so all `closest()` / `dataset` calls work uniformly.  We avoid
 *  `instanceof Text` because cross-realm / happy-dom contexts can
 *  hand us a Text node whose constructor identity differs from the
 *  window's `Text` global; checking `nodeType === Node.TEXT_NODE` is
 *  the cross-realm-safe equivalent. */
function elementFromEventTarget(target: EventTarget | null): HTMLElement | null {
    if (target instanceof HTMLElement) return target;
    if (
        target !== null &&
        typeof target === "object" &&
        "nodeType" in target &&
        (target as Node).nodeType === 3 /* Node.TEXT_NODE */
    ) {
        const parent = (target as Node).parentElement;
        return parent instanceof HTMLElement ? parent : null;
    }
    return null;
}

function resolveWikilinkTarget(target: HTMLElement): string | null {
    return (
        target.closest<HTMLElement>(".wikilink[data-target]")?.dataset.target ??
        null
    );
}

function resolveAnchorHref(target: HTMLElement): string | null {
    return (
        target
            .closest<HTMLAnchorElement>("a[href]")
            ?.getAttribute("href")
            ?.trim() ?? null
    );
}

function blurActiveEditable(container: HTMLElement): void {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !container.contains(active)) return;
    const editable = active.isContentEditable
        ? active
        : active.closest<HTMLElement>('[contenteditable="true"]');
    editable?.blur();
}

function setFollowLinksActive(container: HTMLElement, active: boolean): void {
    if (active) container.setAttribute("data-follow-links", "");
    else container.removeAttribute("data-follow-links");
}

function consumeEditorLinkEvent(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
}

function scheduleAfterNativeClick(callback: () => void): void {
    if (typeof queueMicrotask === "function") queueMicrotask(callback);
    else window.setTimeout(callback, 0);
}

/** Send the wikilink / URL target back to the native shell.  Routed
 *  through the bridge so the native side can map a wikilink to a note
 *  id, open an external URL via `cx.open_url`, or resolve a vault
 *  attachment path — none of which the editor host can do itself. */
function dispatchLinkClick(target: string): void {
    send({ k: "link_click", v: { target } });
}

function activateWikilink(
    event: MouseEvent,
    container: HTMLElement,
    target: string,
): void {
    consumeEditorLinkEvent(event);

    if (!hasFollowModifier(event)) return;

    blurActiveEditable(container);
    // Defer the dispatch one microtask so the native side never sees a
    // `link_click` before the WebView's own click stack has settled —
    // mirrors the React reference's `scheduleAfterNativeClick` trick
    // and keeps Cmd-click feeling instant without racing focus / blur.
    scheduleAfterNativeClick(() => dispatchLinkClick(target));
}

function activateUrl(event: MouseEvent, href: string): void {
    consumeEditorLinkEvent(event);

    if (!hasFollowModifier(event)) return;

    dispatchLinkClick(href);
}

function handleEditorLinkClick(
    event: MouseEvent,
    container: HTMLElement,
): void {
    const target = elementFromEventTarget(event.target);
    if (!target || isInsideCodeContext(target)) return;

    const wikilinkTarget = resolveWikilinkTarget(target);
    if (wikilinkTarget) {
        activateWikilink(event, container, wikilinkTarget);
        return;
    }

    const href = resolveAnchorHref(target);
    if (href) activateUrl(event, href);
}

function handleEditorLinkMouseDown(event: MouseEvent): string | null {
    const target = elementFromEventTarget(event.target);
    if (!target || isInsideCodeContext(target)) return null;

    if (resolveWikilinkTarget(target)) {
        consumeEditorLinkEvent(event);
        return null;
    }

    const href = resolveAnchorHref(target);
    if (hasFollowModifier(event) && href) {
        activateUrl(event, href);
        return href;
    }

    return null;
}

function followedAnchorHrefFromEvent(
    event: MouseEvent,
    fallback: HTMLElement,
): string | null {
    if (!hasFollowModifier(event)) return null;

    return resolveAnchorHref(
        elementFromEventTarget(event.target) ?? fallback,
    );
}

/** Imperative installer (no React dependency).  Attaches the click /
 *  mousedown / keydown listeners that turn editor links into
 *  `FromHost::LinkClick` envelopes.  Returns a cleanup function
 *  matching the `useEffect` cleanup signature; the React mount can
 *  call this in an effect, and unit tests can drive it directly. */
export function attachEditorLinkActivation(
    container: HTMLElement,
): () => void {
    const resetModifierState = () => setFollowLinksActive(container, false);
    const handleModifierChange = (event: KeyboardEvent) => {
        setFollowLinksActive(container, hasFollowModifier(event));
    };
    const handleVisibilityChange = () => {
        if (document.visibilityState !== "visible") resetModifierState();
    };

    // The mousedown path is the *first* event in the click stack —
    // capturing the URL there lets us pre-empt ProseMirror's own
    // mouseup-based selection logic from intercepting Cmd-clicks.  We
    // record the href that mousedown already dispatched so the
    // follow-up click event doesn't fire a duplicate `link_click`.
    let handledMouseDownUrl: string | null = null;
    const rememberHandledMouseDownUrl = (href: string) => {
        handledMouseDownUrl = href;
        window.setTimeout(() => {
            if (handledMouseDownUrl === href) handledMouseDownUrl = null;
        }, 0);
    };
    const handleMouseDown = (event: MouseEvent) => {
        const href = handleEditorLinkMouseDown(event);
        if (href) rememberHandledMouseDownUrl(href);
    };
    const handleClick = (event: MouseEvent) => {
        const followedHref = followedAnchorHrefFromEvent(event, container);
        if (handledMouseDownUrl && followedHref === handledMouseDownUrl) {
            handledMouseDownUrl = null;
            consumeEditorLinkEvent(event);
            return;
        }

        handledMouseDownUrl = null;
        handleEditorLinkClick(event, container);
    };

    container.addEventListener("mousedown", handleMouseDown, true);
    container.addEventListener("click", handleClick, true);
    window.addEventListener("keydown", handleModifierChange);
    window.addEventListener("keyup", handleModifierChange);
    window.addEventListener("blur", resetModifierState);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
        container.removeEventListener("mousedown", handleMouseDown, true);
        container.removeEventListener("click", handleClick, true);
        window.removeEventListener("keydown", handleModifierChange);
        window.removeEventListener("keyup", handleModifierChange);
        window.removeEventListener("blur", resetModifierState);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        resetModifierState();
    };
}
