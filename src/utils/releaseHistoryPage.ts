type ReleaseAssetPayload = {
  browser_download_url?: unknown
  name?: unknown
}

type GitHubReleasePayload = {
  assets?: ReleaseAssetPayload[]
  body?: unknown
  body_html?: unknown
  draft?: unknown
  html_url?: unknown
  name?: unknown
  prerelease?: unknown
  published_at?: unknown
  tag_name?: unknown
}

type ReleaseChannel = 'stable' | 'alpha'

type ReleaseDownload = {
  label: string
  url: string
}

type ReleaseEntry = {
  downloads: ReleaseDownload[]
  githubUrl: string | null
  notesHtml: string
  publishedLabel: string
  publishedTimestamp: number
  readableNotesUrl: string | null
  tagName: string
  title: string
}

type ReleaseSections = Record<ReleaseChannel, ReleaseEntry[]>

const RELEASE_HISTORY_PAGE_STYLES = `
    :root {
      color-scheme: light dark;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --release-surface-page: #f7f6f3;
      --release-surface-card: #ffffff;
      --release-surface-muted: #f4f4f2;
      --release-surface-tab-hover: rgba(21, 93, 255, 0.06);
      --release-surface-secondary-action: #ebeef5;
      --release-text-primary: #37352f;
      --release-text-secondary: #787774;
      --release-text-muted: #5e5c57;
      --release-text-body: #44403c;
      --release-text-blockquote: #57534e;
      --release-text-on-accent: #ffffff;
      --release-border-default: #e9e9e7;
      --release-border-strong: #d6d3d1;
      --release-border-accent: #d8e3ff;
      --release-accent: #155dff;
      --release-alpha: #f59e0b;
      --release-alpha-bg: #fff3d6;
      --release-alpha-text: #b45309;
      --release-shadow-card: rgba(15, 23, 42, 0.05);
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --release-surface-page: #1f1e1b;
        --release-surface-card: #23221f;
        --release-surface-muted: #2d2b27;
        --release-surface-tab-hover: rgba(120, 164, 255, 0.16);
        --release-surface-secondary-action: #34322d;
        --release-text-primary: #e6e1d8;
        --release-text-secondary: #b8b1a6;
        --release-text-muted: #c8c1b6;
        --release-text-body: #d8d1c6;
        --release-text-blockquote: #b8b1a6;
        --release-text-on-accent: #151411;
        --release-border-default: #34322d;
        --release-border-strong: #46433b;
        --release-border-accent: #25415f;
        --release-accent: #78a4ff;
        --release-alpha: #f3a15b;
        --release-alpha-bg: rgba(243, 161, 91, 0.17);
        --release-alpha-text: #f3c27f;
        --release-shadow-card: rgba(0, 0, 0, 0.35);
      }
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--release-surface-page);
      color: var(--release-text-primary);
      padding: 32px 20px 48px;
    }

    main {
      width: min(100%, 840px);
      margin: 0 auto;
    }

    header {
      margin-bottom: 24px;
    }

    h1 {
      margin: 0 0 8px;
      font-size: clamp(2rem, 4vw, 2.5rem);
      line-height: 1.1;
    }

    .subtitle,
    .keyboard-hint {
      margin: 0;
      color: var(--release-text-secondary);
      line-height: 1.6;
    }

    .channel-tabs {
      margin-bottom: 24px;
    }

    .channel-tablist {
      display: inline-flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .channel-tab {
      appearance: none;
      border: 1px solid transparent;
      border-radius: 999px;
      background: transparent;
      color: var(--release-text-muted);
      cursor: pointer;
      font: inherit;
      font-weight: 600;
      padding: 12px 16px;
    }

    .channel-tab:hover {
      background: var(--release-surface-tab-hover);
      color: var(--release-accent);
    }

    .channel-tab:focus-visible {
      outline: 2px solid var(--release-accent);
      outline-offset: 2px;
    }

    .channel-tab[aria-selected="true"] {
      background: var(--release-surface-card);
      border-color: var(--release-border-accent);
      color: var(--release-accent);
    }

    .tab-count {
      color: var(--release-text-secondary);
      font-weight: 500;
      margin-left: 6px;
    }

    .release-panel {
      display: grid;
      gap: 16px;
      outline: none;
    }

    .release-panel[hidden] {
      display: none;
    }

    .release-card {
      background: var(--release-surface-card);
      border: 1px solid var(--release-border-default);
      border-radius: 18px;
      padding: 20px 22px;
      box-shadow: 0 16px 40px var(--release-shadow-card);
    }

    .release-card--alpha {
      border-left: 4px solid var(--release-alpha);
    }

    .release-card--stable {
      border-left: 4px solid var(--release-accent);
    }

    .release-header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 26px;
    }

    .release-header h2 {
      margin: 0;
      font-size: 1.9rem;
      line-height: 1.25;
    }

    .release-meta {
      margin: 4px 0 0;
      color: var(--release-text-secondary);
      font-size: 0.9375rem;
    }

    .release-github-link {
      align-self: start;
      background: var(--release-surface-tab-hover);
      border-radius: 999px;
      color: var(--release-accent);
      font-size: 0.8125rem;
      font-weight: 700;
      letter-spacing: 0.02em;
      padding: 6px 10px;
      text-decoration: none;
      text-transform: uppercase;
    }

    .release-github-link:hover,
    .release-github-link:focus-visible {
      filter: brightness(0.96);
    }

    .release-github-link:focus-visible {
      outline: 2px solid var(--release-accent);
      outline-offset: 2px;
    }

    .release-notes {
      color: var(--release-text-body);
      font-size: 0.98rem;
      line-height: 1.7;
    }

    .release-notes > :first-child {
      margin-top: 0;
    }

    .release-notes > :last-child {
      margin-bottom: 0;
    }

    .release-notes h1,
    .release-notes h2,
    .release-notes h3 {
      line-height: 1.25;
      margin: 1.2em 0 0.4em;
    }

    .release-notes h1 {
      font-size: 1.35rem;
    }

    .release-notes h2 {
      font-size: 1.25rem;
    }

    .release-notes h3 {
      font-size: 1.1rem;
    }

    .release-notes p,
    .release-notes ul,
    .release-notes ol,
    .release-notes blockquote,
    .release-notes pre {
      margin: 0 0 1em;
    }

    .release-notes ul,
    .release-notes ol {
      padding-left: 1.4rem;
    }

    .release-notes code {
      background: var(--release-surface-muted);
      border-radius: 6px;
      padding: 0.12em 0.35em;
    }

    .release-notes pre {
      overflow-x: auto;
      background: var(--release-surface-muted);
      border-radius: 12px;
      padding: 14px;
    }

    .release-notes pre code {
      background: transparent;
      padding: 0;
    }

    .release-notes blockquote {
      border-left: 3px solid var(--release-border-strong);
      color: var(--release-text-blockquote);
      padding-left: 14px;
    }

    .release-notes a,
    .release-downloads a {
      color: var(--release-accent);
      text-decoration-thickness: 0.08em;
      text-underline-offset: 0.18em;
    }

    .release-downloads {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 18px;
    }

    .release-downloads a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 42px;
      padding: 0 14px;
      border-radius: 10px;
      background: var(--release-accent);
      color: var(--release-text-on-accent);
      font-weight: 600;
      text-decoration: none;
    }

    .release-downloads a[data-secondary="true"] {
      background: var(--release-surface-secondary-action);
      color: var(--release-text-primary);
    }

    .release-downloads a:hover,
    .release-downloads a:focus-visible {
      filter: brightness(0.96);
    }

    .release-downloads a:focus-visible {
      outline: 2px solid var(--release-accent);
      outline-offset: 2px;
    }

    .empty-state {
      background: var(--release-surface-card);
      border: 1px dashed var(--release-border-strong);
      border-radius: 18px;
      color: var(--release-text-secondary);
      padding: 28px 24px;
      text-align: center;
    }

    @media (max-width: 640px) {
      body {
        padding-inline: 16px;
      }

      .release-card {
        padding: 18px;
      }

      .channel-tablist {
        width: 100%;
      }

      .channel-tab {
        flex: 1 1 180px;
        text-align: center;
      }
    }
`

const RELEASE_HISTORY_PAGE_SCRIPT = `
    (() => {
      const tabs = Array.from(document.querySelectorAll('[data-release-tab]'));
      const panels = Array.from(document.querySelectorAll('[data-release-panel]'));

      const activateTab = (nextTab) => {
        const nextChannel = nextTab.getAttribute('data-release-tab');
        tabs.forEach((tab) => {
          const selected = tab === nextTab;
          tab.setAttribute('aria-selected', String(selected));
          tab.tabIndex = selected ? 0 : -1;
        });
        panels.forEach((panel) => {
          panel.hidden = panel.getAttribute('data-release-panel') !== nextChannel;
        });
      };

      const moveFocus = (currentIndex, offset) => {
        const nextIndex = (currentIndex + offset + tabs.length) % tabs.length;
        tabs[nextIndex].focus();
        activateTab(tabs[nextIndex]);
      };

      const activateFocusedTab = (tab) => {
        tab.focus();
        activateTab(tab);
      };

      const handleTabKeydown = (event, tab, index) => {
        const keyActions = {
          ' ': () => activateTab(tab),
          ArrowDown: () => moveFocus(index, 1),
          ArrowLeft: () => moveFocus(index, -1),
          ArrowRight: () => moveFocus(index, 1),
          ArrowUp: () => moveFocus(index, -1),
          End: () => activateFocusedTab(tabs[tabs.length - 1]),
          Enter: () => activateTab(tab),
          Home: () => activateFocusedTab(tabs[0]),
        };
        const action = keyActions[event.key];
        if (!action) return;

        event.preventDefault();
        action();
      };

      tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => activateTab(tab));
        tab.addEventListener('keydown', (event) => handleTabKeydown(event, tab, index));
      });

      const escapeHtml = (value) => value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');

      const renderInlineMarkdown = (value) => escapeHtml(value)
        .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
        .replace(/\`([^\`]+)\`/g, '<code>$1</code>');

      const renderMarkdownLine = (rawLine) => {
        const line = rawLine.trim();
        if (!line) return { kind: 'blank' };

        const heading = line.match(/^(#{1,3})\\s+(.+)$/);
        if (heading) {
          const level = heading[1].length;
          return {
            html: '<h' + level + '>' + renderInlineMarkdown(heading[2]) + '</h' + level + '>',
            kind: 'heading',
          };
        }

        const bullet = line.match(/^[-*]\\s+(.+)$/);
        if (bullet) return { html: '<li>' + renderInlineMarkdown(bullet[1]) + '</li>', kind: 'bullet' };

        return { html: '<p>' + renderInlineMarkdown(line) + '</p>', kind: 'paragraph' };
      };

      const closeList = (html, listOpen) => {
        if (listOpen) html.push('</ul>');
        return false;
      };

      const appendBulletLine = (html, line, listOpen) => {
        if (!listOpen) html.push('<ul>');
        html.push(line.html);
        return true;
      };

      const appendBlockLine = (html, line, listOpen) => {
        if (listOpen) html.push('</ul>');
        html.push(line.html);
        return false;
      };

      const appendRenderedLine = (html, line, listOpen) => {
        if (line.kind === 'blank') return closeList(html, listOpen);
        if (line.kind === 'bullet') return appendBulletLine(html, line, listOpen);
        return appendBlockLine(html, line, listOpen);
      };

      const renderReadableMarkdown = (markdown) => {
        const html = [];
        let listOpen = false;
        markdown.split('\\n').forEach((rawLine) => {
          listOpen = appendRenderedLine(html, renderMarkdownLine(rawLine), listOpen);
        });
        if (listOpen) html.push('</ul>');
        return html.join('');
      };

      const loadReadableNotes = async (container) => {
        const notesUrl = container.getAttribute('data-readable-notes-url');
        if (!notesUrl) return;

        try {
          const response = await fetch(notesUrl, { cache: 'no-cache' });
          if (!response.ok) return;

          const html = renderReadableMarkdown(await response.text()).trim();
          if (html.length > 0) container.innerHTML = html;
        } catch {
          // Keep the generated commit list when a readable note cannot be loaded.
        }
      };

      Array.from(document.querySelectorAll('[data-readable-notes-url]')).forEach((container) => {
        void loadReadableNotes(container);
      });
    })();
`

const RELEASE_CHANNEL_LABELS: Record<ReleaseChannel, string> = {
  alpha: 'Alpha',
  stable: 'Stable',
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : null
}

function normalizeUrl(value: unknown): string | null {
  const text = normalizeText(value)
  if (text === null) return null

  try {
    const parsedUrl = new URL(text)
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') return null
    return parsedUrl.toString()
  } catch {
    return null
  }
}

function formatPublishedLabel(value: unknown): string {
  const text = normalizeText(value)
  if (text === null) return 'Unknown publish date'

  const publishedAt = new Date(text)
  if (Number.isNaN(publishedAt.getTime())) return 'Unknown publish date'

  return publishedAt.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  })
}

function parsePublishedTimestamp(value: unknown): number {
  const text = normalizeText(value)
  if (text === null) return Number.NEGATIVE_INFINITY

  const publishedAt = new Date(text)
  const timestamp = publishedAt.getTime()
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp
}

function isDownloadableAsset(name: string): boolean {
  return (
    name.endsWith('.dmg')
    || name.endsWith('.app.tar.gz')
    || name.endsWith('-setup.exe')
    || name.endsWith('.msi')
    || name.endsWith('.AppImage')
    || name.endsWith('.deb')
  )
}

function normalizeDownloads(assets: ReleaseAssetPayload[] | undefined): ReleaseDownload[] {
  if (!Array.isArray(assets)) return []

  const seenUrls = new Set<string>()
  const downloads: ReleaseDownload[] = []

  for (const asset of assets) {
    const name = normalizeText(asset.name)
    const url = normalizeUrl(asset.browser_download_url)
    if (name === null || url === null || !isDownloadableAsset(name) || seenUrls.has(url)) continue

    seenUrls.add(url)
    downloads.push({ label: name, url })
  }

  return downloads
}

function buildFallbackReleaseNotesHtml(markdownFallback: string): string {
  const paragraphs = markdownFallback
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .map(part => `<p>${escapeHtml(part).replaceAll('\n', '<br>')}</p>`)

  return paragraphs.join('')
}

function resolveReleaseNotesHtml(renderedHtml: unknown, markdownFallback: unknown): string {
  const bodyHtml = normalizeText(renderedHtml)
  if (bodyHtml !== null) return bodyHtml

  const fallback = normalizeText(markdownFallback) ?? 'No release notes provided.'
  return buildFallbackReleaseNotesHtml(fallback)
}

function readableNotesUrlForRelease(channel: ReleaseChannel, tagName: string): string | null {
  if (channel !== 'stable' || tagName === 'Unknown tag') return null
  return `release-notes/${encodeURIComponent(tagName)}.md`
}

function normalizeReleaseEntry(release: GitHubReleasePayload): [ReleaseChannel, ReleaseEntry] | null {
  if (release.draft === true) return null

  const title = normalizeText(release.name) ?? normalizeText(release.tag_name) ?? 'Untitled release'
  const tagName = normalizeText(release.tag_name) ?? 'Unknown tag'
  const channel: ReleaseChannel = release.prerelease === true ? 'alpha' : 'stable'

  return [channel, {
    downloads: normalizeDownloads(release.assets),
    githubUrl: normalizeUrl(release.html_url),
    notesHtml: resolveReleaseNotesHtml(release.body_html, release.body),
    publishedLabel: formatPublishedLabel(release.published_at),
    publishedTimestamp: parsePublishedTimestamp(release.published_at),
    readableNotesUrl: readableNotesUrlForRelease(channel, tagName),
    tagName,
    title,
  }]
}

function appendReleaseSection(
  sections: ReleaseSections,
  normalizedRelease: [ReleaseChannel, ReleaseEntry],
): void {
  const [channel, release] = normalizedRelease
  sections[channel].push(release)
}

function collectReleaseSections(payload: unknown): ReleaseSections {
  const sections: ReleaseSections = { alpha: [], stable: [] }
  if (!Array.isArray(payload)) return sections

  for (const item of payload) {
    if (!item || typeof item !== 'object') continue

    const normalizedRelease = normalizeReleaseEntry(item as GitHubReleasePayload)
    if (normalizedRelease === null) continue

    appendReleaseSection(sections, normalizedRelease)
  }

  for (const channel of ['stable', 'alpha'] as const) {
    sections[channel].sort((left, right) => right.publishedTimestamp - left.publishedTimestamp)
  }

  return sections
}

function buildTabMarkup(channel: ReleaseChannel, count: number, selected: boolean): string {
  const label = RELEASE_CHANNEL_LABELS[channel]
  return `
      <button
        id="tab-${channel}"
        class="channel-tab"
        type="button"
        role="tab"
        aria-controls="panel-${channel}"
        aria-selected="${selected}"
        data-release-tab="${channel}"
        tabindex="${selected ? '0' : '-1'}"
      >
        ${label}<span class="tab-count">${count}</span>
      </button>`
}

function buildReleaseMarkup(channel: ReleaseChannel, release: ReleaseEntry): string {
  const downloads = [...release.downloads]

  const githubMarkup = release.githubUrl === null
    ? ''
    : `<a class="release-github-link" href="${escapeHtml(release.githubUrl)}" target="_blank" rel="noreferrer">View on GitHub</a>`
  const downloadsMarkup = downloads.length > 0
    ? `
      <div class="release-downloads">
        ${downloads.map(download => {
          return `<a href="${escapeHtml(download.url)}" target="_blank" rel="noreferrer">${escapeHtml(download.label)}</a>`
        }).join('')}
      </div>`
    : ''
  const readableNotesAttributes = release.readableNotesUrl === null
    ? ''
    : ` data-readable-notes-url="${escapeHtml(release.readableNotesUrl)}"`

  return `
      <article class="release-card release-card--${channel}">
        <div class="release-header">
          <div>
            <h2>${escapeHtml(release.title)}</h2>
            <p class="release-meta">${escapeHtml(release.publishedLabel)} · ${escapeHtml(release.tagName)}</p>
          </div>
          ${githubMarkup}
        </div>
        <div class="release-notes"${readableNotesAttributes}>${release.notesHtml}</div>${downloadsMarkup}
      </article>`
}

function buildPanelMarkup(channel: ReleaseChannel, releases: ReleaseEntry[], selected: boolean): string {
  const releasesMarkup = releases.length > 0
    ? releases.map(release => buildReleaseMarkup(channel, release)).join('')
    : `<div class="empty-state">No ${channel} releases published yet.</div>`

  return `
    <section
      id="panel-${channel}"
      class="release-panel"
      role="tabpanel"
      tabindex="0"
      aria-labelledby="tab-${channel}"
      data-release-panel="${channel}"${selected ? '' : ' hidden'}
    >
      ${releasesMarkup}
    </section>`
}

export function buildReleaseHistoryPage(releasesPayload: unknown): string {
  const sections = collectReleaseSections(releasesPayload)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tolaria — Release History</title>
  <style>${RELEASE_HISTORY_PAGE_STYLES}
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Tolaria Release History</h1>
      <p class="subtitle">Stable builds appear when a stable-vYYYY.M.D tag is promoted. Alpha builds update on every push to main.</p>
    </header>
    <div class="channel-tabs">
      <div class="channel-tablist" role="tablist" aria-label="Release channels">
        ${buildTabMarkup('stable', sections.stable.length, true)}
        ${buildTabMarkup('alpha', sections.alpha.length, false)}
      </div>
    </div>
    ${buildPanelMarkup('stable', sections.stable, true)}
    ${buildPanelMarkup('alpha', sections.alpha, false)}
  </main>
  <script>${RELEASE_HISTORY_PAGE_SCRIPT}
  </script>
</body>
</html>
`
}
