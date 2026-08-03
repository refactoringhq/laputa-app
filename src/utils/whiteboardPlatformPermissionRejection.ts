let activeWhiteboardPlatformPermissionGuards = 0

function errorProperty(error: unknown, property: 'message' | 'name'): unknown {
  if (error instanceof Error) return Reflect.get(error, property)
  if (typeof error === 'string') return property === 'message' ? error : undefined
  if (typeof error !== 'object' || error === null) return undefined
  return property in error ? Reflect.get(error, property) : undefined
}

function errorStringProperty(error: unknown, property: 'message' | 'name'): string {
  const value = errorProperty(error, property)
  return typeof value === 'string' ? value : ''
}

export function isWhiteboardPlatformPermissionRejection(reason: unknown): boolean {
  const name = errorStringProperty(reason, 'name').toLowerCase()
  const message = errorStringProperty(reason, 'message').toLowerCase()
  if (name === 'notallowederror') return true

  return message.includes('notallowederror') || (
    message.includes('not allowed')
    && (
      message.includes('permission')
      || message.includes('platform')
      || message.includes('user agent')
    )
  )
}

export function retainWhiteboardPlatformPermissionGuard(): () => void {
  activeWhiteboardPlatformPermissionGuards += 1
  let released = false

  return () => {
    if (released) return
    released = true
    activeWhiteboardPlatformPermissionGuards = Math.max(0, activeWhiteboardPlatformPermissionGuards - 1)
  }
}

export function hasActiveWhiteboardPlatformPermissionGuard(): boolean {
  return activeWhiteboardPlatformPermissionGuards > 0
}
