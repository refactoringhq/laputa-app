import type { BlockNoteEditor } from "@blocknote/core";
import type { DefaultReactSuggestionItem } from "@blocknote/react";

// ---------------------------------------------------------------------------
// Wikilink suggestion menu plumbing (Phase 8.26)
// ---------------------------------------------------------------------------
//
// Pure helpers that drive the `[[` suggestion menu mounted by
// `EditorApp.tsx`.  The actual `<SuggestionMenuController />` JSX is
// constructed inline in `EditorApp` so this module stays decoupled
// from React rendering — that keeps the helpers cheap to test and
// safe to call from a Rust-driven IPC path in a later strand.
//
// # Bridge gap (TODO 8.26-bridge)
//
// The native shell does *not* yet expose
// `FromHost::WikilinkQuery { prefix }` /
// `ToHost::WikilinkSuggestions { items }` envelopes — see the
// re-audit at the top of `crates/editor_bridge/src/lib.rs`.  Until the
// orchestrator approves those new variants, this module's
// `defaultWikilinkItemsProvider` returns an empty list: the menu UI
// still opens (so 8.26 ships a working surface and 8.27+ regressions
// don't have to re-add the controller), but the list is always empty.
//
// When the bridge gains the variants, swap the provider for one that
// posts `FromHost::WikilinkQuery` and `await`s a promise resolved by
// an `onReceive` handler matching `ToHost::WikilinkSuggestions`.  No
// other call site has to change.

/** Minimum trigger length before the menu starts fetching items.
 *  Mirrors the React reference (`MIN_QUERY_LENGTH = 0`) — BlockNote's
 *  `[[` trigger is itself the gate, so the empty-string query is the
 *  most common "menu just opened" case. */
export const WIKILINK_MIN_QUERY_LENGTH = 0;

/** Bare item shape returned by a wikilink provider.  This is the
 *  envelope the host renders inside the suggestion menu — it carries
 *  the canonical wikilink target as the `key` (so `insertWikilinkItem`
 *  knows what to put into the editor) plus a `title` for display. */
export interface WikilinkSuggestionItem extends DefaultReactSuggestionItem {
    /** Canonical wikilink target — what gets written into the
     *  `[[target]]` markup at insertion time.  Stable across renames
     *  because the native side will, eventually, resolve it via
     *  `vault::Vault::canonical_wikilink_target_for_entry`. */
    wikilinkTarget: string;
}

/** Optional provider override.  In 8.26 the only call site is the
 *  default empty-list stub, but exposing the seam lets the eventual
 *  bridge integration plug in without touching `EditorApp.tsx`. */
export type WikilinkItemsProvider = (
    query: string,
) => Promise<WikilinkSuggestionItem[]>;

/** Default provider — returns an empty list.  Replace with a real
 *  bridge call once `FromHost::WikilinkQuery` lands. */
export const defaultWikilinkItemsProvider: WikilinkItemsProvider = async () =>
    [];

/** Build the BlockNote `onItemClick` handler that inserts the
 *  selected wikilink at the current cursor position and re-emits a
 *  trailing space so the user can keep typing.
 *
 *  Factored out as a top-level function (not a closure on the React
 *  render path) so the unit test can drive it without a live
 *  `SuggestionMenuController`. */
/** Loose-typed handle for `editor.insertInlineContent` that accepts
 *  the custom `wikilink` inline content variant registered in
 *  `setupEditor.ts`.  The default `BlockNoteEditor` generic narrows
 *  to the built-in inline content set; the host stays on that loose
 *  type so markdown / dispatch helpers don't have to thread the
 *  extended generic.  When 8.30 threads the schema generic through,
 *  this helper goes away. */
type LooseInsertInlineContent = (
    content: ReadonlyArray<
        string | { type: string; props?: Record<string, unknown> }
    >,
    opts?: { updateSelection?: boolean },
) => void;

export function insertWikilinkItem(
    editor: BlockNoteEditor,
    item: WikilinkSuggestionItem,
): void {
    // Bind `this` explicitly — naked `as` casts lose method-binding,
    // and `_styleManager` lives on the editor instance.
    const insertExt = editor.insertInlineContent.bind(
        editor,
    ) as unknown as LooseInsertInlineContent;
    insertExt(
        [{ type: "wikilink", props: { target: item.wikilinkTarget } }, " "],
        { updateSelection: true },
    );
}

/** Build a `DefaultReactSuggestionItem`-compatible item from a raw
 *  wikilink target string.  The React reference's
 *  `attachClickHandlers` walks a list of entries — here we keep the
 *  shape minimal because the provider supplies whatever metadata it
 *  has.  The `title` defaults to the target, but providers are free
 *  to pass a friendlier display name. */
export function buildWikilinkSuggestionItem(options: {
    editor: BlockNoteEditor;
    target: string;
    title?: string;
    subtext?: string;
}): WikilinkSuggestionItem {
    const { editor, target, title, subtext } = options;
    const item: WikilinkSuggestionItem = {
        wikilinkTarget: target,
        title: title ?? target,
        subtext,
        onItemClick: () => insertWikilinkItem(editor, item),
    };
    return item;
}

/** Build the async `getItems` adapter the
 *  `<SuggestionMenuController />` consumes.  Bridges the user-supplied
 *  `WikilinkItemsProvider` into BlockNote's expected
 *  `(query) => Promise<DefaultReactSuggestionItem[]>` signature, and
 *  attaches the click handler so the controller doesn't need to know
 *  about the editor.
 *
 *  Errors from the provider are coerced into an empty list with a
 *  console warning — the React-side `useSuggestionMenuItems`
 *  reference does the same, on the principle that a failed query
 *  shouldn't break the editor. */
export function buildWikilinkGetItems(
    editor: BlockNoteEditor,
    provider: WikilinkItemsProvider = defaultWikilinkItemsProvider,
): (query: string) => Promise<WikilinkSuggestionItem[]> {
    return async (query: string) => {
        try {
            const items = await provider(query);
            // Re-attach `onItemClick` against the *live* editor.  The
            // provider type *requires* an `onItemClick`, but at
            // runtime providers can forget it (e.g. a bridge-side
            // payload that didn't ship the closure); we tolerate that
            // by re-wiring the default insertion handler.  The
            // assertion is just that some click handler exists at the
            // time the user picks an item.
            return items.map((item) => {
                const click = (item as { onItemClick?: unknown }).onItemClick;
                if (typeof click === "function") return item;
                return {
                    ...item,
                    onItemClick: () => insertWikilinkItem(editor, item),
                };
            });
        } catch (error) {
            console.warn("[wikilink-suggestion] provider failed:", error);
            return [];
        }
    };
}
