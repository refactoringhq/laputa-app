import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeAlphaRelease, computeStableRelease } from './release-version.mjs'

const today = '2026-08-02'

describe('release version computation', () => {
  it('rejects future-dated stable tags', () => {
    assert.throws(
      () => computeStableRelease({ tag: 'v2027-07-31', today }),
      /cannot be later than the current UTC date 2026-08-02/,
    )
  })

  it('preserves the next-day alpha safeguard after a same-day stable release', () => {
    assert.deepEqual(
      computeAlphaRelease({
        alphaTags: [],
        stableTags: ['v2026-08-02'],
        tagsAtHead: [],
        today,
      }),
      {
        channel: 'alpha',
        displayVersion: 'Alpha 2026.8.3.1',
        tag: 'alpha-v2026.8.3-alpha.0001',
        version: '2026.8.3-alpha.1',
      },
    )
  })

  it('creates one monotonic bridge when an accepted future stable tag poisoned updater ordering', () => {
    assert.deepEqual(
      computeAlphaRelease({
        alphaTags: ['alpha-v2027.8.1-alpha.0017'],
        stableTags: ['v2027-07-31', 'v2026-07-22'],
        tagsAtHead: [],
        today,
      }),
      {
        channel: 'alpha',
        displayVersion: 'Alpha 2026.8.2.0',
        tag: 'alpha-v2027.8.2-alpha.0001',
        version: '2027.8.2-alpha.1',
      },
    )
  })

  it('returns to the real calendar series after the recovery bridge exists', () => {
    assert.deepEqual(
      computeAlphaRelease({
        alphaTags: [
          'alpha-v2027.8.1-alpha.0017',
          'alpha-v2027.8.2-alpha.0001',
        ],
        stableTags: ['v2027-07-31', 'v2026-07-22'],
        tagsAtHead: [],
        today,
      }),
      {
        channel: 'alpha',
        displayVersion: 'Alpha 2026.8.2.1',
        tag: 'alpha-v2026.8.2-alpha.0001',
        version: '2026.8.2-alpha.1',
      },
    )
  })
})
