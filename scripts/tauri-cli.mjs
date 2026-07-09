import { spawn } from 'node:child_process'
import console from 'node:console'
import path from 'node:path'
import process from 'node:process'

export const DEV_APP_CONFIG_NAMESPACE = 'com.tolaria.app.dev'
export const DEV_TAURI_CONFIG_PATH = path.join('src-tauri', 'tauri.dev.conf.json')

const repoRoot = path.resolve(import.meta.dirname, '..')
const tauriBinary = path.join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tauri.cmd' : 'tauri',
)

export function isTauriDevCommand(args) {
  return args[0] === 'dev'
}

export function hasTauriConfigArgument(args) {
  return args.some((arg, index) => (
    arg === '--config'
    || arg.startsWith('--config=')
    || args[index - 1] === '--config'
  ))
}

export function tauriArgs(args) {
  if (!isTauriDevCommand(args) || hasTauriConfigArgument(args)) return args
  return [...args, '--config', DEV_TAURI_CONFIG_PATH]
}

export function tauriEnv(args, env = process.env) {
  if (!isTauriDevCommand(args)) return env
  return {
    ...env,
    TOLARIA_APP_CONFIG_NAMESPACE: DEV_APP_CONFIG_NAMESPACE,
  }
}

export function runTauriCli(args = process.argv.slice(2), env = process.env) {
  const child = spawn(tauriBinary, tauriArgs(args), {
    cwd: repoRoot,
    env: tauriEnv(args, env),
    stdio: 'inherit',
  })

  child.on('error', (error) => {
    console.error(error)
    process.exit(1)
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 1)
  })

  return child
}

if (process.argv[1] === import.meta.filename) {
  runTauriCli()
}
