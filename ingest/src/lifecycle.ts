import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DateParseError, parseSwissDate } from './dates.js'
import type { AllowanceEntry, FormResponse } from './model.js'
import { MoneyParseError, parseRappen } from './money.js'

export interface DonorObservation {
  firstSeenAt: string
  withdrawnAt: string | null
}

const SNAPSHOT_DATE = /^\d{4}-\d{2}-\d{2}$/
const FORM_FILE_NAME = /^(\d+)_(\d+)\.json$/

export function donorName(entry: AllowanceEntry): string {
  if (entry.juristic_name) return entry.juristic_name.trim()
  const first = entry.natural_first_name?.trim()
  const last = entry.natural_name?.trim()
  if (first && last && first === last) return first
  return [first, last].filter(Boolean).join(' ').trim()
}

function keyableAmount(value: string | undefined): string {
  try {
    const parsed = parseRappen(value)
    return parsed === null ? (value ?? '') : String(parsed)
  } catch (error) {
    if (!(error instanceof MoneyParseError)) throw error
    return value ?? ''
  }
}

export function donorKey(campaignId: number, formId: number, entry: AllowanceEntry): string {
  const kind = entry.juristic_name ? 'juristic' : 'natural'
  const name = donorName(entry)
  const city = entry.juristic_city ?? entry.natural_city ?? ''
  const date = entry.date ? parseSwissDate(entry.date) : ''
  const amountRappen = keyableAmount(entry.value)
  return `${campaignId}/${formId}/${kind}/${name}/${city}/${date}/${amountRappen}`
}

function isFormResponse(value: unknown): value is FormResponse {
  if (typeof value !== 'object' || value === null) return false
  const data = (value as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return false
  const formData = (data as { form_data?: unknown }).form_data
  return typeof formData === 'object' && formData !== null
}

function entryKeys(campaignId: number, formId: number, payload: FormResponse): Set<string> {
  const keys = new Set<string>()
  for (const entries of Object.values(payload.data.form_data.allowances ?? {})) {
    for (const entry of entries) {
      let amount: number | null
      try {
        amount = parseRappen(entry.value)
      } catch (error) {
        if (!(error instanceof MoneyParseError)) throw error
        continue
      }
      if (amount === null) continue
      try {
        keys.add(donorKey(campaignId, formId, entry))
      } catch (error) {
        if (!(error instanceof DateParseError)) throw error
        continue
      }
    }
  }
  return keys
}

export interface ReplaySnapshotsResult {
  observations: Map<string, DonorObservation>
  warnings: string[]
}

export async function replaySnapshots(snapshotsDir: string): Promise<ReplaySnapshotsResult> {
  const observations = new Map<string, DonorObservation>()
  const lastKeysByForm = new Map<string, Set<string>>()
  const warnings: string[] = []

  let dateDirs: string[]
  try {
    dateDirs = await readdir(snapshotsDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { observations, warnings }
    throw error
  }

  const dates = dateDirs.filter((d) => SNAPSHOT_DATE.test(d)).sort()

  for (const date of dates) {
    const formsDir = join(snapshotsDir, date, 'forms')
    let files: string[]
    try {
      files = await readdir(formsDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }

    for (const file of files) {
      const match = FORM_FILE_NAME.exec(file)
      if (!match) continue
      const campaignId = Number(match[1])
      const formId = Number(match[2])
      const formKey = `${campaignId}_${formId}`

      const path = join(formsDir, file)
      let payload: unknown
      try {
        payload = JSON.parse(await readFile(path, 'utf8'))
      } catch (error) {
        warnings.push(`unreadable snapshot ${path}: ${(error as Error).message}`)
        continue
      }
      if (!isFormResponse(payload)) continue

      const currentKeys = entryKeys(campaignId, formId, payload)
      const previousKeys = lastKeysByForm.get(formKey)

      for (const key of currentKeys) {
        if (!observations.has(key)) {
          observations.set(key, { firstSeenAt: date, withdrawnAt: null })
        } else {
          const obs = observations.get(key)!
          if (obs.withdrawnAt !== null) obs.withdrawnAt = null
        }
      }

      if (previousKeys) {
        for (const key of previousKeys) {
          if (!currentKeys.has(key)) {
            const obs = observations.get(key)
            if (obs) obs.withdrawnAt = date
          }
        }
      }

      lastKeysByForm.set(formKey, currentKeys)
    }
  }

  return { observations, warnings }
}
