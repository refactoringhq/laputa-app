#!/usr/bin/env node

import { spawn } from 'node:child_process'
import console from 'node:console'
import { readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import process from 'node:process'
import { resolve } from 'node:path'

const rootDir = process.cwd()
const forwardedArgs = process.argv.slice(2)
const totalShards = positiveInteger(process.env.FRONTEND_COVERAGE_SHARDS ?? '2', 'FRONTEND_COVERAGE_SHARDS')
const concurrency = positiveInteger(
  process.env.FRONTEND_COVERAGE_CONCURRENCY ?? String(totalShards),
  'FRONTEND_COVERAGE_CONCURRENCY',
)
const runId = `${Date.now()}-${process.pid}`
const shardRoot = resolve(os.tmpdir(), 'tolaria-vitest-coverage-shards', runId)
const finalCoverageDir = resolve(rootDir, 'coverage')
const coverageRequire = createCoverageRequire()
const { createCoverageMap } = coverageRequire('istanbul-lib-coverage')
const libReport = coverageRequire('istanbul-lib-report')
const reports = coverageRequire('istanbul-reports')
const thresholdPercent = Number(process.env.VITEST_COVERAGE_THRESHOLD ?? '70')
const thresholds = {
  lines: metricThreshold('LINES'),
  functions: metricThreshold('FUNCTIONS'),
  branches: metricThreshold('BRANCHES'),
  statements: metricThreshold('STATEMENTS'),
}

function positiveInteger(value, name) {
  if (/^[1-9][0-9]*$/.test(value)) {
    return Number(value)
  }

  console.error(`${name} must be a positive integer`)
  process.exit(2)
}

function metricThreshold(metricName) {
  const value = process.env[`VITEST_COVERAGE_${metricName}_THRESHOLD`]
  return value === undefined ? thresholdPercent : Number(value)
}

function createCoverageRequire() {
  const require = createRequire(import.meta.url)
  const coveragePackagePath = require.resolve('@vitest/coverage-v8/package.json')
  return createRequire(coveragePackagePath)
}

function shardLabel(shardIndex) {
  return `${shardIndex}/${totalShards}`
}

function shardCoverageDir(shardIndex) {
  return resolve(shardRoot, `shard-${shardIndex}`)
}

async function clearVitestCache() {
  const exitCode = await spawnCommand('clear-cache', 'pnpm', ['exec', 'vitest', '--clearCache'], process.env)
  if (exitCode !== 0) {
    throw new Error(`Vitest cache clear failed with exit code ${exitCode}`)
  }
}

function runShard(shardIndex) {
  const env = {
    ...process.env,
    VITEST_COVERAGE_FINAL_DIR: shardCoverageDir(shardIndex),
    VITEST_COVERAGE_SHARD: shardLabel(shardIndex),
    VITEST_COVERAGE_SKIP_CLEAR_CACHE: '1',
    VITEST_COVERAGE_SKIP_THRESHOLDS: '1',
  }

  return spawnCommand(
    `coverage-${shardIndex}`,
    process.execPath,
    ['scripts/run-vitest-coverage.mjs', '--coverage.reporter=json', ...forwardedArgs],
    env,
  )
}

function spawnCommand(name, command, args, env) {
  return new Promise((resolveExit, rejectExit) => {
    console.log(`[${name}] started`)
    const child = spawn(command, args, {
      cwd: rootDir,
      env,
      stdio: ['inherit', 'pipe', 'pipe'],
    })

    child.stdout?.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`))
    child.stderr?.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`))
    child.on('error', rejectExit)
    child.on('exit', (code, signal) => {
      if (signal) {
        rejectExit(new Error(`${name} exited via signal: ${signal}`))
        return
      }

      const exitCode = code ?? 1
      console.log(`[${name}] exited with status ${exitCode}`)
      resolveExit(exitCode)
    })
  })
}

async function runShardBatch(firstShard) {
  const shardIndexes = []
  for (
    let shardIndex = firstShard;
    shardIndex <= totalShards && shardIndexes.length < concurrency;
    shardIndex += 1
  ) {
    shardIndexes.push(shardIndex)
  }

  const results = await Promise.all(shardIndexes.map((shardIndex) => runShard(shardIndex)))
  return results.every((exitCode) => exitCode === 0)
}

async function runShards() {
  let firstShard = 1

  while (firstShard <= totalShards) {
    if (!(await runShardBatch(firstShard))) {
      console.error(`Coverage shard artifacts preserved at ${shardRoot}`)
      process.exit(1)
    }

    firstShard += concurrency
  }
}

async function readShardCoverage(shardIndex) {
  const coveragePath = resolve(shardCoverageDir(shardIndex), 'coverage-final.json')
  return JSON.parse(await readFile(coveragePath, 'utf8'))
}

async function mergeCoverage() {
  const coverageMap = createCoverageMap({})

  for (let shardIndex = 1; shardIndex <= totalShards; shardIndex += 1) {
    coverageMap.merge(await readShardCoverage(shardIndex))
  }

  return coverageMap
}

async function writeCoverageReports(coverageMap) {
  await rm(finalCoverageDir, { recursive: true, force: true })
  const context = libReport.createContext({
    coverageMap,
    dir: finalCoverageDir,
  })

  for (const reportName of ['text', 'json', 'html', 'lcov']) {
    reports.create(reportName).execute(context)
  }
}

function printCoverageSummary(summary) {
  for (const metric of ['lines', 'functions', 'branches', 'statements']) {
    const item = summary[metric]
    console.log(
      `${metric.padEnd(10)} ${String(item.pct).padStart(6)}% `
        + `(${item.covered}/${item.total}, threshold ${thresholds[metric]}%)`,
    )
  }
}

function checkCoverageThresholds(coverageMap) {
  const summary = coverageMap.getCoverageSummary().toJSON()
  printCoverageSummary(summary)

  const failures = Object.entries(thresholds)
    .filter(([metric, threshold]) => summary[metric].pct < threshold)

  if (failures.length === 0) {
    return
  }

  for (const [metric, threshold] of failures) {
    console.error(
      `Coverage for ${metric} (${summary[metric].pct}%) does not meet threshold ${threshold}%`,
    )
  }

  process.exit(1)
}

await clearVitestCache()
await runShards()

const coverageMap = await mergeCoverage()
await writeCoverageReports(coverageMap)
checkCoverageThresholds(coverageMap)
await rm(shardRoot, { recursive: true, force: true })
