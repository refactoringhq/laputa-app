// ---------------------------------------------------------------------------
// Editor memory probe controller (ADR-0115 Phase 8.30)
// ---------------------------------------------------------------------------
//
// The React reference's probe controller
// (`src/components/useEditorMemoryProbeController.ts`) drives a
// throughput experiment: mount N vault notes into hidden editor
// instances, settle, sample `performance.memory`, mount N more, etc.
// The editor-host has no vault access and no concept of off-screen
// editors — it owns *one* WKWebView at a time.  The 8.30 port keeps
// only the bits that survive the bridge boundary:
//
// - A passive `performance.memory` sampler that runs while the editor
//   is mounted.
// - Threshold detection: when `usedJSHeapSize / jsHeapSizeLimit`
//   crosses `OOM_THRESHOLD_FRACTION`, fire a telemetry event so the
//   native shell can react (e.g. flush dirty buffer + restart the
//   WKWebView before the OS kills the process).
//
// The actual telemetry → native wiring lands in Phase 10.6 — for now
// we route through the existing `telemetry.ts` shim which logs via
// `console.info`, matching the Phase 8.27 contract.
//
// Browser-compat: `performance.memory` is a non-standard Chromium API
// (`Performance.memory`).  Safari and Firefox return `undefined`, so
// the sampler must gracefully no-op there.

import { useCallback, useEffect, useRef } from "react";
import { trackEvent } from "./telemetry.ts";

/** Per-sample snapshot of `performance.memory`.  Captured as a plain
 *  object so the value can be JSON-serialized for telemetry. */
export interface MemorySnapshot {
    /** Bytes currently allocated to JS heap. */
    usedJSHeapSize: number;
    /** Bytes the heap *can* grow to before OOM. */
    jsHeapSizeLimit: number;
    /** Allocator's reserved heap window (allocated but not
     *  necessarily live).  Best-effort, may equal `usedJSHeapSize`. */
    totalJSHeapSize: number;
    /** `performance.now()` at sample time, for delta calculations. */
    sampledAtMs: number;
}

/** Polling interval — every 5 s is dense enough to catch a slow leak
 *  but light enough that an idle editor doesn't burn CPU.  Matches
 *  the React reference's `DEFAULT_PROBE_SETTLE_MS`. */
export const MEMORY_PROBE_INTERVAL_MS = 5_000;

/** Threshold ratio that triggers an OOM warning event.  90 % is the
 *  same heuristic the React-era controller uses for its dashboard. */
export const OOM_THRESHOLD_FRACTION = 0.9;

/** Minimum gap between consecutive OOM events.  Without this a leaky
 *  page would flood telemetry with one warning per sample. */
export const OOM_REPORT_COOLDOWN_MS = 60_000;

interface PerformanceMemoryShape {
    usedJSHeapSize: number;
    jsHeapSizeLimit: number;
    totalJSHeapSize: number;
}

/** Internal — read once per tick.  Returns `null` on Safari / Firefox
 *  where `performance.memory` is not exposed. */
export function readMemorySnapshot(now: () => number = performance.now.bind(performance)): MemorySnapshot | null {
    const perf = performance as unknown as { memory?: PerformanceMemoryShape };
    if (!perf.memory) return null;

    return {
        usedJSHeapSize: perf.memory.usedJSHeapSize,
        jsHeapSizeLimit: perf.memory.jsHeapSizeLimit,
        totalJSHeapSize: perf.memory.totalJSHeapSize,
        sampledAtMs: now(),
    };
}

export interface MemoryProbeControllerOptions {
    /** Polling interval override.  Defaults to
     *  [`MEMORY_PROBE_INTERVAL_MS`]. */
    intervalMs?: number;
    /** Threshold override.  Defaults to [`OOM_THRESHOLD_FRACTION`]. */
    threshold?: number;
    /** Cooldown override.  Defaults to [`OOM_REPORT_COOLDOWN_MS`]. */
    cooldownMs?: number;
    /** Optional sampler injection.  Tests use this to feed
     *  deterministic snapshots without monkey-patching
     *  `performance.memory` on the global. */
    sampler?: () => MemorySnapshot | null;
    /** Optional telemetry sink override.  Defaults to the
     *  editor-host's `trackEvent` shim. */
    emit?: (event: string, properties: Record<string, unknown>) => void;
}

/**
 * Drive a passive `performance.memory` poll while the host editor is
 * mounted.  Exposes:
 *
 * - `start()`: begin polling.  Idempotent — repeat calls are no-ops
 *   until `stop()` runs.
 * - `stop()`: cancel the poll.  Idempotent.
 * - `latestRef`: most recent snapshot (or `null` on
 *   non-Chromium engines).  Read-only — the hook owns the ref.
 *
 * The hook does *not* auto-start.  `EditorApp.tsx` is responsible for
 * calling `start()` after mount and `stop()` on unmount — that gives
 * future periscope captures a chance to pause sampling while a frame
 * is being recorded.
 */
export function useEditorMemoryProbeController({
    intervalMs = MEMORY_PROBE_INTERVAL_MS,
    threshold = OOM_THRESHOLD_FRACTION,
    cooldownMs = OOM_REPORT_COOLDOWN_MS,
    sampler = readMemorySnapshot,
    emit = trackEvent,
}: MemoryProbeControllerOptions = {}) {
    const latestRef = useRef<MemorySnapshot | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const lastOomReportAtRef = useRef<number>(Number.NEGATIVE_INFINITY);
    const samplerRef = useRef(sampler);
    const emitRef = useRef(emit);

    // Keep refs current without re-arming the interval — callers can
    // swap the sampler / telemetry sink without bouncing the polling
    // cadence.
    useEffect(() => {
        samplerRef.current = sampler;
    }, [sampler]);
    useEffect(() => {
        emitRef.current = emit;
    }, [emit]);

    const tick = useCallback(() => {
        const snapshot = samplerRef.current();
        if (snapshot === null) return;
        latestRef.current = snapshot;

        const usedFraction = snapshot.jsHeapSizeLimit > 0
            ? snapshot.usedJSHeapSize / snapshot.jsHeapSizeLimit
            : 0;
        if (usedFraction < threshold) return;

        if (snapshot.sampledAtMs - lastOomReportAtRef.current < cooldownMs) return;
        lastOomReportAtRef.current = snapshot.sampledAtMs;
        emitRef.current("editor_host.memory.oom_warning", {
            usedJSHeapSize: snapshot.usedJSHeapSize,
            jsHeapSizeLimit: snapshot.jsHeapSizeLimit,
            usedFraction,
        });
    }, [cooldownMs, threshold]);

    const start = useCallback(() => {
        if (timerRef.current !== null) return;
        // Take an immediate sample so callers reading `latestRef`
        // straight after `start()` don't see `null` for one tick.
        tick();
        timerRef.current = setInterval(tick, intervalMs);
    }, [intervalMs, tick]);

    const stop = useCallback(() => {
        if (timerRef.current === null) return;
        clearInterval(timerRef.current);
        timerRef.current = null;
    }, []);

    // Defensive cleanup — if the host component unmounts without
    // calling `stop()` first (StrictMode double-mount, hot-reload,
    // crash), the interval would otherwise leak.
    useEffect(() => stop, [stop]);

    return { start, stop, latestRef };
}
