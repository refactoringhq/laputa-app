import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useDragRegion } from '../hooks/useDragRegion'
import { shouldUseCustomWindowChrome } from '../utils/platform'
import { LinuxMenuButton } from './LinuxMenuButton'
import { Button } from './ui/button'

export const LINUX_TITLEBAR_HEIGHT = 32

const RESIZE_EDGE = 6

type ResizeDirection =
  | 'East'
  | 'North'
  | 'NorthEast'
  | 'NorthWest'
  | 'South'
  | 'SouthEast'
  | 'SouthWest'
  | 'West'

const RESIZE_HANDLES: ReadonlyArray<{
  cursor: CSSProperties['cursor']
  direction: ResizeDirection
  style: CSSProperties
}> = [
  { direction: 'North', cursor: 'ns-resize', style: { top: 0, left: RESIZE_EDGE, right: RESIZE_EDGE, height: RESIZE_EDGE } },
  { direction: 'South', cursor: 'ns-resize', style: { bottom: 0, left: RESIZE_EDGE, right: RESIZE_EDGE, height: RESIZE_EDGE } },
  { direction: 'West', cursor: 'ew-resize', style: { top: RESIZE_EDGE, bottom: RESIZE_EDGE, left: 0, width: RESIZE_EDGE } },
  { direction: 'East', cursor: 'ew-resize', style: { top: RESIZE_EDGE, bottom: RESIZE_EDGE, right: 0, width: RESIZE_EDGE } },
  { direction: 'NorthWest', cursor: 'nwse-resize', style: { top: 0, left: 0, width: RESIZE_EDGE, height: RESIZE_EDGE } },
  { direction: 'NorthEast', cursor: 'nesw-resize', style: { top: 0, right: 0, width: RESIZE_EDGE, height: RESIZE_EDGE } },
  { direction: 'SouthWest', cursor: 'nesw-resize', style: { bottom: 0, left: 0, width: RESIZE_EDGE, height: RESIZE_EDGE } },
  { direction: 'SouthEast', cursor: 'nwse-resize', style: { bottom: 0, right: 0, width: RESIZE_EDGE, height: RESIZE_EDGE } },
]

export function LinuxTitlebar() {
  const customChromeEnabled = shouldUseCustomWindowChrome()
  const { onMouseDown } = useDragRegion()
  const maximized = useLinuxMaximizedState(customChromeEnabled)

  if (!customChromeEnabled) return null

  const appWindow = getCurrentWindow()

  return (
    <>
      <ResizeHandles />
      <div
        className="fixed top-0 right-0 left-0 z-[1000] flex items-center justify-between border-b border-border bg-background select-none"
        style={{ height: LINUX_TITLEBAR_HEIGHT }}
        onMouseDown={onMouseDown}
        data-testid="linux-titlebar"
      >
        <div className="flex h-full items-center" data-no-drag>
          <LinuxMenuButton />
        </div>
        <TitlebarWindowControls appWindow={appWindow} maximized={maximized} />
      </div>
    </>
  )
}

function useLinuxMaximizedState(enabled: boolean): boolean {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!enabled) return

    const appWindow = getCurrentWindow()
    let active = true

    const syncMaximizeState = () => {
      void appWindow.isMaximized().then((value) => {
        if (active) setMaximized(value)
      }).catch(() => {})
    }

    syncMaximizeState()
    const unlistenPromise = appWindow.onResized(syncMaximizeState)

    return () => {
      active = false
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => {})
    }
  }, [enabled])

  return maximized
}

function ResizeHandles() {
  if (!shouldUseCustomWindowChrome()) return null

  const startResize = (direction: ResizeDirection) => (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    event.preventDefault()
    void getCurrentWindow().startResizeDragging(direction).catch(() => {})
  }

  return (
    <>
      {RESIZE_HANDLES.map(({ cursor, direction, style }) => (
        <div
          key={direction}
          aria-hidden
          className="fixed z-[1001]"
          data-no-drag
          onMouseDown={startResize(direction)}
          style={{ ...style, cursor }}
        />
      ))}
    </>
  )
}

function TitlebarWindowControls({
  appWindow,
  maximized,
}: {
  appWindow: ReturnType<typeof getCurrentWindow>
  maximized: boolean
}) {
  return (
    <div className="flex h-full items-center" data-no-drag>
      <TitlebarButton ariaLabel="Minimize" onClick={() => void appWindow.minimize().catch(() => {})}>
        <MinimizeIcon />
      </TitlebarButton>
      <TitlebarButton
        ariaLabel={maximized ? 'Restore' : 'Maximize'}
        onClick={() => void appWindow.toggleMaximize().catch(() => {})}
      >
        {maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </TitlebarButton>
      <TitlebarButton
        ariaLabel="Close"
        close
        onClick={() => void appWindow.close().catch(() => {})}
      >
        <CloseIcon />
      </TitlebarButton>
    </div>
  )
}

function TitlebarButton({
  ariaLabel,
  children,
  close = false,
  onClick,
}: {
  ariaLabel: string
  children: ReactNode
  close?: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={ariaLabel}
      className={[
        'h-full w-[46px] rounded-none text-foreground/70 hover:text-foreground',
        close ? 'hover:bg-destructive hover:text-destructive-foreground' : 'hover:bg-foreground/10',
      ].join(' ')}
      onClick={onClick}
      data-no-drag
    >
      {children}
    </Button>
  )
}

function MinimizeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <line x1="2.5" y1="6" x2="9.5" y2="6" />
    </svg>
  )
}

function MaximizeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="2.5" y="2.5" width="7" height="7" rx="0.5" />
    </svg>
  )
}

function RestoreIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="2.5" y="3.8" width="6" height="6" rx="0.5" />
      <path d="M4 3.8 V 2.5 H 9.5 V 8" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <line x1="3" y1="3" x2="9" y2="9" />
      <line x1="9" y1="3" x2="3" y2="9" />
    </svg>
  )
}
