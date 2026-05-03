import {
  closeSync, fstatSync, openSync, opendirSync, readFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const localesDir = path.join(root, 'src/lib/locales')
const sourcePath = path.join(localesDir, 'en.json')

function readCatalog(filePath) {
  return JSON.parse(readUtf8File(filePath))
}

function readUtf8File(filePath) {
  const fd = openSync(filePath, 'r')
  try {
    return readFileSync(fd, 'utf8')
  } finally {
    closeSync(fd)
  }
}

function directoryFiles(dirPath) {
  const dir = opendirSync(dirPath)
  try {
    const files = []
    let entry = dir.readSync()
    while (entry) {
      if (entry.isFile()) files.push(entry.name)
      entry = dir.readSync()
    }
    return files
  } finally {
    dir.closeSync()
  }
}

function ensureDirectory(dirPath) {
  const fd = openSync(dirPath, 'r')
  try {
    if (!fstatSync(fd).isDirectory()) {
      throw new Error(`${dirPath} is not a directory`)
    }
  } finally {
    closeSync(fd)
  }
}

function isFlatObject(value) {
  if (!value) return false
  if (typeof value !== 'object') return false
  return !Array.isArray(value)
}

function assertFlatStringCatalog(locale, catalog) {
  if (!isFlatObject(catalog)) {
    throw new Error(`${locale}: expected a flat object of translation keys`)
  }

  for (const [key, value] of Object.entries(catalog)) {
    if (typeof value !== 'string') {
      throw new Error(`${locale}: key "${key}" must map to a string`)
    }
  }
}

function missingKeys(sourceKeys, localeKeys) {
  const localeKeySet = new Set(localeKeys)
  return sourceKeys.filter((key) => !localeKeySet.has(key))
}

function extraKeys(sourceKeys, localeKeys) {
  const sourceKeySet = new Set(sourceKeys)
  return localeKeys.filter((key) => !sourceKeySet.has(key))
}

function placeholders(value) {
  return Array.from(value.matchAll(/\{(\w+)\}/g), (match) => match[1]).sort()
}

function sameValues(left, right) {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function formatValues(values) {
  return values.length === 0 ? 'none' : values.join(', ')
}

function placeholderIssues(locale, sourceCatalog, catalog) {
  const issues = []

  for (const [key, sourceValue] of Object.entries(sourceCatalog)) {
    if (!(key in catalog)) continue

    const sourcePlaceholders = placeholders(sourceValue)
    const localePlaceholders = placeholders(catalog[key])
    if (sameValues(sourcePlaceholders, localePlaceholders)) continue

    issues.push(
      `${locale}: key "${key}" placeholders differ ` +
        `(expected ${formatValues(sourcePlaceholders)}, found ${formatValues(localePlaceholders)})`,
    )
  }

  return issues
}

const sourceCatalog = readCatalog(sourcePath)
assertFlatStringCatalog('en', sourceCatalog)

const sourceKeys = Object.keys(sourceCatalog).sort()
ensureDirectory(localesDir)
const localeFiles = directoryFiles(localesDir).filter((file) => file.endsWith('.json'))
const issues = []

for (const file of localeFiles) {
  const locale = file.replace(/\.json$/, '')
  const filePath = path.join(localesDir, file)
  const catalog = readCatalog(filePath)

  assertFlatStringCatalog(locale, catalog)

  if (locale === 'en') continue

  const keys = Object.keys(catalog).sort()
  const missing = missingKeys(sourceKeys, keys)
  const extra = extraKeys(sourceKeys, keys)

  if (missing.length > 0) {
    issues.push(`${locale}: missing ${missing.length} key(s)`)
  }
  if (extra.length > 0) {
    issues.push(`${locale}: extra ${extra.length} key(s)`)
  }

  issues.push(...placeholderIssues(locale, sourceCatalog, catalog))
}

if (issues.length > 0) {
  console.error('Locale validation failed:')
  for (const issue of issues) {
    console.error(`- ${issue}`)
  }
  process.exit(1)
}

console.log(`Validated ${localeFiles.length} locale catalog(s) against ${sourceKeys.length} English keys.`)
