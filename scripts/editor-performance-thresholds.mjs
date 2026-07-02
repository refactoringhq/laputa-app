import console from 'node:console'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'

const thresholdDescription = 'Ratcheted editor performance budgets for synthetic small and large note opens. Lower is better; maxMs values should only move down unless intentionally rebaselined.'

export async function readThresholds(thresholdsPath) {
  if (!existsSync(thresholdsPath)) {
    return { scenarios: {}, version: 1 }
  }
  return JSON.parse(await readFile(thresholdsPath, 'utf8'))
}

export async function writeThresholds(thresholdsPath, thresholds) {
  await writeFile(thresholdsPath, `${JSON.stringify(thresholds, null, 2)}\n`)
}

export function updateThresholds(thresholds, summaries) {
  const next = {
    ...thresholds,
    description: thresholdDescription,
    scenarios: { ...thresholds.scenarios },
    updatedAt: new Date().toISOString(),
    version: 1,
  }

  for (const [scenarioName, summary] of Object.entries(summaries)) {
    next.scenarios[scenarioName] = updatedScenarioThreshold(thresholds, scenarioName, summary)
  }

  return next
}

export function thresholdFailures(thresholds, summaries) {
  return Object.entries(summaries).flatMap(([scenarioName, summary]) => (
    scenarioThresholdFailures(thresholds, scenarioName, summary)
  ))
}

export function printSummary({ metricLabels, summaries, thresholds, writeLine = console.log }) {
  for (const [scenarioName, summary] of Object.entries(summaries)) {
    writeLine(`\n${scenarioName} (${summary.contentBytes} bytes, ${summary.sectionCount} sections)`)
    for (const [metricName, value] of currentMetricEntries(summary)) {
      writeLine(summaryMetricLine({
        label: metricLabels[metricName] ?? metricName,
        maxMs: thresholds.scenarios?.[scenarioName]?.metrics?.[metricName]?.maxMs,
        value,
      }))
    }
  }
}

export function printThresholdFailures({ failures, metricLabels, writeLine = console.error }) {
  writeLine('\nEditor performance thresholds failed:')
  for (const failure of failures) {
    const label = metricLabels[failure.metricName] ?? failure.metricName
    writeLine(`  ${failure.scenarioName} ${label}: ${failure.value}ms > ${failure.maxMs}ms`)
  }
}

function updatedScenarioThreshold(thresholds, scenarioName, summary) {
  const previousScenario = thresholds.scenarios?.[scenarioName] ?? {}
  return {
    contentBytes: summary.contentBytes,
    metrics: updatedMetricThresholds(previousScenario.metrics ?? {}, summary),
    sectionCount: summary.sectionCount,
  }
}

function updatedMetricThresholds(previousMetrics, summary) {
  return Object.fromEntries(currentMetricEntries(summary).map(([metricName, value]) => [
    metricName,
    {
      baselineMs: value,
      maxMs: ratchetedMax(metricName, previousMetrics[metricName], value),
    },
  ]))
}

function currentMetricEntries(summary) {
  return Object.entries(summary.medians)
    .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
}

function ratchetedMax(metricName, existingMetric, value) {
  const observedBudget = metricName === 'editFrameMs'
    ? Math.ceil(Math.max(value * 2.5, value + 8, 16))
    : Math.ceil(Math.max(value * 1.35, value + 25))
  if (!existingMetric?.maxMs) return observedBudget
  return Math.min(existingMetric.maxMs, observedBudget)
}

function scenarioThresholdFailures(thresholds, scenarioName, summary) {
  return currentMetricEntries(summary)
    .map(([metricName, value]) => metricFailure(thresholds, scenarioName, metricName, value))
    .filter(Boolean)
}

function metricFailure(thresholds, scenarioName, metricName, value) {
  const maxMs = thresholds.scenarios?.[scenarioName]?.metrics?.[metricName]?.maxMs
  if (typeof maxMs !== 'number' || value <= maxMs) return null
  return {
    maxMs,
    metricName,
    scenarioName,
    value,
  }
}

function summaryMetricLine({ label, maxMs, value }) {
  const suffix = typeof maxMs === 'number' ? ` / max ${maxMs}ms` : ''
  return `  ${label.padEnd(24)} ${String(value).padStart(6)}ms${suffix}`
}
