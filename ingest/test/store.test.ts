import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createStore } from '../src/store.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'scf-store-'))

describe('createStore', () => {
  it('round-trips a tree through raw/', async () => {
    const dir = tmp()
    const store = createStore(dir, '2026-09-09')
    expect(await store.readTree('fr')).toBeNull()
    await store.writeTree('fr', { data: { tree_roots: [] } })
    expect(await store.readTree('fr')).toEqual({ data: { tree_roots: [] } })
  })

  it('round-trips the elections export through raw/', async () => {
    const dir = tmp()
    const store = createStore(dir, '2026-09-09')
    expect(await store.readElections()).toBeNull()
    await store.writeElections({ data: { tree_roots: [{ id: 1, label: 'x', type: 'election' }] } })
    expect(await store.readElections()).toEqual({
      data: { tree_roots: [{ id: 1, label: 'x', type: 'election' }] },
    })
  })

  it('writes a dated elections snapshot only when asked', async () => {
    const dir = tmp()
    const store = createStore(dir, '2026-09-09')
    await store.writeElections({ data: { tree_roots: [] } }, { snapshot: false })
    expect(existsSync(join(dir, 'snapshots'))).toBe(false)

    await store.writeElections({ data: { tree_roots: [{ id: 1, label: 'x', type: 'election' }] } }, { snapshot: true })
    const snap = join(dir, 'snapshots', '2026-09-09', 'elections.json')
    expect(JSON.parse(readFileSync(snap, 'utf8'))).toEqual({
      data: { tree_roots: [{ id: 1, label: 'x', type: 'election' }] },
    })
  })

  it('round-trips a form and reports cache presence', async () => {
    const dir = tmp()
    const store = createStore(dir, '2026-09-09')
    expect(await store.hasForm({ campaignId: 602, formId: 112 })).toBe(false)
    await store.writeForm({ campaignId: 602, formId: 112 }, { meta: { data_checksum_sha256: 'a' } })
    expect(await store.hasForm({ campaignId: 602, formId: 112 })).toBe(true)
    expect(await store.readForm({ campaignId: 602, formId: 112 })).toEqual({
      meta: { data_checksum_sha256: 'a' },
    })
  })

  it('writes a dated snapshot only when asked', async () => {
    const dir = tmp()
    const store = createStore(dir, '2026-09-09')
    await store.writeForm({ campaignId: 1, formId: 2 }, { x: 1 }, { snapshot: false })
    expect(existsSync(join(dir, 'snapshots'))).toBe(false)

    await store.writeForm({ campaignId: 1, formId: 2 }, { x: 2 }, { snapshot: true })
    const snap = join(dir, 'snapshots', '2026-09-09', 'forms', '1_2.json')
    expect(JSON.parse(readFileSync(snap, 'utf8'))).toEqual({ x: 2 })
  })

  it('lists cached form keys', async () => {
    const dir = tmp()
    const store = createStore(dir, '2026-09-09')
    await store.writeForm({ campaignId: 602, formId: 112 }, {})
    await store.writeForm({ campaignId: 7, formId: 91 }, {})
    const keys = (await store.listCachedForms()).sort((a, b) => a.campaignId - b.campaignId)
    expect(keys).toEqual([
      { campaignId: 7, formId: 91 },
      { campaignId: 602, formId: 112 },
    ])
  })

  it('excludes malformed cache filenames instead of fabricating keys', async () => {
    const dir = tmp()
    const store = createStore(dir, '2026-09-09')
    const formsDir = join(dir, 'raw', 'forms')
    mkdirSync(formsDir, { recursive: true })
    writeFileSync(join(formsDir, '3_4.json'), '{}')
    writeFileSync(join(formsDir, '12_.json'), '{}')
    writeFileSync(join(formsDir, '_112.json'), '{}')
    writeFileSync(join(formsDir, '1_2_3.json'), '{}')
    writeFileSync(join(formsDir, '-1_2.json'), '{}')

    const keys = await store.listCachedForms()
    expect(keys).toEqual([{ campaignId: 3, formId: 4 }])
  })

  it('round-trips the slug map', async () => {
    const dir = tmp()
    const store = createStore(dir, '2026-09-09')
    expect(await store.readSlugs()).toEqual({})
    await store.writeSlugs({ '31': 'initiative-sur-la-neutralite' })
    expect(await store.readSlugs()).toEqual({ '31': 'initiative-sur-la-neutralite' })
  })

  it('writes normalised output where the site expects it', async () => {
    const dir = tmp()
    const store = createStore(dir, '2026-09-09')
    await store.writeNormalised('votes.json', { votes: [] })
    expect(JSON.parse(readFileSync(join(dir, 'normalised', 'votes.json'), 'utf8')))
      .toEqual({ votes: [] })
  })
})
