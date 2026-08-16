/** Pure JSON wire/domain types shared by the host and client halves. */

export type MemoryId = string

export type MemoryKind =
  | 'insight'
  | 'decision'
  | 'fact'
  | 'preference'
  | 'constraint'

export type MemoryScope = 'global' | 'workspace' | 'project'

export type MemoryStatus = 'active' | 'archived' | 'superseded' | 'candidate'

export type MemoryAuthor = 'human' | 'agent' | 'system'

export interface MemoryRecord {
  id: MemoryId
  kind: MemoryKind
  title: string
  content: string
  tags: string[]
  scope: MemoryScope
  workspacePath: string | null
  importance: number
  status: MemoryStatus
  sourceSessionId: string
  sourceAgentId?: string
  sourceTurn?: number
  revision: number
  updatedBy: MemoryAuthor
  supersedes?: string | null
  supersededBy?: string | null
  createdAt: number
  updatedAt: number
  expiresAt: number | null
  relatedIds: string[]
}

export type MemorySortKey = 'updatedAt' | 'createdAt' | 'importance' | 'title'

export type MemorySortOrder = 'asc' | 'desc'

export interface MemoryListQuery {
  q?: string
  kind?: MemoryKind
  scope?: MemoryScope | 'current'
  status?: MemoryStatus
  tag?: string
  workspacePath?: string
  /** Sort key; defaults to updatedAt. */
  sort?: MemorySortKey
  /** Sort direction; defaults to desc. */
  order?: MemorySortOrder
  limit?: number
  cursor?: number
}

export interface MemoryListResult {
  items: MemoryRecord[]
  total: number
  nextCursor?: number
}

export interface MemorySearchHit {
  record: MemoryRecord
  matchedReason: string[]
}

export interface MemorySearchResult {
  items: MemorySearchHit[]
  total: number
}

export interface MemoryPutInput {
  id?: MemoryId
  kind?: MemoryKind
  title: string
  content: string
  tags?: string[]
  scope?: MemoryScope
  workspacePath?: string | null
  importance?: number
  status?: MemoryStatus
  sourceSessionId?: string
  sourceAgentId?: string
  sourceTurn?: number
  updatedBy?: MemoryAuthor
  supersedes?: string | null
  supersededBy?: string | null
  expiresAt?: number | null
  relatedIds?: string[]
}

export interface MemoryPatchInput {
  kind?: MemoryKind
  title?: string
  content?: string
  tags?: string[]
  scope?: MemoryScope
  workspacePath?: string | null
  importance?: number
  status?: MemoryStatus
  sourceAgentId?: string
  sourceTurn?: number
  updatedBy?: MemoryAuthor
  supersedes?: string | null
  supersededBy?: string | null
  expiresAt?: number | null
  relatedIds?: string[]
}

export interface MemoryStats {
  total: number
  active: number
  archived: number
  superseded: number
  candidate: number
  byKind: Record<MemoryKind, number>
}

export interface HippomemoChanged {
  operation: 'put' | 'deleted'
  id: MemoryId
}
