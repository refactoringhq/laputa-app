import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FolderPicker } from './FolderPicker'
import type { FolderNode } from '../types'

function makeFolder(name: string, path: string, children: FolderNode[] = []): FolderNode {
  return { name, path, children }
}

const sampleFolders: FolderNode[] = [
  makeFolder('Media', 'Media', [
    makeFolder('Images', 'Media/Images'),
    makeFolder('Videos', 'Media/Videos'),
  ]),
  makeFolder('Journal', 'Journal'),
  makeFolder('attachments', 'attachments'),
]

describe('FolderPicker', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the placeholder when value is null', () => {
    render(
      <FolderPicker
        value={null}
        onChange={vi.fn()}
        folders={sampleFolders}
        placeholder="attachments (default)"
        ariaLabel="Default image folder"
      />,
    )
    const input = screen.getByLabelText('Default image folder') as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toBe('attachments (default)')
  })

  it('shows the current value in the input when provided', () => {
    render(
      <FolderPicker
        value="Media/Images"
        onChange={vi.fn()}
        folders={sampleFolders}
        ariaLabel="Folder"
      />,
    )
    const input = screen.getByLabelText('Folder') as HTMLInputElement
    expect(input.value).toBe('Media/Images')
  })

  it('calls onChange with normalized value when the user presses Enter', () => {
    const onChange = vi.fn()
    render(
      <FolderPicker value={null} onChange={onChange} folders={sampleFolders} ariaLabel="Folder" />,
    )
    const input = screen.getByLabelText('Folder') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  /Daily/Notes/  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('Daily/Notes')
  })

  it('rejects path-traversal segments and clears them to null', () => {
    const onChange = vi.fn()
    render(
      <FolderPicker value={null} onChange={onChange} folders={sampleFolders} ariaLabel="Folder" />,
    )
    const input = screen.getByLabelText('Folder') as HTMLInputElement
    fireEvent.change(input, { target: { value: '../escape' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('emits null when the user clears the value', () => {
    const onChange = vi.fn()
    render(
      <FolderPicker
        value="Media/Images"
        onChange={onChange}
        folders={sampleFolders}
        ariaLabel="Folder"
      />,
    )
    fireEvent.click(screen.getByLabelText('Clear folder'))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('emits a folder when the user clicks a matching suggestion', () => {
    const onChange = vi.fn()
    render(
      <FolderPicker value={null} onChange={onChange} folders={sampleFolders} ariaLabel="Folder" />,
    )
    const input = screen.getByLabelText('Folder')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Media' } })
    const option = screen.getByText('Media/Images')
    fireEvent.click(option)
    expect(onChange).toHaveBeenLastCalledWith('Media/Images')
  })

  it('reverts the draft when the user presses Escape', () => {
    const onChange = vi.fn()
    render(
      <FolderPicker
        value="Journal"
        onChange={onChange}
        folders={sampleFolders}
        ariaLabel="Folder"
      />,
    )
    const input = screen.getByLabelText('Folder') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'something else' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('Journal')
    expect(onChange).not.toHaveBeenCalled()
  })
})
