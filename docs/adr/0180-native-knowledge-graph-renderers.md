---
type: ADR
id: "0180"
title: "Native knowledge graph with force and analysis renderers"
status: active
date: 2026-08-31
---

## Context

Tolaria's collection model separates selected notes from their presentation. The earlier graph prototype in PR #744 proved that a graph can live inside the main application shell, while the standalone `tolaria-graph` demo explored 2D, 3D, analysis, filtering, and neighborhood interactions. The standalone demo depended on a local HTTP service and duplicated vault parsing, theme, and navigation behavior.

## Decision

**Tolaria renders the knowledge graph inside the existing application shell and builds its graph model directly from renderer-owned `VaultEntry` data.** The graph supports force-directed 2D and 3D renderers through `react-force-graph`, plus an explicit analysis renderer through Cytoscape. It reuses Tolaria wikilink resolution, workspace provenance, theme tokens, locale selection, and native note navigation; it does not start a local graph server.

The graph uses absolute in-memory note paths as runtime node identities. Body links and frontmatter relationships remain distinct evidence kinds. Unresolved links can appear as ghost nodes, while local exploration uses undirected breadth-first traversal without discarding edge direction in the displayed model.

## Options considered

- **Embed the standalone demo with a local HTTP service:** preserves the prototype unchanged, but duplicates application state and creates an unnecessary runtime boundary.
- **Use only the canvas renderer from PR #744:** smaller dependency surface, but drops the validated 3D and analysis workflows.
- **Adapt the demo to Tolaria's renderer data and shell** (chosen): retains the useful interactions while sharing navigation, themes, localization, and vault state.

## Consequences

- Opening Graph View replaces the note list/editor canvas while retaining Tolaria's sidebar and status bar.
- Graph rendering dependencies increase the production renderer bundle and should move behind a lazy boundary as the feature matures.
- Large-vault layout work remains a performance concern. A worker-based graph build/layout path is required before treating 10,000-node fixtures as a release benchmark.
- The graph remains a renderer presentation over existing Markdown notes; it creates no graph database and persists no layout coordinates.
