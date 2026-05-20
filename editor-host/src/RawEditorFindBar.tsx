import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import {
    buildEditorFindReplacementChange,
    buildEditorFindReplacementChanges,
    clampEditorFindIndex,
    findEditorMatches,
    nextEditorFindIndex,
    type EditorFindMatch,
    type EditorFindOptions,
} from "./editorFind.ts";

/**
 * Per-note find request the parent can send to the bar: an `id` to
 * de-dupe focus requests and a `replace` flag controlling whether the
 * replace input pops open.  Ported verbatim from
 * `src/components/RawEditorFindBar.tsx` so the React-side reference
 * tests are syntactically compatible.
 */
export interface RawEditorFindRequest {
    id: number;
    path: string;
    replace: boolean;
}

interface RawEditorFindBarProps {
    doc: string;
    onClose: () => void;
    onReplaceOpenChange: (open: boolean) => void;
    open: boolean;
    path: string;
    replaceOpen: boolean;
    request?: RawEditorFindRequest | null;
    viewRef: React.MutableRefObject<EditorView | null>;
}

function selectMatch(view: EditorView, match: EditorFindMatch, focusEditor: boolean): void {
    view.dispatch({
        selection: { anchor: match.from, head: match.to },
        effects: EditorView.scrollIntoView(match.from, { y: "center" }),
    });
    if (focusEditor) view.focus();
}

function matchStatusText(
    error: string | null,
    activeIndex: number,
    matchCount: number,
): string {
    if (error === "Invalid regex") return "Invalid regex";
    if (error) return "Regex must match text";
    if (matchCount === 0) return "No matches";
    return `${clampEditorFindIndex(activeIndex, matchCount) + 1} / ${matchCount}`;
}

function useRequestFocus({
    inputRef,
    onReplaceOpenChange,
    open,
    path,
    request,
}: {
    inputRef: React.RefObject<HTMLInputElement | null>;
    onReplaceOpenChange: (open: boolean) => void;
    open: boolean;
    path: string;
    request?: RawEditorFindRequest | null;
}) {
    useEffect(() => {
        if (!open || !request || request.path !== path) return;
        if (request.replace) onReplaceOpenChange(true);

        const frameId = requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        });
        return () => cancelAnimationFrame(frameId);
    }, [inputRef, onReplaceOpenChange, open, path, request]);
}

function focusEditorOnNextFrame(viewRef: React.MutableRefObject<EditorView | null>): void {
    requestAnimationFrame(() => viewRef.current?.focus());
}

function closeRawEditorFind(
    onClose: () => void,
    viewRef: React.MutableRefObject<EditorView | null>,
): void {
    onClose();
    focusEditorOnNextFrame(viewRef);
}

function handleRawEditorFindKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
    close: () => void,
    moveMatch: (direction: 1 | -1) => void,
): void {
    if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
    }
    if (event.key !== "Enter") return;

    event.preventDefault();
    moveMatch(event.shiftKey ? -1 : 1);
}

function handleRawEditorFindBarKeyDown(
    event: React.KeyboardEvent<HTMLDivElement>,
    close: () => void,
): void {
    if (event.key !== "Escape") return;

    event.preventDefault();
    close();
}

function selectActiveEditorFindMatch(
    viewRef: React.MutableRefObject<EditorView | null>,
    open: boolean,
    activeMatch?: EditorFindMatch,
): void {
    const view = viewRef.current;
    if (!open || !view || !activeMatch) return;
    selectMatch(view, activeMatch, false);
}

function replaceCurrentEditorFindMatch({
    activeMatch,
    options,
    query,
    replacement,
    viewRef,
}: {
    activeMatch?: EditorFindMatch;
    options: EditorFindOptions;
    query: string;
    replacement: string;
    viewRef: React.MutableRefObject<EditorView | null>;
}): void {
    const view = viewRef.current;
    if (!view || !activeMatch) return;

    const change = buildEditorFindReplacementChange(activeMatch, query, replacement, options);
    view.dispatch({
        changes: change,
        selection: { anchor: change.from, head: change.from + change.insert.length },
        effects: EditorView.scrollIntoView(change.from, { y: "center" }),
    });
    view.focus();
}

function replaceAllEditorFindMatches({
    matches,
    options,
    query,
    replacement,
    viewRef,
}: {
    matches: readonly EditorFindMatch[];
    options: EditorFindOptions;
    query: string;
    replacement: string;
    viewRef: React.MutableRefObject<EditorView | null>;
}): boolean {
    const view = viewRef.current;
    if (!view || matches.length === 0) return false;

    const changes = buildEditorFindReplacementChanges(matches, query, replacement, options);
    view.dispatch({ changes });
    view.focus();
    return true;
}

interface RawEditorFindController {
    caseSensitive: boolean;
    close: () => void;
    findInputRef: React.RefObject<HTMLInputElement | null>;
    handleBarKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
    handleFindChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    handleFindKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    hasMatches: boolean;
    moveNext: () => void;
    movePrevious: () => void;
    query: string;
    regex: boolean;
    replaceAll: () => void;
    replaceCurrent: () => void;
    replacement: string;
    setReplacement: (value: string) => void;
    status: string;
    toggleCaseSensitive: () => void;
    toggleRegex: () => void;
}

function useRawEditorFindController({
    doc,
    onClose,
    onReplaceOpenChange,
    open,
    path,
    request,
    viewRef,
}: Omit<RawEditorFindBarProps, "replaceOpen">): RawEditorFindController {
    const inputRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState("");
    const [replacement, setReplacement] = useState("");
    const [regex, setRegex] = useState(false);
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const options = useMemo<EditorFindOptions>(
        () => ({ caseSensitive, regex }),
        [caseSensitive, regex],
    );
    const result = useMemo(() => findEditorMatches(doc, query, options), [doc, options, query]);
    const clampedActiveIndex = clampEditorFindIndex(activeIndex, result.matches.length);
    const activeMatch = result.matches.at(clampedActiveIndex);
    const status = matchStatusText(result.error, clampedActiveIndex, result.matches.length);
    const hasMatches = result.matches.length > 0 && !result.error;

    useRequestFocus({ inputRef, onReplaceOpenChange, open, path, request });

    useEffect(() => {
        selectActiveEditorFindMatch(viewRef, open, activeMatch);
    }, [activeMatch, open, viewRef]);

    const moveMatch = useCallback(
        (direction: 1 | -1) => {
            setActiveIndex((current) =>
                nextEditorFindIndex(current, result.matches.length, direction),
            );
        },
        [result.matches.length],
    );
    const movePrevious = useCallback(() => moveMatch(-1), [moveMatch]);
    const moveNext = useCallback(() => moveMatch(1), [moveMatch]);
    const handleFindChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setQuery(event.target.value);
        setActiveIndex(0);
    }, []);

    const close = useCallback(
        () => closeRawEditorFind(onClose, viewRef),
        [onClose, viewRef],
    );

    const handleFindKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLInputElement>) => {
            handleRawEditorFindKeyDown(event, close, moveMatch);
        },
        [close, moveMatch],
    );

    const handleBarKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLDivElement>) => {
            handleRawEditorFindBarKeyDown(event, close);
        },
        [close],
    );

    const replaceCurrent = useCallback(() => {
        replaceCurrentEditorFindMatch({ activeMatch, options, query, replacement, viewRef });
    }, [activeMatch, options, query, replacement, viewRef]);

    const replaceAll = useCallback(() => {
        if (
            replaceAllEditorFindMatches({
                matches: result.matches,
                options,
                query,
                replacement,
                viewRef,
            })
        ) {
            setActiveIndex(0);
        }
    }, [options, query, replacement, result.matches, viewRef]);

    return {
        caseSensitive,
        close,
        findInputRef: inputRef,
        handleBarKeyDown,
        handleFindChange,
        handleFindKeyDown,
        hasMatches,
        moveNext,
        movePrevious,
        query,
        regex,
        replaceAll,
        replaceCurrent,
        replacement,
        setReplacement,
        status,
        toggleCaseSensitive: () => setCaseSensitive((value) => !value),
        toggleRegex: () => setRegex((value) => !value),
    };
}

export function RawEditorFindBar(props: RawEditorFindBarProps) {
    const { onReplaceOpenChange, open, replaceOpen } = props;
    const controller = useRawEditorFindController(props);
    const {
        caseSensitive,
        close,
        findInputRef,
        handleBarKeyDown,
        handleFindChange,
        handleFindKeyDown,
        hasMatches,
        moveNext,
        movePrevious,
        query,
        regex,
        replaceAll,
        replaceCurrent,
        replacement,
        setReplacement,
        status,
        toggleCaseSensitive,
        toggleRegex,
    } = controller;

    if (!open) return null;

    return (
        <div
            className="raw-editor-find-bar"
            data-testid="raw-editor-find-bar"
            onKeyDown={handleBarKeyDown}
        >
            <div className="raw-editor-find-row">
                <button
                    type="button"
                    aria-label={
                        replaceOpen ? "Hide replace controls" : "Show replace controls"
                    }
                    title={replaceOpen ? "Hide replace controls" : "Show replace controls"}
                    data-replace-open={replaceOpen}
                    onClick={() => onReplaceOpenChange(!replaceOpen)}
                >
                    {replaceOpen ? "v" : ">"}
                </button>
                <input
                    ref={findInputRef}
                    type="search"
                    aria-label="Find"
                    placeholder="Find"
                    value={query}
                    onChange={handleFindChange}
                    onKeyDown={handleFindKeyDown}
                    data-testid="raw-editor-find-input"
                />
                <span
                    className="raw-editor-find-count"
                    aria-live="polite"
                    data-testid="raw-editor-find-count"
                >
                    {status}
                </span>
                <button
                    type="button"
                    aria-label="Previous match"
                    title="Previous match"
                    disabled={!hasMatches}
                    onClick={movePrevious}
                >
                    ^
                </button>
                <button
                    type="button"
                    aria-label="Next match"
                    title="Next match"
                    disabled={!hasMatches}
                    onClick={moveNext}
                >
                    v
                </button>
                <button
                    type="button"
                    aria-label="Use regular expression"
                    aria-pressed={regex}
                    title="Use regular expression"
                    onClick={toggleRegex}
                >
                    .*
                </button>
                <button
                    type="button"
                    aria-label="Match case"
                    aria-pressed={caseSensitive}
                    title="Match case"
                    onClick={toggleCaseSensitive}
                >
                    Aa
                </button>
                <button type="button" aria-label="Close find bar" title="Close" onClick={close}>
                    x
                </button>
            </div>
            {replaceOpen && (
                <div className="raw-editor-replace-row">
                    <input
                        type="text"
                        aria-label="Replace"
                        placeholder="Replace"
                        value={replacement}
                        onChange={(event) => setReplacement(event.target.value)}
                        data-testid="raw-editor-replace-input"
                    />
                    <button
                        type="button"
                        aria-label="Replace"
                        disabled={!hasMatches}
                        onClick={replaceCurrent}
                    >
                        Replace
                    </button>
                    <button
                        type="button"
                        aria-label="Replace all"
                        disabled={!hasMatches}
                        onClick={replaceAll}
                    >
                        Replace all
                    </button>
                </div>
            )}
        </div>
    );
}
