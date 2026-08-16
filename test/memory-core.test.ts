import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryCore, normalizeRecord, splitTags, tokenize } from '../src/memory-core.ts'
import type { MemoryPutInput, MemoryRecord } from '../src/types.ts'

function makeCore(overrides: Partial<{ maxMemories: number; defaultRecallLimit: number; maxRecallChars: number }> = {}) {
  let seq = 0
  return new MemoryCore(
    {
      maxMemories: overrides.maxMemories ?? 10,
      defaultRecallLimit: overrides.defaultRecallLimit ?? 5,
      maxRecallChars: overrides.maxRecallChars ?? 5000,
    },
    {
      now: () => 1000 + seq,
      newId: () => 'id-' + String(++seq),
    },
  )
}

function input(title: string, content: string, extra: Partial<MemoryPutInput> = {}): MemoryPutInput {
  return { title, content, ...extra }
}

test('tokenize returns latin words and CJK unigrams/bigrams', () => {
  assert.deepEqual(tokenize('Hello world'), ['hello', 'world'])
  const cjk = tokenize('中文测试')
  for (const token of ['中', '文', '测', '试', '中文', '文测', '测试']) {
    assert.equal(cjk.includes(token), true)
  }
  assert.equal(tokenize('hello 中文').includes('hello'), true)
  assert.equal(tokenize('hello 中文').includes('中'), true)
})

test('splitTags trims, dedupes, and drops empty entries', () => {
  assert.deepEqual(splitTags('a, b , a, '), ['a', 'b'])
  assert.deepEqual(splitTags(''), [])
})

test('normalizeRecord creates defaults and bumps revisions', () => {
  const first = normalizeRecord(input('Alpha', 'one'), undefined, { now: () => 2000, newId: () => 'id-1' })
  assert.equal(first.record.id, 'id-1')
  assert.equal(first.record.revision, 1)
  assert.equal(first.record.createdAt, 2000)
  assert.equal(first.record.updatedAt, 2000)
  assert.equal(first.record.status, 'active')
  assert.equal(first.record.updatedBy, 'system')

  const second = normalizeRecord(input('Alpha', 'two'), first.record, { now: () => 3000 })
  assert.equal(second.record.id, 'id-1')
  assert.equal(second.record.revision, 2)
  assert.equal(second.record.createdAt, 2000)
  assert.equal(second.record.updatedAt, 3000)
})

test('normalizeRecord rejects empty title and content', () => {
  assert.throws(() => normalizeRecord(input('  ', 'x')), /title must be non-empty/)
  assert.throws(() => normalizeRecord(input('x', '  ')), /content must be non-empty/)
})

test('core put/list/get/delete round-trips records', () => {
  const core = makeCore()
  const record = core.put(input('First', 'hello world', { tags: ['greeting'], kind: 'fact' }))
  assert.equal(core.size, 1)
  assert.equal(core.get(record.id)?.title, 'First')
  assert.equal(core.list().total, 1)
  assert.equal(core.delete(record.id), true)
  assert.equal(core.delete(record.id), false)
  assert.equal(core.get(record.id), undefined)
})

test('core enforces maxMemories on create', () => {
  const core = makeCore({ maxMemories: 1 })
  core.put(input('A', 'one'))
  assert.throws(() => core.put(input('B', 'two')), /maxMemories/)
})

test('core update bumps revision and changes fields', () => {
  const core = makeCore()
  const first = core.put(input('A', 'one', { scope: 'global', kind: 'fact' }))
  const second = core.update(first.id, { title: 'B', content: 'two', scope: 'workspace', importance: 0.9 })
  assert.equal(second.revision, 2)
  assert.equal(second.title, 'B')
  assert.equal(second.scope, 'workspace')
  assert.equal(second.importance, 0.9)
  assert.equal(second.createdAt, first.createdAt)
  assert.throws(() => core.update('missing', { title: 'x' }), /unknown memory/)
})

test('core filters by kind, status, tag, and scope', () => {
  const core = makeCore()
  core.put(input('A', 'one', { kind: 'fact', status: 'active', tags: ['red'], scope: 'global' }))
  core.put(input('B', 'two', { kind: 'decision', status: 'candidate', tags: ['blue'], scope: 'workspace', workspacePath: '/w' }))
  core.put(input('C', 'three', { kind: 'fact', status: 'archived', tags: ['red'], scope: 'project', workspacePath: '/w/p' }))

  assert.equal(core.list({ kind: 'fact' }).total, 2)
  assert.equal(core.list({ status: 'candidate' }).total, 1)
  assert.equal(core.list({ tag: 'red' }).total, 2)
  assert.equal(core.list({ scope: 'workspace' }).total, 1)
  assert.equal(core.list({ scope: 'current', workspacePath: '/w' }).total, 2)
  assert.equal(core.list({ scope: 'current' }).total, 1)
})

test('core search ranks title matches above content matches', () => {
  const core = makeCore()
  core.put(input('Needle title', 'nothing here', { kind: 'fact' }))
  core.put(input('Other title', 'needle appears only in content', { kind: 'fact' }))
  const result = core.search({ q: 'needle' })
  assert.equal(result.items[0].record.title, 'Needle title')
  assert.equal(result.items[0].matchedReason.includes('title'), true)
})

test('core search filters current scope and reports matchedReason', () => {
  const core = makeCore()
  core.put(input('Global memory', 'shared insight', { scope: 'global' }))
  core.put(input('Workspace memory', 'local insight', { scope: 'workspace', workspacePath: '/w' }))
  core.put(input('Other workspace', 'local insight', { scope: 'workspace', workspacePath: '/x' }))
  const result = core.search({ q: 'insight', scope: 'current', workspacePath: '/w' })
  assert.equal(result.total, 2)
  assert.equal(result.items.some(hit => hit.record.scope === 'global'), true)
  assert.equal(result.items.some(hit => hit.record.scope === 'workspace' && hit.record.workspacePath === '/w'), true)
})

test('core search honors recall limit and byte budget', () => {
  const core = makeCore({ defaultRecallLimit: 2, maxRecallChars: 10 })
  core.put(input('A', 'aaaaaaaaaa'))
  core.put(input('B', 'bbbbbbbbbb'))
  core.put(input('C', 'cccccccccc'))
  const result = core.search({ q: '' })
  assert.equal(result.items.length, 1)
})

test('core stats counts statuses and kinds', () => {
  const core = makeCore()
  core.put(input('A', 'one', { kind: 'fact', status: 'active' }))
  core.put(input('B', 'two', { kind: 'decision', status: 'archived' }))
  core.put(input('C', 'three', { kind: 'preference', status: 'superseded' }))
  core.put(input('D', 'four', { kind: 'constraint', status: 'candidate' }))
  const stats = core.stats()
  assert.equal(stats.total, 4)
  assert.equal(stats.active, 1)
  assert.equal(stats.archived, 1)
  assert.equal(stats.superseded, 1)
  assert.equal(stats.candidate, 1)
  assert.equal(stats.byKind.fact, 1)
})

test('core defaults work without injected clocks or ids', () => {
  const core = new MemoryCore({ maxMemories: 10, defaultRecallLimit: 5, maxRecallChars: 5000 })
  const record = core.put(input('Default', 'default record', { tags: ['default'] }))
  assert.equal(record.id.length > 0, true)
  assert.equal(record.createdAt > 0, true)
  assert.equal([...core.entries()].length, 1)
})

test('core search matches tag tokens', () => {
  const core = makeCore()
  core.put(input('Title', 'body', { tags: ['tag-token'] }))
  const result = core.search({ q: 'tag-token' })
  assert.equal(result.items[0].matchedReason.includes('tag'), true)
})

test('core list filters workspacePath when scope is omitted', () => {
  const core = makeCore()
  core.put(input('Global', 'one', { scope: 'global' }))
  core.put(input('Local', 'two', { scope: 'workspace', workspacePath: '/w' }))
  core.put(input('Other', 'three', { scope: 'workspace', workspacePath: '/x' }))
  assert.equal(core.list({ workspacePath: '/w' }).total, 2)
})

test('core load accepts storage-domain entry tuples', () => {
  const core = makeCore()
  const record: MemoryRecord = {
    id: 'tuple-1', kind: 'fact', title: 'Tuple', content: 'entry tuple', tags: ['tuple'], scope: 'global',
    workspacePath: null, importance: 0.5, status: 'active', sourceSessionId: 's1', revision: 1,
    updatedBy: 'system', supersedes: null, supersededBy: null, createdAt: 1, updatedAt: 2, expiresAt: null, relatedIds: [],
  }
  core.load([['tuple-1', record]])
  assert.equal(core.get('tuple-1')?.title, 'Tuple')
  assert.equal(core.list().items[0].title, 'Tuple')
})

test('core tolerates legacy records without tags', () => {
  const core = makeCore()
  const legacy = {
    id: 'legacy-1', kind: 'fact', title: 'Legacy', content: 'no tags field', scope: 'global',
    workspacePath: null, importance: 0.5, status: 'active', sourceSessionId: 's1', revision: 1,
    updatedBy: 'system', supersedes: null, supersededBy: null, createdAt: 1, updatedAt: 2, expiresAt: null, relatedIds: [],
  } as any
  core.load([legacy])
  assert.equal(core.get('legacy-1')?.title, 'Legacy')
  assert.equal(core.search({ q: 'legacy' }).total, 1)
})

test('core list paginates with limit/cursor/nextCursor', () => {
  const core = makeCore()
  for (let index = 1; index <= 5; index += 1) {
    core.put(input('Item ' + index, 'body ' + index))
  }
  const first = core.list({ limit: 2 })
  assert.equal(first.total, 5)
  assert.equal(first.items.length, 2)
  assert.equal(first.nextCursor, 2)
  const second = core.list({ limit: 2, cursor: first.nextCursor })
  assert.equal(second.items.length, 2)
  assert.equal(second.nextCursor, 4)
  const third = core.list({ limit: 2, cursor: second.nextCursor as number })
  assert.equal(third.items.length, 1)
  assert.equal(third.nextCursor, undefined)
})

test('core list sorts by key and direction', () => {
  const core = makeCore()
  core.put(input('Beta', 'b', { importance: 0.3 }))
  core.put(input('Alpha', 'a', { importance: 0.9 }))
  core.put(input('Gamma', 'g', { importance: 0.5 }))

  assert.deepEqual(core.list({ sort: 'updatedAt', order: 'desc' }).items.map(r => r.title), ['Gamma', 'Alpha', 'Beta'])
  assert.deepEqual(core.list({ sort: 'updatedAt', order: 'asc' }).items.map(r => r.title), ['Beta', 'Alpha', 'Gamma'])
  assert.deepEqual(core.list({ sort: 'importance', order: 'desc' }).items.map(r => r.title), ['Alpha', 'Gamma', 'Beta'])
  assert.deepEqual(core.list({ sort: 'importance', order: 'asc' }).items.map(r => r.title), ['Beta', 'Gamma', 'Alpha'])
  assert.deepEqual(core.list({ sort: 'title', order: 'asc' }).items.map(r => r.title), ['Alpha', 'Beta', 'Gamma'])
  assert.deepEqual(core.list({ sort: 'title', order: 'desc' }).items.map(r => r.title), ['Gamma', 'Beta', 'Alpha'])
})

test('core allTags counts and orders by usage', () => {
  const core = makeCore()
  core.put(input('A', 'one', { tags: ['red', 'blue'] }))
  core.put(input('B', 'two', { tags: ['red'] }))
  core.put(input('C', 'three', { tags: ['green', 'red'] }))
  assert.deepEqual(core.allTags(), [
    { tag: 'red', count: 3 },
    { tag: 'blue', count: 1 },
    { tag: 'green', count: 1 },
  ])
})

test('core load rebuilds index from durable records', () => {
  const core = makeCore()
  const record: MemoryRecord = {
    id: 'loaded-1', kind: 'insight', title: 'Loaded', content: 'durable content', tags: ['loaded'],
    scope: 'global', workspacePath: null, importance: 0.5, status: 'active', sourceSessionId: 's1',
    revision: 1, updatedBy: 'system', supersedes: null, supersededBy: null, createdAt: 1, updatedAt: 2,
    expiresAt: null, relatedIds: [],
  }
  core.load([record])
  assert.equal(core.get('loaded-1')?.title, 'Loaded')
  assert.equal(core.search({ q: 'durable' }).total, 1)
})
