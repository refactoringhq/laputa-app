#!/usr/bin/env node
/* global console */
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`)
  }
}

function parsePlan(planText) {
  const entries = []
  const seen = new Set()

  for (const section of planText.split(/\n(?=\S)/)) {
    const label = section.split('\n')[0]?.trim() ?? ''
    const location = readField(section, 'Install location')
    const url = readField(section, 'Download url')
    rememberEntry(entries, seen, { label, location, url })
  }

  return entries
}

function readField(text, name) {
  const match = text.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, 'm'))
  return match?.[1].trim() ?? ''
}

function rememberEntry(entries, seen, entry) {
  const key = `${entry.location}\n${entry.url}`
  if (!entry.location || !entry.url || seen.has(key)) return
  seen.add(key)
  entries.push(entry)
}

function installBrowser(entry) {
  const markerPath = join(entry.location, 'INSTALLATION_COMPLETE')
  if (existsSync(markerPath)) {
    console.log(`Already installed: ${entry.label}`)
    return
  }

  const workDir = join(tmpdir(), `playwright-${Date.now()}`)
  const archivePath = join(workDir, 'browser.zip')
  const extractDir = join(workDir, 'extract')

  rmSync(entry.location, { force: true, recursive: true })
  mkdirSync(extractDir, { recursive: true })

  console.log(`Downloading ${entry.label}`)
  run('curl', [
    '-fL',
    '--retry',
    '3',
    '--connect-timeout',
    '20',
    '-o',
    archivePath,
    entry.url,
  ])

  console.log(`Extracting ${entry.label}`)
  run('unzip', ['-q', archivePath, '-d', extractDir])

  mkdirSync(entry.location, { recursive: true })
  for (const child of readdirSync(extractDir)) {
    renameSync(join(extractDir, child), join(entry.location, child))
  }

  writeFileSync(markerPath, '')
  rmSync(workDir, { force: true, recursive: true })
}

const planText = execFileSync(
  'npx',
  ['playwright', 'install', '--dry-run', 'chromium'],
  { encoding: 'utf8' },
)
const entries = parsePlan(planText)

if (entries.length === 0) {
  throw new Error('Playwright did not report any browser archives to install')
}

for (const entry of entries) {
  installBrowser(entry)
}
