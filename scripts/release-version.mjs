import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DAY_MS = 24 * 60 * 60 * 1000
const ALPHA_TAG_PATTERN = /^alpha-v(\d{4})\.(\d{1,2})\.(\d{1,2})-alpha\.(\d+)$/
const CALENDAR_STABLE_PATTERN = /^v(\d{4})-(\d{2})-(\d{2})$/
const LEGACY_STABLE_PATTERN = /^stable-v(\d{4})\.(\d{1,2})\.(\d{1,2})$/

function parseDateParts(parts, source) {
  const [year, month, day] = parts.map(Number)
  const value = new Date(Date.UTC(year, month - 1, day))
  if (!dateMatchesParts(value, year, month, day)) {
    throw new Error(`Invalid calendar date in ${source}`)
  }
  return value
}

function dateMatchesParts(value, year, month, day) {
  if (value.getUTCFullYear() !== year) return false
  if (value.getUTCMonth() !== month - 1) return false
  return value.getUTCDate() === day
}

function parseToday(today) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today)
  if (!match) throw new Error(`Invalid UTC date ${today}`)
  return parseDateParts(match.slice(1), today)
}

function parseStableTag(tag) {
  const match = CALENDAR_STABLE_PATTERN.exec(tag) ?? LEGACY_STABLE_PATTERN.exec(tag)
  return match ? parseDateParts(match.slice(1), tag) : null
}

function parseAlphaTag(tag) {
  const match = ALPHA_TAG_PATTERN.exec(tag)
  if (!match) return null
  return { date: parseDateParts(match.slice(1, 4), tag), sequence: Number(match[4]), tag }
}

function compareDates(left, right) {
  return left.getTime() - right.getTime()
}

function latestDate(dates) {
  return dates.reduce((latest, value) => (!latest || value > latest ? value : latest), null)
}

function nextDay(value) {
  return new Date(value.getTime() + DAY_MS)
}

function calendarCore(value) {
  return `${value.getUTCFullYear()}.${value.getUTCMonth() + 1}.${value.getUTCDate()}`
}

function releaseFromTag(tag, todayDate, recoveryBridgeDate) {
  const parsed = parseAlphaTag(tag)
  if (!parsed) throw new Error(`Invalid alpha tag at HEAD: ${tag}`)
  const version = `${calendarCore(parsed.date)}-alpha.${parsed.sequence}`
  const isRecoveryBridge = recoveryBridgeDate && compareDates(parsed.date, recoveryBridgeDate) === 0
  const displayVersion = isRecoveryBridge
    ? `Alpha ${calendarCore(todayDate)}.0`
    : `Alpha ${calendarCore(parsed.date)}.${parsed.sequence}`
  return { channel: 'alpha', displayVersion, tag, version }
}

export function computeAlphaRelease({ alphaTags, stableTags, tagsAtHead, today }) {
  const todayDate = parseToday(today)
  const stableDates = stableTags.map(parseStableTag).filter(Boolean)
  const futureStableDate = latestDate(stableDates.filter((value) => value > todayDate))
  const recoveryBridgeDate = futureStableDate ? nextDay(nextDay(futureStableDate)) : null
  const alphaReleases = alphaTags.map(parseAlphaTag).filter(Boolean)

  if (tagsAtHead.length > 0) {
    return releaseFromTag(tagsAtHead[0], todayDate, recoveryBridgeDate)
  }

  const latestFutureAlpha = latestDate(
    alphaReleases.filter(({ date }) => date > todayDate).map(({ date }) => date),
  )
  const needsRecoveryBridge =
    recoveryBridgeDate && (!latestFutureAlpha || latestFutureAlpha < recoveryBridgeDate)
  const latestValidStable = latestDate(stableDates.filter((value) => value <= todayDate))
  const regularDate =
    latestValidStable && compareDates(latestValidStable, todayDate) === 0
      ? nextDay(todayDate)
      : todayDate
  const releaseDate = needsRecoveryBridge ? recoveryBridgeDate : regularDate
  const core = calendarCore(releaseDate)
  const sequence = alphaReleases.filter(({ date }) => calendarCore(date) === core).length + 1
  const displaySequence = needsRecoveryBridge ? 0 : sequence

  return {
    channel: 'alpha',
    displayVersion: `Alpha ${calendarCore(needsRecoveryBridge ? todayDate : releaseDate)}.${displaySequence}`,
    tag: `alpha-v${core}-alpha.${String(sequence).padStart(4, '0')}`,
    version: `${core}-alpha.${sequence}`,
  }
}

export function computeStableRelease({ tag, today }) {
  const todayDate = parseToday(today)
  const tagDate = parseStableTag(tag)
  if (!tagDate) throw new Error(`Stable tags must use vYYYY-MM-DD or stable-vYYYY.M.D, got ${tag}`)
  if (tagDate > todayDate) {
    throw new Error(`Stable tag ${tag} cannot be later than the current UTC date ${today}`)
  }
  const version = calendarCore(tagDate)
  return { channel: 'stable', displayVersion: tag.startsWith('v') ? tag : version, tag, version }
}

function gitLines(args) {
  const output = execFileSync('git', args, { encoding: 'utf8' }).trim()
  return output ? output.split('\n').filter(Boolean) : []
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`
}

function shellReleaseEnv(release, skipRelease) {
  return [
    `VERSION=${shellQuote(release.version)}`,
    `DISPLAY_VERSION=${shellQuote(release.displayVersion)}`,
    `TAG=${shellQuote(release.tag)}`,
    `CHANNEL=${shellQuote(release.channel)}`,
    `SKIP_RELEASE=${skipRelease ? 'true' : 'false'}`,
  ]
}

function githubReleaseEnv(release, skipRelease) {
  return [
    `version=${release.version}`,
    `display_version=${release.displayVersion}`,
    `tag=${release.tag}`,
    `channel=${release.channel}`,
    `skip_release=${skipRelease ? 'true' : 'false'}`,
  ]
}

export function formatReleaseEnv(release, skipRelease, format = 'shell') {
  const lines = format === 'github'
    ? githubReleaseEnv(release, skipRelease)
    : shellReleaseEnv(release, skipRelease)
  return `${lines.join('\n')}\n`
}

function printReleaseEnv(release, skipRelease, format) {
  process.stdout.write(formatReleaseEnv(release, skipRelease, format))
}

function runCli() {
  const channel = process.argv[2]
  const format = process.argv[3] ?? 'shell'
  const today = process.env.RELEASE_TODAY ?? new Date().toISOString().slice(0, 10)
  if (channel === 'stable') {
    const tag = process.env.RELEASE_TAG ?? process.env.CIRCLE_TAG_VALUE ?? ''
    printReleaseEnv(computeStableRelease({ tag, today }), false, format)
    return
  }
  if (channel !== 'alpha') throw new Error('Usage: node scripts/release-version.mjs alpha|stable')

  const changed = gitLines(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])
  const release = computeAlphaRelease({
    alphaTags: gitLines(['tag', '--list', 'alpha-v*']),
    stableTags: gitLines([
      'for-each-ref',
      '--format=%(refname:short)',
      'refs/tags/v20*',
      'refs/tags/stable-v*',
    ]),
    tagsAtHead: gitLines(['tag', '--points-at', 'HEAD']).filter((tag) => tag.startsWith('alpha-v')),
    today,
  })
  const ignored = changed.every(
    (path) => path.startsWith('site/') || path.startsWith('.circleci/') || path === '.github/workflows/README.md',
  )
  printReleaseEnv(release, changed.length > 0 && ignored, format)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runCli()
