import { test, expect } from '@playwright/test'
import { sendShortcut } from './helpers'

test.describe('MCP config copy', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/vault/ping', route => route.fulfill({ status: 503 }))
    await page.goto('/')
    await expect(page.getByTestId('note-list-container')).toBeVisible({ timeout: 5_000 })
  })

  test('copies the active-vault MCP config from the Settings AI section', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])

    await sendShortcut(page, ',', ['Control'])
    await expect(page.getByTestId('settings-panel')).toBeVisible({ timeout: 3_000 })
    await page.getByTestId('settings-copy-mcp-config').click()

    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('"mcpServers"')
    const copiedConfig = await page.evaluate(() => navigator.clipboard.readText())
    const parsedConfig = JSON.parse(copiedConfig) as {
      mcpServers: {
        tolaria: {
          args: string[]
          command: string
          env: Record<string, string>
          type: string
        }
      }
    }
    const tolariaServer = parsedConfig.mcpServers.tolaria

    expect(tolariaServer.type).toBe('stdio')
    expect(tolariaServer.command).toBe('node')
    expect(tolariaServer.args[0]).toContain('mcp-server/index.js')
    expect(tolariaServer.env.VAULT_PATH).toBeTruthy()
    expect(tolariaServer.env.WS_UI_PORT).toBe('9711')
  })
})
