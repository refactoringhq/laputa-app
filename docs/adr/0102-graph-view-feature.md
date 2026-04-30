---
type: ADR
id: "0102"
title: "Graph view feature"
status: active
date: 2026-04-30
---

## Context

Tolaria's vault is a knowledge graph of markdown notes connected via wikilinks (`[[target]]`) and frontmatter relationships (`belongs_to`, `related_to`, custom dynamic relationships). Until now this graph was only visible piecewise — the Inspector showed backlinks/relationships for a single focal note, and Neighborhood mode was a list view, not a spatial visualization. There was no way to see the shape of the whole vault, spot orphans, find clusters, or navigate by visual proximity.

## Decision

**Add an Obsidian-style graph view as a first-class navigation surface. Force-directed canvas rendering using `react-force-graph-2d`. Two modes — Global (whole-vault) and Local (N-hop neighborhood around a focal note). Clicking a node opens the live editor in a resizable split next to the graph.**

The graph lives at `selection.kind === 'graph'` in `SidebarSelection`, replacing the editor area when selected. A live `<Editor>` instance renders inside the GraphView's content area as a right-hand pane (using a `rightPane` slot), giving full edit/save/inspector functionality without leaving the graph.

## Options considered

- **Option A (chosen):** `react-force-graph-2d` (D3-force + canvas). Closest visual match to Obsidian. Smooth up to ~5k nodes. Small API surface, fits props-down model.
- **Option B:** `cytoscape.js`. More layout algorithms and larger graphs supported, but heavier bundle (~500 KB) and less "force-directed" by default.
- **Option C:** `sigma.js` + `graphology`. WebGL renderer, best for very large vaults (10k+). More setup; ergonomics suffer for smaller graphs.

Sigma is a future swap-in if vaults outgrow the canvas renderer.

## Consequences

- `SidebarSelection` gains two `graph` variants: `{ mode: 'global' }` and `{ mode: 'local', focus, depth }`.
- `useGraphData(entries, mode, focus, depth, …)` derives `{ nodes, links }` adjacency; reuses `buildEntryLookup` + `findMatchedEntries` from `useInspectorData.ts` for wikilink resolution.
- `GraphView` owns its own UI state (search query, archived/orphan toggles); selection state lives at the App level (selected node = active editor tab).
- `GraphView` accepts a `rightPane` slot — App passes the live `<Editor>` element. This keeps graph and editor on a shared vertical layout (controls toolbar above, stats footer below, scrollable content between).
- Node colors come from the existing type→color map (`typeColors.ts`); no new color pipeline.
- `react-force-graph-2d` and `d3-force` added as dependencies; `@radix-ui/react-slider` and `@radix-ui/react-toggle-group` added for graph controls.
- Telemetry: `graph_view_opened`, `graph_node_opened`, `graph_pivot` PostHog events.
- Right-click on a node pivots local mode to that node (re-roots the neighborhood).
- Re-evaluation trigger: vaults consistently exceeding ~5k notes (consider sigma.js); user feedback that local mode needs different traversal semantics (e.g. type-aware pruning).
