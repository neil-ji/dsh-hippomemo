import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HippomemoApi } from './api.ts'
import type { HippomemoLocaleKey } from './locales.ts'
import type { MemoryKind, MemoryPatchInput, MemoryPutInput, MemoryRecord, MemoryScope, MemoryStats, MemoryStatus } from '../types.ts'

type Translate = (key: HippomemoLocaleKey) => string

export interface MemorySectionProps {
  api: HippomemoApi
  t: Translate
}

const KINDS: MemoryKind[] = ['insight', 'decision', 'fact', 'preference', 'constraint']
const SCOPES: MemoryScope[] = ['global', 'workspace', 'project']
const STATUSES: MemoryStatus[] = ['active', 'archived', 'superseded', 'candidate']

interface SelectOption {
  value: string
  label: string
}

function HippomemoSelect({ value, placeholder, options, onChange }: {
  value: string
  placeholder: string
  options: SelectOption[]
  onChange: (value: string) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [side, setSide] = useState<'bottom' | 'top'>('bottom')
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const selected = options.find(option => option.value === value)
  const label = selected?.label ?? placeholder

  const openMenu = (): void => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect !== undefined) {
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      setSide(spaceBelow >= 220 || spaceBelow >= spaceAbove ? 'bottom' : 'top')
    }
    setOpen(true)
  }

  return (
    <Menu
      open={open}
      portal
      side={side}
      anchor={(
        <button
          ref={triggerRef}
          type="button"
          className={open ? 'hippomemo-select hippomemo-select-open' : 'hippomemo-select'}
          onClick={openMenu}
        >
          <span className="hippomemo-select-label">{label}</span>
          <span className="hippomemo-select-chevron" aria-hidden="true">
            <IconChevronDownOutline14 />
          </span>
        </button>
      )}
      items={options.map(option => ({ id: option.value, label: option.label }))}
      selectedId={value}
      onSelect={(id) => { onChange(id); setOpen(false) }}
      onClose={() => { setOpen(false) }}
    />
  )
}

export function MemorySection({ api, t }: MemorySectionProps): ReactNode {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [scope, setScope] = useState('')
  const [status, setStatus] = useState('')
  const [records, setRecords] = useState<MemoryRecord[]>([])
  const [stats, setStats] = useState<MemoryStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<MemoryRecord | 'new' | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    const query = {
      ...(q.length > 0 ? { q } : {}),
      ...(kind.length > 0 ? { kind: kind as MemoryKind } : {}),
      ...(scope.length > 0 ? { scope: scope as MemoryScope } : {}),
      ...(status.length > 0 ? { status: status as MemoryStatus } : {}),
    }
    void Promise.all([api.list(query), api.stats()])
      .then(([list, nextStats]) => {
        if (current === false) return
        setRecords(list.items)
        setStats(nextStats)
      })
      .catch((cause: unknown) => {
        if (current === false) return
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (current === false) return
        setLoading(false)
      })
    return () => { current = false }
  }, [api, q, kind, scope, status, reloadKey])

  const reload = (): void => {
    setReloadKey(prev => prev + 1)
  }

  useEffect(() => {
    const close = api.events(() => { reload() })
    return close
  }, [api])

  const save = async (input: MemoryPutInput | MemoryPatchInput, id?: string): Promise<void> => {
    if (id === undefined) await api.create(input as MemoryPutInput)
    else await api.update(id, input as MemoryPatchInput)
    setEditing(null)
    reload()
  }

  const remove = async (id: string): Promise<void> => {
    if (window.confirm(t('confirmDelete')) === false) return
    await api.remove(id)
    reload()
  }

  const setStatusFor = async (record: MemoryRecord, next: MemoryStatus): Promise<void> => {
    await api.update(record.id, { status: next })
    reload()
  }

  return (
    <div className="hippomemo-section" data-plugin="dsh-hippomemo">
      <h2 className="hippomemo-title">{t('title')}</h2>
      <p className="hippomemo-intro">{t('intro')}</p>

      <div className="hippomemo-toolbar">
        <input
          className="hippomemo-search"
          value={q}
          placeholder={t('searchPlaceholder')}
          onChange={event => { setQ(event.currentTarget.value) }}
        />
        <HippomemoSelect
          value={kind}
          placeholder={t('allKinds')}
          options={[{ value: '', label: t('allKinds') }, ...KINDS.map(value => ({ value, label: t(value) }))]}
          onChange={setKind}
        />
        <HippomemoSelect
          value={scope}
          placeholder={t('allScopes')}
          options={[{ value: '', label: t('allScopes') }, ...SCOPES.map(value => ({ value, label: t(value) }))]}
          onChange={setScope}
        />
        <HippomemoSelect
          value={status}
          placeholder={t('allStatuses')}
          options={[{ value: '', label: t('allStatuses') }, ...STATUSES.map(value => ({ value, label: t(value) }))]}
          onChange={setStatus}
        />
        <button type="button" className="hippomemo-button" onClick={() => { setEditing('new') }}>
          {t('newMemory')}
        </button>
      </div>

      {stats !== null ? (
        <div className="hippomemo-meta">
          <span>{t('total')} {stats.total}</span>
          <span>{t('activeCount')} {stats.active}</span>
          <span>{t('archivedCount')} {stats.archived}</span>
        </div>
      ) : null}

      {loading ? <p>{t('loading')}</p> : null}
      {error.length > 0 && loading === false ? (
        <p className="hippomemo-error">{t('loadFailed')}: {error}</p>
      ) : null}

      {loading === false && records.length === 0 ? <p>{q.length > 0 ? t('emptySearch') : t('empty')}</p> : null}

      {editing !== null ? (
        <MemoryEditor
          t={t}
          initial={editing === 'new' ? undefined : editing}
          onCancel={() => { setEditing(null) }}
          onSave={save}
        />
      ) : null}

      <div className="hippomemo-list">
        {records.map(record => (
          <div className="hippomemo-card" key={record.id}>
            <div className="hippomemo-card-head">
              <span className="hippomemo-card-title">{record.title}</span>
              <span className="hippomemo-meta">{t(record.kind)}</span>
            </div>
            <p className="hippomemo-content">{record.content}</p>
            <div className="hippomemo-meta">
              <span>{t('scope')}: {t(record.scope)}</span>
              <span>{t('status')}: {t(record.status)}</span>
              <span>{t('importanceLabel')}: {record.importance.toFixed(2)}</span>
              <span>{t('revisionLabel')}: {record.revision}</span>
              <span>{t('sourceSession')}: {record.sourceSessionId}</span>
              <span>{t('updatedAt')}: {new Date(record.updatedAt).toLocaleString()}</span>
            </div>
            <div className="hippomemo-toolbar">
              <button type="button" className="hippomemo-button" onClick={() => { setEditing(record) }}>{t('edit')}</button>
              <button
                type="button"
                className="hippomemo-button"
                onClick={() => { void setStatusFor(record, record.status === 'archived' ? 'active' : 'archived') }}
              >
                {record.status === 'archived' ? t('restore') : t('archive')}
              </button>
              <button type="button" className="hippomemo-button" onClick={() => { void remove(record.id) }}>{t('delete')}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

interface EditorProps {
  t: Translate
  initial?: MemoryRecord
  onCancel: () => void
  onSave: (input: MemoryPutInput | MemoryPatchInput, id?: string) => Promise<void>
}

function MemoryEditor({ t, initial, onCancel, onSave }: EditorProps): ReactNode {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [content, setContent] = useState(initial?.content ?? '')
  const [tags, setTags] = useState(initial?.tags.join(', ') ?? '')
  const [kind, setKind] = useState<MemoryKind>(initial?.kind ?? 'insight')
  const [scope, setScope] = useState<MemoryScope>(initial?.scope ?? 'global')
  const [importance, setImportance] = useState(String(initial?.importance ?? 0.5))
  const [saving, setSaving] = useState(false)

  const submit = async (): Promise<void> => {
    setSaving(true)
    try {
      const patch: MemoryPatchInput = {
        title,
        content,
        tags: tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0),
        kind,
        scope,
        importance: Number(importance) || 0.5,
      }
      await onSave(patch, initial?.id)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="hippomemo-form">
      <label>{t('titleLabel')}<input value={title} onChange={event => { setTitle(event.currentTarget.value) }} /></label>
      <label>{t('kind')}
        <HippomemoSelect
          value={kind}
          placeholder={t('kind')}
          options={KINDS.map(value => ({ value, label: t(value) }))}
          onChange={(value) => { setKind(value as MemoryKind) }}
        />
      </label>
      <label>{t('scope')}
        <HippomemoSelect
          value={scope}
          placeholder={t('scope')}
          options={SCOPES.map(value => ({ value, label: t(value) }))}
          onChange={(value) => { setScope(value as MemoryScope) }}
        />
      </label>
      <label>{t('importanceLabel')}<input type="number" min="0" max="1" step="0.1" value={importance} onChange={event => { setImportance(event.currentTarget.value) }} /></label>
      <label>{t('contentLabel')}<textarea value={content} onChange={event => { setContent(event.currentTarget.value) }} /></label>
      <label>{t('tagsLabel')}<input value={tags} onChange={event => { setTags(event.currentTarget.value) }} /></label>
      <div className="hippomemo-toolbar">
        <button type="button" className="hippomemo-button" disabled={saving} onClick={() => { void submit() }}>{t('save')}</button>
        <button type="button" className="hippomemo-button" onClick={onCancel}>{t('cancel')}</button>
      </div>
    </div>
  )
}
