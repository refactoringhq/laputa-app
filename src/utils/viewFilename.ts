const VIEW_FILENAME_EXTENSION = '.yml'
const FALLBACK_VIEW_FILENAME_STEM = 'view'
const WINDOWS_RESERVED_DEVICE_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
])

export function slugifyViewFilenameStem(name: string): string {
  const stem = name
    .normalize('NFKC')
    .toLocaleLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/(^-+|-+$)/g, '')

  return avoidReservedDeviceName(stem || FALLBACK_VIEW_FILENAME_STEM)
}

export function createViewFilename(name: string, existingFilenames: string[] = []): string {
  const baseStem = slugifyViewFilenameStem(name)
  const usedFilenames = new Set(existingFilenames.map((filename) => filename.toLocaleLowerCase()))
  let candidateStem = baseStem
  let suffix = 2

  while (usedFilenames.has(filenameFromStem(candidateStem).toLocaleLowerCase())) {
    candidateStem = `${baseStem}-${suffix}`
    suffix += 1
  }

  return filenameFromStem(candidateStem)
}

function filenameFromStem(stem: string): string {
  return `${stem}${VIEW_FILENAME_EXTENSION}`
}

function avoidReservedDeviceName(stem: string): string {
  return WINDOWS_RESERVED_DEVICE_NAMES.has(stem.toLocaleUpperCase()) ? `${stem}-view` : stem
}
