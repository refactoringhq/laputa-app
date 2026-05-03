import { useEffect } from 'react'
import { markFrontendReady } from '@/utils/frontendReady'

export function FrontendReadyMarker() {
  useEffect(() => {
    markFrontendReady()
  }, [])

  return null
}
