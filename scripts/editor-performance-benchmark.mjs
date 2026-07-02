#!/usr/bin/env node
/* global document, fetch, HTMLElement, performance, requestAnimationFrame, Response, setTimeout, URL, window */

import { spawn } from 'node:child_process'
import console from 'node:console'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import process from 'node:process'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import {
  printSummary,
  printThresholdFailures,
  readThresholds,
  thresholdFailures,
  updateThresholds,
  writeThresholds,
} from './editor-performance-thresholds.mjs'

const rootDir = process.cwd()
const defaultThresholdsPath = resolve(rootDir, '.editor-performance-thresholds.json')
const defaultPort = '41742'
const scenarios = {
  small: { sectionCount: 5, title: 'Perf Small Note' },
  large: { sectionCount: 460, title: 'Perf Large Note' },
}
const defaultScenarioNames = Object.keys(scenarios)
const metricLabels = {
  blockApplyMs: 'block apply',
  blockResolveMs: 'block resolve',
  editFrameMs: 'edit frame',
  editorVisibleMs: 'editor visible',
  firstContentMs: 'first content rendered',
  fullAppliedMs: 'full note applied',
  noteOpenEditorSwapMs: 'note open editor swap',
  noteOpenTotalMs: 'note open total',
}

function defaultOptions() {
  return {
    baseUrl: process.env.BASE_URL ?? '',
    headful: false,
    iterations: positiveInteger(process.env.EDITOR_PERF_ITERATIONS ?? '5', 'EDITOR_PERF_ITERATIONS'),
    port: process.env.EDITOR_PERF_PORT ?? defaultPort,
    scenarioNames: defaultScenarioNames,
    thresholdsPath: defaultThresholdsPath,
    update: false,
  }
}

const flagOptions = {
  '--headful': parsed => {
    parsed.headful = true
  },
  '--update': parsed => {
    parsed.update = true
  },
}

const valueOptions = {
  '--base-url': (parsed, value) => {
    parsed.baseUrl = value
  },
  '--iterations': (parsed, value) => {
    parsed.iterations = positiveInteger(value, '--iterations')
  },
  '--port': (parsed, value) => {
    parsed.port = value
  },
  '--scenario': (parsed, value) => {
    parsed.scenarioNames = value.split(',').filter(Boolean)
  },
  '--thresholds': (parsed, value) => {
    parsed.thresholdsPath = value
  },
}

function parseArgs(args) {
  const parsed = defaultOptions()
  for (let index = 0; index < args.length; index += 1) {
    index = parseArg(parsed, args, index)
  }

  validateScenarioNames(parsed.scenarioNames)
  return parsed
}

function parseArg(parsed, args, index) {
  const arg = args[index]
  if (arg === '--') return index
  if (arg === '--help' || arg === '-h') exitWithHelp(0)
  if (flagOptions[arg]) {
    flagOptions[arg](parsed)
    return index
  }
  if (valueOptions[arg]) {
    valueOptions[arg](parsed, requiredValue(args, index, arg))
    return index + 1
  }
  console.error(`Unknown argument: ${arg}`)
  exitWithHelp(2)
  return index
}

function validateScenarioNames(scenarioNames) {
  for (const scenarioName of scenarioNames) {
    if (!(scenarioName in scenarios)) {
      console.error(`Unknown scenario: ${scenarioName}`)
      process.exit(2)
    }
  }
}

function exitWithHelp(code) {
  printHelp()
  process.exit(code)
}

const options = parseArgs(process.argv.slice(2))
const thresholdsPath = resolve(rootDir, options.thresholdsPath)
let devServer = null
let stoppingDevServer = false

function requiredValue(args, index, name) {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    console.error(`${name} requires a value`)
    process.exit(2)
  }
  return value
}

function positiveInteger(value, name) {
  if (/^[1-9][0-9]*$/.test(String(value))) return Number(value)
  console.error(`${name} must be a positive integer`)
  process.exit(2)
}

function printHelp() {
  console.log(`Usage: pnpm perf:editor [options]

Options:
  --base-url <url>       Reuse an existing dev server instead of starting Vite.
  --iterations <count>   Runs per scenario. Default: 5.
  --scenario <names>     Comma-separated scenarios: small,large. Default: both.
  --thresholds <path>    Threshold JSON path. Default: .editor-performance-thresholds.json.
  --update               Ratchet stored baselines and thresholds from the current run.
  --headful              Run Chromium headed for debugging.
`)
}

function median(values) {
  const numeric = values.filter(value => typeof value === 'number' && Number.isFinite(value))
  if (numeric.length === 0) return null
  const sorted = [...numeric].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function round(value) {
  return value === null ? null : Math.round(value * 10) / 10
}

function largeMarkdown(sectionCount, title) {
  const paragraphs = Array.from({ length: sectionCount }, (_, index) => {
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
    `title: ${title}`,
    'type: Note',
    '---',
    '',
    `# ${title}`,
    '',
    ...paragraphs,
  ].join('\n')
}

function syntheticEntry({ markdown, title }) {
  return {
    aliases: [],
    archived: false,
    belongsTo: [],
    color: null,
    createdAt: Math.floor(Date.now() / 1000) - 60,
    favorite: false,
    favoriteIndex: null,
    fileSize: markdown.length,
    filename: `${title.toLowerCase().replace(/\s+/g, '-')}.md`,
    hasH1: true,
    icon: null,
    isA: 'Note',
    listPropertiesDisplay: [],
    modifiedAt: Math.floor(Date.now() / 1000) + 60,
    order: null,
    organized: false,
    outgoingLinks: ['build-laputa-app'],
    path: `/Users/luca/Laputa/${title.toLowerCase().replace(/\s+/g, '-')}.md`,
    properties: {},
    relationships: {},
    relatedTo: [],
    sidebarLabel: null,
    snippet: 'Synthetic note for editor performance benchmarking.',
    sort: null,
    status: null,
    template: null,
    title,
    view: null,
    visible: null,
    wordCount: 10 * Math.max(1, Math.floor(markdown.length / 280)),
  }
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch (error) {
      void error
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 250))
  }
  throw new Error(`Timed out waiting for dev server: ${url}`)
}

async function startDevServer() {
  if (options.baseUrl) return options.baseUrl

  const baseUrl = `http://127.0.0.1:${options.port}`
  const viteCacheDir = resolve(tmpdir(), `tolaria-editor-perf-vite-${options.port}`)
  devServer = spawn(
    'pnpm',
    ['dev', '--host', '127.0.0.1', '--port', options.port, '--strictPort'],
    {
      cwd: rootDir,
      env: { ...process.env, TOLARIA_VITE_CACHE_DIR: viteCacheDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  devServer.stdout?.on('data', chunk => process.stdout.write(`[perf-server] ${chunk}`))
  devServer.stderr?.on('data', chunk => process.stderr.write(`[perf-server] ${chunk}`))
  devServer.on('exit', (code, signal) => {
    if (stoppingDevServer) return
    if (signal || code === 0) return
    console.error(`[perf-server] exited with status ${code}`)
  })

  await waitForServer(baseUrl)
  return baseUrl
}

function stopDevServer() {
  if (!devServer || devServer.killed) return
  stoppingDevServer = true
  devServer.stdout?.removeAllListeners('data')
  devServer.stderr?.removeAllListeners('data')
  devServer.kill('SIGTERM')
}

async function installSyntheticVault(page, entry, markdown) {
  await page.addInitScript(({ syntheticEntryValue, syntheticMarkdown }) => {
    const jsonResponse = value => new Response(JSON.stringify(value), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
    const requestPath = (input) => {
      const rawUrl = typeof input === 'string'
        ? input
        : input && typeof input === 'object' && 'url' in input
          ? input.url
          : String(input)
      return new URL(rawUrl, window.location.href).pathname
    }
    const originalFetch = window.fetch.bind(window)
    const syntheticResponses = {
      '/api/vault/all-content': () => jsonResponse([{ content: syntheticMarkdown, path: syntheticEntryValue.path }]),
      '/api/vault/content': () => jsonResponse({ content: syntheticMarkdown }),
      '/api/vault/entry': () => jsonResponse(syntheticEntryValue),
      '/api/vault/list': () => jsonResponse([syntheticEntryValue]),
      '/api/vault/ping': () => new Response('ok', { status: 200 }),
      '/api/vault/search': () => jsonResponse([syntheticEntryValue]),
    }
    window.fetch = async (input, init) => {
      const responseFactory = syntheticResponses[requestPath(input)]
      if (responseFactory) return responseFactory()
      return originalFetch(input, init)
    }

    const withSyntheticEntry = (result) => {
      const entries = Array.isArray(result) ? result : []
      return [
        syntheticEntryValue,
        ...entries.filter(candidate => candidate.path !== syntheticEntryValue.path),
      ]
    }
    const matchesSyntheticPath = args => args?.path === syntheticEntryValue.path
    const handlerPatches = {
      get_note_content: original => args => (
        matchesSyntheticPath(args) ? syntheticMarkdown : original?.(args) ?? ''
      ),
      list_vault: original => args => withSyntheticEntry(original?.(args)),
      reload_vault: original => args => withSyntheticEntry(original?.(args)),
      reload_vault_entry: original => args => (
        matchesSyntheticPath(args) ? syntheticEntryValue : original?.(args)
      ),
      validate_note_content: original => args => (
        matchesSyntheticPath(args)
          ? args.content === syntheticMarkdown
          : Boolean(original?.(args))
      ),
    }

    const patchHandlers = (handlers) => {
      if (!handlers || handlers.__editorPerformancePatched) return handlers ?? null
      for (const [name, createHandler] of Object.entries(handlerPatches)) {
        handlers[name] = createHandler(handlers[name])
      }
      handlers.__editorPerformancePatched = true
      return handlers
    }

    let handlersRef = patchHandlers(window.__mockHandlers)
    Object.defineProperty(window, '__mockHandlers', {
      configurable: true,
      get() {
        return handlersRef ?? undefined
      },
      set(value) {
        handlersRef = patchHandlers(value)
      },
    })
  }, { syntheticEntryValue: entry, syntheticMarkdown: markdown })
}

async function measureEditFrame(page) {
  return await page.evaluate(async () => {
    const root = document.querySelector('.bn-editor')
    const editable = root?.querySelector('[contenteditable="true"]') ?? root
    if (!root || !(editable instanceof HTMLElement)) return null

    editable.focus()
    const startedAt = performance.now()
    document.execCommand('insertText', false, 'x')
    await new Promise(resolveFrame => requestAnimationFrame(() => resolveFrame()))
    return performance.now() - startedAt
  })
}

function durationFromLog(logs, pattern) {
  for (const line of logs) {
    const match = line.match(pattern)
    if (match?.[1]) return Number(match[1])
  }
  return null
}

function parsePerfMetrics(perfLogs) {
  return {
    blockApplyMs: durationFromLog(perfLogs, /editorBlockApply .* duration=([\d.]+)ms/),
    blockResolveMs: durationFromLog(perfLogs, /editorBlockResolve .* duration=([\d.]+)ms/),
    noteOpenEditorSwapMs: durationFromLog(perfLogs, /noteOpen .* editorSwap=([\d.]+)ms/),
    noteOpenTotalMs: durationFromLog(perfLogs, /noteOpen .* total=([\d.]+)ms/),
  }
}

async function runIteration({ baseUrl, browser, index, scenario, scenarioName }) {
  const markdown = largeMarkdown(scenario.sectionCount, scenario.title)
  const entry = syntheticEntry({ markdown, title: scenario.title })
  const context = await browser.newContext()
  const page = await context.newPage()
  const perfLogs = []
  page.on('console', (message) => {
    const text = message.text()
    if (text.includes('[perf]')) perfLogs.push(text)
  })

  await installSyntheticVault(page, entry, markdown)
  await page.goto(baseUrl)
  await page.waitForLoadState('domcontentloaded')
  await page.getByText('Set up later', { exact: true }).click({ timeout: 12_000 }).catch(() => {})

  const title = page.getByText(scenario.title, { exact: true }).first()
  await title.waitFor({ state: 'visible', timeout: 30_000 })

  const startedAt = await page.evaluate(() => performance.now())
  await title.click()

  await page.locator('.editor__blocknote-container').waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.bn-editor').waitFor({ state: 'visible', timeout: 30_000 })
  const editorVisibleAt = await page.evaluate(() => performance.now())

  await page.waitForFunction(() => {
    const editor = document.querySelector('.bn-editor')
    return editor?.textContent?.includes('Section 1') === true
  }, undefined, { timeout: 30_000 })
  const firstContentAt = await page.evaluate(() => performance.now())

  await page.waitForFunction((expectedSectionCount) => {
    const editor = document.querySelector('.bn-editor')
    return editor?.textContent?.includes(`Section ${expectedSectionCount}`) === true
  }, scenario.sectionCount, { timeout: 30_000 })
  const fullAppliedAt = await page.evaluate(() => performance.now())

  await page.locator('.bn-editor').click({ timeout: 10_000 })
  const editFrameMs = []
  for (let sample = 0; sample < 8; sample += 1) {
    const value = await measureEditFrame(page)
    if (typeof value === 'number') editFrameMs.push(value)
    await page.waitForTimeout(80)
  }

  await context.close()
  return {
    ...parsePerfMetrics(perfLogs),
    editFrameMs,
    editorVisibleMs: editorVisibleAt - startedAt,
    firstContentMs: firstContentAt - startedAt,
    fullAppliedMs: fullAppliedAt - startedAt,
    index,
    perfLogs,
    scenario: scenarioName,
  }
}

function summarizeScenario(scenarioName, scenario, runs) {
  const editFrameSamples = runs.flatMap(run => run.editFrameMs)
  const medians = {
    blockApplyMs: round(median(runs.map(run => run.blockApplyMs))),
    blockResolveMs: round(median(runs.map(run => run.blockResolveMs))),
    editFrameMs: round(median(editFrameSamples)),
    editorVisibleMs: round(median(runs.map(run => run.editorVisibleMs))),
    firstContentMs: round(median(runs.map(run => run.firstContentMs))),
    fullAppliedMs: round(median(runs.map(run => run.fullAppliedMs))),
    noteOpenEditorSwapMs: round(median(runs.map(run => run.noteOpenEditorSwapMs))),
    noteOpenTotalMs: round(median(runs.map(run => run.noteOpenTotalMs))),
  }

  return {
    contentBytes: largeMarkdown(scenario.sectionCount, scenario.title).length,
    medians,
    runs: runs.map(run => ({
      ...run,
      blockApplyMs: round(run.blockApplyMs),
      blockResolveMs: round(run.blockResolveMs),
      editFrameMs: run.editFrameMs.map(round),
      editorVisibleMs: round(run.editorVisibleMs),
      firstContentMs: round(run.firstContentMs),
      fullAppliedMs: round(run.fullAppliedMs),
      noteOpenEditorSwapMs: round(run.noteOpenEditorSwapMs),
      noteOpenTotalMs: round(run.noteOpenTotalMs),
    })),
    scenario: scenarioName,
    sectionCount: scenario.sectionCount,
  }
}

async function runBenchmarks(baseUrl) {
  const browser = await chromium.launch({ headless: !options.headful })
  const summaries = {}
  try {
    for (const scenarioName of options.scenarioNames) {
      const scenario = scenarios[scenarioName]
      console.log(`[perf] scenario=${scenarioName} sections=${scenario.sectionCount}`)
      const runs = []
      for (let index = 1; index <= options.iterations; index += 1) {
        const run = await runIteration({ baseUrl, browser, index, scenario, scenarioName })
        runs.push(run)
        console.log(
          `[perf] ${scenarioName} run=${index} `
            + `visible=${round(run.editorVisibleMs)}ms `
            + `first=${round(run.firstContentMs)}ms `
            + `full=${round(run.fullAppliedMs)}ms `
            + `edit=${round(median(run.editFrameMs))}ms`,
        )
      }
      summaries[scenarioName] = summarizeScenario(scenarioName, scenario, runs)
    }
  } finally {
    await browser.close()
  }
  return summaries
}

const startedBaseUrl = await startDevServer()
try {
  const summaries = await runBenchmarks(startedBaseUrl)
  const thresholds = await readThresholds(thresholdsPath)
  const activeThresholds = options.update ? updateThresholds(thresholds, summaries) : thresholds

  printSummary({ metricLabels, summaries, thresholds: activeThresholds })

  if (options.update) {
    await writeThresholds(thresholdsPath, activeThresholds)
    console.log(`\nUpdated ${thresholdsPath}`)
  }

  const failures = thresholdFailures(activeThresholds, summaries)
  let exitCode = 0
  if (failures.length > 0) {
    printThresholdFailures({ failures, metricLabels })
    exitCode = 1
  }

  await rm(resolve(rootDir, 'test-results'), { recursive: true, force: true })
  if (exitCode !== 0) process.exit(exitCode)
} finally {
  stopDevServer()
}
