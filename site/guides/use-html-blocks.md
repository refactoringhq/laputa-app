# Use HTML Blocks

::: v-pre
HTML blocks render fenced `html` code as sandboxed previews inside a note. Use them for local dashboards, report fragments, small custom layouts, and presentation-oriented views that should stay in the vault as Markdown.

## Create An HTML Block

Insert an HTML block from the slash menu, or write a fenced `html` block in raw mode:

````md
```html height="360"
<style>
  .metric { font-weight: 700; }
</style>

<section>
  <h2>Project status</h2>
  <p class="metric">{{status}}</p>
</section>
```
````

The `height` attribute controls the preview height. You can also resize the block from the rich editor. Source editing happens in raw mode, so the rich editor preview stays read-only.

## Add Live Vault Values

HTML block source can include vault expressions inside `{{...}}`. Tolaria resolves them before the HTML is sanitized and rendered.

```html
<p>Status: {{status}}</p>
<p>Published: {{formatDate(publish_date, "long")}}</p>
<p>Owner: {{[[project-alpha]].owner}}</p>
<p>Budget: {{formatCurrency([[project-budget]].B2, "USD", 0)}}</p>
<p>Summary line: {{[[launch-brief]].2}}</p>
```

Use current-note properties directly, such as `{{status}}`, or use `{{this.status}}` when you want to be explicit. Use `[[note]].property`, `[[note]].A1`, or `[[note]].2` to read another note's property, sheet cell, or raw body line.

See [Vault Expressions](/reference/vault-expressions) for the full syntax and formatting helpers.

## Style The Preview

Inline `style` attributes and `<style>` tags work. Tolaria places sanitized style blocks in the iframe head so CSS applies to the whole preview.

Remote loading is intentionally blocked. External stylesheets, CSS `@import`, CSS `url(...)`, remote scripts, nested frames, workers, forms, and network requests are removed or blocked by the sandbox.

## Run Local Script

Scripts are blocked by default. Opt into an opaque-origin script sandbox only when the block needs local DOM rendering:

````md
```html height="520" scripts="sandboxed"
<div id="notes"></div>

<script type="application/json" id="notes-data">
{{json([[essay]].has_notes)}}
</script>

<script>
  const notes = JSON.parse(document.getElementById("notes-data").textContent || "[]");
  const list = document.createElement("ul");

  for (const note of notes) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = note.deepLink || "#";
    link.textContent = note.title;
    item.append(link);
    list.append(item);
  }

  document.getElementById("notes").replaceChildren(list);
</script>
```
````

`json(...)` returns safely escaped JSON. When the value is a wikilink or a relationship list of wikilinks, Tolaria enriches it with note metadata such as `title`, `status`, `path`, `target`, `raw`, and `deepLink`.

The script sandbox is still constrained. It can use standard DOM APIs inside the preview, but it cannot access the parent Tolaria window, Tauri APIs, same-origin storage, remote network data, external script files, workers, forms, or nested frames.

## Troubleshooting

If a `{{...}}` expression stays visible, Tolaria could not parse or resolve it. Check the note target, property name, function arguments, or whether the referenced note is ambiguous.

If script code appears not to run, confirm the fence has `scripts="sandboxed"` and that the script is inline. External `src` scripts are not supported.

If styling does not apply, put the CSS in a `<style>` tag or inline `style` attribute and avoid remote CSS imports or `url(...)` assets.
:::
