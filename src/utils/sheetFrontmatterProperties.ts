type SheetFrontmatterScalar = boolean | number | string
type FrontmatterContent = string
type FrontmatterIndent = number
type FrontmatterKey = string
type FrontmatterLine = string
type FrontmatterPropertyPath = string[]
type FrontmatterScalarText = string

interface SheetFrontmatterMapNode {
  blankScalar: boolean
  children: Map<string, SheetFrontmatterNode>
  kind: 'map'
  list: boolean
}

interface SheetFrontmatterScalarNode {
  kind: 'scalar'
  value: SheetFrontmatterScalar
}

interface SheetFrontmatterInvalidNode {
  kind: 'invalid'
}

type SheetFrontmatterNode = SheetFrontmatterInvalidNode | SheetFrontmatterMapNode | SheetFrontmatterScalarNode

interface StackItem {
  indent: FrontmatterIndent
  node: SheetFrontmatterMapNode
}

const FRONTMATTER_CLOSE_DELIMITER = /(?:^|\r?\n)---(?:\r?\n|$)/

function mapNode({ blankScalar = false }: { blankScalar?: boolean } = {}): SheetFrontmatterMapNode {
  return {
    blankScalar,
    children: new Map(),
    kind: 'map',
    list: false,
  }
}

function invalidNode(): SheetFrontmatterInvalidNode {
  return { kind: 'invalid' }
}

function frontmatterStartIndex(content: FrontmatterContent): FrontmatterIndent | null {
  const start = content.startsWith('---\r\n') ? 5 : content.startsWith('---\n') ? 4 : null
  return start
}

function extractFrontmatterBody(content: FrontmatterContent): FrontmatterContent | null {
  const start = frontmatterStartIndex(content)
  if (start === null) return null

  const rest = content.slice(start)
  const close = rest.match(FRONTMATTER_CLOSE_DELIMITER)
  return close?.index === undefined ? null : rest.slice(0, close.index)
}

function lineIndent(line: FrontmatterLine): FrontmatterIndent | null {
  if (line.startsWith('\t')) return null
  return line.match(/^ */)?.[0].length ?? 0
}

function isQuotedScalar(value: FrontmatterScalarText): boolean {
  const first = value.at(0)
  const last = value.at(-1)
  return first === last && (first === '"' || first === "'")
}

function unquoteScalar(value: FrontmatterScalarText): FrontmatterScalarText {
  return isQuotedScalar(value) ? value.slice(1, -1) : value
}

function isNumericScalar(value: FrontmatterScalarText): boolean {
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
}

function isUnsupportedScalarSyntax(value: FrontmatterScalarText): boolean {
  if (value === '|' || value === '>') return true
  return value.startsWith('[') || value.startsWith('{')
}

function booleanScalarValue(value: FrontmatterScalarText): boolean | null {
  const lower = value.toLowerCase()
  if (lower === 'true' || lower === 'yes') return true
  if (lower === 'false' || lower === 'no') return false
  return null
}

function numericScalarValue(value: FrontmatterScalarText, original: FrontmatterScalarText): number | null {
  if (value !== original || !isNumericScalar(value)) return null
  return Number(value)
}

function scalarNode(value: SheetFrontmatterScalar): SheetFrontmatterScalarNode {
  return { kind: 'scalar', value }
}

function parseScalarNode(value: FrontmatterScalarText): SheetFrontmatterNode {
  const trimmed = value.trim()
  if (trimmed === '') return mapNode({ blankScalar: true })
  if (isUnsupportedScalarSyntax(trimmed)) return invalidNode()

  const clean = unquoteScalar(trimmed)
  return scalarNode(
    booleanScalarValue(clean)
    ?? numericScalarValue(clean, trimmed)
    ?? clean,
  )
}

function parseKeyValue(line: FrontmatterLine): { key: FrontmatterKey; value: FrontmatterScalarText } | null {
  const match = line.match(/^["']?([^"':]+)["']?\s*:\s*(.*)$/)
  return match ? { key: match[1].trim(), value: match[2] ?? '' } : null
}

function parentForIndent(stack: StackItem[], indent: FrontmatterIndent): SheetFrontmatterMapNode {
  while (stack.length > 1 && (stack.at(-1)?.indent ?? 0) >= indent) stack.pop()
  return stack.at(-1)?.node ?? stack[0].node
}

function addListLine(stack: StackItem[]): void {
  const parent = stack.at(-1)?.node
  if (!parent) return
  parent.blankScalar = false
  parent.list = true
}

function addKeyValueLine(
  stack: StackItem[],
  indent: FrontmatterIndent,
  key: FrontmatterKey,
  value: FrontmatterScalarText,
): void {
  const parent = parentForIndent(stack, indent)
  const child = parseScalarNode(value)
  parent.blankScalar = false
  parent.children.set(key, child)
  if (child.kind === 'map') stack.push({ indent, node: child })
}

function parseFrontmatterTree(content: FrontmatterContent): SheetFrontmatterMapNode | null {
  const body = extractFrontmatterBody(content)
  if (body === null) return null

  const root = mapNode()
  const stack: StackItem[] = [{ indent: -1, node: root }]
  for (const rawLine of body.split(/\r?\n/)) {
    if (rawLine.trim() === '' || rawLine.trimStart().startsWith('#')) continue

    const indent = lineIndent(rawLine)
    if (indent === null) return null

    const line = rawLine.slice(indent)
    if (line.startsWith('- ')) {
      addListLine(stack)
      continue
    }

    const keyValue = parseKeyValue(line)
    if (keyValue) addKeyValueLine(stack, indent, keyValue.key, keyValue.value)
  }
  return root
}

function scalarValueForNode(node: SheetFrontmatterNode | undefined): SheetFrontmatterScalar | null {
  if (!node || node.kind === 'invalid') return null
  if (node.kind === 'scalar') return node.value
  if (node.blankScalar && !node.list && node.children.size === 0) return ''
  return null
}

export function resolveSheetFrontmatterProperty(
  content: FrontmatterContent,
  path: FrontmatterPropertyPath,
): SheetFrontmatterScalar | null {
  let node: SheetFrontmatterNode | undefined = parseFrontmatterTree(content) ?? undefined
  for (const segment of path) {
    if (node?.kind !== 'map') return null
    node = node.children.get(segment)
  }
  return scalarValueForNode(node)
}
