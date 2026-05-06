import { readFileSync } from 'node:fs'

describe('Tauri drag/drop configuration', () => {
  it('keeps browser file drops disabled so images use the native attachment path', () => {
    const config = JSON.parse(readFileSync(`${process.cwd()}/src-tauri/tauri.conf.json`, 'utf8'))

    expect(config.app.windows[0].dragDropEnabled).toBe(false)
  })
})
