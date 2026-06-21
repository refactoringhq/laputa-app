export interface SheetExternalFormulaResolutionSnapshot {
  signature: string
  status: 'pending' | 'resolved' | 'unavailable'
}

export function shouldWaitForInitialSheetExternalFormulaResolution({
  dependencyCount,
  hasExternalFormulaReferences,
  nativeWorkerEnabled,
  resolution,
  resolvedDependencyCount,
  signature,
  workbookAlreadyBuilt,
}: {
  dependencyCount: number
  hasExternalFormulaReferences: boolean
  nativeWorkerEnabled: boolean
  resolution: SheetExternalFormulaResolutionSnapshot | null
  resolvedDependencyCount: number
  signature: string
  workbookAlreadyBuilt: boolean
}): boolean {
  if (workbookAlreadyBuilt || !hasExternalFormulaReferences || !nativeWorkerEnabled) return false
  if (resolvedDependencyCount < dependencyCount) return true
  if (!resolution || resolution.signature !== signature) return true
  return resolution.status === 'pending'
}
