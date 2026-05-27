import type {
  AppCommandShortcutEventInit,
  AppCommandShortcutEventOptions,
} from '../hooks/appCommandCatalog'

export interface LaputaTestBridge {
  activeTabPath?: string | null
  dispatchAppCommand?: (id: string) => void
  openDeepLink?: (url: string) => void
  dispatchShortcutEvent?: (init: AppCommandShortcutEventInit) => void
  dispatchBrowserMenuCommand?: (id: string) => void
  triggerMenuCommand?: (id: string) => Promise<unknown>
  triggerShortcutCommand?: (id: string, options?: AppCommandShortcutEventOptions) => void
  seedBlockNoteTable?: (columnWidths?: Array<number | null>) => Promise<void> | void
  seedAutoGitSavedChange?: () => Promise<void> | void
}

declare global {
  interface Window {
    __laputaTest?: LaputaTestBridge
  }
}

export {}
