import { readFileSync } from 'node:fs'
import { cwd } from 'node:process'
import { describe, expect, it } from 'vitest'

describe('Tauri Linux bundle configuration', () => {
  it('sets a desktop entry category for deb and rpm launchers', () => {
    const config = JSON.parse(readFileSync(`${cwd()}/src-tauri/tauri.conf.json`, 'utf8'))

    expect(config.bundle.category).toBe('Productivity')
  })
})
