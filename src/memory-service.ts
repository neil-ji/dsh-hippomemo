/**
 * HippoMemo host service: durable storage-domain persistence plus the shared
 * in-memory MemoryCore used by tools, recall, HTTP, and SSE.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { hippomemoDomainSpec } from './spec.ts'
import { MemoryCore, normalizeRecord } from './memory-core.ts'
import type {
  HippomemoChanged, MemoryId, MemoryListQuery, MemoryListResult, MemoryPatchInput,
  MemoryPutInput, MemoryRecord, MemorySearchResult, MemoryStats,
} from './types.ts'
import { registerHippomemoHttpRoutes } from './http.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryService
  }

  interface Events {
    'hippomemo/changed'(change: HippomemoChanged): void
  }
}

export interface HippomemoConfig {
  maxMemories?: number
  defaultRecallLimit?: number
  maxRecallChars?: number
}

interface ResolvedConfig {
  maxMemories: number
  defaultRecallLimit: number
  maxRecallChars: number
}

const DEFAULT_CONFIG: ResolvedConfig = {
  maxMemories: 10_000,
  defaultRecallLimit: 5,
  maxRecallChars: 8_000,
}

function resolveConfig(config: HippomemoConfig = {}): ResolvedConfig {
  const next = { ...DEFAULT_CONFIG, ...config }
  for (const key of Object.keys(next) as (keyof ResolvedConfig)[]) {
    if (Number.isSafeInteger(next[key]) === false || next[key] <= 0) {
      throw new TypeError('hippomemo: ' + key + ' must be a positive safe integer')
    }
  }
  return next
}

export class MemoryService extends Service {
  static inject = ['storageDomain', 'webServer']

  static Config = z.object({
    maxMemories: z.number().step(1).min(1).default(DEFAULT_CONFIG.maxMemories),
    defaultRecallLimit: z.number().step(1).min(1).default(DEFAULT_CONFIG.defaultRecallLimit),
    maxRecallChars: z.number().step(1).min(1).default(DEFAULT_CONFIG.maxRecallChars),
  })

  private readonly config: ResolvedConfig
  private readonly core: MemoryCore
  private table?: KvTable<MemoryId, MemoryRecord>
  private readonly listeners = new Set<(change: HippomemoChanged) => void>()

  constructor(ctx: Context, config: HippomemoConfig = {}) {
    super(ctx, 'memory')
    this.config = resolveConfig(config)
    this.core = new MemoryCore(this.config)
  }

  protected async [Service.init](): Promise<void> {
    const domain: Domain<typeof hippomemoDomainSpec> = await this.ctx.storageDomain.open(hippomemoDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'hippomemo.domainClose')
    this.table = domain.table('memories')
    this.core.load(this.table.entries())
    registerHippomemoHttpRoutes(this.ctx, this)
  }

  get(id: MemoryId): MemoryRecord | undefined {
    return this.core.get(id)
  }

  list(query: MemoryListQuery = {}): MemoryListResult {
    return this.core.list(query)
  }

  search(query: MemoryListQuery = {}): MemorySearchResult {
    return this.core.search(query)
  }

  async put(input: MemoryPutInput): Promise<MemoryRecord> {
    const previous = input.id === undefined ? undefined : this.core.get(input.id)
    const { record } = normalizeRecord(input, previous)
    if (previous === undefined && this.core.size >= this.config.maxMemories) {
      throw new Error('hippomemo: maxMemories (' + String(this.config.maxMemories) + ') reached')
    }
    await this.requireTable().put(record.id, record)
    this.core.commit(record)
    this.emit({ operation: 'put', id: record.id })
    return record
  }

  async update(id: MemoryId, patch: MemoryPatchInput): Promise<MemoryRecord> {
    const previous = this.core.get(id)
    if (previous === undefined) throw new Error('hippomemo: unknown memory "' + id + '"')
    const { record } = normalizeRecord({
      ...previous,
      ...patch,
      title: patch.title ?? previous.title,
      content: patch.content ?? previous.content,
    }, previous)
    await this.requireTable().put(record.id, record)
    this.core.commit(record)
    this.emit({ operation: 'put', id: record.id })
    return record
  }

  async delete(id: MemoryId): Promise<boolean> {
    if (this.core.get(id) === undefined) return false
    await this.requireTable().delete(id)
    const existed = this.core.delete(id)
    if (existed) this.emit({ operation: 'deleted', id })
    return existed
  }

  stats(): MemoryStats {
    return this.core.stats()
  }

  subscribe(listener: (change: HippomemoChanged) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private requireTable(): KvTable<MemoryId, MemoryRecord> {
    if (this.table === undefined) throw new Error('hippomemo: domain is not open')
    return this.table
  }

  private emit(change: HippomemoChanged): void {
    for (const listener of this.listeners) {
      try { listener(change) } catch (error) { this.ctx.logger.warn('hippomemo: change listener failed: ' + String(error)) }
    }
    try {
      this.ctx.emit('hippomemo/changed', change)
    } catch (error) {
      this.ctx.logger.warn('hippomemo: cordis change listener failed: ' + String(error))
    }
  }
}

export default MemoryService
