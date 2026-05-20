// ---------------------------------------------------------------------------
// Telemetry shim (ADR-0115 Phase 8.27, Strand C)
// ---------------------------------------------------------------------------
//
// The React-era app routes editor analytics through `src/lib/telemetry.ts`
// (Sentry + PostHog).  The embedded editor host has no direct access
// to those SDKs — they would balloon the single-file bundle and would
// fire twice (once in the WKWebView, once in the parent app).  The
// shim here funnels events through `console.info` instead, with a
// stable `[editor-host:telemetry]` prefix so the native shell can scrape
// them via `WKScriptMessageHandler` if a future row wants to forward
// them upstream.
//
// The unit tests (`richEditorTransformErrorRecoveryExtension.test.ts`)
// stub this module via `vi.mock` exactly as the React-side tests do.

export function trackEvent(
    event: string,
    properties: Record<string, unknown> = {},
): void {
    // `console.info` over `console.log` keeps the noise distinguishable
    // from the bridge dispatch log in `bridge.ts`.
    console.info("[editor-host:telemetry]", event, properties);
}
