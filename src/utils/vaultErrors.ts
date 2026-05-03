export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

export function isActiveVaultUnavailableError(error: unknown): boolean {
  return /no active vault selected|active vault is not available/i.test(errorMessage(error))
}
