import { describe, expect, it } from "vitest";
import {
    isRecoverableBlockNoteRenderError,
    isRecoveredBlockNoteRenderError,
    markRecoveredBlockNoteRenderError,
} from "./blockNoteRenderRecovery.ts";

describe("blockNoteRenderRecovery", () => {
    it("marks only recovered BlockNote missing-id render errors for root suppression", () => {
        const error = new Error("Block doesn't have id");

        expect(isRecoverableBlockNoteRenderError(error)).toBe(true);
        expect(isRecoveredBlockNoteRenderError(error, "")).toBe(false);

        markRecoveredBlockNoteRenderError(error);

        expect(isRecoveredBlockNoteRenderError(error, "")).toBe(true);
        expect(isRecoveredBlockNoteRenderError(new Error("Other render failure"), "")).toBe(false);
    });

    it("recognizes recovered BlockNote errors from the React component stack fallback", () => {
        expect(isRecoveredBlockNoteRenderError(
            new Error("Block doesn't have id"),
            "\n    in MermaidBlock\n    in BlockNoteRenderRecoveryBoundary",
        )).toBe(true);
    });
});
