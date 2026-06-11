"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

type TooltipContentElement = React.ElementRef<typeof TooltipPrimitive.Content>

function setTooltipWrapperZoom(wrapper: HTMLElement | null | undefined): () => void {
  if (!wrapper?.hasAttribute("data-radix-popper-content-wrapper")) return () => {}
  const previousZoom = wrapper.style.getPropertyValue("zoom")
  const previousZoomToken = wrapper.style.getPropertyValue("--tolaria-tooltip-wrapper-zoom")
  const previousMarker = wrapper.getAttribute("data-tolaria-tooltip-position-zoom")
  wrapper.style.setProperty("--tolaria-tooltip-wrapper-zoom", "var(--tolaria-overlay-zoom-inverse, 1)")
  wrapper.style.setProperty("zoom", "var(--tolaria-tooltip-wrapper-zoom)")
  wrapper.setAttribute("data-tolaria-tooltip-position-zoom", "inverse")

  return () => {
    if (previousZoom) {
      wrapper.style.setProperty("zoom", previousZoom)
    } else {
      wrapper.style.removeProperty("zoom")
    }
    if (previousZoomToken) {
      wrapper.style.setProperty("--tolaria-tooltip-wrapper-zoom", previousZoomToken)
    } else {
      wrapper.style.removeProperty("--tolaria-tooltip-wrapper-zoom")
    }
    if (previousMarker === null) {
      wrapper.removeAttribute("data-tolaria-tooltip-position-zoom")
    } else {
      wrapper.setAttribute("data-tolaria-tooltip-position-zoom", previousMarker)
    }
  }
}

function tooltipWrapperForContentId(contentId: string): HTMLElement | null {
  const content = document.querySelector<HTMLElement>(`[data-tolaria-tooltip-content-id="${contentId}"]`)
  return content?.parentElement ?? null
}

function applyTooltipWrapperZoom(contentId: string): () => void {
  let cleanup = setTooltipWrapperZoom(tooltipWrapperForContentId(contentId))
  let cancelled = false
  let frame: number | null = null

  const apply = () => {
    cleanup()
    cleanup = setTooltipWrapperZoom(tooltipWrapperForContentId(contentId))
  }

  const retry = () => {
    if (cancelled) return
    frame = null
    apply()
  }

  const schedule = () => {
    if (frame !== null) return
    frame = window.requestAnimationFrame(retry)
  }

  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  schedule()

  return () => {
    cancelled = true
    observer.disconnect()
    if (frame !== null) window.cancelAnimationFrame(frame)
    cleanup()
  }
}

const TooltipContent = React.forwardRef<
  TooltipContentElement,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({
  className,
  sideOffset = 0,
  collisionPadding = 8,
  children,
  style,
  ...props
}, forwardedRef) {
  const tooltipContentId = React.useId().replace(/[^A-Za-z0-9_-]/g, "")

  React.useLayoutEffect(() => applyTooltipWrapperZoom(tooltipContentId), [tooltipContentId])

  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={forwardedRef}
        data-slot="tooltip-content"
        data-tolaria-tooltip-content-id={tooltipContentId}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "z-50 w-fit max-w-[min(var(--radix-tooltip-content-available-width,22rem),22rem)] origin-(--radix-tooltip-content-transform-origin)"
        )}
        style={style}
        {...props}
      >
        <div
          data-slot="tooltip-visual-scale"
          className={cn(
            "bg-foreground text-background max-w-[inherit] rounded-md px-3 py-1.5 text-xs text-balance [zoom:var(--tolaria-overlay-zoom-factor,1)]",
            className
          )}
        >
          {children}
          <TooltipPrimitive.Arrow className="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
        </div>
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
})

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
