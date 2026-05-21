# Portent

Source: templates/portent.md
URL: /templates/portent

# Portent

[Portent](https://portent.md) is an open specification and template for work and personal knowledge bases.

It gives a Tolaria vault a small set of defaults for organizing information: clear types, generic graph-like relationships, and a simple lifecycle for captured knowledge. The goal is to make a knowledge base useful to humans and AI agents without forcing every person or team to design a private ontology first.

## Core Questions

Portent favors convention over configuration. Instead of asking "where should this go?", it asks:

- What is this?
- What is it useful for?
- Is it captured, organized, or archived?

Those questions map naturally to Tolaria's type documents, relationship fields, Inbox, organized state, archive behavior, and custom views.

## Types

Portent defines eight default types.

PORT types are actionable:

- Project
- Operation
- Responsibility
- Task

ENTP types are non-actionable knowledge records:

- Event
- Note
- Topic
- Person

These defaults are meant to cover the common shape of personal and work knowledge with almost no setup. You can add custom types later, but Portent works best when the default vocabulary comes first.

## Relationships

Portent models knowledge as a graph. The two default relationships are:

- `belongs_to`: primary ownership, composition, or context.
- `related_to`: a looser semantic connection.

In Tolaria, these relationships can live in YAML frontmatter and point to other notes with wikilinks. That keeps the graph portable, searchable, and readable outside the app.

## Lifecycle

Portent separates capture from organization:

1. Capture information quickly so it is not lost.
2. Organize it by assigning a type and useful relationships.
3. Archive it when it has served its purpose.

Tolaria supports that lifecycle directly: the Inbox holds captured notes, organizing a note marks it ready for normal views, and archiving hides old or obsolete notes from active surfaces while keeping them available.

## Why Use It

A blank vault is flexible, but it also asks you to make structural decisions before you have momentum. Portent gives you enough structure to start capturing, organizing, and retrieving notes immediately.

Because Portent is file-friendly and portable, the same model can work across local Markdown vaults, note apps, docs tools, and agent-readable knowledge bases. Tolaria is the first intended implementation, but the spec is not tied to Tolaria internals.

## Start From The Template

The fastest starting point is the Portent template vault:

- [refactoringhq/portent-vault-template](https://github.com/refactoringhq/portent-vault-template)

Use it as-is, rename pieces to match your language, or treat it as a reference model for your own Tolaria setup.

## Learn More

Visit [portent.md](https://portent.md) for the full spec, examples, and implementation notes.