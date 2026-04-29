import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteItem } from './NoteItem'
import { makeEntry } from '../test-utils/noteListTestUtils'

vi.mock('../utils/url', async () => {
  const actual = await vi.importActual('../utils/url') as typeof import('../utils/url')
  return { ...actual, openExternalUrl: vi.fn().mockResolvedValue(undefined) }
})

const { openExternalUrl } = await import('../utils/url') as typeof import('../utils/url') & {
  openExternalUrl: ReturnType<typeof vi.fn>
}

const NOW_SECONDS = 1_744_286_400

describe('NoteItem', () => {
  beforeEach(() => {
    openExternalUrl.mockClear()
  })

  it('renders unsupported binary files as non-clickable muted rows', () => {
    const binaryEntry = makeEntry({
      path: '/vault/archive.zip',
      filename: 'archive.zip',
      title: 'archive.zip',
      fileKind: 'binary',
    })
    const onClickNote = vi.fn()

    render(<NoteItem entry={binaryEntry} isSelected={false} typeEntryMap={{}} onClickNote={onClickNote} />)

    const item = screen.getByTestId('binary-file-item')
    expect(item.className).toContain('opacity-50')
    expect(item).toHaveAttribute('title', 'Cannot open this file type')

    fireEvent.click(item)
    expect(onClickNote).not.toHaveBeenCalled()
  })

  it('renders image files as clickable rows with an image file indicator', () => {
    const imageEntry = makeEntry({
      path: '/vault/photo.png',
      filename: 'photo.png',
      title: 'photo.png',
      fileKind: 'binary',
    })
    const onClickNote = vi.fn()

    render(<NoteItem entry={imageEntry} isSelected={false} typeEntryMap={{}} onClickNote={onClickNote} />)

    const item = screen.getByTestId('image-file-item')
    expect(item.className).not.toContain('opacity-50')
    expect(item).toHaveAttribute('title', 'Open image preview')

    fireEvent.click(item)
    expect(onClickNote).toHaveBeenCalledWith(imageEntry, expect.any(Object))
    expect(screen.getByTestId('type-icon')).toHaveAttribute('data-file-preview-kind', 'image')
  })

  it('renders PDF files as clickable rows with a PDF file indicator', () => {
    const pdfEntry = makeEntry({
      path: '/vault/reports/brief.pdf',
      filename: 'brief.pdf',
      title: 'brief.pdf',
      fileKind: 'binary',
    })
    const onClickNote = vi.fn()

    render(<NoteItem entry={pdfEntry} isSelected={false} typeEntryMap={{}} onClickNote={onClickNote} />)

    const item = screen.getByTestId('pdf-file-item')
    expect(item.className).not.toContain('opacity-50')
    expect(item).toHaveAttribute('title', 'Open PDF preview')

    fireEvent.click(item)
    expect(onClickNote).toHaveBeenCalledWith(pdfEntry, expect.any(Object))
    expect(screen.getByTestId('type-icon')).toHaveAttribute('data-file-preview-kind', 'pdf')
  })

  it('renders text files as clickable rows', () => {
    const textEntry = makeEntry({
      path: '/vault/config.yml',
      filename: 'config.yml',
      title: 'config.yml',
      fileKind: 'text',
    })
    const onClickNote = vi.fn()

    render(<NoteItem entry={textEntry} isSelected={false} typeEntryMap={{}} onClickNote={onClickNote} />)

    const item = screen.getByText('config.yml').closest('div')!
    fireEvent.click(item)
    expect(onClickNote).toHaveBeenCalled()
  })

  it('shows the title with filename metadata when a change status is present', () => {
    const entry = {
      ...makeEntry({ filename: 'my-note.md', title: 'My Note Title' }),
      __changeAddedLines: 42,
      __changeDeletedLines: 7,
    }

    render(<NoteItem entry={entry} isSelected={false} typeEntryMap={{}} onClickNote={vi.fn()} changeStatus="modified" />)

    expect(screen.getByText('My Note Title')).toBeInTheDocument()
    expect(screen.getByText('my-note.md')).toBeInTheDocument()
    expect(screen.getByTestId('change-note-filename')).toHaveClass('truncate', 'text-[12px]', 'leading-[1.5]', 'text-muted-foreground')
    expect(screen.getByTestId('change-stat-added')).toHaveTextContent('+42')
    expect(screen.getByTestId('change-stat-deleted')).toHaveTextContent('-7')
  })

  it('renders the correct symbol for modified files', () => {
    const entry = makeEntry({ filename: 'note.md' })

    render(<NoteItem entry={entry} isSelected={false} typeEntryMap={{}} onClickNote={vi.fn()} changeStatus="modified" />)

    expect(screen.getByTestId('change-status-icon').textContent).toBe('·')
  })

  it('renders the correct symbol for added files', () => {
    const entry = makeEntry({ filename: 'new-note.md' })

    render(<NoteItem entry={entry} isSelected={false} typeEntryMap={{}} onClickNote={vi.fn()} changeStatus="added" />)

    expect(screen.getByTestId('change-status-icon').textContent).toBe('+')
  })

  it('shows a neutral fallback when line stats are unavailable', () => {
    const entry = makeEntry({ filename: 'binary-note.md', title: 'Binary Note' })

    render(<NoteItem entry={entry} isSelected={false} typeEntryMap={{}} onClickNote={vi.fn()} changeStatus="modified" />)

    expect(screen.getByTestId('change-stat-fallback')).toHaveTextContent('Diff unavailable')
  })

  it('renders the regular title when no change status is set', () => {
    const entry = makeEntry({ filename: 'note.md', title: 'My Note' })

    render(<NoteItem entry={entry} isSelected={false} typeEntryMap={{}} onClickNote={vi.fn()} />)

    expect(screen.getByText('My Note')).toBeInTheDocument()
    expect(screen.queryByText('note.md')).not.toBeInTheDocument()
    expect(screen.queryByTestId('change-status-icon')).not.toBeInTheDocument()
  })

  it('adds more breathing room between note sections', () => {
    const entry = makeEntry({
      title: 'Spaced note',
      snippet: 'Body preview',
      createdAt: NOW_SECONDS - 86400 * 3,
      modifiedAt: NOW_SECONDS - 86400,
      properties: { Status: 'Active' },
    })

    render(
      <NoteItem
        entry={entry}
        isSelected={false}
        typeEntryMap={{}}
        displayPropsOverride={['Status']}
        onClickNote={vi.fn()}
      />,
    )

    expect(screen.getByTestId('note-content-stack').className).toContain('space-y-2')
  })

  it('shows created date on the right side of the date row when available', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW_SECONDS * 1000))
    const entry = makeEntry({
      title: 'Dated note',
      createdAt: NOW_SECONDS - 86400 * 5,
      modifiedAt: NOW_SECONDS - 86400 * 2,
    })

    render(<NoteItem entry={entry} isSelected={false} typeEntryMap={{}} onClickNote={vi.fn()} />)

    const dateRow = screen.getByTestId('note-date-row')
    expect(dateRow.className).toContain('grid')
    expect(dateRow).toHaveTextContent('2d ago')
    expect(dateRow).toHaveTextContent('Created 5d ago')
  })

  it('leaves the right side empty when no creation date exists', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW_SECONDS * 1000))
    const entry = makeEntry({
      title: 'Modified note',
      createdAt: null,
      modifiedAt: NOW_SECONDS - 3600,
    })

    render(<NoteItem entry={entry} isSelected={false} typeEntryMap={{}} onClickNote={vi.fn()} />)

    expect(screen.getByTestId('note-date-row')).toHaveTextContent('1h ago')
    expect(screen.queryByText(/Created /)).not.toBeInTheDocument()
  })

  it('colors relationship chips by target type and opens the related note on Cmd+click only', () => {
    const linkedProject = makeEntry({
      path: '/vault/project/build-app.md',
      filename: 'build-app.md',
      title: 'Build App',
      isA: 'Project',
    })
    const projectType = makeEntry({
      path: '/vault/type/project.md',
      filename: 'project.md',
      title: 'Project',
      isA: 'Type',
      color: 'red',
      icon: 'wrench',
    })
    const sourceEntry = makeEntry({
      path: '/vault/note/source.md',
      filename: 'source.md',
      title: 'Source',
      isA: 'Note',
      relationships: { 'Belongs to': ['[[project/build-app]]'] },
    })
    const onClickNote = vi.fn()

    render(
      <NoteItem
        entry={sourceEntry}
        isSelected={false}
        typeEntryMap={{ Project: projectType }}
        allEntries={[sourceEntry, linkedProject, projectType]}
        displayPropsOverride={['Belongs to']}
        onClickNote={onClickNote}
      />,
    )

    const chip = screen.getByTestId('property-chip-belongs-to-0')
    expect(chip).toHaveTextContent('Build App')
    expect(chip.className).toContain('cursor-pointer')
    expect(chip).toHaveStyle({ color: 'var(--accent-red)', backgroundColor: 'var(--accent-red-light)' })

    fireEvent.click(chip)
    expect(onClickNote).not.toHaveBeenCalled()

    fireEvent.click(chip, { metaKey: true })
    expect(onClickNote).toHaveBeenCalledWith(linkedProject, expect.objectContaining({ metaKey: true }))
  })

  it('falls back to the built-in type icon for relationship chips when the Type has no custom icon', () => {
    const linkedTopic = makeEntry({
      path: '/vault/topic/ai.md',
      filename: 'ai.md',
      title: 'AI',
      isA: 'topic',
    })
    const topicType = makeEntry({
      path: '/vault/type/topic.md',
      filename: 'topic.md',
      title: 'Topic',
      isA: 'Type',
      color: 'green',
      icon: null,
    })
    const sourceEntry = makeEntry({
      path: '/vault/note/source.md',
      filename: 'source.md',
      title: 'Source',
      isA: 'Note',
      relationships: { Topics: ['[[topic/ai]]'] },
    })

    render(
      <NoteItem
        entry={sourceEntry}
        isSelected={false}
        typeEntryMap={{ Topic: topicType, topic: topicType }}
        allEntries={[sourceEntry, linkedTopic, topicType]}
        displayPropsOverride={['Topics']}
        onClickNote={vi.fn()}
      />,
    )

    const chip = screen.getByTestId('property-chip-topics-0')
    expect(chip).toHaveTextContent('AI')
    expect(chip).toHaveStyle({ color: 'var(--accent-green)', backgroundColor: 'var(--accent-green-light)' })
    expect(chip.querySelector('svg')).not.toBeNull()
  })

  it('preserves exact linked note title formatting in relationship chips', () => {
    const linkedTopic = makeEntry({
      path: '/vault/topic/ai-ml.md',
      filename: 'ai-ml.md',
      title: 'AI / ML',
      isA: 'Topic',
    })
    const topicType = makeEntry({
      path: '/vault/type/topic.md',
      filename: 'topic.md',
      title: 'Topic',
      isA: 'Type',
      color: 'green',
    })
    const sourceEntry = makeEntry({
      path: '/vault/note/source.md',
      filename: 'source.md',
      title: 'Source',
      isA: 'Note',
      relationships: { Topics: ['[[topic/ai-ml]]'] },
    })

    render(
      <NoteItem
        entry={sourceEntry}
        isSelected={false}
        typeEntryMap={{ Topic: topicType }}
        allEntries={[sourceEntry, linkedTopic, topicType]}
        displayPropsOverride={['Topics']}
        onClickNote={vi.fn()}
      />,
    )

    expect(screen.getByTestId('property-chip-topics-0')).toHaveTextContent('AI / ML')
  })

  it('keeps explicit wikilink aliases in relationship chips', () => {
    const linkedProject = makeEntry({
      path: '/vault/project/my-project.md',
      filename: 'my-project.md',
      title: 'My Project',
      isA: 'Project',
    })
    const sourceEntry = makeEntry({
      path: '/vault/note/source.md',
      filename: 'source.md',
      title: 'Source',
      isA: 'Note',
      relationships: { 'Belongs to': ['[[project/my-project|My Cool Project]]'] },
    })

    render(
      <NoteItem
        entry={sourceEntry}
        isSelected={false}
        typeEntryMap={{}}
        allEntries={[sourceEntry, linkedProject]}
        displayPropsOverride={['Belongs to']}
        onClickNote={vi.fn()}
      />,
    )

    expect(screen.getByTestId('property-chip-belongs-to-0')).toHaveTextContent('My Cool Project')
  })

  it('opens URL chips on Cmd+click only and keeps regular clicks inert', () => {
    const entry = makeEntry({
      path: '/vault/note/source.md',
      filename: 'source.md',
      title: 'Source',
      properties: { URL: 'https://example.com/docs' },
    })
    const onClickNote = vi.fn()

    render(
      <NoteItem
        entry={entry}
        isSelected={false}
        typeEntryMap={{}}
        displayPropsOverride={['URL']}
        onClickNote={onClickNote}
      />,
    )

    const chip = screen.getByTestId('property-chip-url-0')
    expect(chip).toHaveTextContent('example.com')
    expect(chip.className).toContain('cursor-pointer')
    expect(chip).toHaveStyle({ color: 'var(--accent-blue)', backgroundColor: 'var(--accent-blue-light)' })

    fireEvent.click(chip)
    expect(openExternalUrl).not.toHaveBeenCalled()
    expect(onClickNote).not.toHaveBeenCalled()

    fireEvent.click(chip, { metaKey: true })
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/docs')
    expect(onClickNote).not.toHaveBeenCalled()
  })

  it('renders broken relationship chips as neutral and non-interactive', () => {
    const entry = makeEntry({
      path: '/vault/note/source.md',
      filename: 'source.md',
      title: 'Source',
      relationships: { Related: ['[[missing/note]]'] },
    })
    const onClickNote = vi.fn()

    render(
      <NoteItem
        entry={entry}
        isSelected={false}
        typeEntryMap={{}}
        allEntries={[entry]}
        displayPropsOverride={['Related']}
        onClickNote={onClickNote}
      />,
    )

    const chip = screen.getByTestId('property-chip-related-0')
    expect(chip).toHaveTextContent('Note')
    expect(chip.className).not.toContain('cursor-pointer')

    fireEvent.click(chip, { metaKey: true })
    expect(onClickNote).not.toHaveBeenCalled()
    expect(openExternalUrl).not.toHaveBeenCalled()
  })
})
