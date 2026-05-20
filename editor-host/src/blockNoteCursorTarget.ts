// ---------------------------------------------------------------------------
// Cursor-target restoration helpers (Phase 8.26)
// ---------------------------------------------------------------------------
//
// Ported verbatim from the React-era
// `src/components/blockNoteCursorTarget.ts` with TypeScript signature
// adjustments only — no behaviour changes.
//
// After a wikilink insertion / replacement removes the block under the
// cursor (BlockNote re-creates the surrounding block when an inline
// content swap straddles a block boundary), the editor needs to pick
// the nearest block that *still* accepts a text cursor so subsequent
// keystrokes land where the user expects.
//
// The two exported helpers are pure block-array lookups — no editor
// mutation — so they can be driven from a unit test without
// constructing a real BlockNote editor.

/** Minimum shape required to decide whether a block supports a text
 *  cursor.  BlockNote `Block`s carry `id: string` and an optional
 *  `content` array; non-text blocks (image, file, video, audio) omit
 *  `content` entirely. */
interface CursorTargetBlockLike {
    id: string;
    content?: unknown;
}

function blockSupportsTextCursor(
    block: CursorTargetBlockLike | undefined,
): block is CursorTargetBlockLike {
    return Array.isArray(block?.content);
}

/** Given an ordered block list and a target index, walk outward
 *  symmetrically (forward first at each distance, then backward) and
 *  return the nearest block whose `content` is an array.  Returns
 *  `null` if the document contains no text-cursorable blocks at all. */
export function findNearestTextCursorBlock(
    blocks: CursorTargetBlockLike[],
    targetIndex: number,
): CursorTargetBlockLike | null {
    if (blocks.length === 0) return null;

    const clampedTargetIndex = Math.min(
        Math.max(targetIndex, 0),
        blocks.length - 1,
    );
    const targetBlock = blocks.at(clampedTargetIndex);
    if (blockSupportsTextCursor(targetBlock)) {
        return targetBlock;
    }

    for (let distance = 1; distance < blocks.length; distance += 1) {
        const forwardBlock = blocks[clampedTargetIndex + distance];
        if (blockSupportsTextCursor(forwardBlock)) {
            return forwardBlock;
        }

        const backwardBlock = blocks[clampedTargetIndex - distance];
        if (blockSupportsTextCursor(backwardBlock)) {
            return backwardBlock;
        }
    }

    return null;
}

/** Convenience wrapper around [`findNearestTextCursorBlock`] that
 *  accepts a block id instead of an index.  Returns `null` if the id
 *  isn't present in the document. */
export function findNearestTextCursorBlockById(
    blocks: CursorTargetBlockLike[],
    targetBlockId: string,
): CursorTargetBlockLike | null {
    const targetIndex = blocks.findIndex((block) => block.id === targetBlockId);
    if (targetIndex === -1) return null;

    return findNearestTextCursorBlock(blocks, targetIndex);
}
