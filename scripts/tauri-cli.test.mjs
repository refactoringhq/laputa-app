import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import {
  DEV_APP_CONFIG_NAMESPACE,
  DEV_TAURI_CONFIG_PATH,
  hasTauriConfigArgument,
  isTauriDevCommand,
  shouldUseShell,
  tauriArgs,
  tauriBinary,
  tauriEnv,
  tauriSpawnOptions,
} from './tauri-cli.mjs'

test('detects tauri dev commands', () => {
  assert.equal(isTauriDevCommand(['dev']), true)
  assert.equal(isTauriDevCommand(['build']), false)
  assert.equal(isTauriDevCommand([]), false)
})

test('detects explicit tauri config arguments', () => {
  assert.equal(hasTauriConfigArgument(['dev', '--config', 'custom.json']), true)
  assert.equal(hasTauriConfigArgument(['dev', '--config=custom.json']), true)
  assert.equal(hasTauriConfigArgument(['dev']), false)
})

test('adds the dev config to tauri dev by default', () => {
  assert.deepEqual(
    tauriArgs(['dev']),
    ['dev', '--config', DEV_TAURI_CONFIG_PATH],
  )
})

test('preserves explicit tauri dev config arguments', () => {
  assert.deepEqual(
    tauriArgs(['dev', '--config', 'custom.json']),
    ['dev', '--config', 'custom.json'],
  )
})

test('leaves non-dev tauri commands on the production config', () => {
  assert.deepEqual(tauriArgs(['build']), ['build'])
})

test('sets the app config namespace only for tauri dev', () => {
  assert.equal(
    tauriEnv(['dev'], { EXISTING: '1' }).TOLARIA_APP_CONFIG_NAMESPACE,
    DEV_APP_CONFIG_NAMESPACE,
  )
  assert.equal(tauriEnv(['build'], { EXISTING: '1' }).TOLARIA_APP_CONFIG_NAMESPACE, undefined)
})

test('uses the Windows command shim through a shell', () => {
  assert.equal(path.basename(tauriBinary('win32')), 'tauri.cmd')
  assert.equal(shouldUseShell('win32'), true)
  assert.equal(
    tauriSpawnOptions(['build'], { EXISTING: '1' }, 'win32').shell,
    true,
  )
})

test('runs the Unix Tauri binary without a shell', () => {
  assert.equal(path.basename(tauriBinary('darwin')), 'tauri')
  assert.equal(shouldUseShell('darwin'), false)
  assert.equal(
    tauriSpawnOptions(['build'], { EXISTING: '1' }, 'darwin').shell,
    false,
  )
})
