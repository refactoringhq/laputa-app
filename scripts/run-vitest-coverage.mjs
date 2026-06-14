#!/usr/bin/env node

import { cp, mkdir, rm } from 'node:fs/promises'
import console from 'node:console'
import os from 'node:os'
import process from 'node:process'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const rootDir = process.cwd()
const finalCoverageDir = resolve(rootDir, process.env.VITEST_COVERAGE_FINAL_DIR ?? 'coverage')
const coverageRunRoot = resolve(os.tmpdir(), 'tolaria-vitest-coverage-runs')
const forwardedArgs = process.argv.slice(2)
const hasFileParallelismOverride = forwardedArgs.some((arg) =>
  arg === '--fileParallelism' || arg === '--no-file-parallelism'
)
const hasMaxWorkersOverride = forwardedArgs.some((arg) =>
  arg === '--maxWorkers' || arg.startsWith('--maxWorkers=')
)
const hasShardOverride = forwardedArgs.some((arg) =>
  arg === '--shard' || arg.startsWith('--shard=')
)
const defaultMaxWorkers = resolveDefaultMaxWorkers()
const coverageShard = process.env.VITEST_COVERAGE_SHARD?.trim() ?? ''
const skipCoverageThresholds = process.env.VITEST_COVERAGE_SKIP_THRESHOLDS === '1'
const skipClearCache = process.env.VITEST_COVERAGE_SKIP_CLEAR_CACHE === '1'
const maxAttempts = 2

// Standalone pnpm installs ship a native binary, so npm_execpath points at
// a Mach-O/ELF executable. Only reuse process.execPath (node) when the path
// is something node can actually load as a module.
const packageManagerExec = process.env.npm_execpath
const isJsExecpath = packageManagerExec && /\.[mc]?js$/i.test(packageManagerExec)
const command = isJsExecpath ? process.execPath : 'pnpm'
const baseCommandArgs = isJsExecpath
  ? [packageManagerExec, 'exec', 'vitest', 'run', '--coverage']
  : ['exec', 'vitest', 'run', '--coverage']
const clearCacheCommandArgs = isJsExecpath
  ? [packageManagerExec, 'exec', 'vitest', '--clearCache']
  : ['exec', 'vitest', '--clearCache']

function isKnownVitestInternalStateFlake(output) {
  return output.includes('Vitest failed to access its internal state.')
    && /Test Files\s+\d+\s+passed\s+\(\d+\)/.test(output)
    && /Tests\s+\d+\s+passed\s+\(\d+\)/.test(output)
}

function appendCapturedOutput(output, chunk) {
  const nextOutput = output + chunk
  return nextOutput.length > 200_000 ? nextOutput.slice(-200_000) : nextOutput
}

function resolveDefaultMaxWorkers() {
  const value = process.env.VITEST_COVERAGE_MAX_WORKERS?.trim()

  if (!value) {
    return '4'
  }

  if (/^[1-9][0-9]*%?$/.test(value)) {
    return value
  }

  console.warn(`Ignoring invalid VITEST_COVERAGE_MAX_WORKERS=${JSON.stringify(value)}; using 4`)
  return '4'
}

function isValidCoverageShard(value) {
  return /^[1-9][0-9]*\/[1-9][0-9]*$/.test(value)
}

function coverageThresholdOverrideArgs() {
  return [
    '--coverage.thresholds.lines=0',
    '--coverage.thresholds.functions=0',
    '--coverage.thresholds.branches=0',
    '--coverage.thresholds.statements=0',
  ]
}

async function runCoverageAttempt(attempt) {
  const runId = `${Date.now()}-${process.pid}-${attempt}`
  const runCoverageDir = resolve(coverageRunRoot, runId)
  const runCoverageTempDir = resolve(runCoverageDir, '.tmp')

  await mkdir(runCoverageDir, { recursive: true })
  // Vitest writes per-worker coverage shards under reportsDirectory/.tmp.
  await mkdir(runCoverageTempDir, { recursive: true })
  if (!skipClearCache) {
    await clearVitestCache()
  }

  const commandArgs = [
    ...baseCommandArgs,
    // Keep coverage fast enough for CI while avoiding the unbounded worker
    // contention that makes a few DOM-heavy suites time out under full
    // file parallelism. Callers can still opt into serial or wider runs.
    ...(hasFileParallelismOverride ? [] : ['--fileParallelism']),
    ...(hasMaxWorkersOverride ? [] : [`--maxWorkers=${defaultMaxWorkers}`]),
    ...(coverageShard && !hasShardOverride ? [`--shard=${coverageShard}`] : []),
    ...(skipCoverageThresholds ? coverageThresholdOverrideArgs() : []),
    `--coverage.reportsDirectory=${runCoverageDir}`,
    ...forwardedArgs,
  ]
  let output = ''

  const exitCode = await new Promise((resolveExit, rejectExit) => {
    const child = spawn(command, commandArgs, {
      cwd: rootDir,
      env: {
        ...process.env,
        VITEST_COVERAGE_DIR: runCoverageDir,
      },
      stdio: ['inherit', 'pipe', 'pipe'],
    })

    const handleOutput = (stream, target) => {
      if (!stream) return
      stream.setEncoding('utf8')
      stream.on('data', (chunk) => {
        target.write(chunk)
        output = appendCapturedOutput(output, chunk)
      })
    }

    handleOutput(child.stdout, process.stdout)
    handleOutput(child.stderr, process.stderr)

    child.on('error', rejectExit)
    child.on('exit', (code, signal) => {
      if (signal) {
        rejectExit(new Error(`Vitest coverage exited via signal: ${signal}`))
        return
      }

      resolveExit(code ?? 1)
    })
  })

  return {
    exitCode,
    output,
    runCoverageDir,
  }
}

async function clearVitestCache() {
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    const child = spawn(command, clearCacheCommandArgs, {
      cwd: rootDir,
      env: process.env,
      stdio: 'inherit',
    })

    child.on('error', rejectExit)
    child.on('exit', (code, signal) => {
      if (signal) {
        rejectExit(new Error(`Vitest cache clear exited via signal: ${signal}`))
        return
      }

      resolveExit(code ?? 1)
    })
  })

  if (exitCode !== 0) {
    throw new Error(`Vitest cache clear failed with exit code ${exitCode}`)
  }
}

if (coverageShard && !isValidCoverageShard(coverageShard)) {
  console.error(`Invalid VITEST_COVERAGE_SHARD=${JSON.stringify(coverageShard)}; expected index/total`)
  process.exit(2)
}

let finalRun = null

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const run = await runCoverageAttempt(attempt)
  finalRun = run

  if (run.exitCode === 0) {
    await rm(finalCoverageDir, { recursive: true, force: true })
    await cp(run.runCoverageDir, finalCoverageDir, {
      force: true,
      recursive: true,
    })
    await rm(run.runCoverageDir, { recursive: true, force: true })
    process.exit(0)
  }

  // Retry once when Vitest itself flakes after a fully passing suite.
  if (attempt < maxAttempts && isKnownVitestInternalStateFlake(run.output)) {
    console.error(`Vitest hit a known internal-state teardown flake on attempt ${attempt}; retrying once...`)
    await rm(run.runCoverageDir, { recursive: true, force: true })
    continue
  }

  break
}

console.error(`Vitest coverage artifacts preserved at ${finalRun.runCoverageDir}`)
process.exit(finalRun.exitCode)
