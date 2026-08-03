import assert from 'node:assert/strict'
import test from 'node:test'

import {
  aggregateSamples,
  buildSamplePlan,
} from './editor-performance-statistics.mjs'
import {
  thresholdFailures,
  updateThresholds,
} from './editor-performance-thresholds.mjs'

test('builds explicit discarded warmups before measured samples', () => {
  assert.deepEqual(buildSamplePlan({ iterations: 3, warmups: 2 }), [
    { ordinal: 1, phase: 'warmup' },
    { ordinal: 2, phase: 'warmup' },
    { ordinal: 1, phase: 'measured' },
    { ordinal: 2, phase: 'measured' },
    { ordinal: 3, phase: 'measured' },
  ])
})

test('reports median and p90 aggregates instead of trusting one timing', () => {
  assert.deepEqual(aggregateSamples([100, 20, 30, 40, 50]), {
    median: 40,
    p90: 80,
  })
})

test('fails closed when a scenario budget or measurement is missing', () => {
  const missingBudget = thresholdFailures(
    { scenarios: {} },
    { startup: { medians: { appInteractiveMs: 120 } } },
  )
  const missingMeasurement = thresholdFailures(
    {
      scenarios: {
        startup: {
          metrics: {
            appInteractiveMs: { maxMs: 200 },
          },
        },
      },
    },
    { startup: { medians: { appInteractiveMs: null } } },
  )

  assert.deepEqual(missingBudget, [{
    metricName: 'appInteractiveMs',
    reason: 'missing-threshold',
    scenarioName: 'startup',
    value: 120,
  }])
  assert.deepEqual(missingMeasurement, [{
    maxMs: 200,
    metricName: 'appInteractiveMs',
    reason: 'missing-measurement',
    scenarioName: 'startup',
    value: null,
  }])
})

test('baseline updates ratchet an existing maximum down but never loosen it', () => {
  const thresholds = {
    scenarios: {
      startup: {
        metrics: {
          appInteractiveMs: { baselineMs: 100, maxMs: 150 },
        },
      },
    },
  }

  const faster = updateThresholds(thresholds, {
    startup: {
      fixtureCount: 500,
      medians: { appInteractiveMs: 80 },
      p90s: { appInteractiveMs: 90 },
    },
  })
  const slower = updateThresholds(faster, {
    startup: {
      fixtureCount: 500,
      medians: { appInteractiveMs: 130 },
      p90s: { appInteractiveMs: 140 },
    },
  })

  assert.ok(faster.scenarios.startup.metrics.appInteractiveMs.maxMs < 150)
  assert.equal(
    slower.scenarios.startup.metrics.appInteractiveMs.maxMs,
    faster.scenarios.startup.metrics.appInteractiveMs.maxMs,
  )
})
