import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendEvents, classifyChange, formDataChanged } from '../src/history.js'
import type { FormResponse } from '../src/model.js'

const form = (checksum: string, total: string, label = 'Déclaration des recettes budgétées'): FormResponse => ({
  data: { label, actor_label: 'Comité X', form_data: { totals: { total } } },
  meta: { data_checksum_sha256: checksum },
})

describe('formDataChanged', () => {
  it('is true when there is no previous payload', () => {
    expect(formDataChanged(null, form('a', "CHF 1'000.00"))).toBe(true)
  })

  it('is false when form_data is deep-equal despite a different checksum', () => {
    expect(formDataChanged(form('a', "CHF 1'000.00"), form('b', "CHF 1'000.00"))).toBe(false)
  })

  it('is true when a value changes', () => {
    expect(formDataChanged(form('a', "CHF 1'000.00"), form('b', "CHF 2'000.00"))).toBe(true)
  })

  it('ignores key order', () => {
    const a: FormResponse = {
      data: { label: 'l', actor_label: 'x', form_data: { totals: { total: '1.00', sales: '2.00' } } },
      meta: { data_checksum_sha256: 'a' },
    }
    const b: FormResponse = {
      data: { label: 'l', actor_label: 'x', form_data: { totals: { sales: '2.00', total: '1.00' } } },
      meta: { data_checksum_sha256: 'b' },
    }
    expect(formDataChanged(a, b)).toBe(false)
  })
})

describe('classifyChange', () => {
  it('reports first_seen with no previous', () => {
    expect(classifyChange(null, form('a', '1.00'))).toBe('first_seen')
  })
  it('reports unchanged when the checksum is identical', () => {
    expect(classifyChange(form('a', '1.00'), form('a', '1.00'))).toBe('unchanged')
  })
  it('reports label_only when the checksum moved but form_data did not', () => {
    expect(classifyChange(form('a', '1.00', 'Ancien libellé'), form('b', '1.00', 'Nouveau libellé')))
      .toBe('label_only')
  })
  it('reports data_changed when a number moved', () => {
    expect(classifyChange(form('a', '1.00'), form('b', '2.00'))).toBe('data_changed')
  })
})

describe('appendEvents', () => {
  it('appends JSONL to a year-sharded file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scf-hist-'))
    const now = new Date('2026-09-09T04:12:03Z')
    await appendEvents(dir, [
      { event: 'form_first_seen', voteId: 31, campaignId: 607, formId: 111, checksum: 'f4', total: 1_500_000 },
    ], now)
    await appendEvents(dir, [
      { event: 'form_removed', voteId: 31, campaignId: 602, formId: 112 },
    ], now)

    const path = join(dir, 'history', 'events-2026.jsonl')
    const lines = readFileSync(path, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!)).toMatchObject({
      ts: '2026-09-09T04:12:03.000Z', event: 'form_first_seen', voteId: 31, total: 1_500_000,
    })
    expect(JSON.parse(lines[1]!)).toMatchObject({ event: 'form_removed', formId: 112 })
  })

  it('shards by the year of the timestamp', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scf-hist-'))
    await appendEvents(dir, [{ event: 'form_removed', voteId: 1, campaignId: 1, formId: 1 }],
      new Date('2027-01-02T00:00:00Z'))
    expect(() => readFileSync(join(dir, 'history', 'events-2027.jsonl'), 'utf8')).not.toThrow()
    expect(() => readFileSync(join(dir, 'history', 'events-2026.jsonl'), 'utf8')).toThrow()
  })

  it('writes nothing when given no events', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scf-hist-'))
    await appendEvents(dir, [], new Date('2026-09-09T00:00:00Z'))
    expect(() => readFileSync(join(dir, 'history', 'events-2026.jsonl'), 'utf8')).toThrow()
  })
})
