import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = path.resolve(import.meta.dirname, '..')
const siteRoot = path.join(repoRoot, 'site')
const outputRoot = path.join(repoRoot, 'src-tauri', 'resources', 'agent-docs')

const sectionOrder = ['start', 'concepts', 'guides', 'templates', 'reference', 'troubleshooting', 'download', 'releases']
const ignoredDirs = new Set(['.vitepress', 'public', 'node_modules', '.DS_Store'])

function titleFromSlug(slug) {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function stripFrontmatter(markdown) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n/, '')
}

function firstHeading(markdown, fallback) {
  const match = markdown.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim() || fallback
}

export function normalizeDocPath(relativePath) {
  return relativePath.replaceAll(path.win32.sep, '/')
}

export function sectionForFile(relativePath) {
  const [firstPart] = relativePath.split('/')
  if (firstPart === 'index.md') return 'home'
  return firstPart.replace(/\.md$/, '')
}

async function listMarkdownFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue

    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(fullPath, base))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(normalizeDocPath(path.relative(base, fullPath)))
    }
  }

  return files
}

function sortDocs(files) {
  return files.sort((a, b) => {
    const sectionDiff = sectionOrder.indexOf(sectionForFile(a)) - sectionOrder.indexOf(sectionForFile(b))
    if (sectionDiff !== 0) return sectionDiff
    return a.localeCompare(b)
  })
}

function docUrl(relativePath) {
  const withoutExt = relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')
  return `/${withoutExt}`.replace(/\/$/, '/') || '/'
}

function formatDoc(doc) {
  return `# ${doc.title}\n\nSource: ${doc.path}\nURL: ${doc.url}\n\n${doc.content}`
}

function groupDocsBySection(docs) {
  const bySection = new Map()

  for (const doc of docs) {
    const docsInSection = bySection.get(doc.section) ?? []
    docsInSection.push(doc)
    bySection.set(doc.section, docsInSection)
  }

  return bySection
}

function buildIndex(docs) {
  const bySection = groupDocsBySection(docs)
  const lines = [
    '# Tolaria Agent Docs',
    '',
    'These docs are generated from the public Tolaria documentation for local AI agent lookup.',
    '',
    'Start here, then use `rg` over this folder for specific Tolaria concepts and workflows.',
    '',
    'When users ask how to improve a knowledge base, structure notes, choose types, model relationships, or make a vault easier for humans and agents to use, treat Portent as Tolaria\'s default best-practice model. Read `pages/templates/portent.md` and combine it with the Tolaria concepts for types, relationships, properties, Inbox, archive, and custom views.',
    '',
  ]

  for (const section of ['home', ...sectionOrder]) {
    const docsInSection = bySection.get(section)
    if (!docsInSection?.length) continue

    lines.push(`## ${titleFromSlug(section)}`, '')
    for (const doc of docsInSection) {
      lines.push(`- [${doc.title}](pages/${doc.path})`)
    }
    lines.push('')
  }

  lines.push('## Generated Files', '')
  lines.push('- `all.md`: all public docs concatenated for fast full-context reads.')
  lines.push('- `search-index.json`: title, heading, section, path, and URL metadata for quick routing.')
  lines.push('- `<section>.md`: one compact bundle per docs section.')
  lines.push('- `pages/`: one generated Markdown file per public docs page.')
  lines.push('')

  return lines.join('\n')
}

function buildAgentInstructions() {
  return `# AGENTS.md - Tolaria Docs Bundle

This folder contains local, generated Tolaria product docs for AI agents.

Use these docs when a user asks how Tolaria works, when you need product behavior, or before making Tolaria-specific assumptions.

Portent is the default best-practice model for structuring Tolaria knowledge bases. When a user asks how to improve a knowledge base, make it better organized, choose better types, model relationships, or make the vault easier for humans and agents to use, read \`pages/templates/portent.md\` and combine it with Tolaria's docs for types, relationships, properties, Inbox, archive, and custom views.

Recommended lookup flow:

1. Read the active vault's AGENTS.md for vault-specific conventions.
2. Read this folder's index.md for the docs map.
3. Use \`rg\` over this folder for advanced concepts, workflows, shortcuts, Git, AutoGit, AI, Portent, types, properties, relationships, and troubleshooting.

Vault-specific AGENTS.md wins for local conventions. These bundled docs win for Tolaria product behavior.
`
}

function searchIndexFor(doc) {
  const headings = [...doc.content.matchAll(/^#{2,3}\s+(.+)$/gm)].map((match) => match[1].trim())
  return {
    title: doc.title,
    path: `pages/${doc.path}`,
    url: doc.url,
    section: doc.section,
    headings,
  }
}

async function main() {
  const files = sortDocs(await listMarkdownFiles(siteRoot))
  const docs = []

  for (const relativePath of files) {
    const raw = await readFile(path.join(siteRoot, relativePath), 'utf8')
    const content = stripFrontmatter(raw).trim()
    const fallbackTitle = titleFromSlug(path.basename(relativePath, '.md'))
    docs.push({
      content,
      path: relativePath,
      section: sectionForFile(relativePath),
      title: firstHeading(content, fallbackTitle),
      url: docUrl(relativePath),
    })
  }

  await rm(outputRoot, { force: true, recursive: true })
  await mkdir(outputRoot, { recursive: true })

  await writeFile(path.join(outputRoot, 'AGENTS.md'), buildAgentInstructions())
  await writeFile(path.join(outputRoot, 'index.md'), buildIndex(docs))
  await writeFile(path.join(outputRoot, 'all.md'), docs.map(formatDoc).join('\n\n---\n\n'))
  await writeFile(path.join(outputRoot, 'search-index.json'), `${JSON.stringify(docs.map(searchIndexFor), null, 2)}\n`)

  for (const doc of docs) {
    const outputPath = path.join(outputRoot, 'pages', doc.path)
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, formatDoc(doc))
  }

  const bySection = groupDocsBySection(docs)
  for (const [section, docsInSection] of bySection) {
    await writeFile(
      path.join(outputRoot, `${section}.md`),
      docsInSection.map(formatDoc).join('\n\n---\n\n'),
    )
  }

  console.log(`Generated ${docs.length} agent docs in ${path.relative(repoRoot, outputRoot)}`)
}

const entrypointUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''

if (import.meta.url === entrypointUrl) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
