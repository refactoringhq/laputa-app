// ---------------------------------------------------------------------------
// Cursor + scroll preservation across rich ↔ raw mode (Phase 8.30)
// ---------------------------------------------------------------------------
//
// The React reference (`src/components/editorModePosition.ts`) pulls in
// `compactMarkdown`, `splitFrontmatter`, `restoreWikilinksInBlocks`, and
// `serializeDurableEditorBlocks` to derive line-accurate position
// mapping between BlockNote blocks and a CodeMirror string buffer.
// Those helpers live above the bridge boundary in the native app and
// would balloon the editor-host bundle, so this port:
//
// 1. Keeps the *contracts* of the React helpers — same types
//    (`BlockNotePositionEditor`, `CodeMirrorViewLike`,
//    `RichEditorPositionSnapshot`, `RawEditorPositionSnapshot`,
//    `CodeMirrorRestoreState`) — so `useEditorModePositionSync` can
//    drive both apps without divergence.
// 2. Inlines a *simpler* line-mapper that walks the editor body via
//    BlockNote's own `blocksToMarkdownLossy` (no wikilink restoration
//    needed — the editor-host's bridge already handles that on the
//    way in), and treats frontmatter as opaque.
//
// The behaviour the editor-host needs is a "best-effort restore":
// after a mode flip, drop the cursor near the same block the user was
// editing, and restore the scroll offset.  Pixel-perfect parity with
// the React reference is not a requirement — the modes coexist within
// the same WKWebView, so a small jitter is acceptable.

import { findNearestTextCursorBlockById } from "./blockNoteCursorTarget.ts";

// ---------------------------------------------------------------------------
// Public types — kept identical to the React reference.
// ---------------------------------------------------------------------------

interface BlockLike {
    id: string;
    content?: unknown;
}

interface BlockSelectionLike {
    blocks: BlockLike[];
}

interface TextCursorPositionLike {
    block: BlockLike;
}

export interface BlockNotePositionEditor {
    document: BlockLike[];
    getSelection?: () => BlockSelectionLike | undefined;
    getTextCursorPosition?: () => TextCursorPositionLike;
    blocksToMarkdownLossy: (blocks: unknown[]) => string;
    setSelection: (startBlock: string, endBlock: string) => void;
    setTextCursorPosition: (targetBlock: string, placement: "start" | "end") => void;
    focus: () => void;
}

export interface CodeMirrorViewLike {
    state: {
        doc: { toString: () => string };
        selection: {
            main: {
                anchor: number;
                head: number;
            };
        };
    };
    scrollDOM: {
        scrollTop: number;
    };
    dispatch: (spec: { selection: { anchor: number; head: number } }) => void;
    focus: () => void;
}

interface RawEditorHost extends Element {
    __cmView?: CodeMirrorViewLike;
}

export interface RichEditorPositionSnapshot {
    anchorBlockIndex: number;
    headBlockIndex: number;
    scrollTop: number;
}

export interface RawEditorPositionSnapshot {
    anchorLineRatio: number;
    headLineRatio: number;
}

export interface CodeMirrorRestoreState {
    anchor: number;
    head: number;
    scrollTop: number;
}

interface BlockNoteRestoreState {
    startBlockId: string;
    endBlockId: string;
}

interface BlockLineRange {
    startLine: number;
    endLine: number;
}

// Selectors match the React reference so DOM-based callers (tests,
// future periscope captures) can target the same nodes in both apps.
const RAW_EDITOR_SELECTOR = '[data-testid="raw-editor-codemirror"]';
const BLOCKNOTE_SCROLL_SELECTOR = ".editor-scroll-area";

// ---------------------------------------------------------------------------
// Small numeric / text helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function clampSelectionOffset(value: number, maxOffset: number): number {
    return Number.isFinite(value) ? clamp(value, 0, maxOffset) : 0;
}

function countLines(text: string): number {
    return text.length === 0 ? 1 : text.split("\n").length;
}

function countLineBreaks(text: string): number {
    let count = 0;
    for (let i = 0; i < text.length; i += 1) {
        if (text.charCodeAt(i) === 0x0a /* \n */) count += 1;
    }
    return count;
}

function getLineStartOffset(text: string, lineIndex: number): number {
    if (lineIndex <= 0 || text.length === 0) return 0;

    let currentLine = 0;
    for (let index = 0; index < text.length; index += 1) {
        if (text.charAt(index) !== "\n") continue;
        currentLine += 1;
        if (currentLine === lineIndex) return index + 1;
    }
    return text.length;
}

function getLineEndOffset(text: string, lineIndex: number): number {
    const start = getLineStartOffset(text, lineIndex);
    const nextBreak = text.indexOf("\n", start);
    return nextBreak === -1 ? text.length : nextBreak;
}

function getLineIndexForOffset(text: string, offset: number): number {
    if (text.length === 0) return 0;
    const clamped = clamp(offset, 0, text.length);
    return countLineBreaks(text.slice(0, clamped));
}

function getLineRatio(text: string, offset: number): number {
    const totalLines = countLines(text);
    if (totalLines <= 1) return 0;
    const lineIndex = getLineIndexForOffset(text, offset);
    return lineIndex / (totalLines - 1);
}

function getLineIndexFromRatio(totalLines: number, ratio: number): number {
    if (totalLines <= 1) return 0;
    return Math.round(clamp(ratio, 0, 1) * (totalLines - 1));
}

// ---------------------------------------------------------------------------
// Block ↔ line range mapping
// ---------------------------------------------------------------------------

function serializeBlock(editor: BlockNotePositionEditor, block: BlockLike): string {
    // The editor-host doesn't need wikilink restoration on the way
    // *out* (the bridge re-encodes wikilinks when it sends `Save`);
    // BlockNote's own lossy serializer is sufficient for the
    // line-mapping heuristic below.
    return editor.blocksToMarkdownLossy([block]);
}

function serializeEditorBody(editor: BlockNotePositionEditor): string {
    return editor.blocksToMarkdownLossy(editor.document);
}

function buildBlockLineRanges(body: string, editor: BlockNotePositionEditor): BlockLineRange[] {
    let searchStart = 0;
    let fallbackStartLine = 0;

    return editor.document.map((block) => {
        const serializedBlock = serializeBlock(editor, block);
        if (!serializedBlock) {
            return { startLine: fallbackStartLine, endLine: fallbackStartLine };
        }

        const bodyIndex = body.indexOf(serializedBlock, searchStart);
        if (bodyIndex === -1) {
            const lineCount = countLines(serializedBlock);
            const range = {
                startLine: fallbackStartLine,
                endLine: fallbackStartLine + Math.max(lineCount - 1, 0),
            };
            fallbackStartLine = range.endLine + 1;
            return range;
        }

        const startLine = countLineBreaks(body.slice(0, bodyIndex));
        const endLine = countLineBreaks(body.slice(0, bodyIndex + serializedBlock.length));
        searchStart = bodyIndex + serializedBlock.length;
        fallbackStartLine = endLine + 1;
        return { startLine, endLine };
    });
}

function findNearestBlockIndex(ranges: BlockLineRange[], targetLine: number): number {
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    ranges.forEach((range, index) => {
        if (targetLine >= range.startLine && targetLine <= range.endLine) {
            nearestIndex = index;
            nearestDistance = 0;
            return;
        }

        const distance = targetLine < range.startLine
            ? range.startLine - targetLine
            : targetLine - range.endLine;
        if (distance < nearestDistance) {
            nearestIndex = index;
            nearestDistance = distance;
        }
    });

    return nearestIndex;
}

// ---------------------------------------------------------------------------
// Rich (BlockNote) snapshot capture
// ---------------------------------------------------------------------------

function getSelectionIndexes(editor: BlockNotePositionEditor): [number, number] | null {
    if (typeof editor.getSelection !== "function") return null;

    const selection = editor.getSelection();
    const selectedBlocks = selection?.blocks ?? [];
    if (selectedBlocks.length === 0) return null;

    const startBlock = selectedBlocks.at(0);
    const endBlock = selectedBlocks.at(-1);
    if (!startBlock || !endBlock) return null;

    const startIndex = editor.document.findIndex((block) => block.id === startBlock.id);
    const endIndex = editor.document.findIndex((block) => block.id === endBlock.id);
    if (startIndex === -1 || endIndex === -1) return null;

    return [startIndex, endIndex];
}

function getCursorIndex(editor: BlockNotePositionEditor): number | null {
    if (typeof editor.getTextCursorPosition !== "function") return null;

    const cursorBlockId = editor.getTextCursorPosition().block.id;
    const cursorIndex = editor.document.findIndex((block) => block.id === cursorBlockId);
    return cursorIndex === -1 ? null : cursorIndex;
}

function buildBlockNoteRestoreState(
    editor: BlockNotePositionEditor,
    snapshot: RawEditorPositionSnapshot,
): BlockNoteRestoreState | null {
    if (editor.document.length === 0) return null;

    const body = serializeEditorBody(editor);
    const ranges = buildBlockLineRanges(body, editor);
    const totalLines = countLines(body);
    const anchorLine = getLineIndexFromRatio(totalLines, snapshot.anchorLineRatio);
    const headLine = getLineIndexFromRatio(totalLines, snapshot.headLineRatio);
    const anchorIndex = findNearestBlockIndex(ranges, anchorLine);
    const headIndex = findNearestBlockIndex(ranges, headLine);
    const startIndex = Math.min(anchorIndex, headIndex);
    const endIndex = Math.max(anchorIndex, headIndex);
    const startBlock = editor.document.at(startIndex);
    const endBlock = editor.document.at(endIndex);
    if (!startBlock || !endBlock) return null;

    const startBlockId = findNearestTextCursorBlockById(editor.document, startBlock.id)?.id;
    const endBlockId = findNearestTextCursorBlockById(editor.document, endBlock.id)?.id;
    if (!startBlockId || !endBlockId) return null;

    return { startBlockId, endBlockId };
}

export function readBlockNoteScrollTop(documentObject: Document): number {
    const scrollElement = documentObject.querySelector<HTMLElement>(BLOCKNOTE_SCROLL_SELECTOR);
    return scrollElement?.scrollTop ?? 0;
}

export function captureRichEditorPositionSnapshot(
    editor: BlockNotePositionEditor,
    documentObject: Document,
): RichEditorPositionSnapshot | null {
    if (editor.document.length === 0) return null;

    const selectionIndexes = getSelectionIndexes(editor);
    const [anchorBlockIndex, headBlockIndex] = selectionIndexes
        ?? [getCursorIndex(editor), getCursorIndex(editor)];
    if (anchorBlockIndex === null || headBlockIndex === null) return null;

    return {
        anchorBlockIndex,
        headBlockIndex,
        scrollTop: readBlockNoteScrollTop(documentObject),
    };
}

export function buildCodeMirrorRestoreState(
    editor: BlockNotePositionEditor,
    content: string,
    snapshot: RichEditorPositionSnapshot,
): CodeMirrorRestoreState | null {
    if (editor.document.length === 0) return null;

    const ranges = buildBlockLineRanges(content, editor);
    if (ranges.length === 0) return null;

    const anchorRange = ranges.at(clamp(snapshot.anchorBlockIndex, 0, ranges.length - 1));
    const headRange = ranges.at(clamp(snapshot.headBlockIndex, 0, ranges.length - 1));
    if (!anchorRange || !headRange) return null;

    return {
        anchor: getLineStartOffset(content, anchorRange.startLine),
        head: getLineEndOffset(content, headRange.endLine),
        scrollTop: snapshot.scrollTop,
    };
}

// ---------------------------------------------------------------------------
// Raw (CodeMirror) snapshot capture
// ---------------------------------------------------------------------------

export function getRawEditorView(documentObject: Document): CodeMirrorViewLike | null {
    const host = documentObject.querySelector<RawEditorHost>(RAW_EDITOR_SELECTOR);
    return host?.__cmView ?? null;
}

export function captureRawEditorPositionSnapshot(
    documentObject: Document,
): RawEditorPositionSnapshot | null {
    const view = getRawEditorView(documentObject);
    if (!view) return null;

    const content = view.state.doc.toString();
    const bodyLength = content.length;
    const anchorOffset = clamp(view.state.selection.main.anchor, 0, bodyLength);
    const headOffset = clamp(view.state.selection.main.head, 0, bodyLength);
    return {
        anchorLineRatio: getLineRatio(content, anchorOffset),
        headLineRatio: getLineRatio(content, headOffset),
    };
}

export function captureRawCodeMirrorRestoreState(
    documentObject: Document,
): CodeMirrorRestoreState | null {
    const view = getRawEditorView(documentObject);
    if (!view) return null;

    return {
        anchor: view.state.selection.main.anchor,
        head: view.state.selection.main.head,
        scrollTop: view.scrollDOM.scrollTop,
    };
}

export function restoreCodeMirrorView(
    documentObject: Document,
    state: CodeMirrorRestoreState,
): boolean {
    const view = getRawEditorView(documentObject);
    if (!view) return false;

    const maxOffset = view.state.doc.toString().length;
    const selection = {
        anchor: clampSelectionOffset(state.anchor, maxOffset),
        head: clampSelectionOffset(state.head, maxOffset),
    };

    try {
        view.dispatch({ selection });
    } catch {
        return false;
    }
    view.scrollDOM.scrollTop = state.scrollTop;
    view.focus();
    return true;
}

export function restoreBlockNoteView(
    editor: BlockNotePositionEditor,
    snapshot: RawEditorPositionSnapshot,
    documentObject: Document,
): boolean {
    const state = buildBlockNoteRestoreState(editor, snapshot);
    if (!state) return false;

    try {
        if (state.startBlockId === state.endBlockId) {
            editor.setTextCursorPosition(state.endBlockId, "end");
        } else {
            editor.setSelection(state.startBlockId, state.endBlockId);
        }
    } catch {
        return false;
    }
    editor.focus();
    documentObject
        .querySelector<HTMLElement>(`[data-id="${state.endBlockId}"]`)
        ?.scrollIntoView({ block: "center" });
    return true;
}
