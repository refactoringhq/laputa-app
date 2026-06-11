import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Input } from './input'
import { Textarea } from './textarea'

describe('text controls', () => {
  it('keeps inputs out of spellcheck without disabling IME autocorrection', () => {
    render(<Input aria-label="Search" />)

    const input = screen.getByLabelText('Search')
    expect(input).toHaveAttribute('spellcheck', 'false')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).not.toHaveAttribute('autocorrect')
    expect(input).not.toHaveAttribute('autocapitalize')
  })

  it('keeps textareas out of spellcheck without disabling IME autocorrection', () => {
    render(<Textarea aria-label="Message" />)

    const textarea = screen.getByLabelText('Message')
    expect(textarea).toHaveAttribute('spellcheck', 'false')
    expect(textarea).toHaveAttribute('autocomplete', 'off')
    expect(textarea).not.toHaveAttribute('autocorrect')
    expect(textarea).not.toHaveAttribute('autocapitalize')
  })
})
