import { buildReleaseHistoryPage } from './releaseHistoryPage'

describe('buildReleaseHistoryPage', () => {
  it('renders markdown notes into separate stable and alpha panels with stable selected by default', () => {
    const html = buildReleaseHistoryPage([
      {
        assets: [
          {
            browser_download_url: 'https://example.com/Tolaria.dmg',
            name: 'Tolaria.dmg',
          },
        ],
        body: '## Highlights\n\n- Faster startup\n- Better release notes',
        body_html: '<h2>Highlights</h2><ul><li>Faster startup</li><li>Better release notes</li></ul>',
        html_url: 'https://github.com/refactoringhq/tolaria/releases/tag/stable-v2026.4.19',
        name: 'Tolaria Stable 2026.4.19',
        prerelease: false,
        published_at: '2026-04-19T11:00:00Z',
        tag_name: 'stable-v2026.4.19',
      },
      {
        assets: [
          {
            browser_download_url: 'https://example.com/Tolaria-setup.exe',
            name: 'Tolaria-setup.exe',
          },
        ],
        body: '**Alpha** notes with [details](https://example.com/details).',
        body_html: '<p><strong>Alpha</strong> notes with <a href="https://example.com/details">details</a>.</p>',
        html_url: 'https://github.com/refactoringhq/tolaria/releases/tag/2026.4.19-alpha.1',
        name: 'Alpha 2026.4.19.1',
        prerelease: true,
        published_at: '2026-04-19T10:00:00Z',
        tag_name: '2026.4.19-alpha.1',
      },
    ])

    expect(html).toContain('role="tablist"')
    expect(html).toContain('id="tab-stable"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('data-release-panel="alpha" hidden')
    expect(html).toContain('color-scheme: light dark')
    expect(html).toContain('@media (prefers-color-scheme: dark)')
    expect(html).toContain('background: var(--release-surface-page)')
    expect(html).toContain('<h2>Highlights</h2>')
    expect(html).toContain('<li>Faster startup</li>')
    expect(html).toContain('<strong>Alpha</strong> notes')
    expect(html).toContain('Tolaria-setup.exe')
    expect(html).toContain('View on GitHub')
    expect(html).not.toContain('class="release-channel"')
  })

  it('loads readable notes for stable releases at runtime and keeps commits as the fallback', () => {
    const html = buildReleaseHistoryPage([
      {
        body: "## What's Changed\n\n- ee71a00 feat: add paste without formatting command",
        body_html: [
          '<h2>What&apos;s Changed</h2>',
          '<ul>',
          '<li><a href="https://github.com/refactoringhq/tolaria/commit/ee71a00">ee71a00</a> feat: add paste without formatting command</li>',
          '</ul>',
        ].join(''),
        html_url: 'https://github.com/refactoringhq/tolaria/releases/tag/stable-v2026.5.2',
        name: 'Tolaria 2026.5.2',
        prerelease: false,
        published_at: '2026-05-02T16:15:00Z',
        tag_name: 'stable-v2026.5.2',
      },
    ])

    expect(html).toContain('data-readable-notes-url="release-notes/stable-v2026.5.2.md"')
    expect(html).toContain("fetch(notesUrl, { cache: 'no-cache' })")
    expect(html).toContain('ee71a00')
    expect(html).toContain('feat: add paste without formatting command')
    expect(html).not.toContain('data-release-detail-tab')
    expect(html).not.toContain('>Readable<')
    expect(html).not.toContain('>Commits<')
    expect(html).not.toContain('📋 <strong>Paste Without Formatting</strong>')
  })

  it('falls back to escaped paragraph markup when rendered html is unavailable', () => {
    const html = buildReleaseHistoryPage([
      {
        body: 'First paragraph\nwith a line break.\n\nSecond paragraph',
        name: 'Fallback release',
        prerelease: false,
        published_at: '2026-04-19T11:00:00Z',
        tag_name: 'stable-v2026.4.19',
      },
    ])

    expect(html).toContain('<p>First paragraph<br>with a line break.</p><p>Second paragraph</p>')
  })

  it('sorts releases within each channel by published date descending even when the payload order is wrong', () => {
    const html = buildReleaseHistoryPage([
      {
        body: 'Older alpha release',
        name: 'Tolaria Alpha 2026.4.20.9',
        prerelease: true,
        published_at: '2026-04-20T09:44:02Z',
        tag_name: 'alpha-v2026.4.20-alpha.9',
      },
      {
        body: 'Newest alpha release',
        name: 'Tolaria Alpha 2026.4.20.12',
        prerelease: true,
        published_at: '2026-04-20T16:53:41Z',
        tag_name: 'alpha-v2026.4.20-alpha.12',
      },
      {
        body: 'Middle alpha release',
        name: 'Tolaria Alpha 2026.4.20.10',
        prerelease: true,
        published_at: '2026-04-20T10:32:01Z',
        tag_name: 'alpha-v2026.4.20-alpha.10',
      },
    ])

    expect(html.indexOf('Tolaria Alpha 2026.4.20.12')).toBeLessThan(html.indexOf('Tolaria Alpha 2026.4.20.10'))
    expect(html.indexOf('Tolaria Alpha 2026.4.20.10')).toBeLessThan(html.indexOf('Tolaria Alpha 2026.4.20.9'))
  })

  it('filters draft releases and shows an empty state for channels without published builds', () => {
    const html = buildReleaseHistoryPage([
      {
        body: 'Draft release',
        draft: true,
        name: 'Draft release',
        prerelease: false,
        published_at: '2026-04-19T11:00:00Z',
        tag_name: 'stable-v2026.4.19',
      },
    ])

    expect(html).not.toContain('Draft release')
    expect(html).toContain('No stable releases published yet.')
    expect(html).toContain('No alpha releases published yet.')
  })
})
