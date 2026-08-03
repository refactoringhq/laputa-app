function numericSamples(values) {
  return values.filter(value => typeof value === 'number' && Number.isFinite(value))
}

function percentile(sortedValues, quantile) {
  if (sortedValues.length === 0) return null
  if (sortedValues.length === 1) return sortedValues[0]

  const position = (sortedValues.length - 1) * quantile
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  const lower = sortedValues.at(lowerIndex)
  const upper = sortedValues.at(upperIndex)
  return lower + ((upper - lower) * (position - lowerIndex))
}

export function aggregateSamples(values) {
  const sorted = numericSamples(values).sort((left, right) => left - right)
  return {
    median: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
  }
}

export function buildSamplePlan({ iterations, warmups }) {
  const warmupSamples = Array.from({ length: warmups }, (_, index) => ({
    ordinal: index + 1,
    phase: 'warmup',
  }))
  const measuredSamples = Array.from({ length: iterations }, (_, index) => ({
    ordinal: index + 1,
    phase: 'measured',
  }))
  return [...warmupSamples, ...measuredSamples]
}
