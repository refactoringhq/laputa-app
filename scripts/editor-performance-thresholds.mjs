import console from 'node:console'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'

const thresholdDescription = 'Ratcheted perceived-latency budgets for stable synthetic Tolaria flows. Lower is better; maxMs values only move down unless a reviewer explicitly changes the threshold file.'

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
    version: 2,
  }

  for (const [scenarioName, summary] of Object.entries(summaries)) {
    Reflect.set(next.scenarios, scenarioName, updatedScenarioThreshold(thresholds, scenarioName, summary))
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
    writeLine(`\n${scenarioName} (${summary.fixtureLabel})`)
    for (const [metricName, value] of Object.entries(summary.medians)) {
      writeLine(summaryMetricLine({
        label: Reflect.get(metricLabels, metricName) ?? metricName,
        maxMs: metricThreshold(thresholds, scenarioName, metricName)?.maxMs,
        p90: Reflect.get(summary.p90s ?? {}, metricName),
        value,
      }))
    }
  }
}

export function printThresholdFailures({ failures, metricLabels, writeLine = console.error }) {
  writeLine('\nEditor performance thresholds failed:')
  for (const failure of failures) {
    const label = Reflect.get(metricLabels, failure.metricName) ?? failure.metricName
    writeLine(thresholdFailureLine(failure, label))
  }
}

function updatedScenarioThreshold(thresholds, scenarioName, summary) {
  const previousScenario = Reflect.get(thresholds.scenarios ?? {}, scenarioName) ?? {}
  return {
    fixtureLabel: summary.fixtureLabel,
    metrics: updatedMetricThresholds(previousScenario.metrics ?? {}, summary),
  }
}

function updatedMetricThresholds(previousMetrics, summary) {
  return Object.fromEntries(currentMetricEntries(summary).map(([metricName, value]) => [
    metricName,
    {
      baselineMs: value,
      maxMs: ratchetedMax(metricName, Reflect.get(previousMetrics, metricName), value),
      p90Ms: Reflect.get(summary.p90s ?? {}, metricName) ?? null,
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
  return Object.entries(summary.medians)
    .map(([metricName, value]) => metricFailure(thresholds, scenarioName, metricName, value))
    .filter(Boolean)
}

function metricFailure(thresholds, scenarioName, metricName, value) {
  const maxMs = metricThreshold(thresholds, scenarioName, metricName)?.maxMs
  if (typeof maxMs !== 'number') {
    return {
      metricName,
      reason: 'missing-threshold',
      scenarioName,
      value,
    }
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {
      maxMs,
      metricName,
      reason: 'missing-measurement',
      scenarioName,
      value,
    }
  }
  if (value <= maxMs) return null
  return {
    maxMs,
    metricName,
    reason: 'over-budget',
    scenarioName,
    value,
  }
}

function metricThreshold(thresholds, scenarioName, metricName) {
  const scenario = Reflect.get(thresholds.scenarios ?? {}, scenarioName)
  return Reflect.get(scenario?.metrics ?? {}, metricName)
}

function summaryMetricLine({ label, maxMs, p90, value }) {
  const suffix = typeof maxMs === 'number' ? ` / max ${maxMs}ms` : ''
  const medianText = typeof value === 'number' ? `${value}ms` : 'missing'
  const p90Text = typeof p90 === 'number' ? `${p90}ms` : 'missing'
  return `  ${label.padEnd(24)} median ${medianText.padStart(9)}  p90 ${p90Text.padStart(9)}${suffix}`
}

function thresholdFailureLine(failure, label) {
  if (failure.reason === 'missing-threshold') {
    return `  ${failure.scenarioName} ${label}: no maxMs budget is defined`
  }
  if (failure.reason === 'missing-measurement') {
    return `  ${failure.scenarioName} ${label}: measurement was not produced`
  }
  return `  ${failure.scenarioName} ${label}: ${failure.value}ms > ${failure.maxMs}ms`
}
