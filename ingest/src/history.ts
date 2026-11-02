import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { FormResponse } from './model.js'

export type HistoryEvent =
  | {
      event: 'form_first_seen'
      voteId: number
      campaignId: number
      formId: number
      checksum: string
      total: number | null
    }
  | {
      event: 'form_changed'
      voteId: number
      campaignId: number
      formId: number
      checksum: string
      previousChecksum: string
      total: number | null
      previousTotal: number | null
    }
  | {
      event: 'form_label_changed'
      voteId: number
      campaignId: number
      formId: number
      checksum: string
      previousChecksum: string
    }
  | { event: 'form_removed'; voteId: number; campaignId: number; formId: number }

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

export function formDataChanged(previous: FormResponse | null, next: FormResponse): boolean {
  if (!previous) return true
  return stableStringify(previous.data.form_data) !== stableStringify(next.data.form_data)
}

export function classifyChange(
  previous: FormResponse | null,
  next: FormResponse,
): 'first_seen' | 'data_changed' | 'label_only' | 'unchanged' {
  if (!previous) return 'first_seen'
  if (previous.meta.data_checksum_sha256 === next.meta.data_checksum_sha256) return 'unchanged'
  return formDataChanged(previous, next) ? 'data_changed' : 'label_only'
}

export async function appendEvents(
  dataDir: string,
  events: readonly HistoryEvent[],
  now: Date,
): Promise<void> {
  if (events.length === 0) return
  const ts = now.toISOString()
  const dir = join(dataDir, 'history')
  await mkdir(dir, { recursive: true })
  const path = join(dir, `events-${now.getUTCFullYear()}.jsonl`)
  const body = events.map((e) => `${JSON.stringify({ ts, ...e })}\n`).join('')
  await appendFile(path, body, 'utf8')
}
