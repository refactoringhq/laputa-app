export const DEFAULT_APP_LOCALE = 'en'
export const SYSTEM_UI_LANGUAGE = 'system'

export const APP_LOCALES = ['en', 'zh-Hans'] as const
export type AppLocale = typeof APP_LOCALES[number]
export type UiLanguagePreference = typeof SYSTEM_UI_LANGUAGE | AppLocale

const SIMPLIFIED_CHINESE_LANGUAGE_CODES = new Set(['zh', 'zh-cn', 'zh-hans', 'zh-sg'])

const EN_TRANSLATIONS = {
  'command.noMatches': 'No matching commands',
  'command.palettePlaceholder': 'Type a command...',
  'command.footerNavigate': '↑↓ navigate',
  'command.footerSelect': '↵ select',
  'command.footerClose': 'esc close',
  'command.footerSend': '↵ send',
  'command.aiMode': '{agent} mode',
  'command.openSettings': 'Open Settings',
  'command.openSettings.keywords': 'preferences config',
  'command.openLanguageSettings': 'Open Language Settings',
  'command.openLanguageSettings.keywords': 'language locale i18n internationalization localization chinese english 中文',
  'command.useSystemLanguage': 'Use System Language',
  'command.switchToEnglish': 'Switch Language to English',
  'command.switchToChinese': 'Switch Language to Simplified Chinese',
  'command.openH1Setting': 'Open H1 Auto-Rename Setting',
  'command.contribute': 'Contribute',
  'command.checkUpdates': 'Check for Updates',

  'settings.title': 'Settings',
  'settings.close': 'Close settings',
  'settings.sync.title': 'Sync & Updates',
  'settings.sync.description': 'Configure background pulling and which update feed Tolaria follows. Stable only receives manually promoted releases, while Alpha follows every push to main.',
  'settings.pullInterval': 'Pull interval (minutes)',
  'settings.releaseChannel': 'Release channel',
  'settings.releaseStable': 'Stable',
  'settings.releaseAlpha': 'Alpha',
  'settings.appearance.title': 'Appearance',
  'settings.appearance.description': 'Choose the app color mode used for Tolaria chrome, editor surfaces, menus, and dialogs.',
  'settings.theme.label': 'Theme',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.language.title': 'Language',
  'settings.language.description': 'Choose the display language for Tolaria chrome. System follows macOS when that language is supported, with English as the fallback.',
  'settings.language.label': 'Display language',
  'settings.language.system': 'System ({language})',
  'settings.language.en': 'English',
  'settings.language.zhHans': 'Simplified Chinese',
  'settings.language.summary': 'Missing translations fall back to English so partially translated locales stay usable.',
  'settings.autogit.title': 'AutoGit',
  'settings.autogit.description.enabled': 'Automatically create conservative Git checkpoints after editing pauses or when the app is no longer active.',
  'settings.autogit.description.disabled': 'AutoGit is unavailable until the current vault is Git-enabled. Initialize Git for this vault first.',
  'settings.autogit.enable': 'Enable AutoGit',
  'settings.autogit.enableDescription': 'When enabled, Tolaria will commit and push saved local changes automatically after an idle pause or after the app becomes inactive.',
  'settings.autogit.idleThreshold': 'Idle threshold (seconds)',
  'settings.autogit.inactiveThreshold': 'Inactive-app grace period (seconds)',
  'settings.media.title': 'Media Files',
  'settings.media.description': 'Choose where pasted or dropped images and videos are saved inside the vault. Leave empty to use the default "attachments" folder.',
  'settings.media.imageFolder': 'Default image folder',
  'settings.media.videoFolder': 'Default video folder',
  'settings.media.folderPlaceholder': 'attachments (default)',
  'settings.titles.title': 'Titles & Filenames',
  'settings.titles.description': 'Choose whether Tolaria automatically syncs untitled note filenames from the first H1 title.',
  'settings.titles.autoRename': 'Auto-rename untitled notes from first H1',
  'settings.titles.autoRenameDescription': 'When enabled, Tolaria renames untitled-note files as soon as the first H1 becomes a real title. Turn this off to keep the filename unchanged until you rename it manually from the breadcrumb bar.',
  'settings.aiAgents.title': 'AI Agents',
  'settings.aiAgents.description': 'Choose which CLI AI agent Tolaria uses in the AI panel and command palette.',
  'settings.aiAgents.default': 'Default AI agent',
  'settings.aiAgents.installed': 'installed',
  'settings.aiAgents.missing': 'missing',
  'settings.aiAgents.ready': '{agent}{version} is ready to use.',
  'settings.aiAgents.notInstalled': '{agent} is not installed yet. You can still select it now and install it later.',
  'settings.workflow.title': 'Workflow',
  'settings.workflow.description': 'Choose whether Tolaria shows the Inbox workflow, plus how it moves through items while you triage them.',
  'settings.workflow.explicit': 'Organize notes explicitly',
  'settings.workflow.explicitDescription': 'When enabled, an Inbox section shows unorganized notes, and a toggle lets you mark notes as organized.',
  'settings.workflow.autoAdvance': 'Auto-advance to next Inbox item',
  'settings.workflow.autoAdvanceDescription': 'When enabled, marking an Inbox note as organized immediately opens the next visible Inbox note.',
  'settings.privacy.title': 'Privacy & Telemetry',
  'settings.privacy.description': 'Anonymous data helps us fix bugs and improve Tolaria. No vault content, note titles, or file paths are ever sent.',
  'settings.privacy.crashReporting': 'Crash reporting',
  'settings.privacy.crashReportingDescription': 'Send anonymous error reports',
  'settings.privacy.analytics': 'Usage analytics',
  'settings.privacy.analyticsDescription': 'Share anonymous usage patterns',
  'settings.footerShortcut': '⌘, to open settings',
  'settings.cancel': 'Cancel',
  'settings.save': 'Save',

  'locale.en': 'English',
  'locale.zhHans': 'Simplified Chinese',

  'noteList.title.archive': 'Archive',
  'noteList.title.changes': 'Changes',
  'noteList.title.inbox': 'Inbox',
  'noteList.title.history': 'History',
  'noteList.title.view': 'View',
  'noteList.title.notes': 'Notes',
  'noteList.searchPlaceholder': 'Search notes...',
  'noteList.searchAction': 'Search notes',
  'noteList.createNote': 'Create new note',
  'noteList.empty.changesError': 'Failed to load changes: {error}',
  'noteList.empty.noChanges': 'No pending changes',
  'noteList.empty.noArchived': 'No archived notes',
  'noteList.empty.noMatching': 'No matching notes',
  'noteList.empty.allOrganized': 'All notes are organized',
  'noteList.empty.noNotes': 'No notes found',
  'noteList.empty.noMatchingItems': 'No matching items',
  'noteList.empty.noRelatedItems': 'No related items',
} as const

export type TranslationKey = keyof typeof EN_TRANSLATIONS
type TranslationValues = Record<string, string | number>

const ZH_HANS_TRANSLATIONS: Partial<Record<TranslationKey, string>> = {
  'command.noMatches': '没有匹配的命令',
  'command.palettePlaceholder': '输入命令...',
  'command.footerNavigate': '↑↓ 导航',
  'command.footerSelect': '↵ 选择',
  'command.footerClose': 'esc 关闭',
  'command.footerSend': '↵ 发送',
  'command.aiMode': '{agent} 模式',
  'command.openSettings': '打开设置',
  'command.openSettings.keywords': '设置 偏好 配置',
  'command.openLanguageSettings': '打开语言设置',
  'command.openLanguageSettings.keywords': '语言 区域 i18n 国际化 本地化 中文 english',
  'command.useSystemLanguage': '使用系统语言',
  'command.switchToEnglish': '切换到英文',
  'command.switchToChinese': '切换到简体中文',
  'command.openH1Setting': '打开 H1 自动重命名设置',
  'command.contribute': '参与贡献',
  'command.checkUpdates': '检查更新',

  'settings.title': '设置',
  'settings.close': '关闭设置',
  'settings.sync.title': '同步与更新',
  'settings.sync.description': '配置后台拉取以及 Tolaria 使用的更新通道。Stable 只接收手动推广的版本，Alpha 跟随 main 的每次推送。',
  'settings.pullInterval': '拉取间隔（分钟）',
  'settings.releaseChannel': '发布通道',
  'settings.releaseStable': 'Stable',
  'settings.releaseAlpha': 'Alpha',
  'settings.appearance.title': '外观',
  'settings.appearance.description': '选择 Tolaria 界面、编辑器、菜单和对话框使用的颜色模式。',
  'settings.theme.label': '主题',
  'settings.theme.light': '浅色',
  'settings.theme.dark': '深色',
  'settings.language.title': '语言',
  'settings.language.description': '选择 Tolaria 界面的显示语言。系统选项会在支持时跟随 macOS，否则回退到英文。',
  'settings.language.label': '显示语言',
  'settings.language.system': '系统（{language}）',
  'settings.language.en': '英文',
  'settings.language.zhHans': '简体中文',
  'settings.language.summary': '缺失的翻译会回退到英文，因此部分翻译的语言也能正常使用。',
  'settings.autogit.title': 'AutoGit',
  'settings.autogit.description.enabled': '在编辑暂停或应用不再活跃后，自动创建保守的 Git 检查点。',
  'settings.autogit.description.disabled': '当前仓库启用 Git 后才能使用 AutoGit。请先为此仓库初始化 Git。',
  'settings.autogit.enable': '启用 AutoGit',
  'settings.autogit.enableDescription': '启用后，Tolaria 会在空闲暂停或应用变为非活跃后自动提交并推送保存的本地更改。',
  'settings.autogit.idleThreshold': '空闲阈值（秒）',
  'settings.autogit.inactiveThreshold': '应用非活跃宽限期（秒）',
  'settings.titles.title': '标题与文件名',
  'settings.titles.description': '选择 Tolaria 是否根据第一个 H1 标题自动同步未命名笔记的文件名。',
  'settings.titles.autoRename': '根据第一个 H1 自动重命名未命名笔记',
  'settings.titles.autoRenameDescription': '启用后，只要第一个 H1 成为真实标题，Tolaria 就会重命名 untitled-note 文件。关闭后，文件名会保持不变，直到你从面包屑栏手动重命名。',
  'settings.aiAgents.title': 'AI 代理',
  'settings.aiAgents.default': '默认 AI 代理',
  'settings.aiAgents.installed': '已安装',
  'settings.aiAgents.missing': '缺失',
  'settings.aiAgents.ready': '{agent}{version} 已可使用。',
  'settings.aiAgents.notInstalled': '{agent} 尚未安装。你仍可先选择它，稍后再安装。',
  'settings.workflow.title': '工作流',
  'settings.workflow.description': '选择 Tolaria 是否显示 Inbox 工作流，以及整理时如何移动到下一项。',
  'settings.workflow.explicit': '显式整理笔记',
  'settings.workflow.explicitDescription': '启用后，Inbox 会显示尚未整理的笔记，并提供一个开关用于标记为已整理。',
  'settings.workflow.autoAdvance': '自动前进到下一条 Inbox',
  'settings.workflow.autoAdvanceDescription': '启用后，将 Inbox 笔记标记为已整理会立即打开下一条可见的 Inbox 笔记。',
  'settings.privacy.title': '隐私与遥测',
  'settings.privacy.description': '匿名数据可帮助我们修复错误并改进 Tolaria。不会发送仓库内容、笔记标题或文件路径。',
  'settings.privacy.crashReporting': '崩溃报告',
  'settings.privacy.crashReportingDescription': '发送匿名错误报告',
  'settings.privacy.analytics': '使用分析',
  'settings.privacy.analyticsDescription': '分享匿名使用模式',
  'settings.footerShortcut': '⌘, 打开设置',
  'settings.cancel': '取消',
  'settings.save': '保存',

  'locale.en': '英文',
  'locale.zhHans': '简体中文',

  'noteList.title.archive': '归档',
  'noteList.title.changes': '更改',
  'noteList.title.inbox': 'Inbox',
  'noteList.title.history': '历史',
  'noteList.title.view': '视图',
  'noteList.title.notes': '笔记',
  'noteList.searchPlaceholder': '搜索笔记...',
  'noteList.searchAction': '搜索笔记',
  'noteList.createNote': '新建笔记',
  'noteList.empty.changesError': '加载更改失败：{error}',
  'noteList.empty.noChanges': '没有待处理更改',
  'noteList.empty.noArchived': '没有归档笔记',
  'noteList.empty.noMatching': '没有匹配的笔记',
  'noteList.empty.allOrganized': '所有笔记都已整理',
  'noteList.empty.noNotes': '没有笔记',
  'noteList.empty.noMatchingItems': '没有匹配项',
  'noteList.empty.noRelatedItems': '没有相关项',
}

const TRANSLATIONS: Record<AppLocale, Partial<Record<TranslationKey, string>>> = {
  en: EN_TRANSLATIONS,
  'zh-Hans': ZH_HANS_TRANSLATIONS,
}

export function interpolate(template: string, values: TranslationValues = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = values[key]
    return value === undefined ? match : String(value)
  })
}

export function translate(locale: AppLocale, key: TranslationKey, values?: TranslationValues): string {
  const template = TRANSLATIONS[locale]?.[key] ?? EN_TRANSLATIONS[key]
  return interpolate(template, values)
}

export function createTranslator(locale: AppLocale) {
  return (key: TranslationKey, values?: TranslationValues) => translate(locale, key, values)
}

function normalizeLocaleCode(value: string): AppLocale | null {
  const normalized = value.trim().replace('_', '-').toLowerCase()
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en'
  if (SIMPLIFIED_CHINESE_LANGUAGE_CODES.has(normalized)) return 'zh-Hans'
  return null
}

export function normalizeUiLanguagePreference(value: unknown): UiLanguagePreference | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  if (lower === SYSTEM_UI_LANGUAGE || lower === 'auto') return SYSTEM_UI_LANGUAGE
  return normalizeLocaleCode(trimmed)
}

export function serializeUiLanguagePreference(value: unknown): AppLocale | null {
  const normalized = normalizeUiLanguagePreference(value)
  if (!normalized || normalized === SYSTEM_UI_LANGUAGE) return null
  return normalized
}

export function getBrowserLanguagePreferences(): string[] {
  if (typeof navigator === 'undefined') return []
  const languages = Array.isArray(navigator.languages) ? navigator.languages : []
  if (languages.length > 0) return [...languages]
  return navigator.language ? [navigator.language] : []
}

export function resolveEffectiveLocale(
  preference: unknown,
  languagePreferences: readonly string[] = getBrowserLanguagePreferences(),
): AppLocale {
  const normalizedPreference = normalizeUiLanguagePreference(preference)
  if (normalizedPreference && normalizedPreference !== SYSTEM_UI_LANGUAGE) {
    return normalizedPreference
  }

  for (const language of languagePreferences) {
    const locale = normalizeLocaleCode(language)
    if (locale) return locale
  }

  return DEFAULT_APP_LOCALE
}

export function localeDisplayName(locale: AppLocale, displayLocale: AppLocale = locale): string {
  return translate(displayLocale, locale === 'zh-Hans' ? 'locale.zhHans' : 'locale.en')
}
