// ---------------------------------------------------------------------------
// BlockNote table handles regression (ported from
// `src/lib/blockNoteTableHandles.regression.test.ts`).
// ---------------------------------------------------------------------------
//
// Drag-handle attachment on a `prosemirror-tables`-backed BlockNote
// table is brittle under three failure modes that the mirrored
// `@blocknote/core` patch (`patches/@blocknote__core@0.46.2.patch`)
// turns into a `hideHandles({ resetCell, resetDragging })` no-op
// instead of throwing:
//
// 1. `view.update()` runs after the table block has been removed
//    from the document (e.g. via a reload that swaps the doc out).
// 2. `colDragStart` / `rowDragStart` fire with no hovered cell or
//    a missing `tablePos`.
// 3. A drop event lands without a hovered row / column index.
//
// Reaching `TableHandlesExtension` / `TableHandlesView` requires a
// type-level back-door (the symbols ship in `dist/` but the public
// type index does not re-export them) — the Tauri repo did the same
// from `node_modules/.../src/extensions/TableHandles/...`.  We import
// from the published `extensions` runtime entry instead so the test
// targets exactly the patched bundle.

import { afterEach, describe, expect, it, vi } from "vitest";
// `@blocknote/core/extensions` exposes `TableHandlesExtension` and
// `TableHandlesView` at runtime even though the public type-roll only
// declares them under the internal path.  We re-type the import below
// so TypeScript doesn't fail on the missing public type alias.
import * as blocknoteExtensions from "@blocknote/core/extensions";

type TableHandlesExtensionFactory = (options?: unknown) => {
    prosemirrorPlugins?: ReadonlyArray<{
        spec: { view?: (pmView: unknown) => unknown };
    }>;
    colDragStart: (event: {
        dataTransfer: DataTransfer | null;
        clientX: number;
    }) => void;
    rowDragStart: (event: {
        dataTransfer: DataTransfer | null;
        clientY: number;
    }) => void;
    dragEnd: () => void;
    addRowOrColumn: (
        index: number,
        direction:
            | { orientation: "row"; side: "above" | "below" }
            | { orientation: "column"; side: "left" | "right" },
    ) => void;
};

interface TableHandlesViewLike {
    state?: Record<string, unknown>;
    tableElement?: HTMLElement;
    tablePos?: number;
    update(): void;
    destroy(): void;
    dropHandler(event: DragEvent | { preventDefault: () => void }): boolean;
}

interface TableHandlesViewConstructor {
    new (
        editor: unknown,
        pmView: unknown,
        emitUpdate: (state: unknown) => void,
    ): TableHandlesViewLike;
}

const TableHandlesExtension = (
    blocknoteExtensions as unknown as {
        TableHandlesExtension: (
            options?: unknown,
        ) => (env: { editor: unknown }) => ReturnType<TableHandlesExtensionFactory>;
    }
).TableHandlesExtension;

const TableHandlesView = (
    blocknoteExtensions as unknown as { TableHandlesView: TableHandlesViewConstructor }
).TableHandlesView;

function createTableBlock() {
    return {
        id: "table-block",
        type: "table",
        content: {
            type: "tableContent",
            rows: [
                { cells: ["Head 1", "Head 2"] },
                { cells: ["A", "B"] },
            ],
        },
    };
}

function createSelectionStateThatRejectsNaNPositions() {
    const selectionTransaction = {
        setSelection: vi.fn(),
    };
    const resolvedPosition = {
        posAtIndex: vi.fn((index: number) => index),
    };

    return {
        doc: {
            resolve: vi.fn((position: number) => {
                if (!Number.isFinite(position)) {
                    throw new Error(`Position ${position} out of range`);
                }
                return resolvedPosition;
            }),
        },
        tr: selectionTransaction,
        apply: vi.fn(),
    };
}

function mountTableHandlesExtension() {
    const editorRoot = document.createElement("div");
    document.body.appendChild(editorRoot);

    const selectionState = createSelectionStateThatRejectsNaNPositions();
    const dispatch = vi.fn();
    const editor = {
        headless: true,
        isEditable: true,
        prosemirrorView: {
            root: document,
        },
        exec: vi.fn(
            (command: (state: unknown, dispatch: unknown) => unknown) =>
                command(selectionState as unknown, dispatch as unknown),
        ),
        transact: vi.fn(),
    };

    const extension = TableHandlesExtension()({ editor });
    const plugin = extension.prosemirrorPlugins?.[0];

    if (!plugin?.spec.view) {
        throw new Error("TableHandlesExtension did not register a plugin view");
    }

    const view = plugin.spec.view({
        dom: editorRoot,
        root: document,
    }) as TableHandlesViewLike;

    return { editor, extension, view, selectionState };
}

function showTableHandles(view: TableHandlesViewLike) {
    view.state = {
        block: createTableBlock(),
        show: true,
        showAddOrRemoveRowsButton: true,
        showAddOrRemoveColumnsButton: true,
        rowIndex: 0,
        colIndex: 0,
        draggingState: undefined,
    };
}

function expectAddRowAndColumnActionsToStaySafe(
    extension: ReturnType<typeof mountTableHandlesExtension>["extension"],
    index: number,
) {
    expect(() =>
        extension.addRowOrColumn(index, { orientation: "row", side: "below" }),
    ).not.toThrow();
    expect(() =>
        extension.addRowOrColumn(index, {
            orientation: "column",
            side: "right",
        }),
    ).not.toThrow();
}

describe("BlockNote table handles regression", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("hides stale table handles instead of throwing when tbody is missing during update", () => {
        const block = createTableBlock();
        const editorRoot = document.createElement("div");
        document.body.appendChild(editorRoot);

        const editor = {
            getBlock: vi.fn(() => block),
        };
        const emitUpdate = vi.fn();

        const view = new TableHandlesView(
            editor,
            {
                dom: editorRoot,
                root: document,
            },
            emitUpdate,
        );

        view.state = {
            block,
            show: true,
            showAddOrRemoveRowsButton: true,
            showAddOrRemoveColumnsButton: true,
            rowIndex: 0,
            colIndex: 0,
        };

        const staleTableWrapper = document.createElement("div");
        editorRoot.appendChild(staleTableWrapper);
        view.tableElement = staleTableWrapper;

        expect(() => view.update()).not.toThrow();
        expect(view.state?.show).toBe(false);
        expect(view.state?.showAddOrRemoveRowsButton).toBe(false);
        expect(view.state?.showAddOrRemoveColumnsButton).toBe(false);
        expect(emitUpdate).toHaveBeenCalled();

        view.destroy();
    });

    it("hides stale table handles instead of throwing when a reload clears the hovered block", () => {
        const editorRoot = document.createElement("div");
        document.body.appendChild(editorRoot);

        const editor = {
            getBlock: vi.fn(),
        };
        const emitUpdate = vi.fn();

        const view = new TableHandlesView(
            editor,
            {
                dom: editorRoot,
                root: document,
            },
            emitUpdate,
        );

        view.state = {
            block: undefined,
            show: true,
            showAddOrRemoveRowsButton: true,
            showAddOrRemoveColumnsButton: true,
            rowIndex: 0,
            colIndex: 0,
            draggingState: {
                draggedCellOrientation: "row",
                originalIndex: 0,
                mousePos: 10,
            },
        };

        expect(() => view.update()).not.toThrow();
        expect(editor.getBlock).not.toHaveBeenCalled();
        expect(view.state?.show).toBe(false);
        expect(view.state?.showAddOrRemoveRowsButton).toBe(false);
        expect(view.state?.showAddOrRemoveColumnsButton).toBe(false);
        expect(view.state?.rowIndex).toBeUndefined();
        expect(view.state?.colIndex).toBeUndefined();
        expect(view.state?.draggingState).toBeUndefined();
        expect(emitUpdate).toHaveBeenCalled();

        view.destroy();
    });

    it("ignores stale table drag starts instead of throwing when hover state is unavailable", () => {
        const { editor, extension, view } = mountTableHandlesExtension();

        expect(() =>
            extension.colDragStart({ dataTransfer: null, clientX: 10 }),
        ).not.toThrow();
        expect(() =>
            extension.rowDragStart({ dataTransfer: null, clientY: 10 }),
        ).not.toThrow();
        expect(editor.transact).not.toHaveBeenCalled();

        view.destroy();
    });

    it("ignores stale table drag end events instead of throwing after state disappears", () => {
        const { extension, view } = mountTableHandlesExtension();

        expect(() => extension.dragEnd()).not.toThrow();

        view.destroy();
    });

    it("ignores add row or column actions when the selection target is stale", () => {
        const { editor, extension, view } = mountTableHandlesExtension();

        showTableHandles(view);
        view.tablePos = undefined;

        expectAddRowAndColumnActionsToStaySafe(extension, 0);
        expect(editor.exec).not.toHaveBeenCalled();

        view.tablePos = 0;

        expectAddRowAndColumnActionsToStaySafe(extension, Number.NaN);
        expect(editor.exec).not.toHaveBeenCalled();

        view.destroy();
    });

    it("cancels stale table drops instead of throwing when no hovered row or column is available", () => {
        const block = createTableBlock();
        const editorRoot = document.createElement("div");
        document.body.appendChild(editorRoot);

        const editor = {
            getBlock: vi.fn(() => block),
        };
        const emitUpdate = vi.fn();

        const view = new TableHandlesView(
            editor,
            {
                dom: editorRoot,
                root: document,
            },
            emitUpdate,
        );

        view.state = {
            block,
            show: true,
            showAddOrRemoveRowsButton: true,
            showAddOrRemoveColumnsButton: true,
            referencePosTable: {
                left: 0,
                top: 0,
                right: 100,
                bottom: 100,
            },
            rowIndex: undefined,
            colIndex: undefined,
            draggingState: {
                draggedCellOrientation: "row",
                originalIndex: 0,
                mousePos: 10,
            },
            widgetContainer: undefined,
        };

        const dropEvent = {
            preventDefault: vi.fn(),
        };

        expect(() => view.dropHandler(dropEvent)).not.toThrow();
        expect(dropEvent.preventDefault).toHaveBeenCalled();
        expect(view.state?.draggingState).toBeUndefined();
        expect(view.state?.show).toBe(false);
        expect(view.state?.rowIndex).toBeUndefined();
        expect(view.state?.colIndex).toBeUndefined();
        expect(emitUpdate).toHaveBeenCalled();

        view.destroy();
    });
});
