import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EditorApp } from "./EditorApp.tsx";
import { send } from "./bridge.ts";
import "./style.css";

const root = document.getElementById("editor-root");
if (!root) throw new Error("missing #editor-root in index.html");

createRoot(root).render(
    <StrictMode>
        <EditorApp />
    </StrictMode>,
);

// Announce ready *after* React commits the EditorApp tree so the
// bridge `onReceive` install has already run and `tolariaBridge` is
// installed by the time the native side acts on `Ready`.
//
// React renders synchronously inside `createRoot().render(...)`, but
// `BlockNoteViewRaw` mounts inside an effect — a microtask after the
// commit phase.  Defer the `ready` send by one queue tick so the
// install runs before the native side fires a `NoteOpen`.
queueMicrotask(() => send({ k: "ready" }));
