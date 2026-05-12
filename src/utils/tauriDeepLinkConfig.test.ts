import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const repoFile = (path: string) => readFileSync(`${process.cwd()}/${path}`, 'utf8')

describe('Tauri deep-link configuration', () => {
  it('registers the tolaria scheme for desktop deep links', () => {
    const config = JSON.parse(repoFile('src-tauri/tauri.conf.json'))

    const schemes = config.plugins?.['deep-link']?.desktop?.schemes ?? []

    expect(schemes).toContain('tolaria')
  })

  it('initializes the deep-link plugin in the desktop app setup', () => {
    const libRs = repoFile('src-tauri/src/lib.rs')

    expect(libRs).toContain('tauri_plugin_deep_link::init()')
  })
})
