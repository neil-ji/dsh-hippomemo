/**
 * storage-domain declaration for HippoMemo.
 *
 * The domain name doubles as the storage-json unit name, so the durable file
 * is `$DSH_HOME/storages/hippomemo.json` under the web profile defaults.
 */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { MemoryId, MemoryRecord } from './types.ts'

const memoryId = z.string().min(1).transform(value => value as MemoryId)

const memoryRecord = z.object({
  id: memoryId,
  kind: z.enum(['insight', 'decision', 'fact', 'preference', 'constraint']),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(20_000),
  tags: z.array(z.string().min(1).max(50)).max(32).default([]),
  scope: z.enum(['global', 'workspace', 'project']).default('global'),
  workspacePath: z.string().nullable().default(null),
  importance: z.number().min(0).max(1).default(0.5),
  status: z.enum(['active', 'archived', 'superseded', 'candidate']).default('active'),
  sourceSessionId: z.string().min(1),
  sourceAgentId: z.string().optional(),
  sourceTurn: z.number().int().nonnegative().optional(),
  revision: z.number().int().nonnegative().default(1),
  updatedBy: z.enum(['human', 'agent', 'system']).default('system'),
  supersedes: memoryId.nullable().default(null),
  supersededBy: memoryId.nullable().default(null),
  createdAt: z.number(),
  updatedAt: z.number(),
  expiresAt: z.number().nullable().default(null),
  relatedIds: z.array(memoryId).max(16).default([]),
}) satisfies z.ZodType<MemoryRecord>

export const hippomemoDomainSpec = defineDomain({
  name: 'hippomemo',
  version: 2,
  tables: {
    memories: domainTable<MemoryId, MemoryRecord>(memoryRecord),
  },
})
