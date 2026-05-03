import { readFileSync } from 'node:fs'
import {
  buildStableDownloadRedirectPage,
  extractStableDownloadTargets,
  extractStableDownloadTargetsFromReleases,
  resolveStableDownloadTargets,
} from './releaseDownloadPage'

describe('release workflow macOS artifact names', () => {
  function countOccurrences(input: string, value: string): number {
    return input.split(value).length - 1
  }

  it('publishes versioned Silicon and Intel artifact names', () => {
    const alphaWorkflow = readFileSync(`${process.cwd()}/.github/workflows/release.yml`, 'utf8')
    const stableWorkflow = readFileSync(
      `${process.cwd()}/.github/workflows/release-stable.yml`,
      'utf8',
    )

    expect(alphaWorkflow).toContain(
      'Tolaria_${{ needs.version.outputs.version }}_macOS_Silicon.app.tar.gz',
    )
    expect(alphaWorkflow).toContain(
      'Tolaria_${{ needs.version.outputs.version }}_macOS_Intel.app.tar.gz',
    )
    expect(stableWorkflow).toContain(
      'Tolaria_${{ needs.version.outputs.version }}_macOS_Silicon.app.tar.gz',
    )
    expect(stableWorkflow).toContain(
      'Tolaria_${{ needs.version.outputs.version }}_macOS_Intel.app.tar.gz',
    )
    expect(stableWorkflow).toContain(
      'Tolaria_${{ needs.version.outputs.version }}_macOS_Silicon.dmg',
    )
    expect(stableWorkflow).toContain(
      'Tolaria_${{ needs.version.outputs.version }}_macOS_Intel.dmg',
    )
  })

  it('passes the computed build version to Sentry release env for packaged apps', () => {
    const alphaWorkflow = readFileSync(`${process.cwd()}/.github/workflows/release.yml`, 'utf8')
    const stableWorkflow = readFileSync(
      `${process.cwd()}/.github/workflows/release-stable.yml`,
      'utf8',
    )
    const releaseEnv = 'VITE_SENTRY_RELEASE: ${{ needs.version.outputs.version }}'

    expect(countOccurrences(alphaWorkflow, releaseEnv)).toBe(3)
    expect(countOccurrences(stableWorkflow, releaseEnv)).toBe(3)
  })
})

describe('extractStableDownloadTargets', () => {
  it('returns stable downloads for each supported desktop platform when present', () => {
    expect(
      extractStableDownloadTargets({
        platforms: {
          'darwin-aarch64': {
            download_url: 'https://example.com/Tolaria-aarch64.dmg',
          },
          'darwin-x86_64': {
            download_url: 'https://example.com/Tolaria-x64.dmg',
          },
          'linux-x86_64': {
            download_url: 'https://example.com/Tolaria.AppImage',
          },
          'windows-x86_64': {
            url: 'https://example.com/Tolaria-setup.exe',
          },
        },
      }),
    ).toMatchObject({
      'darwin-aarch64': {
        label: 'macOS Apple Silicon',
        url: 'https://example.com/Tolaria-aarch64.dmg',
      },
      'darwin-x86_64': {
        label: 'macOS Intel',
        url: 'https://example.com/Tolaria-x64.dmg',
      },
      'linux-x86_64': {
        label: 'Linux',
        url: 'https://example.com/Tolaria.AppImage',
      },
      'windows-x86_64': {
        label: 'Windows',
        url: 'https://example.com/Tolaria-setup.exe',
      },
    })
  })
})

describe('buildStableDownloadRedirectPage', () => {
  it('builds a redirect page with platform-specific download links', () => {
    const html = buildStableDownloadRedirectPage({
      'darwin-aarch64': {
        buttonLabel: 'Download Tolaria for macOS Apple Silicon',
        label: 'macOS Apple Silicon',
        url: 'https://example.com/Tolaria-aarch64.dmg',
      },
      'darwin-x86_64': {
        buttonLabel: 'Download Tolaria for Intel Mac',
        label: 'macOS Intel',
        url: 'https://example.com/Tolaria-x64.dmg',
      },
      'windows-x86_64': {
        buttonLabel: 'Download Tolaria for Windows',
        label: 'Windows',
        url: 'https://example.com/Tolaria-setup.exe',
      },
    })

    expect(html).toContain('Tolaria Stable Download')
    expect(html).toContain('DOWNLOAD_TARGETS')
    expect(html).toContain('Download Tolaria for Windows')
    expect(html).toContain('Download Tolaria for macOS Apple Silicon')
    expect(html).toContain('Download Tolaria for Intel Mac')
    expect(html).toContain('hasMultipleMacDownloads')
    expect(html).toContain('Choose the Apple Silicon or Intel Mac download below.')
    expect(html).toContain('window.location.replace')
    expect(html).toContain('color-scheme: light dark')
    expect(html).toContain('@media (prefers-color-scheme: dark)')
    expect(html).toContain('background: var(--download-surface-page)')
  })

  it('builds a fallback page when no stable downloads exist yet', () => {
    const html = buildStableDownloadRedirectPage({})

    expect(html).toContain('Tolaria Stable Download Unavailable')
    expect(html).toContain('View release history')
    expect(html).toContain('https://refactoringhq.github.io/tolaria/')
    expect(html).not.toContain('DOWNLOAD_TARGETS')
  })
})

describe('resolveStableDownloadTargets', () => {
  it('falls back to stable release assets when latest.json is incomplete', () => {
    const latestPayload = {
      platforms: {
        'darwin-aarch64': {
          download_url: 'https://example.com/Tolaria-aarch64.dmg',
        },
      },
    }
    const releasesPayload = [
      {
        prerelease: false,
        assets: [
          {
            name: 'Tolaria_x64.dmg',
            browser_download_url: 'https://example.com/Tolaria-x64.dmg',
          },
          {
            name: 'Tolaria-setup.exe',
            browser_download_url: 'https://example.com/Tolaria-setup.exe',
          },
          {
            name: 'Tolaria.AppImage',
            browser_download_url: 'https://example.com/Tolaria.AppImage',
          },
        ],
      },
    ]

    expect(extractStableDownloadTargetsFromReleases(releasesPayload)).toMatchObject({
      'darwin-x86_64': {
        url: 'https://example.com/Tolaria-x64.dmg',
      },
      'linux-x86_64': {
        url: 'https://example.com/Tolaria.AppImage',
      },
      'windows-x86_64': {
        url: 'https://example.com/Tolaria-setup.exe',
      },
    })
    expect(resolveStableDownloadTargets(latestPayload, releasesPayload)).toMatchObject({
      'darwin-aarch64': {
        url: 'https://example.com/Tolaria-aarch64.dmg',
      },
      'darwin-x86_64': {
        url: 'https://example.com/Tolaria-x64.dmg',
      },
      'linux-x86_64': {
        url: 'https://example.com/Tolaria.AppImage',
      },
      'windows-x86_64': {
        url: 'https://example.com/Tolaria-setup.exe',
      },
    })
  })
})
