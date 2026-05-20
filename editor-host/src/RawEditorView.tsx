import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    buildRawLanguageExtension,
    detectYamlError,
    inferRawLanguage,
} from "./rawEditorUtils.ts";
import { useCodeMirror } from "./useCodeMirror.ts";
import { RawEditorFindBar, type RawEditorFindRequest } from "./RawEditorFindBar.tsx";

/**
 * Public props for the embedded raw editor.  Kept close to the React
 * reference (`src/components/RawEditorView.tsx`) so a future bridge
 * envelope that ships vault entries / source entry can land without
 * re-shaping the component.  Today the editor-host has no concept of
 * vault entries — the suggestion-menu props from the React reference
 * are not surfaced here; they will reappear once a `WikilinkQuery`
 * bridge envelope ships.
 */
export interface RawEditorViewProps {
    content: string;
    path: string;
    onContentChange: (path: string, content: string) => void;
    onSave: () => void;
    /** Mutable ref updated on every keystroke with the latest doc
     *  string.  Mirrors the React reference so the parent can flush
     *  debounced content before unmount. */
    latestContentRef?: React.MutableRefObject<string | null>;
    findRequest?: RawEditorFindRequest | null;
}

const DEBOUNCE_MS = 500;

type PendingChangeRefs = {
    debounceRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
    latestDocRef: React.MutableRefObject<string>;
    onContentChangeRef: React.MutableRefObject<RawEditorViewProps["onContentChange"]>;
    pathRef: React.MutableRefObject<string>;
};

function useLatestRef<T>(value: T): React.MutableRefObject<T> {
    const ref = useRef(value);
    useEffect(() => {
        ref.current = value;
    }, [value]);
    return ref;
}

function flushPendingRawEditorChange({
    debounceRef,
    latestDocRef,
    onContentChangeRef,
    pathRef,
}: PendingChangeRefs): void {
    if (!debounceRef.current) return;

    clearTimeout(debounceRef.current);
    debounceRef.current = null;
    onContentChangeRef.current(pathRef.current, latestDocRef.current);
}

function RawEditorYamlErrorBanner({ error }: { error: string | null }) {
    if (!error) return null;

    return (
        <div className="raw-editor-yaml-error" role="alert" data-testid="raw-editor-yaml-error">
            <span className="raw-editor-yaml-error-label">YAML error:</span>
            <span>{error}</span>
        </div>
    );
}

type RawEditorPendingChanges = PendingChangeRefs & {
    handleDocChange: (doc: string) => void;
    handleSave: () => void;
    yamlError: string | null;
};

function useRawEditorPendingChanges({
    content,
    latestContentRef,
    onContentChange,
    onSave,
    path,
}: Pick<
    RawEditorViewProps,
    "content" | "latestContentRef" | "onContentChange" | "onSave" | "path"
>): RawEditorPendingChanges {
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pathRef = useLatestRef(path);
    const onContentChangeRef = useLatestRef(onContentChange);
    const onSaveRef = useLatestRef(onSave);
    const latestContentRefStable = useRef(latestContentRef);
    const latestDocRef = useRef(content);
    const [yamlError, setYamlError] = useState<string | null>(() => detectYamlError(content));

    useEffect(() => {
        if (latestContentRef) latestContentRef.current = content;
    }, [latestContentRef, content]);
    useEffect(() => {
        latestContentRefStable.current = latestContentRef;
    }, [latestContentRef]);

    const handleDocChange = useCallback(
        (doc: string) => {
            latestDocRef.current = doc;
            if (latestContentRefStable.current) latestContentRefStable.current.current = doc;
            setYamlError(detectYamlError(doc));
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
                onContentChangeRef.current(pathRef.current, doc);
            }, DEBOUNCE_MS);
        },
        [latestContentRefStable, onContentChangeRef, pathRef],
    );

    const handleSave = useCallback(() => {
        flushPendingRawEditorChange({ debounceRef, latestDocRef, onContentChangeRef, pathRef });
        onSaveRef.current();
    }, [onContentChangeRef, onSaveRef, pathRef]);

    useEffect(() => {
        return () => {
            flushPendingRawEditorChange({
                debounceRef,
                latestDocRef,
                onContentChangeRef,
                pathRef,
            });
        };
    }, [onContentChangeRef, pathRef]);

    return {
        debounceRef,
        handleDocChange,
        handleSave,
        latestDocRef,
        onContentChangeRef,
        pathRef,
        yamlError,
    };
}

export function RawEditorView({
    content,
    path,
    onContentChange,
    onSave,
    latestContentRef,
    findRequest,
}: RawEditorViewProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [rawDoc, setRawDoc] = useState(content);
    const [findOpen, setFindOpen] = useState(false);
    const [replaceOpen, setReplaceOpen] = useState(false);
    const pendingChanges = useRawEditorPendingChanges({
        content,
        latestContentRef,
        onContentChange,
        onSave,
        path,
    });

    const language = useMemo(() => {
        const lang = inferRawLanguage(path);
        return buildRawLanguageExtension(lang);
    }, [path]);

    const handleDocChange = useCallback(
        (doc: string) => {
            setRawDoc(doc);
            pendingChanges.handleDocChange(doc);
        },
        [pendingChanges],
    );

    const handleEscape = useCallback(() => {
        if (!findOpen) return false;
        setFindOpen(false);
        return true;
    }, [findOpen]);

    const handleOpenFind = useCallback(() => {
        setFindOpen(true);
        return true;
    }, []);

    const viewRef = useCodeMirror(
        containerRef,
        content,
        {
            onDocChange: handleDocChange,
            onCursorActivity: () => {},
            onSave: pendingChanges.handleSave,
            onEscape: handleEscape,
            onOpenFind: handleOpenFind,
        },
        { language, enableFrontmatterHighlight: true },
    );

    useEffect(() => {
        setRawDoc(content);
    }, [content]);

    useEffect(() => {
        if (!findRequest || findRequest.path !== path) return;
        setFindOpen(true);
        setReplaceOpen(findRequest.replace);
    }, [findRequest, path]);

    return (
        <div className="raw-editor-root" role="presentation">
            <RawEditorYamlErrorBanner error={pendingChanges.yamlError} />
            <RawEditorFindBar
                doc={rawDoc}
                onClose={() => setFindOpen(false)}
                onReplaceOpenChange={setReplaceOpen}
                open={findOpen}
                path={path}
                replaceOpen={replaceOpen}
                request={findRequest}
                viewRef={viewRef}
            />
            <div
                ref={containerRef}
                className="raw-editor-codemirror"
                data-testid="raw-editor-codemirror"
                aria-label="Raw text editor"
            />
        </div>
    );
}
