// ---------------------------------------------------------------------------
// BlockNote popover virtual-reference regression (ported from
// `src/lib/blockNotePopover.regression.test.ts`).
// ---------------------------------------------------------------------------
//
// `getMountedBoundingClientRectCache` (re-exported from
// `@blocknote/react`) is the helper that menus reach for when the
// underlying DOM element disappears mid-remount (slash menu, link
// toolbar, etc.).  Without the mirrored `@blocknote/react` patch
// (`patches/@blocknote__react@0.46.2.patch`) the helper called
// `reference.element.getBoundingClientRect()` straight away and
// threw on a `null` / `undefined` element.  The patched form falls
// back to the supplied virtual `getBoundingClientRect` instead.
//
// The hover guards we ship for the slash + side menus rely on this
// fallback when the editor reloads under them; the regression here
// keeps that contract enforced.

import { getMountedBoundingClientRectCache } from "@blocknote/react";
import { describe, expect, it } from "vitest";

describe("patched BlockNote popover references", () => {
    it("uses the virtual rect when a remounting suggestion menu has no DOM element", () => {
        const fallbackRect = new DOMRect(4, 8, 16, 24);
        const readRect = getMountedBoundingClientRectCache({
            element: undefined,
            getBoundingClientRect: () => fallbackRect,
        } as never);

        expect(() => readRect()).not.toThrow();
        expect(readRect()).toBe(fallbackRect);
    });

    it("returns the same cached rect across repeated reads on a stable virtual reference", () => {
        let calls = 0;
        const virtualRect = new DOMRect(0, 0, 32, 16);
        const readRect = getMountedBoundingClientRectCache({
            element: undefined,
            getBoundingClientRect: () => {
                calls += 1;
                return virtualRect;
            },
        } as never);

        // The cache is allowed to call the underlying `getBoundingClientRect`
        // once on first read and then memoise; both reads must return the
        // exact same rect instance.
        const first = readRect();
        const second = readRect();
        expect(first).toBe(virtualRect);
        expect(second).toBe(virtualRect);
        expect(calls).toBeGreaterThanOrEqual(1);
    });
});
