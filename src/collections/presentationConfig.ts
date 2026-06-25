import type { ViewDefinition } from '../types'
import {
  COLLECTION_PRESENTATION_LIST,
  type CollectionPresentationConfig,
  type ListCollectionPresentationConfig,
} from './collectionTypes'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function listPresentation(source: UnknownRecord, fallback: ListCollectionPresentationConfig): ListCollectionPresentationConfig {
  return {
    type: COLLECTION_PRESENTATION_LIST,
    sort: nullableString(source.sort) ?? fallback.sort,
    properties: stringArray(source.properties).length > 0 ? stringArray(source.properties) : fallback.properties,
  }
}

export function defaultListPresentation(): ListCollectionPresentationConfig {
  return { type: COLLECTION_PRESENTATION_LIST, sort: null, properties: [] }
}

export function presentationFromViewDefinition(definition: ViewDefinition): CollectionPresentationConfig {
  const fallback: ListCollectionPresentationConfig = {
    type: COLLECTION_PRESENTATION_LIST,
    sort: nullableString(definition.sort),
    properties: stringArray(definition.listPropertiesDisplay),
  }
  const rawPresentation = Reflect.get(definition as unknown as UnknownRecord, 'presentation')
  if (!isRecord(rawPresentation)) return fallback
  if (rawPresentation.type !== COLLECTION_PRESENTATION_LIST) return fallback
  return listPresentation(rawPresentation, fallback)
}
