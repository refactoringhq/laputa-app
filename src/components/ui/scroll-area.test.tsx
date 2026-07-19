import { render } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { ScrollArea } from "./scroll-area"

const scrollAreaSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "scroll-area.tsx"),
  "utf8",
)

describe("ScrollArea", () => {
  it("styles the thumb with dedicated scrollbar tokens, not border chrome", () => {
    expect(scrollAreaSource).toContain("bg-scrollbar-thumb")
    expect(scrollAreaSource).toContain("hover:bg-scrollbar-thumb-hover")
    expect(scrollAreaSource).toContain("active:bg-scrollbar-thumb-active")
    expect(scrollAreaSource).not.toMatch(
      /ScrollAreaThumb[\s\S]*?className="bg-border/,
    )
    expect(scrollAreaSource).not.toContain('className="bg-border relative')
  })

  it("renders a thinner discreet vertical track", () => {
    const { container } = render(
      <ScrollArea type="always" className="h-[120px] w-[160px]">
        <div className="h-[500px] w-full">long content</div>
      </ScrollArea>,
    )

    const bar = container.querySelector('[data-slot="scroll-area-scrollbar"]')
    expect(bar).not.toBeNull()
    expect(bar?.className).toMatch(/\bw-2\b/)
    expect(bar?.className).not.toMatch(/w-2\.5/)
  })
})
