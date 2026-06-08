let activeWhiteboardPlatformPermissionGuards = 0

function errorStringProperty(error: unknown, property: 'message' | 'name'): string {
  if (error instanceof Error) return error[property]
  if (property === 'message' && typeof error === 'string') return error
  if (typeof error !== 'object' || error === null || !(property in error)) return ''

  const value = Reflect.get(error, property)
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
