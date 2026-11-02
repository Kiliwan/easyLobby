import { mkdtempSync } from 'node:fs'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildFromCache } from '../src/buildFromCache.js'
import { RequestCapExceeded, TooManyFailures } from '../src/fetcher.js'
import { run } from '../src/run.js'
import { createStore } from '../src/store.js'
import type { FormResponse, NormalisedOutput } from '../src/model.js'

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))
const readFixture = (p: string) => JSON.parse(readFileSync(join(fixtures, p), 'utf8'))

const trees = {
  fr: readFixture('trees/fr-campaign_financings.json'),
  de: readFixture('trees/de-campaign_financings.json'),
}
const elections = readFixture('trees/fr-exports-elections.json')
const formPayloads = new Map<string, unknown>()
for (const name of readdirSync(join(fixtures, 'forms'))) {
  if (name.endsWith('.json')) {
    formPayloads.set(name.replace(/\.json$/, ''), readFixture(join('forms', name)))
  }
}

type TreesOverride = Partial<Record<'fr' | 'de' | 'it', unknown>>

function fakeFetcher(
  overrides = new Map<string, unknown>(),
  electionsOverride?: unknown,
  treesOverride?: TreesOverride,
) {
  const urls: string[] = []
  return {
    urls,
    getJsonOrNull: async <T>(url: string): Promise<T | null> => {
      urls.push(url)
      return null
    },
    getJson: async <T>(url: string): Promise<T> => {
      urls.push(url)
      if (url.includes('group_by=elections')) return (electionsOverride ?? elections) as T
      const treeMatch = /\/v1\/(\w\w)\/campaign_financings$/.exec(url)
      if (treeMatch) {
        const lang = treeMatch[1] as 'fr' | 'de' | 'it'
        const tree = treesOverride?.[lang] ?? trees[lang as 'fr' | 'de'] ?? trees.fr
        return tree as T
      }
      const formMatch = /\/campaigns\/(\d+)\/forms\/(\d+)$/.exec(url)
      if (formMatch) {
        const key = `${formMatch[1]}_${formMatch[2]}`
        const payload = overrides.get(key) ?? formPayloads.get(key)
        if (!payload) throw new Error(`HTTP 404 for ${url}`)
        return payload as T
      }
      throw new Error(`unexpected url ${url}`)
    },
  }
}

const newRun = async (
  dir: string, day: string, overrides?: Map<string, unknown>, electionsOverride?: unknown,
  treesOverride?: TreesOverride,
) => {
  const store = createStore(dir, day)
  const fetcher = fakeFetcher(overrides, electionsOverride, treesOverride)
  const result = await run({ fetcher, store, dataDir: dir, now: new Date(`${day}T04:00:00Z`) })
  return { result, fetcher, store }
}

describe('run', () => {
  it('fetches 3 trees and the elections export before any form', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scf-run-'))
    const { fetcher } = await newRun(dir, '2026-09-09')
    const firstFour = fetcher.urls.slice(0, 4)
    expect(firstFour.filter((u) => u.includes('campaign_financings'))).toHaveLength(3)
    expect(firstFour.filter((u) => u.includes('group_by=elections'))).toHaveLength(1)
  })

  it('writes votes.json with all 29 in-scope votations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scf-run-'))
    const { result } = await newRun(dir, '2026-09-09')
    expect(result.votes).toBe(29)
    const written = JSON.parse(readFileSync(join(dir, 'normalised', 'votes.json'), 'utf8'))
    expect(written.votes).toHaveLength(29)
  })

  it('emits form_first_seen events on a cold run and writes them to the year shard', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scf-run-'))
    const { result } = await newRun(dir, '2026-09-09')
    expect(result.events.every((e) => e.event === 'form_first_seen')).toBe(true)
    expect(result.events.length).toBeGreaterThan(80)
    const jsonl = readFileSync(join(dir, 'history', 'events-2026.jsonl'), 'utf8').trim().split('\n')
    expect(jsonl).toHaveLength(result.events.length)
  })

  it('writes a dated snapshot on the first run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scf-run-'))
    await newRun(dir, '2026-09-09')
    expect(readdirSync(join(dir, 'snapshots'))).toEqual(['2026-09-09'])
  })

  it('persists the elections export to raw/ so build-from-cache can read it offline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scf-run-'))
    await newRun(dir, '2026-09-09')
    const written = JSON.parse(readFileSync(join(dir, 'raw', 'elections.json'), 'utf8'))
    const ids = written.data.tree_roots.map((r: { id: number }) => r.id).sort((a: number, b: number) => a - b)
    expect(ids).toEqual([1, 2, 22, 27])
  })

  it('snapshots the elections export on the first run, and again only if it changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scf-run-'))
    await newRun(dir, '2026-09-09')
    expect(readFileSync(join(dir, 'snapshots', '2026-09-09', 'elections.json'), 'utf8')).toBeTruthy()

    await newRun(dir, '2026-09-10')
    expect(() => readFileSync(join(dir, 'snapshots', '2026-09-10', 'elections.json'), 'utf8')).toThrow()

    const changedElections = {
      data: { tree_roots: [...elections.data.tree_roots, { id: 999, label: 'x', type: 'campaign_financing' }] },
    }
    await newRun(dir, '2026-09-11', undefined, changedElections)
    const snap = readFileSync(join(dir, 'snapshots', '2026-09-11', 'elections.json'), 'utf8')
    expect(JSON.parse(snap)).toEqual(changedElections)
  })

  it('emits no events and writes no new snapshot on an unchanged second run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scf-run-'))
    await newRun(dir, '2026-09-09')
    const { result } = await newRun(dir, '2026-09-10')
    expect(result.events).toEqual([])
    expect(readdirSync(join(dir, 'snapshots'))).toEqual(['2026-09-09'])
  })

  it('tolerates a 404 on an individual form without aborting the run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scf-run-'))
    const { result } = await newRun(dir, '2026-09-09')
    expect(result.formsFetched).toBe(89)
    expect(result.votes).toBe(29)
  })

  it('reports structural violations without throwing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scf-run-'))
    const { result } = await newRun(dir, '2026-09-09')
    expect(result.violations).toEqual([])
  })

  it('maps a data_changed classification to a form_changed event, not form_label_changed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scf-run-'))
    await newRun(dir, '2026-09-09')

    const base = formPayloads.get('602_112') as FormResponse
    const changed: FormResponse = {
      ...base,
      data: {
        ...base.data,
        form_data: {
          ...base.data.form_data,
          allowances: {
            ...base.data.form_data.allowances,
            natural_monetary: [
              { ...(base.data.form_data.allowances!.natural_monetary![0]!), value: "9'999'999.00" },
              ...base.data.form_data.allowances!.natural_monetary!.slice(1),
            ],
          },
        },
      },
      meta: { data_checksum_sha256: 'changed-data-checksum' },
    }

    const overrides = new Map<string, unknown>([['602_112', changed]])
    const { result } = await newRun(dir, '2026-09-10', overrides)

    const events = result.events.filter((e) => e.campaignId === 602 && e.formId === 112)
    expect(events).toHaveLength(1)
    expect(events[0]!.event).toBe('form_changed')
    expect(events.some((e) => e.event === 'form_label_changed')).toBe(false)
  })

  it('maps a label_only classification to a form_label_changed event, not form_changed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scf-run-'))
    await newRun(dir, '2026-09-09')

    const base = formPayloads.get('602_112') as FormResponse
    const relabelled: FormResponse = {
      ...base,
      data: { ...base.data, label: `${base.data.label} (relabelled)` },
      meta: { data_checksum_sha256: 'relabelled-checksum' },
    }

    const overrides = new Map<string, unknown>([['602_112', relabelled]])
    const { result } = await newRun(dir, '2026-09-10', overrides)

    const events = result.events.filter((e) => e.campaignId === 602 && e.formId === 112)
    expect(events).toHaveLength(1)
    expect(events[0]!.event).toBe('form_label_changed')
    expect(events.some((e) => e.event === 'form_changed')).toBe(false)
  })

  it('records the budget/final total mismatch invariant count in meta.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scf-run-'))
    await newRun(dir, '2026-09-09')
    const meta = JSON.parse(readFileSync(join(dir, 'normalised', 'meta.json'), 'utf8'))
    expect(typeof meta.displayStageFinalMismatchCount).toBe('number')
    expect(meta.displayStageFinalMismatchCount).toBe(0)
  })

  it('produces byte-identical votes.json to buildFromCache from the same cache — no drift between the two build paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scf-parity-'))
    await newRun(dir, '2026-09-09')
    const afterRun = JSON.parse(readFileSync(join(dir, 'normalised', 'votes.json'), 'utf8')) as NormalisedOutput

    const cacheResult = await buildFromCache({ dataDir: dir, now: new Date('2026-09-09T04:00:00Z') })

    const stripGeneratedAt = (o: NormalisedOutput) => ({ ...o, generatedAt: undefined })
    expect(stripGeneratedAt(cacheResult.output)).toEqual(stripGeneratedAt(afterRun))
  })

  it('asks the official results source for every ballot date it publishes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scf-run-'))
    const { result, fetcher } = await newRun(dir, '2026-09-09')
    const resultUrls = fetcher.urls.filter((u) => u.includes('eidgAbstimmung'))
    expect(resultUrls.length).toBeGreaterThan(0)
    expect(resultUrls).toEqual([...new Set(resultUrls)])
    expect(result.resultsFetched).toBe(0)
  })

  it('still writes votes.json and history when the results source is down', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scf-run-'))
    const store = createStore(dir, '2026-09-09')
    const base = fakeFetcher()
    const fetcher = {
      urls: base.urls,
      getJson: base.getJson,
      getJsonOrNull: async <T>(): Promise<T | null> => {
        throw new Error('HTTP 503 from the results CDN')
      },
    }
    const result = await run({ fetcher, store, dataDir: dir, now: new Date('2026-09-09T04:00:00Z') })
    expect(result.votes).toBeGreaterThan(0)
    expect(existsSync(join(dir, 'normalised', 'votes.json'))).toBe(true)
    expect(result.votesWithResult).toBe(0)
  })

  it('lets a tripped TooManyFailures propagate out of run() instead of being logged as a per-form skip', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scf-run-'))
    const fetcher = {
      getJsonOrNull: async <T>(): Promise<T | null> => null,
      getJson: async <T>(url: string): Promise<T> => {
        if (url.includes('group_by=elections')) return elections as T
        if (url.includes('campaign_financings')) return trees.fr as T
        throw new TooManyFailures(5)
      },
    }
    const store = createStore(dir, '2026-09-09')
    await expect(run({ fetcher, store, dataDir: dir, now: new Date('2026-09-09T04:00:00Z') }))
      .rejects.toThrow(TooManyFailures)
  })

  it('lets a tripped RequestCapExceeded propagate out of run() instead of being logged as a per-form skip', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scf-run-'))
    const fetcher = {
      getJsonOrNull: async <T>(): Promise<T | null> => null,
      getJson: async <T>(url: string): Promise<T> => {
        if (url.includes('group_by=elections')) return elections as T
        if (url.includes('campaign_financings')) return trees.fr as T
        throw new RequestCapExceeded(600)
      },
    }
    const store = createStore(dir, '2026-09-09')
    await expect(run({ fetcher, store, dataDir: dir, now: new Date('2026-09-09T04:00:00Z') }))
      .rejects.toThrow(RequestCapExceeded)
  })

  it('survives a root with a malformed (no date prefix) label rather than crashing the whole run', async () => {
    const malformedRoot = { id: 999_001, label: 'No date prefix here', type: 'campaign_financing' }
    const frWithBadRoot = { data: { tree_roots: [...trees.fr.data.tree_roots, malformedRoot] } }
    const deWithBadRoot = { data: { tree_roots: [...trees.de.data.tree_roots, malformedRoot] } }
    const itWithBadRoot = frWithBadRoot

    const dir = mkdtempSync(join(tmpdir(), 'scf-run-'))
    const { result } = await newRun(dir, '2026-09-09', undefined, undefined, {
      fr: frWithBadRoot, de: deWithBadRoot, it: itWithBadRoot,
    })

    expect(result.votes).toBe(29)
    const written = JSON.parse(readFileSync(join(dir, 'normalised', 'votes.json'), 'utf8'))
    expect(written.votes.some((v: { id: number }) => v.id === 999_001)).toBe(false)
    const meta = JSON.parse(readFileSync(join(dir, 'normalised', 'meta.json'), 'utf8'))
    expect(meta.violations.map((v: { rule: string }) => v.rule)).toContain('root_label_date_prefix')
  })
})
