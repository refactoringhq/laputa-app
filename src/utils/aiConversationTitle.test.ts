import { describe, expect, it } from 'vitest'
import { generateAiConversationTitle } from './aiConversationTitle'

describe('generateAiConversationTitle', () => {
  it('creates a compact title from the first prompt', () => {
    expect(generateAiConversationTitle('please summarize quarterly sponsor outreach next steps')).toBe(
      'Summarize Quarterly Sponsor Outreach',
    )
  })

  it('strips wikilinks and urls before choosing title words', () => {
    expect(generateAiConversationTitle('help with [[Sponsor Onboarding]] https://example.com plan')).toBe(
      'Sponsor Onboarding Plan',
    )
  })
})
