export function getVaultTriggerClassName(open: boolean, compact: boolean): string {
  if (compact) {
    return open
      ? 'h-6 w-6 rounded-sm bg-[var(--hover)] p-0 text-foreground hover:bg-[var(--hover)]'
      : 'h-6 w-6 rounded-sm p-0 text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground'
  }

  return open
    ? 'h-auto gap-1 rounded-sm bg-[var(--hover)] px-1 py-0.5 text-[12px] font-medium text-foreground hover:bg-[var(--hover)]'
    : 'h-auto gap-1 rounded-sm px-1 py-0.5 text-[12px] font-medium text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground'
}
