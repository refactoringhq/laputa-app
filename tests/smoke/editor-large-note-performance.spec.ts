import { expect, test, type Page } from '@playwright/test'

const LARGE_NOTE_PATH = '/Users/luca/Laputa/perf-large-note.md'
const LARGE_NOTE_TITLE = 'Perf Large Note'

function largeMarkdown(): string {
  const paragraphs = Array.from({ length: 460 }, (_, index) => {
    const ordinal = index + 1
    return [
      `## Section ${ordinal}`,
      '',
      `Paragraph ${ordinal} keeps the large editor path realistic with **bold text**, *italic text*, `,
      `a wikilink to [[Build Laputa App]], and a [reference link](https://example.com/${ordinal}). `,
      'The text is intentionally long enough to push the source past the worker-backed parser threshold.',
    ].join('')
  })

  return [
    '---',
    `title: ${LARGE_NOTE_TITLE}`,
    'type: Note',
    '---',
    '',
    `# ${LARGE_NOTE_TITLE}`,
    '',
    ...paragraphs,
  ].join('\n')
}

const largeEntry = {
  path: LARGE_NOTE_PATH,
  filename: 'perf-large-note.md',
  title: LARGE_NOTE_TITLE,
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: null,
  archived: false,
  modifiedAt: Math.floor(Date.now() / 1000) + 60,
  createdAt: Math.floor(Date.now() / 1000) - 60,
  fileSize: largeMarkdown().length,
  snippet: 'Synthetic large note for editor performance instrumentation.',
  wordCount: 4600,
  relationships: {},
  outgoingLinks: ['build-laputa-app'],
  icon: null,
  color: null,
  order: null,
  sidebarLabel: null,
  template: null,
  sort: null,
  view: null,
  visible: null,
  properties: {},
  organized: false,
  favorite: false,
  favoriteIndex: null,
  listPropertiesDisplay: [],
  hasH1: true,
}

function collectPerfLogs(page: Page): string[] {
  const perfLogs: string[] = []
  page.on('console', (message) => {
    const text = message.text()
    if (text.includes('[perf]')) perfLogs.push(text)
  })
  return perfLogs
}

function largeNoteMockScript(markdown: string): string {
  const entryJson = JSON.stringify(largeEntry)
  const markdownJson = JSON.stringify(markdown)
  return `
(() => {
  const entry = ${entryJson};
  const markdown = ${markdownJson};
  const browserWindow = window;
  const withLargeEntry = (result) => {
    const entries = Array.isArray(result) ? result : [];
    return [entry, ...entries.filter(candidate => candidate.path !== entry.path)];
  };
  const invokesLargePath = args => args?.path === entry.path;
  const entryListHandler = original => args => withLargeEntry(original?.(args));
  const singleEntryHandler = original => args => invokesLargePath(args) ? entry : original?.(args);
  const contentHandler = original => args => invokesLargePath(args) ? markdown : original?.(args) ?? '';
  const validationHandler = original => args => invokesLargePath(args) ? args.content === markdown : Boolean(original?.(args));
  const patchHandlers = (handlers) => {
    if (!handlers || handlers.__largeNotePerformancePatched) return handlers ?? null;
    handlers.list_vault = entryListHandler(handlers.list_vault);
    handlers.reload_vault = entryListHandler(handlers.reload_vault);
    handlers.reload_vault_entry = singleEntryHandler(handlers.reload_vault_entry);
    handlers.get_note_content = contentHandler(handlers.get_note_content);
    handlers.validate_note_content = validationHandler(handlers.validate_note_content);
    handlers.__largeNotePerformancePatched = true;
    return handlers;
  };

  let handlersRef = patchHandlers(browserWindow.__mockHandlers);
  Object.defineProperty(browserWindow, '__mockHandlers', {
    configurable: true,
    get() {
      return handlersRef ?? undefined;
    },
    set(value) {
      handlersRef = patchHandlers(value);
    },
  });
})();
`
}

async function installLargeNoteMock(page: Page, markdown: string): Promise<void> {
  await page.addInitScript({ content: largeNoteMockScript(markdown) })
}

async function openLargeNote(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await expect(page.getByText(LARGE_NOTE_TITLE, { exact: true }).first()).toBeVisible({ timeout: 10_000 })
  await page.getByText(LARGE_NOTE_TITLE, { exact: true }).first().click()

  await expect(page.locator('.editor__blocknote-container')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 10_000 })
}

async function expectPerfLog(perfLogs: string[], label: string, expected: string): Promise<void> {
  await expect.poll(
    () => perfLogs.find(line => line.includes(`${label} path=${LARGE_NOTE_PATH}`)),
    { timeout: 10_000 },
  ).toContain(expected)
}

test('large Markdown notes use the fast resolver and progressive editor apply path', async ({ page }) => {
  const content = largeMarkdown()
  const perfLogs = collectPerfLogs(page)

  await installLargeNoteMock(page, content)
  await openLargeNote(page)

  await expectPerfLog(perfLogs, 'editorBlockResolve', 'strategy=direct-markdown')
  await expectPerfLog(perfLogs, 'editorBlockApply', 'mode=progressive')
})
