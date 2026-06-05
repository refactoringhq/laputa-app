import { describe, expect, it } from 'vitest'
import { createTranslator } from '../lib/i18n'
import { APP_COMMAND_IDS, APP_COMMAND_MENU_SECTIONS, getAppCommandMenuSections } from './appCommandCatalog'

describe('appCommandCatalog', () => {
  it('keeps the AI panel toggle in the View menu', () => {
    const viewMenu = APP_COMMAND_MENU_SECTIONS.find(section => section.label === 'View')

    expect(viewMenu?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        commandId: APP_COMMAND_IDS.viewToggleAiChat,
        label: 'Toggle AI Panel',
        menuItemId: APP_COMMAND_IDS.viewToggleAiChat,
      }),
    ]))
  })

  it('localizes custom desktop menu labels', () => {
    const viewMenu = getAppCommandMenuSections(createTranslator('zh-CN')).find(section => section.label === '视图')

    expect(viewMenu?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        commandId: APP_COMMAND_IDS.viewToggleAiChat,
        label: '切换 AI 面板',
        menuItemId: APP_COMMAND_IDS.viewToggleAiChat,
      }),
      expect.objectContaining({
        commandId: APP_COMMAND_IDS.viewZoomReset,
        label: '实际大小',
      }),
    ]))
  })
})
