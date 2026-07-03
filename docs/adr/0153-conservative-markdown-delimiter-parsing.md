---
type: ADR
id: "0153"
title: "Conservative Markdown delimiter parsing"
status: active
date: 2026-07-03
supersedes: "0082 inline math delimiter details"
---

## Context

Tolaria imports durable Markdown into BlockNote, then restores app-owned schema nodes for durable syntax such as wikilinks and math. Some Markdown delimiter characters also appear naturally in prose. In finance and product notes, `~` often means "approximately" and `$` often introduces currency, so permissive parsing can turn ordinary text such as `~$1.5k/mo now, ~$3k/mo` into accidental strikethrough and inline math.

## Decision

Tolaria will prefer literal prose when Markdown delimiter intent is ambiguous.

- Strikethrough uses only double tildes: `~~deleted~~`. A single `~` is treated as ordinary text during rich-editor Markdown import.
- Inline `$...$` math stays supported, but only when the content passes deterministic math-intent checks. Currency-like and prose-like spans remain literal text.
- Math placeholders passed through BlockNote use Markdown-inert encoded payloads so placeholder internals cannot be interpreted as Markdown formatting.
- Display math remains line-owned `$$...$$` / multiline `$$` blocks.

## Consequences

- False positives that rewrite prose are avoided before preserving every possible single-dollar math shorthand.
- Ambiguous numeric-only inline math, such as `$2$`, may stay literal. Users can use display math or a less ambiguous formula syntax when needed.
- Tolaria's formatting UI and serializer continue to persist strikethrough as `~~strike~~`.
- ADR-0082 still owns the Markdown-durable math model, but this ADR supersedes its permissive inline delimiter details.
