---
type: ADR
id: "0134"
title: "Direct Shiki language registrations for code blocks"
status: active
date: 2026-05-29
---

## Context

Tolaria uses `@blocknote/code-block` for rich-editor fenced-code highlighting. The bundled BlockNote highlighter covers the common web and systems languages already in the editor menu, but it does not include several common Shiki grammars such as PowerShell, VBScript, Dart, Dockerfile, Terraform/HCL, and TOML. Users still expect imported fences like `powershell`, `ps1`, `vb`, and `vbscript` to highlight, show a valid language picker state, and serialize back to a stable Markdown fence.

## Decision

**Tolaria keeps BlockNote's code-block integration and adds direct, lazy `@shikijs/langs` registrations for missing common languages and aliases.**

## Options considered

- **Keep only the BlockNote bundle**: simplest, but leaves PowerShell/VBScript and other common fences unsupported.
- **Register selected `@shikijs/langs` grammars lazily** (chosen): preserves BlockNote's schema and parser path while adding only the extra grammars users need.
- **Replace BlockNote's highlighter with a full custom Shiki bundle**: more control, but a larger structural change than the current requirement needs.

## Consequences

`src/components/codeBlockOptions.ts` remains the owner of the BlockNote highlighter configuration, but extra grammar modules are now imported directly from `@shikijs/langs` only when a matching fence or picker value needs highlighting. `src/utils/codeBlockLanguageCatalog.ts` owns the supported extra language labels and aliases, and `src/utils/codeBlockLanguage.ts` normalizes known imported aliases such as `ps1` and `vb` to the canonical picker language.

The language menu grows, but unsupported aliases still fail safely by staying as plain explicit fence names. If Tolaria later needs a generated language bundle, export-time highlighting, or a substantially smaller menu, this ADR should be superseded by a custom Shiki packaging decision.
