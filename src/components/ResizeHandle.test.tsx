import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { ResizeHandle } from './ResizeHandle'

describe('ResizeHandle', () => {
  let rafCallback: FrameRequestCallback | null = null
  const originalRAF = globalThis.requestAnimationFrame
  const originalCAF = globalThis.cancelAnimationFrame

  beforeEach(() => {
    rafCallback = null
    globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      rafCallback = cb
      return 1
    })
    globalThis.cancelAnimationFrame = vi.fn()
  })

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRAF
    globalThis.cancelAnimationFrame = originalCAF
  })

  it('renders a draggable handle element', () => {
    const { container } = render(<ResizeHandle onResize={vi.fn()} />)
    const handle = container.firstChild as HTMLElement
    expect(handle).toBeInTheDocument()
    expect(handle.style.cursor || handle.className).toBeTruthy()
  })

  it('stacks above z-indexed panel surfaces', () => {
    const { container } = render(<ResizeHandle onResize={vi.fn()} />)
    const handle = container.firstChild as HTMLElement
    expect(handle.className).toContain('z-30')
  })

  it('calls onResize with delta during drag', () => {
    const onResize = vi.fn()
    const { container } = render(<ResizeHandle onResize={onResize} />)
    const handle = container.firstChild as HTMLElement

    // Start drag
    fireEvent.mouseDown(handle, { clientX: 100 })

    // Move mouse
    fireEvent.mouseMove(document, { clientX: 120 })

    // Flush rAF
    if (rafCallback) rafCallback(0)

    expect(onResize).toHaveBeenCalledWith(20)
  })

  it('accumulates delta across multiple moves before rAF', () => {
    const onResize = vi.fn()
    const { container } = render(<ResizeHandle onResize={onResize} />)
    const handle = container.firstChild as HTMLElement

    fireEvent.mouseDown(handle, { clientX: 100 })
    fireEvent.mouseMove(document, { clientX: 110 })
    fireEvent.mouseMove(document, { clientX: 120 })

    // Only one rAF should have been scheduled
    if (rafCallback) rafCallback(0)

    expect(onResize).toHaveBeenCalledWith(20)
  })

  it('flushes pending delta on mouseUp', () => {
    const onResize = vi.fn()
    const { container } = render(<ResizeHandle onResize={onResize} />)
    const handle = container.firstChild as HTMLElement

    fireEvent.mouseDown(handle, { clientX: 100 })
    fireEvent.mouseMove(document, { clientX: 115 })

    // Mouse up before rAF fires
    fireEvent.mouseUp(document)

    expect(globalThis.cancelAnimationFrame).toHaveBeenCalled()
    expect(onResize).toHaveBeenCalledWith(15)
  })

  it('does not call onResize when mouseMove without mouseDown', () => {
    const onResize = vi.fn()
    render(<ResizeHandle onResize={onResize} />)

    fireEvent.mouseMove(document, { clientX: 200 })

    expect(onResize).not.toHaveBeenCalled()
  })

  it('resets cursor and user-select on mouseUp', () => {
    const onResize = vi.fn()
    const { container } = render(<ResizeHandle onResize={onResize} />)
    const handle = container.firstChild as HTMLElement

    fireEvent.mouseDown(handle, { clientX: 100 })
    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')

    fireEvent.mouseUp(document)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })
})
