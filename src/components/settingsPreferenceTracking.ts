import type { Settings, NoteWidthMode } from '../types'
import { trackEvent } from '../lib/telemetry'
import {
  trackAiFeaturesEnabledChanged,
  trackDateDisplayFormatChanged,
  trackDefaultNoteWidthChanged,
  trackGitFeaturesEnabledChanged,
  trackSidebarTypePluralizationChanged,
} from '../lib/productAnalytics'
import { areAiFeaturesEnabled } from '../lib/aiFeatures'
import { areGitFeaturesEnabled } from '../lib/gitSettings'
import { areAutomaticUpdateChecksEnabled } from '../lib/automaticUpdateChecks'
import {
  DEFAULT_DATE_DISPLAY_FORMAT,
  normalizeDateDisplayFormat,
  type DateDisplayFormat,
} from '../utils/dateDisplay'
import { DEFAULT_NOTE_WIDTH_MODE, normalizeNoteWidthMode } from '../utils/noteWidth'

export interface SettingsPreferenceDraft {
  analytics: boolean
  aiFeaturesEnabled: boolean
  autoGitAiCommitMessagesEnabled: boolean
  automaticUpdateChecksEnabled: boolean
  dateDisplayFormat: DateDisplayFormat
  defaultNoteWidth: NoteWidthMode
  gitFeaturesEnabled: boolean
  multiWorkspaceEnabled: boolean
  sidebarTypePluralizationEnabled: boolean
}

function numericFlag(value: boolean): number {
  return value ? 1 : 0
}

function trackPreferenceChange<Value>(
  previous: Value,
  next: Value,
  trackChange: (value: Value) => void,
): void {
  if (previous !== next) trackChange(next)
}

function trackEnabledPreferenceChange(
  previous: boolean,
  next: boolean,
  eventName: string,
): void {
  trackPreferenceChange(previous, next, (enabled) => {
    trackEvent(eventName, { enabled: numericFlag(enabled) })
  })
}

export function trackTelemetryConsentChange(previousAnalytics: boolean, nextAnalytics: boolean): void {
  if (!previousAnalytics && nextAnalytics) trackEvent('telemetry_opted_in')
  if (previousAnalytics && !nextAnalytics) trackEvent('telemetry_opted_out')
}

export function trackSettingsPreferenceChanges(settings: Settings, draft: SettingsPreferenceDraft): void {
  trackPreferenceChange(areAiFeaturesEnabled(settings), draft.aiFeaturesEnabled, trackAiFeaturesEnabledChanged)
  trackPreferenceChange(areGitFeaturesEnabled(settings), draft.gitFeaturesEnabled, trackGitFeaturesEnabledChanged)
  trackEnabledPreferenceChange(
    settings.autogit_use_ai_commit_messages === true,
    draft.autoGitAiCommitMessagesEnabled,
    'autogit_ai_commit_messages_changed',
  )
  trackEnabledPreferenceChange(
    areAutomaticUpdateChecksEnabled(settings),
    draft.automaticUpdateChecksEnabled,
    'automatic_update_checks_changed',
  )
  trackPreferenceChange(
    normalizeDateDisplayFormat(settings.date_display_format) ?? DEFAULT_DATE_DISPLAY_FORMAT,
    draft.dateDisplayFormat,
    trackDateDisplayFormatChanged,
  )
  trackPreferenceChange(
    normalizeNoteWidthMode(settings.note_width_mode) ?? DEFAULT_NOTE_WIDTH_MODE,
    draft.defaultNoteWidth,
    trackDefaultNoteWidthChanged,
  )
  trackPreferenceChange(
    settings.sidebar_type_pluralization_enabled ?? true,
    draft.sidebarTypePluralizationEnabled,
    trackSidebarTypePluralizationChanged,
  )
  trackEnabledPreferenceChange(
    settings.multi_workspace_enabled === true,
    draft.multiWorkspaceEnabled,
    'multi_workspace_mode_changed',
  )
}
