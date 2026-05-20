import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
    MEMORY_PROBE_INTERVAL_MS,
    OOM_REPORT_COOLDOWN_MS,
    OOM_THRESHOLD_FRACTION,
    readMemorySnapshot,
    useEditorMemoryProbeController,
    type MemorySnapshot,
} from "./useEditorMemoryProbeController.ts";

// ---------------------------------------------------------------------------
// useEditorMemoryProbeController — editor-host port
// ---------------------------------------------------------------------------
//
// The React reference's probe runs a vault-loading experiment.  The
// editor-host port is passive — a `performance.memory` sampler that
// fires telemetry on threshold breach.  These tests verify the
// timer-driven sampling cadence, the OOM-event cooldown, and the
// browser-compat fall-through for engines without `performance.memory`.

function makeSnapshot(used: number, limit: number, sampledAtMs: number): MemorySnapshot {
    return {
        usedJSHeapSize: used,
        jsHeapSizeLimit: limit,
        totalJSHeapSize: used,
        sampledAtMs,
    };
}

describe("readMemorySnapshot", () => {
    it("returns null when performance.memory is missing", () => {
        const original = (performance as unknown as { memory?: unknown }).memory;
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test harness
            delete (performance as any).memory;
            expect(readMemorySnapshot()).toBeNull();
        } finally {
            if (original !== undefined) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test harness
                (performance as any).memory = original;
            }
        }
    });

    it("returns a populated snapshot when performance.memory is present", () => {
        const original = (performance as unknown as { memory?: unknown }).memory;
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test harness
            (performance as any).memory = {
                usedJSHeapSize: 1_000,
                jsHeapSizeLimit: 10_000,
                totalJSHeapSize: 2_000,
            };
            const snapshot = readMemorySnapshot(() => 42);
            expect(snapshot).toEqual({
                usedJSHeapSize: 1_000,
                jsHeapSizeLimit: 10_000,
                totalJSHeapSize: 2_000,
                sampledAtMs: 42,
            });
        } finally {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test harness
            (performance as any).memory = original;
        }
    });
});

describe("useEditorMemoryProbeController", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("samples once on start and at every interval thereafter", () => {
        const sampler = vi.fn().mockReturnValue(makeSnapshot(10, 100, 0));
        const { result } = renderHook(() =>
            useEditorMemoryProbeController({ sampler }),
        );

        act(() => {
            result.current.start();
        });

        expect(sampler).toHaveBeenCalledTimes(1);
        expect(result.current.latestRef.current).toEqual(makeSnapshot(10, 100, 0));

        act(() => {
            vi.advanceTimersByTime(MEMORY_PROBE_INTERVAL_MS * 3);
        });
        expect(sampler).toHaveBeenCalledTimes(4);
    });

    it("stop halts further sampling", () => {
        const sampler = vi.fn().mockReturnValue(makeSnapshot(10, 100, 0));
        const { result } = renderHook(() =>
            useEditorMemoryProbeController({ sampler }),
        );

        act(() => {
            result.current.start();
        });
        act(() => {
            result.current.stop();
            vi.advanceTimersByTime(MEMORY_PROBE_INTERVAL_MS * 5);
        });

        expect(sampler).toHaveBeenCalledTimes(1);
    });

    it("emits oom_warning when usedJSHeapSize crosses the threshold", () => {
        const emit = vi.fn();
        const sampler = vi.fn()
            .mockReturnValueOnce(makeSnapshot(50, 100, 1_000))
            .mockReturnValueOnce(makeSnapshot(95, 100, 2_000));
        const { result } = renderHook(() =>
            useEditorMemoryProbeController({ sampler, emit }),
        );

        act(() => {
            result.current.start();
        });
        expect(emit).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(MEMORY_PROBE_INTERVAL_MS);
        });
        expect(emit).toHaveBeenCalledWith("editor_host.memory.oom_warning", {
            usedJSHeapSize: 95,
            jsHeapSizeLimit: 100,
            usedFraction: 0.95,
        });
    });

    it("respects the cooldown between consecutive OOM warnings", () => {
        const emit = vi.fn();
        // Three consecutive samples all over the threshold but with
        // tight time intervals — only the first should report.
        const sampler = vi.fn()
            .mockReturnValueOnce(makeSnapshot(95, 100, 1_000))
            .mockReturnValueOnce(makeSnapshot(95, 100, 1_000 + MEMORY_PROBE_INTERVAL_MS))
            .mockReturnValueOnce(makeSnapshot(95, 100, 1_000 + MEMORY_PROBE_INTERVAL_MS * 2));
        const { result } = renderHook(() =>
            useEditorMemoryProbeController({ sampler, emit }),
        );

        act(() => {
            result.current.start();
            vi.advanceTimersByTime(MEMORY_PROBE_INTERVAL_MS * 2);
        });

        expect(emit).toHaveBeenCalledTimes(1);
    });

    it("re-emits after the cooldown lapses", () => {
        const emit = vi.fn();
        const sampler = vi.fn()
            .mockReturnValueOnce(makeSnapshot(95, 100, 0))
            .mockReturnValueOnce(makeSnapshot(95, 100, OOM_REPORT_COOLDOWN_MS + 1));
        const { result } = renderHook(() =>
            useEditorMemoryProbeController({ sampler, emit }),
        );

        act(() => {
            result.current.start();
            vi.advanceTimersByTime(MEMORY_PROBE_INTERVAL_MS);
        });

        expect(emit).toHaveBeenCalledTimes(2);
    });

    it("no-ops when the sampler returns null (Safari / Firefox)", () => {
        const emit = vi.fn();
        const sampler = vi.fn().mockReturnValue(null);
        const { result } = renderHook(() =>
            useEditorMemoryProbeController({ sampler, emit }),
        );

        act(() => {
            result.current.start();
            vi.advanceTimersByTime(MEMORY_PROBE_INTERVAL_MS * 5);
        });

        expect(emit).not.toHaveBeenCalled();
        expect(result.current.latestRef.current).toBeNull();
    });

    it("start is idempotent — repeat calls do not stack timers", () => {
        const sampler = vi.fn().mockReturnValue(makeSnapshot(10, 100, 0));
        const { result } = renderHook(() =>
            useEditorMemoryProbeController({ sampler }),
        );

        act(() => {
            result.current.start();
            result.current.start();
            result.current.start();
        });
        // Only one immediate sample.
        expect(sampler).toHaveBeenCalledTimes(1);

        act(() => {
            vi.advanceTimersByTime(MEMORY_PROBE_INTERVAL_MS);
        });
        // One additional tick — *not* three.
        expect(sampler).toHaveBeenCalledTimes(2);
    });

    it("stops sampling on unmount even if stop() was never called", () => {
        const sampler = vi.fn().mockReturnValue(makeSnapshot(10, 100, 0));
        const { result, unmount } = renderHook(() =>
            useEditorMemoryProbeController({ sampler }),
        );

        act(() => {
            result.current.start();
        });
        unmount();

        act(() => {
            vi.advanceTimersByTime(MEMORY_PROBE_INTERVAL_MS * 5);
        });
        expect(sampler).toHaveBeenCalledTimes(1);
    });

    it("uses the configured threshold override", () => {
        const emit = vi.fn();
        const sampler = vi.fn().mockReturnValue(makeSnapshot(60, 100, 1_000));
        const { result } = renderHook(() =>
            useEditorMemoryProbeController({ sampler, emit, threshold: 0.5 }),
        );

        act(() => {
            result.current.start();
        });
        expect(emit).toHaveBeenCalledWith(
            "editor_host.memory.oom_warning",
            expect.objectContaining({ usedFraction: 0.6 }),
        );
    });

    it("does not emit when jsHeapSizeLimit is zero", () => {
        const emit = vi.fn();
        const sampler = vi.fn().mockReturnValue(makeSnapshot(100, 0, 1_000));
        const { result } = renderHook(() =>
            useEditorMemoryProbeController({ sampler, emit }),
        );

        act(() => {
            result.current.start();
        });
        expect(emit).not.toHaveBeenCalled();
    });
});

describe("memory probe defaults", () => {
    it("OOM threshold is set to a conservative 0.9", () => {
        expect(OOM_THRESHOLD_FRACTION).toBe(0.9);
    });
});
