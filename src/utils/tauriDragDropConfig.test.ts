import { readFileSync } from 'node:fs'

describe('Tauri drag/drop configuration', () => {
  it('keeps native file drops enabled for path-aware app inputs', () => {
    const config = JSON.parse(readFileSync(`${process.cwd()}/src-tauri/tauri.conf.json`, 'utf8'))

    expect(config.app.windows[0].dragDropEnabled).toBe(true)
  })
})
