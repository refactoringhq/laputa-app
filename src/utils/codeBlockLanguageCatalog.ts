export type CodeBlockLanguageOption = {
  name: string
  aliases: string[]
}

export type CodeBlockLanguageCatalogEntry = CodeBlockLanguageOption & {
  id: string
}

export const GO_CODE_BLOCK_LANGUAGE = {
  id: 'go',
  name: 'Go',
  aliases: ['go', 'golang'],
} as const satisfies CodeBlockLanguageCatalogEntry

export const EXTRA_CODE_BLOCK_LANGUAGES = [
  { id: 'powershell', name: 'PowerShell', aliases: ['powershell', 'ps', 'ps1'] },
  { id: 'vbscript', name: 'VBScript', aliases: ['vbscript', 'vbs', 'vb', 'vba', 'visual-basic', 'visualbasic'] },
  { id: 'dart', name: 'Dart', aliases: ['dart'] },
  { id: 'groovy', name: 'Groovy', aliases: ['groovy'] },
  { id: 'matlab', name: 'MATLAB', aliases: ['matlab'] },
  { id: 'perl', name: 'Perl', aliases: ['perl', 'pl', 'pm'] },
  { id: 'elixir', name: 'Elixir', aliases: ['elixir', 'ex', 'exs'] },
  { id: 'erlang', name: 'Erlang', aliases: ['erlang', 'erl'] },
  { id: 'fsharp', name: 'F#', aliases: ['fsharp', 'f#', 'fs'] },
  { id: 'clojure', name: 'Clojure', aliases: ['clojure', 'clj'] },
  { id: 'asm', name: 'Assembly', aliases: ['asm', 'assembly'] },
  { id: 'zig', name: 'Zig', aliases: ['zig'] },
  { id: 'hcl', name: 'HCL', aliases: ['hcl'] },
  { id: 'terraform', name: 'Terraform', aliases: ['terraform', 'tf', 'tfvars'] },
  { id: 'dockerfile', name: 'Dockerfile', aliases: ['dockerfile', 'docker'] },
  { id: 'batch', name: 'Batch', aliases: ['batch', 'bat', 'cmd'] },
  { id: 'diff', name: 'Diff', aliases: ['diff', 'patch'] },
  { id: 'ini', name: 'INI', aliases: ['ini', 'properties'] },
  { id: 'toml', name: 'TOML', aliases: ['toml'] },
] as const satisfies readonly CodeBlockLanguageCatalogEntry[]

const KNOWN_CODE_BLOCK_LANGUAGES = [
  GO_CODE_BLOCK_LANGUAGE,
  ...EXTRA_CODE_BLOCK_LANGUAGES,
] as const

function knownLanguageAliases(): Array<[string, string]> {
  const aliases: Array<[string, string]> = []
  for (const language of KNOWN_CODE_BLOCK_LANGUAGES) {
    aliases.push([language.id, language.id])
    for (const alias of language.aliases) aliases.push([alias, language.id])
  }
  return aliases
}

const KNOWN_LANGUAGE_ID_BY_ALIAS = new Map<string, string>(knownLanguageAliases())

export function codeBlockLanguageOptions(
  languages: readonly CodeBlockLanguageCatalogEntry[],
): Record<string, CodeBlockLanguageOption> {
  return Object.fromEntries(
    languages.map((language) => [
      language.id,
      {
        name: language.name,
        aliases: [...language.aliases],
      },
    ]),
  )
}

export function canonicalKnownCodeBlockLanguage(language: string): string | null {
  return KNOWN_LANGUAGE_ID_BY_ALIAS.get(language.trim().toLowerCase()) ?? null
}
