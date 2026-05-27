import { type Page } from '@playwright/test'
import type {
  AppCommandId,
  AppCommandShortcutEventInit,
  AppCommandShortcutEventOptions,
} from '../../src/hooks/appCommandCatalog'

async function waitForDispatchBrowserMenuCommand(page: Page): Promise<void> {
  await page.waitForFunction(
    () => typeof window.__laputaTest?.dispatchBrowserMenuCommand === 'function',
    undefined,
    { timeout: 5_000 },
  )
}

async function attemptTriggerMenuCommandInPage(commandId: string): Promise<boolean> {
  const triggerMenuCommand = window.__laputaTest?.triggerMenuCommand
  if (typeof triggerMenuCommand !== 'function') {
    return false
  }

  try {
    await triggerMenuCommand(commandId)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('dispatchBrowserMenuCommand')) {
      throw error
    }
    return false
  }
}

function dispatchMenuCommandFallbackInPage(commandId: string): void {
  const dispatchBrowserMenuCommand = window.__laputaTest?.dispatchBrowserMenuCommand
  if (typeof dispatchBrowserMenuCommand !== 'function') {
    throw new Error('Tolaria test bridge is missing dispatchBrowserMenuCommand')
  }
  dispatchBrowserMenuCommand(commandId)
}

export async function triggerMenuCommand(page: Page, id: string): Promise<void> {
  await waitForDispatchBrowserMenuCommand(page)
  const didTrigger = await page.evaluate(attemptTriggerMenuCommandInPage, id)
  if (didTrigger) {
    return
  }
  await page.evaluate(dispatchMenuCommandFallbackInPage, id)
}

export async function seedBlockNoteTable(
  page: Page,
  columnWidths?: Array<number | null>,
): Promise<void> {
  await page.evaluate((widths) => {
    const bridge = window.__laputaTest?.seedBlockNoteTable
    if (typeof bridge !== 'function') {
      throw new Error('Tolaria test bridge is missing seedBlockNoteTable')
    }
    return bridge(widths ?? undefined)
  }, columnWidths)
}

export async function seedAutoGitSavedChange(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const bridge = window.__laputaTest?.seedAutoGitSavedChange
    if (typeof bridge !== 'function') {
      throw new Error('Tolaria test bridge is missing seedAutoGitSavedChange')
    }
    await bridge()
  })
}

export async function openDeepLink(page: Page, url: string): Promise<void> {
  await page.evaluate((deepLinkUrl) => {
    const bridge = window.__laputaTest?.openDeepLink
    if (typeof bridge !== 'function') {
      throw new Error('Tolaria test bridge is missing openDeepLink')
    }
    bridge(deepLinkUrl)
  }, url)
}

export async function dispatchShortcutEvent(
  page: Page,
  init: AppCommandShortcutEventInit,
): Promise<void> {
  await page.evaluate((eventInit) => {
    const bridge = window.__laputaTest?.dispatchShortcutEvent
    if (typeof bridge !== 'function') {
      throw new Error('Tolaria test bridge is missing dispatchShortcutEvent')
    }
    bridge(eventInit)
  }, init)
}

export async function triggerShortcutCommand(
  page: Page,
  id: AppCommandId,
  options?: AppCommandShortcutEventOptions,
): Promise<void> {
  await page.evaluate((payload) => {
    const bridge = window.__laputaTest?.triggerShortcutCommand
    if (typeof bridge !== 'function') {
      throw new Error('Tolaria test bridge is missing triggerShortcutCommand')
    }
    bridge(payload.id, payload.options)
  }, { id, options })
}
