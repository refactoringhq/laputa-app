import { markdown } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

const SYNTAX_COLORS = {
    heading: "var(--syntax-heading)",
    link: "var(--syntax-link)",
    monospace: "var(--syntax-monospace)",
    monospaceBackground: "var(--syntax-monospace-bg)",
    muted: "var(--syntax-muted)",
};

const markdownHighlightStyle = HighlightStyle.define([
    { tag: tags.heading1, color: SYNTAX_COLORS.heading, fontWeight: "700", fontSize: "1.4em" },
    { tag: tags.heading2, color: SYNTAX_COLORS.heading, fontWeight: "700", fontSize: "1.25em" },
    { tag: tags.heading3, color: SYNTAX_COLORS.heading, fontWeight: "600", fontSize: "1.1em" },
    { tag: tags.heading4, color: SYNTAX_COLORS.heading, fontWeight: "600" },
    { tag: tags.heading5, color: SYNTAX_COLORS.heading, fontWeight: "600" },
    { tag: tags.heading6, color: SYNTAX_COLORS.heading, fontWeight: "600" },
    { tag: tags.strong, fontWeight: "700" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strikethrough, textDecoration: "line-through" },
    { tag: tags.link, color: SYNTAX_COLORS.link, textDecoration: "underline" },
    { tag: tags.url, color: SYNTAX_COLORS.link },
    {
        tag: tags.monospace,
        color: SYNTAX_COLORS.monospace,
        backgroundColor: SYNTAX_COLORS.monospaceBackground,
        borderRadius: "3px",
    },
    { tag: tags.quote, color: SYNTAX_COLORS.muted, fontStyle: "italic" },
    { tag: tags.separator, color: SYNTAX_COLORS.muted },
    { tag: tags.processingInstruction, color: SYNTAX_COLORS.monospace, fontWeight: "600" },
    { tag: tags.contentSeparator, color: SYNTAX_COLORS.monospace, fontWeight: "600" },
]);

export function markdownLanguage(): Extension {
    return [
        yamlFrontmatter({ content: markdown() }),
        syntaxHighlighting(markdownHighlightStyle),
    ];
}
