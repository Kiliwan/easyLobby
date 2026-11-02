import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { donorKey, donorName, replaySnapshots } from '../src/lifecycle.js'

const entry = (name: string, value: string, date: string) => ({
  juristic_name: name, juristic_city: 'Bern', value, date,
})

const form = (entries: ReturnType<typeof entry>[]) => ({
  data: {
    label: 'Déclaration de libéralités supérieures à 15 000 francs',
    actor_label: 'Comité X',
    form_data: { allowances: { juristic_monetary: entries } },
  },
  meta: { data_checksum_sha256: 'a'.repeat(64) },
})

function snapshotTree(days: Record<string, Record<string, unknown>>): string {
  const dir = mkdtempSync(join(tmpdir(), 'scf-life-'))
  for (const [date, forms] of Object.entries(days)) {
    for (const [file, body] of Object.entries(forms)) {
      const d = join(dir, date, 'forms')
      mkdirSync(d, { recursive: true })
      writeFileSync(join(d, file), JSON.stringify(body), 'utf8')
    }
  }
  return dir
}

describe('donorName', () => {
  it('collapses natural_first_name and natural_name into one string when they are identical after trimming', () => {
    const e = {
      natural_first_name: 'Urs Murbach und Theresa Nussbaum',
      natural_name: 'Urs Murbach und Theresa Nussbaum',
    }
    expect(donorName(e)).toBe('Urs Murbach und Theresa Nussbaum')
  })

  it('collapses even when one side carries incidental surrounding whitespace', () => {
    const e = { natural_first_name: '  Urs Murbach  ', natural_name: 'Urs Murbach' }
    expect(donorName(e)).toBe('Urs Murbach')
  })

  it('does not collapse when the two fields merely look similar — no fuzzy logic', () => {
    const e = { natural_first_name: 'Urs', natural_name: 'Urs Murbach' }
    expect(donorName(e)).toBe('Urs Urs Murbach')
  })

  it('keeps concatenating genuinely distinct first/last names as before', () => {
    const e = { natural_first_name: 'Sabine und Dominik', natural_name: 'Brändlin' }
    expect(donorName(e)).toBe('Sabine und Dominik Brändlin')
  })

  it('keeps donorKey consistent for a collapsed name — the knock-on to replaySnapshots', () => {
    const e = {
      natural_first_name: 'Urs Murbach und Theresa Nussbaum',
      natural_name: 'Urs Murbach und Theresa Nussbaum',
      natural_city: 'Au',
      value: "40'000.00",
      date: '06.05.2026',
    }
    const key = donorKey(580, 92, e)
    expect(key).toBe(donorKey(580, 92, e))
    expect(key).toContain('/Urs Murbach und Theresa Nussbaum/Au/')
  })
})

describe('donorKey', () => {
  it('is content-derived and ignores array position', () => {
    const a = donorKey(1, 2, entry('Acme AG', "15'000.00", '01.02.2026'))
    const b = donorKey(1, 2, entry('Acme AG', "15'000.00", '01.02.2026'))
    expect(a).toBe(b)
  })

  it('never throws on a malformed money value, and distinguishes two donors that differ only in it', () => {
    const malformed = entry('Acme AG', "1'000.--", '01.02.2026')
    const otherMalformed = entry('Acme AG', "2'000.--", '01.02.2026')
    expect(() => donorKey(1, 2, malformed)).not.toThrow()
    expect(donorKey(1, 2, malformed)).not.toBe(donorKey(1, 2, otherMalformed))
  })

  it('never throws when the value is missing, and does not collide two otherwise-different donors', () => {
    const noValue = { juristic_name: 'Acme AG', juristic_city: 'Bern', date: '01.02.2026' }
    const otherNoValue = { juristic_name: 'Other AG', juristic_city: 'Bern', date: '01.02.2026' }
    expect(() => donorKey(1, 2, noValue)).not.toThrow()
    expect(donorKey(1, 2, noValue)).not.toBe(donorKey(1, 2, otherNoValue))
  })

  it('distinguishes amount, date, name and form', () => {
    const base = entry('Acme AG', "15'000.00", '01.02.2026')
    expect(donorKey(1, 2, base)).not.toBe(donorKey(1, 3, base))
    expect(donorKey(1, 2, base)).not.toBe(donorKey(1, 2, entry('Acme AG', "16'000.00", '01.02.2026')))
    expect(donorKey(1, 2, base)).not.toBe(donorKey(1, 2, entry('Acme AG', "15'000.00", '02.02.2026')))
    expect(donorKey(1, 2, base)).not.toBe(donorKey(1, 2, entry('Other AG', "15'000.00", '01.02.2026')))
  })
})

describe('replaySnapshots', () => {
  it('returns an empty map for an empty archive', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scf-life-'))
    const { observations, warnings } = await replaySnapshots(dir)
    expect(observations.size).toBe(0)
    expect(warnings).toEqual([])
  })

  it('records firstSeenAt from the earliest snapshot containing the entry', async () => {
    const e = entry('Acme AG', "15'000.00", '01.02.2026')
    const dir = snapshotTree({
      '2026-09-10': { '5_6.json': form([e]) },
      '2026-09-12': { '5_6.json': form([e]) },
    })
    const { observations } = await replaySnapshots(dir)
    const obs = observations.get(donorKey(5, 6, e))!
    expect(obs.firstSeenAt).toBe('2026-09-10')
    expect(obs.withdrawnAt).toBeNull()
  })

  it('records withdrawnAt when an entry vanishes from a later snapshot of the same form', async () => {
    const kept = entry('Acme AG', "15'000.00", '01.02.2026')
    const gone = entry('Gone AG', "20'000.00", '03.02.2026')
    const dir = snapshotTree({
      '2026-09-10': { '5_6.json': form([kept, gone]) },
      '2026-09-14': { '5_6.json': form([kept]) },
    })
    const { observations: map } = await replaySnapshots(dir)
    expect(map.get(donorKey(5, 6, kept))!.withdrawnAt).toBeNull()
    const g = map.get(donorKey(5, 6, gone))!
    expect(g.firstSeenAt).toBe('2026-09-10')
    expect(g.withdrawnAt).toBe('2026-09-14')
  })

  it('does NOT mark an entry withdrawn merely because its form was not snapshotted that day', async () => {
    const a = entry('Acme AG', "15'000.00", '01.02.2026')
    const b = entry('Beta AG', "18'000.00", '02.02.2026')
    const dir = snapshotTree({
      '2026-09-10': { '5_6.json': form([a]) },
      '2026-09-11': { '7_8.json': form([b]) },
    })
    const { observations: map } = await replaySnapshots(dir)
    expect(map.get(donorKey(5, 6, a))!.withdrawnAt).toBeNull()
  })

  it('clears withdrawnAt and keeps the original firstSeenAt when an entry reappears', async () => {
    const e = entry('Acme AG', "15'000.00", '01.02.2026')
    const other = entry('Other AG', "19'000.00", '04.02.2026')
    const dir = snapshotTree({
      '2026-09-10': { '5_6.json': form([e]) },
      '2026-09-12': { '5_6.json': form([other]) },
      '2026-09-15': { '5_6.json': form([e, other]) },
    })
    const { observations } = await replaySnapshots(dir)
    const obs = observations.get(donorKey(5, 6, e))!
    expect(obs.firstSeenAt).toBe('2026-09-10')
    expect(obs.withdrawnAt).toBeNull()
  })

  it('processes snapshot dates in chronological order, not directory order', async () => {
    const e = entry('Acme AG', "15'000.00", '01.02.2026')
    const dir = snapshotTree({
      '2026-09-20': { '5_6.json': form([e]) },
      '2026-09-02': { '5_6.json': form([e]) },
    })
    const { observations } = await replaySnapshots(dir)
    expect(observations.get(donorKey(5, 6, e))!.firstSeenAt).toBe('2026-09-02')
  })

  it('ignores non-date directories and malformed form files without throwing', async () => {
    const e = entry('Acme AG', "15'000.00", '01.02.2026')
    const dir = snapshotTree({ '2026-09-10': { '5_6.json': form([e]) } })
    mkdirSync(join(dir, 'not-a-date', 'forms'), { recursive: true })
    writeFileSync(join(dir, 'not-a-date', 'forms', '9_9.json'), 'not json', 'utf8')
    mkdirSync(join(dir, '2026-09-11', 'forms'), { recursive: true })
    writeFileSync(join(dir, '2026-09-11', 'forms', 'bad.json'), '{}', 'utf8')
    const { observations } = await replaySnapshots(dir)
    expect(observations.get(donorKey(5, 6, e))!.firstSeenAt).toBe('2026-09-10')
  })

  it('surfaces an unreadable snapshot as a warning instead of silently dropping it', async () => {
    const e = entry('Acme AG', "15'000.00", '01.02.2026')
    const dir = snapshotTree({ '2026-09-10': { '5_6.json': form([e]) } })
    mkdirSync(join(dir, '2026-09-11', 'forms'), { recursive: true })
    writeFileSync(join(dir, '2026-09-11', 'forms', '7_8.json'), 'not json', 'utf8')
    const { observations, warnings } = await replaySnapshots(dir)
    expect(observations.get(donorKey(5, 6, e))!.firstSeenAt).toBe('2026-09-10')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('7_8.json')
  })
})
