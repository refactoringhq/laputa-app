---
type: ADR
id: "0108"
title: "Direct model AI targets alongside coding agents"
status: active
date: 2026-05-03
---

## Context

Tolaria's AI panel originally targeted desktop coding-agent CLIs only. That works well for tool-capable vault editing, but it excludes users who run local model servers, users who prefer OpenAI or Anthropic APIs, and future mobile builds where desktop subprocesses cannot run.

## Decision

**Tolaria models AI selection as an AI target.** Targets can be desktop coding agents or direct model endpoints. Coding agents keep the existing Safe / Power User permission modes and tool access. Direct model targets run in Chat mode: they receive note context and conversation history, but they do not get vault-write tools or shell access.

Direct model provider metadata is stored in app settings. Provider API secrets are not stored in settings; hosted providers can either save a key in Tolaria's local app-data secrets file or read a key from a named environment variable. The local secrets file is outside the vault, outside project worktrees, and written with owner-only file permissions on Unix platforms. Local providers such as Ollama and LM Studio can run without a key.

## Options Considered

- **AI target abstraction** (chosen): supports agents, local models, hosted APIs, and mobile-compatible model runtimes without pretending all AI backends have the same capabilities.
- **Treat custom providers as OpenCode configuration only**: lower implementation cost on desktop, but does not help mobile and keeps API users dependent on a coding-agent install.
- **Direct API runtime with write tools immediately**: powerful, but would require Tolaria-owned tool loops, confirmations, retries, and safety semantics before the basic chat value is proven.

## Consequences

- Settings owns durable provider setup and default target selection.
- The status bar becomes a quick target switcher across agents and configured model targets.
- The AI panel explains capability differences: agents show Safe / Power User; direct model targets show Chat mode.
- Future work can migrate local secrets to OS keychain storage and add read/write tool loops without changing the top-level target model.
