#!/usr/bin/env node
/* global document, fetch, HTMLElement, performance, requestAnimationFrame, Response, setTimeout, URL, window */

import { spawn } from 'node:child_process'
import console from 'node:console'
import { mkdir, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import {
  aggregateSamples,
  buildSamplePlan,
} from './editor-performance-statistics.mjs'
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
  startup: {
    entryCount: 500,
    fixtureLabel: '500 deterministic vault entries',
    kind: 'startup',
    metricNames: ['reactShellMs', 'activeVaultUsableMs', 'appInteractiveMs'],
  },
  list: {
    entryCount: 2_000,
    fixtureLabel: '2,000 deterministic virtualized rows',
    kind: 'list',
    metricNames: ['listScrollReadyMs'],
  },
  small: {
    entryCount: 500,
    fixtureLabel: '5-section note in a 500-entry vault',
    kind: 'note',
    metricNames: [
      'editorVisibleMs',
      'firstContentMs',
      'fullAppliedMs',
      'editFrameMs',
      'blockResolveMs',
      'blockApplyMs',
      'noteOpenEditorSwapMs',
      'noteOpenTotalMs',
    ],
    sectionCount: 5,
    title: 'Perf Small Note',
  },
  large: {
    entryCount: 500,
    fixtureLabel: '460-section note in a 500-entry vault',
    kind: 'note',
    metricNames: [
      'editorVisibleMs',
      'firstContentMs',
      'fullAppliedMs',
      'editFrameMs',
      'blockResolveMs',
      'blockApplyMs',
      'noteOpenEditorSwapMs',
      'noteOpenTotalMs',
    ],
    sectionCount: 460,
    title: 'Perf Large Note',
  },
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
  activeVaultUsableMs: 'active vault usable',
  appInteractiveMs: 'app interactive',
  listScrollReadyMs: 'list scroll rendered',
  reactShellMs: 'React shell',
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
    warmups: nonNegativeInteger(process.env.EDITOR_PERF_WARMUPS ?? '1', 'EDITOR_PERF_WARMUPS'),
  }
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
  const arg = args.at(index)
  if (arg === '--') return index
  if (arg === '--help' || arg === '-h') exitWithHelp(0)
  if (applyFlagOption(parsed, arg)) return index
  if (applyValueOption(parsed, args, index, arg)) return index + 1
  console.error(`Unknown argument: ${arg}`)
  exitWithHelp(2)
  return index
}

function applyFlagOption(parsed, arg) {
  if (arg === '--headful') parsed.headful = true
  else if (arg === '--update') parsed.update = true
  else return false
  return true
}

function applyValueOption(parsed, args, index, arg) {
  const valueOptionNames = [
    '--base-url',
    '--iterations',
    '--port',
    '--scenario',
    '--thresholds',
    '--warmups',
  ]
  if (!valueOptionNames.includes(arg)) return false
  const value = requiredValue(args, index, arg)
  if (arg === '--base-url') parsed.baseUrl = value
  else if (arg === '--iterations') parsed.iterations = positiveInteger(value, arg)
  else if (arg === '--port') parsed.port = value
  else if (arg === '--scenario') parsed.scenarioNames = value.split(',').filter(Boolean)
  else if (arg === '--thresholds') parsed.thresholdsPath = value
  else parsed.warmups = nonNegativeInteger(value, arg)
  return true
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
  const value = args.at(index + 1)
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

function nonNegativeInteger(value, name) {
  if (/^(0|[1-9][0-9]*)$/.test(String(value))) return Number(value)
  console.error(`${name} must be a non-negative integer`)
  process.exit(2)
}

function printHelp() {
  process.stdout.write(`Usage: pnpm perf:editor [options]

Options:
  --base-url <url>       Reuse an existing dev server instead of starting Vite.
  --iterations <count>   Runs per scenario. Default: 5.
  --warmups <count>      Discarded warmup runs per scenario. Default: 1.
  --scenario <names>     Comma-separated scenarios: startup,list,small,large.
  --thresholds <path>    Threshold JSON path. Default: .editor-performance-thresholds.json.
  --update               Ratchet stored baselines and thresholds from the current run.
  --headful              Run Chromium headed for debugging.
`)
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

function syntheticEntry({ index = 0, markdown = '', title }) {
  const slug = title.toLowerCase().replace(/\s+/g, '-')
  return {
    aliases: [],
    archived: false,
    belongsTo: [],
    color: null,
    createdAt: 1_700_000_000 + index,
    favorite: false,
    favoriteIndex: null,
    fileSize: markdown.length,
    filename: `${slug}.md`,
    hasH1: true,
    icon: null,
    isA: 'Note',
    listPropertiesDisplay: [],
    modifiedAt: 1_710_000_000 + index,
    order: null,
    organized: false,
    outgoingLinks: ['build-laputa-app'],
    path: `/performance-fixture/${slug}.md`,
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

function syntheticVaultEntries(count, primaryEntry = null) {
  const entries = Array.from({ length: count }, (_, index) => {
    const ordinal = index + 1
    return syntheticEntry({
      index,
      markdown: `# Performance Note ${ordinal}\n\nStable fixture body ${ordinal}.`,
      title: `Performance Note ${String(ordinal).padStart(4, '0')}`,
    })
  })
  if (!primaryEntry) return entries
  return [primaryEntry, ...entries.slice(1)]
}

const waitForServer = async (url) => {
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
  devServer = spawn(
    'pnpm',
    ['preview', '--host', '127.0.0.1', '--port', options.port, '--strictPort'],
    {
      cwd: rootDir,
      env: process.env,
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

async function installSyntheticVault(page, entries, contentByPath) {
  await page.addInitScript(({ syntheticContent, syntheticEntries }) => {
    globalThis.__TOLARIA_PERFORMANCE_HARNESS__ = true
    localStorage.setItem('tolaria:claude-code-onboarding-dismissed', '1')
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
    const contentRows = Object.entries(syntheticContent).map(([path, content]) => ({ content, path }))
    const syntheticResponse = (path) => {
      if (path === '/api/vault/all-content') return jsonResponse(contentRows)
      if (path === '/api/vault/content') return jsonResponse({ content: contentRows[0]?.content ?? '' })
      if (path === '/api/vault/entry') return jsonResponse(syntheticEntries[0])
      if (path === '/api/vault/list' || path === '/api/vault/search') return jsonResponse(syntheticEntries)
      if (path === '/api/vault/ping') return new Response('ok', { status: 200 })
      return null
    }
    window.fetch = async (input, init) => {
      const response = syntheticResponse(requestPath(input))
      if (response) return response
      return originalFetch(input, init)
    }

    const contentFor = args => syntheticContent[args?.path] ?? ''
    const entryFor = args => (
      syntheticEntries.find(candidate => candidate.path === args?.path)
      ?? syntheticEntries[0]
    )
    const handlerPatches = {
      get_all_content: () => () => syntheticContent,
      get_note_content: () => contentFor,
      list_vault: () => () => syntheticEntries,
      read_vault_snapshot: () => () => syntheticEntries,
      reload_vault: () => () => syntheticEntries,
      reload_vault_entry: () => entryFor,
      validate_note_content: () => args => args?.content === contentFor(args),
    }

    const patchHandlers = (handlers) => {
      if (!handlers || handlers.__editorPerformancePatched) return handlers ?? null
      for (const [name, createHandler] of Object.entries(handlerPatches)) {
        Reflect.set(handlers, name, createHandler(Reflect.get(handlers, name)))
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
  }, { syntheticContent: contentByPath, syntheticEntries: entries })
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

async function openFixturePage({ baseUrl, browser, contentByPath, entries }) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const perfLogs = []
  page.on('console', (message) => {
    const text = message.text()
    if (text.includes('[perf]')) perfLogs.push(text)
  })
  await installSyntheticVault(page, entries, contentByPath)
  await page.goto(baseUrl, { timeout: 90_000, waitUntil: 'domcontentloaded' })
  await page.getByText('Set up later', { exact: true }).click({ timeout: 2_000 }).catch(() => {})
  return { context, page, perfLogs }
}

async function startupMarkMs(page, phase) {
  const markName = `tolaria:${phase}`
  await page.waitForFunction(
    name => performance.getEntriesByName(name, 'mark').length > 0,
    markName,
    { timeout: 30_000 },
  )
  return await page.evaluate(
    name => performance.getEntriesByName(name, 'mark')[0]?.startTime ?? null,
    markName,
  )
}

const runStartupIteration = async ({ baseUrl, browser, scenario }) => {
  const entries = syntheticVaultEntries(scenario.entryCount)
  const fixture = await openFixturePage({
    baseUrl,
    browser,
    contentByPath: {},
    entries,
  })
  try {
    return {
      activeVaultUsableMs: await startupMarkMs(fixture.page, 'active_usable'),
      appInteractiveMs: await startupMarkMs(fixture.page, 'app_interactive'),
      perfLogs: fixture.perfLogs,
      reactShellMs: await startupMarkMs(fixture.page, 'react_shell'),
    }
  } finally {
    await fixture.context.close()
  }
}

async function measureListScroll(page, entryCount) {
  const scroller = page.locator('[data-testid="virtuoso-scroller"]')
  await scroller.waitFor({ state: 'visible', timeout: 30_000 })
  return await scroller.evaluate(async (element, expectedCount) => {
    const lastRenderedIndex = () => {
      const items = [...document.querySelectorAll('[data-testid="virtuoso-item-list"] [data-index]')]
      return Math.max(...items.map(item => Number(item.getAttribute('data-index') ?? '-1')))
    }
    const startedAt = performance.now()
    element.scrollTop = element.scrollHeight - element.clientHeight
    element.dispatchEvent(new Event('scroll'))
    const targetIndex = Math.floor(expectedCount * 0.9)
    for (let frame = 0; frame < 120 && lastRenderedIndex() < targetIndex; frame += 1) {
      await new Promise(resolveFrame => requestAnimationFrame(resolveFrame))
    }
    if (lastRenderedIndex() < targetIndex) return null
    await new Promise(resolveFrame => requestAnimationFrame(resolveFrame))
    await new Promise(resolveFrame => requestAnimationFrame(resolveFrame))
    return performance.now() - startedAt
  }, entryCount)
}

const runListIteration = async ({ baseUrl, browser, scenario }) => {
  const entries = syntheticVaultEntries(scenario.entryCount)
  const fixture = await openFixturePage({
    baseUrl,
    browser,
    contentByPath: {},
    entries,
  })
  try {
    await startupMarkMs(fixture.page, 'app_interactive')
    return {
      listScrollReadyMs: await measureListScroll(fixture.page, scenario.entryCount),
      perfLogs: fixture.perfLogs,
    }
  } finally {
    await fixture.context.close()
  }
}

const runNoteIteration = async ({ baseUrl, browser, scenario }) => {
  const markdown = largeMarkdown(scenario.sectionCount, scenario.title)
  const entry = syntheticEntry({
    index: scenario.entryCount + 1,
    markdown,
    title: scenario.title,
  })
  const entries = syntheticVaultEntries(scenario.entryCount, entry)
  const contentByPath = {}
  Reflect.set(contentByPath, entry.path, markdown)
  const fixture = await openFixturePage({
    baseUrl,
    browser,
    contentByPath,
    entries,
  })
  try {
    const title = fixture.page.getByText(scenario.title, { exact: true }).first()
    await title.waitFor({ state: 'visible', timeout: 30_000 })
    const startedAt = await fixture.page.evaluate(() => performance.now())
    await title.click()

    await fixture.page.locator('.editor__blocknote-container').waitFor({ state: 'visible', timeout: 30_000 })
    await fixture.page.locator('.bn-editor').waitFor({ state: 'visible', timeout: 30_000 })
    const editorVisibleAt = await fixture.page.evaluate(() => performance.now())
    await waitForEditorSection(fixture.page, 1)
    const firstContentAt = await fixture.page.evaluate(() => performance.now())
    await waitForEditorSection(fixture.page, scenario.sectionCount)
    const fullAppliedAt = await fixture.page.evaluate(() => performance.now())

    await fixture.page.locator('.bn-editor').click({ timeout: 10_000 })
    const editFrameMs = []
    for (let sample = 0; sample < 8; sample += 1) {
      const value = await measureEditFrame(fixture.page)
      if (typeof value === 'number') editFrameMs.push(value)
      await fixture.page.waitForTimeout(80)
    }

    return {
      ...parsePerfMetrics(fixture.perfLogs),
      editFrameMs,
      editorVisibleMs: editorVisibleAt - startedAt,
      firstContentMs: firstContentAt - startedAt,
      fullAppliedMs: fullAppliedAt - startedAt,
      perfLogs: fixture.perfLogs,
    }
  } finally {
    await fixture.context.close()
  }
}

async function waitForEditorSection(page, sectionCount) {
  await page.waitForFunction((expectedSectionCount) => {
    const editor = document.querySelector('.bn-editor')
    return editor?.textContent?.includes(`Section ${expectedSectionCount}`) === true
  }, sectionCount, { timeout: 30_000 })
}

function runScenarioIteration(args) {
  if (args.scenario.kind === 'startup') return runStartupIteration(args)
  if (args.scenario.kind === 'list') return runListIteration(args)
  return runNoteIteration(args)
}

function metricSamples(runs, metricName) {
  if (metricName === 'editFrameMs') return runs.flatMap(run => run.editFrameMs)
  return runs.map(run => Reflect.get(run, metricName))
}

function summarizeScenario(scenarioName, scenario, runs) {
  const aggregates = Object.fromEntries(scenario.metricNames.map((metricName) => [
    metricName,
    aggregateSamples(metricSamples(runs, metricName)),
  ]))
  const medians = Object.fromEntries(Object.entries(aggregates).map(([name, values]) => [
    name,
    round(values.median),
  ]))
  const p90s = Object.fromEntries(Object.entries(aggregates).map(([name, values]) => [
    name,
    round(values.p90),
  ]))

  return {
    fixtureLabel: scenario.fixtureLabel,
    medians,
    p90s,
    runs: runs.map(roundRun),
    scenario: scenarioName,
  }
}

function roundRun(run) {
  return Object.fromEntries(Object.entries(run).map(([name, value]) => {
    if (Array.isArray(value) && name === 'editFrameMs') return [name, value.map(round)]
    if (typeof value === 'number') return [name, round(value)]
    return [name, value]
  }))
}

function runMetricSummary(scenario, run) {
  return scenario.metricNames
    .map((metricName) => {
      const value = metricName === 'editFrameMs'
        ? aggregateSamples(run.editFrameMs).median
        : Reflect.get(run, metricName)
      return `${metricName}=${round(value)}ms`
    })
    .join(' ')
}

const runBenchmarks = async (baseUrl) => {
  const browser = await chromium.launch({ headless: !options.headful })
  const summaries = {}
  try {
    for (const scenarioName of options.scenarioNames) {
      const scenario = Reflect.get(scenarios, scenarioName)
      process.stdout.write(`[perf] scenario=${scenarioName} fixture="${scenario.fixtureLabel}"\n`)
      const runs = []
      const samplePlan = buildSamplePlan({
        iterations: options.iterations,
        warmups: options.warmups,
      })
      for (const sample of samplePlan) {
        const run = await runScenarioIteration({ baseUrl, browser, scenario })
        const sampleLabel = `${sample.phase}=${sample.ordinal}`
        process.stdout.write(`[perf] ${scenarioName} ${sampleLabel} ${runMetricSummary(scenario, run)}\n`)
        if (sample.phase === 'measured') runs.push(run)
      }
      Reflect.set(summaries, scenarioName, summarizeScenario(scenarioName, scenario, runs))
    }
  } finally {
    await browser.close()
  }
  return summaries
}

async function writeResultFile({ failures, summaries }) {
  await mkdir('test-results', { recursive: true })
  const result = {
    failures,
    generatedAt: new Date().toISOString(),
    iterations: options.iterations,
    scenarios: summaries,
    status: failures.length === 0 ? 'passed' : 'failed',
    thresholdsPath,
    warmups: options.warmups,
  }
  await writeFile('test-results/performance-summary.json', `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write('\nWrote test-results/performance-summary.json\n')
}

const startedBaseUrl = await startDevServer()
try {
  const summaries = await runBenchmarks(startedBaseUrl)
  const thresholds = await readThresholds(thresholdsPath)
  const activeThresholds = options.update ? updateThresholds(thresholds, summaries) : thresholds

  printSummary({ metricLabels, summaries, thresholds: activeThresholds })

  if (options.update) {
    await writeThresholds(thresholdsPath, activeThresholds)
    process.stdout.write(`\nUpdated ${thresholdsPath}\n`)
  }

  const failures = thresholdFailures(activeThresholds, summaries)
  let exitCode = 0
  if (failures.length > 0) {
    printThresholdFailures({ failures, metricLabels })
    exitCode = 1
  }

  await writeResultFile({ failures, summaries })
  if (exitCode !== 0) process.exitCode = exitCode
} finally {
  stopDevServer()
}
