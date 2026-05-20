// Test-only setup — imported by Vitest via the `setupFiles` entry in
// `vite.config.ts`.  Extends `expect` with `@testing-library/jest-dom`
// matchers so Phase 8.29 raw-mode tests (which mirror the React-era
// reference suite) can use `toBeInTheDocument`, `toHaveTextContent`,
// `toHaveFocus`, etc., without sprinkling polyfills in each file.
//
// Also installs a React Testing Library `afterEach` cleanup hook —
// the editor-host vitest config sets `globals: false`, which bypasses
// the auto-cleanup wired by `@testing-library/react`'s default import.
// Without this, mounting the same `RawEditorView` in two consecutive
// tests leaves the DOM littered with previous trees and `getByTestId`
// errors out with "multiple elements".
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
    cleanup();
});
