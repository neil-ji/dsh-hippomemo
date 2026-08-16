/**
 * Pure in-memory domain for HippoMemo. No Cordis or storage imports so the
 * whole model is unit-testable with node:test.
 */
import type {
  MemoryAuthor, MemoryId, MemoryKind, MemoryListQuery, MemoryListResult,
  MemoryPatchInput, MemoryPutInput, MemoryRecord, MemoryScope, MemorySearchHit,
  MemorySearchResult, MemoryStats, MemoryStatus,
} from './types.ts'

export interface MemoryCoreConfig {
  maxMemories: number
  defaultRecallLimit: number
  maxRecallChars: number
}

export interface MemoryCoreDeps {
  now?: () => number
  newId?: () => string
}

const KIND_KEYS: MemoryKind[] = ['insight', 'decision', 'fact', 'preference', 'constraint']

function defaultNow(): number {
  return Date.now()
}

function defaultNewId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'mem-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36)
}

/** Tokenize Latin words plus CJK unigrams and bigrams for small exact/partial search. */
export function tokenize(value: string): string[] {
  const lower = value.toLocaleLowerCase()
  const tokens = new Set<string>()
  const latin = lower.match(/[a-z0-9_]+/g) ?? []
  for (const token of latin) tokens.add(token)
  const cjkRuns = lower.match(/\p{Script=Han}+/gu) ?? []
  for (const run of cjkRuns) {
    const chars = [...run]
    for (const char of chars) tokens.add(char)
    for (let index = 0; index < chars.length - 1; index += 1) {
      tokens.add(chars[index] + chars[index + 1])
    }
  }
  return [...tokens]
}

export function splitTags(value: string): string[] {
  return [...new Set(value.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0))].slice(0, 32)
}

function recordText(record: MemoryRecord): string {
  const tags = Array.isArray(record.tags) ? record.tags : []
  return [record.title, record.content, ...tags].join('\n')
}

function clampImportance(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function sortByUpdated(left: MemoryRecord, right: MemoryRecord): number {
  return right.updatedAt - left.updatedAt
}

export interface NormalizeResult {
  record: MemoryRecord
  revisionBumped: boolean
}

/** Create or revise one record from untrusted input. */
export function normalizeRecord(input: MemoryPutInput, previous?: MemoryRecord, deps: MemoryCoreDeps = {}): NormalizeResult {
  const title = input.title.trim()
  if (title.length === 0) throw new TypeError('hippomemo: title must be non-empty')
  const content = input.content.trim()
  if (content.length === 0) throw new TypeError('hippomemo: content must be non-empty')

  const now = (deps.now ?? defaultNow)()
  const id = input.id ?? previous?.id ?? (deps.newId ?? defaultNewId)()
  const revision = previous === undefined ? 1 : previous.revision + 1

  const record: MemoryRecord = {
    id,
    kind: input.kind ?? previous?.kind ?? 'insight',
    title,
    content,
    tags: splitTags((input.tags ?? (previous !== undefined && Array.isArray(previous.tags) ? previous.tags : [])).join(',')),
    scope: input.scope ?? previous?.scope ?? 'global',
    workspacePath: input.workspacePath === undefined ? previous?.workspacePath ?? null : input.workspacePath,
    importance: clampImportance(input.importance ?? previous?.importance ?? 0.5),
    status: input.status ?? previous?.status ?? 'active',
    sourceSessionId: input.sourceSessionId ?? previous?.sourceSessionId ?? 'user',
    ...(input.sourceAgentId !== undefined || previous?.sourceAgentId !== undefined ? { sourceAgentId: input.sourceAgentId ?? previous?.sourceAgentId } : {}),
    ...(input.sourceTurn !== undefined || previous?.sourceTurn !== undefined ? { sourceTurn: input.sourceTurn ?? previous?.sourceTurn } : {}),
    revision,
    updatedBy: input.updatedBy ?? previous?.updatedBy ?? 'system',
    supersedes: input.supersedes === undefined ? previous?.supersedes ?? null : input.supersedes,
    supersededBy: input.supersededBy === undefined ? previous?.supersededBy ?? null : input.supersededBy,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    expiresAt: input.expiresAt === undefined ? previous?.expiresAt ?? null : input.expiresAt,
    relatedIds: [...new Set(input.relatedIds ?? previous?.relatedIds ?? [])].slice(0, 16),
  }

  return { record, revisionBumped: previous !== undefined }
}

export class MemoryCore {
  private readonly records = new Map<MemoryId, MemoryRecord>()
  private readonly index = new Map<string, Set<MemoryId>>()
  private readonly config: MemoryCoreConfig
  private readonly deps: Required<MemoryCoreDeps>

  constructor(config: MemoryCoreConfig, deps: MemoryCoreDeps = {}) {
    this.config = config
    this.deps = { now: deps.now ?? defaultNow, newId: deps.newId ?? defaultNewId }
  }

  get size(): number {
    return this.records.size
  }

  load(records: Iterable<MemoryRecord | readonly [MemoryId, MemoryRecord]>): void {
    this.records.clear()
    this.index.clear()
    for (const item of records) {
      const record = Array.isArray(item) ? item[1] : item
      this.records.set(record.id, record)
      this.indexRecord(record)
    }
  }

  entries(): IterableIterator<[MemoryId, MemoryRecord]> {
    return this.records.entries()
  }

  get(id: MemoryId): MemoryRecord | undefined {
    return this.records.get(id)
  }

  list(query: MemoryListQuery = {}): MemoryListResult {
    const limit = query.limit ?? 50
    const cursor = query.cursor ?? 0
    const filtered = this.filter(query).sort(sortByUpdated)
    const total = filtered.length
    const items = filtered.slice(cursor, cursor + limit)
    const nextCursor = cursor + items.length < total ? cursor + items.length : undefined
    return { items, total, ...(nextCursor === undefined ? {} : { nextCursor }) }
  }

  search(query: MemoryListQuery = {}): MemorySearchResult {
    const q = query.q?.trim().toLocaleLowerCase() ?? ''
    const limit = query.limit ?? this.config.defaultRecallLimit
    const workspacePath = query.workspacePath

    let hits = this.filter(query).map((record) => this.scoreRecord(record, q))
    if (q.length > 0) {
      hits = hits.filter(hit => hit.score > 0)
    }
    hits.sort((left, right) => right.score - left.score || sortByUpdated(left.record, right.record))

    if (query.scope === 'current') {
      hits = hits.filter(hit =>
        hit.record.scope === 'global' || (workspacePath !== undefined && hit.record.workspacePath === workspacePath))
    }

    const budget = this.config.maxRecallChars
    let used = 0
    const items: MemorySearchHit[] = []
    for (const hit of hits) {
      if (items.length >= limit) break
      const size = hit.record.title.length + hit.record.content.length
      if (used + size > budget && items.length > 0) break
      items.push({ record: hit.record, matchedReason: hit.reasons })
      used += size
    }
    return { items, total: items.length }
  }

  put(input: MemoryPutInput): MemoryRecord {
    const previous = input.id === undefined ? undefined : this.records.get(input.id)
    const { record } = normalizeRecord(input, previous, this.deps)
    if (previous === undefined && this.records.size >= this.config.maxMemories) {
      throw new Error('hippomemo: maxMemories (' + String(this.config.maxMemories) + ') reached')
    }
    this.commit(record)
    return record
  }

  /** Commit an already-persisted record into the in-memory index. */
  commit(record: MemoryRecord): void {
    this.records.set(record.id, record)
    this.indexRecord(record)
  }

  update(id: MemoryId, patch: MemoryPatchInput): MemoryRecord {
    const previous = this.records.get(id)
    if (previous === undefined) throw new Error('hippomemo: unknown memory "' + id + '"')
    const { record } = normalizeRecord({
      ...previous,
      ...patch,
      title: patch.title ?? previous.title,
      content: patch.content ?? previous.content,
    }, previous, this.deps)
    this.records.set(record.id, record)
    this.indexRecord(record)
    return record
  }

  delete(id: MemoryId): boolean {
    const existed = this.records.has(id)
    if (existed === false) return false
    this.records.delete(id)
    this.removeFromIndex(id)
    return true
  }

  stats(): MemoryStats {
    const byKind: Record<MemoryKind, number> = { insight: 0, decision: 0, fact: 0, preference: 0, constraint: 0 }
    let active = 0
    let archived = 0
    let superseded = 0
    let candidate = 0
    for (const record of this.records.values()) {
      byKind[record.kind] += 1
      if (record.status === 'active') active += 1
      else if (record.status === 'archived') archived += 1
      else if (record.status === 'superseded') superseded += 1
      else if (record.status === 'candidate') candidate += 1
    }
    return { total: this.records.size, active, archived, superseded, candidate, byKind }
  }

  private filter(query: MemoryListQuery): MemoryRecord[] {
    let records = [...this.records.values()]
    if (query.kind !== undefined) records = records.filter(record => record.kind === query.kind)
    if (query.status !== undefined) records = records.filter(record => record.status === query.status)
    if (query.tag !== undefined) records = records.filter(record => record.tags.includes(query.tag))
    if (query.scope === 'current') {
      records = records.filter(record =>
        record.scope === 'global' || (query.workspacePath !== undefined && record.workspacePath === query.workspacePath))
    } else if (query.scope !== undefined) {
      records = records.filter(record => record.scope === query.scope)
    } else if (query.workspacePath !== undefined) {
      records = records.filter(record => record.scope === 'global' || record.workspacePath === query.workspacePath)
    }
    return records
  }

  private scoreRecord(record: MemoryRecord, q: string): { record: MemoryRecord; score: number; reasons: string[] } {
    const reasons: string[] = []
    let score = 0
    if (q.length > 0) {
      const title = tokenize(record.title)
      const content = tokenize(record.content)
      const tags = Array.isArray(record.tags) ? record.tags.flatMap(tokenize) : []
      const query = tokenize(q)
      for (const token of query) {
        if (title.includes(token)) {
          score += 8
          if (reasons.includes('title') === false) reasons.push('title')
        }
        if (tags.includes(token)) {
          score += 6
          if (reasons.includes('tag') === false) reasons.push('tag')
        }
        if (content.includes(token)) {
          score += 2
          if (reasons.includes('content') === false) reasons.push('content')
        }
      }
    }
    score += record.importance * 2
    const ageDays = Math.max(0, (this.deps.now() - record.updatedAt) / 86_400_000)
    score += Math.max(0, 2 - ageDays)
    if (q.length === 0) reasons.push('recency')
    return { record, score, reasons }
  }

  private indexRecord(record: MemoryRecord): void {
    this.removeFromIndex(record.id)
    const terms = new Set<string>()
    for (const token of tokenize(recordText(record))) terms.add(token)
    const tags = Array.isArray(record.tags) ? record.tags : []
    for (const tag of tags) for (const token of tokenize(tag)) terms.add(token)
    for (const token of terms) {
      let ids = this.index.get(token)
      if (ids === undefined) {
        ids = new Set()
        this.index.set(token, ids)
      }
      ids.add(record.id)
    }
  }

  private removeFromIndex(id: MemoryId): void {
    for (const ids of this.index.values()) ids.delete(id)
  }
}
