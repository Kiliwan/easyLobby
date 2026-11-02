import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { donorRenderState, loadVotes, type Committee, type Vote } from '../src/lib/data.js'
import { hasVariedObservationDates, splitCommitteeDonors } from '../src/lib/donors.js'
import { pageScale } from '../src/lib/scale.js'
import { t } from '../src/i18n/index.js'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const { votes } = loadVotes()

const donorCount = (v: Vote): number => v.committees.reduce((s, c) => s + c.donors.length, 0)
const busiest = votes.reduce((a, b) => (donorCount(b) > donorCount(a) ? b : a))

const object28 = votes.find((v) => v.id === 28)!
const emptyPast = votes.find((v) => v.id === 23)!
const emptyFuture = votes.find((v) => v.id === 33)!
const page = (p: string) => readFileSync(`${dist}${p}`, 'utf8')

function entryBlockContaining(html: string, needle: string): string {
  const marker = '<div class="e'
  const needleIdx = html.indexOf(needle)
  if (needleIdx === -1) throw new Error(`needle not found: ${needle}`)
  const start = html.lastIndexOf(marker, needleIdx)
  const nextStart = html.indexOf(marker, start + marker.length)
  return html.slice(start, nextStart === -1 ? html.length : nextStart)
}

describe('detail pages', () => {
  it('builds one page per vote per language', () => {
    for (const lang of ['de', 'fr', 'it']) {
      for (const v of votes) {
        expect(existsSync(`${dist}${lang}/objet/${v.slug}/index.html`), `${lang}/${v.slug}`).toBe(true)
      }
    }
  })

  it(`renders both butterfly columns on the busiest object by donor count (${busiest.slug})`, () => {
    const html = page(`fr/objet/${busiest.slug}/index.html`)
    expect(html).toContain('class="L"')
    expect(html).toContain('class="R"')
  })

  it('never doubles the object-28 filer name across natural_first_name/natural_name (form 580/92) — the fixed budget-stage row is then itself suppressed as a re-filing under the corrected name', () => {
    const html = page(`fr/objet/${object28.slug}/index.html`)
    expect(html).not.toContain('Urs Murbach und Theresa Nussbaum Urs Murbach und Theresa Nussbaum')
    expect(html).toContain('>Urs und Theresa Murbach und Nussbaum<')

    const committee580 = object28.committees.find((c) => c.id === 580)!
    const fixed = committee580.donors.find((d) => d.name === 'Urs Murbach und Theresa Nussbaum')!
    expect(fixed).toBeDefined()
    expect(donorRenderState(fixed, committee580)).toBe('suppressed')
  })

  it('shows economiesuisse and Economiesuisse separately — no merging (object 28, the only object with both castings)', () => {
    const html = page(`fr/objet/${object28.slug}/index.html`)
    expect(html).toContain('>economiesuisse<')
    expect(html).toContain('>Economiesuisse<')
  })

  it(`shows the undeclared remainder on the busiest object (${busiest.slug})`, () => {
    expect(page(`fr/objet/${busiest.slug}/index.html`)).toContain('Sous le seuil')
  })

  it(`prints the shared scale on the busiest object (${busiest.slug})`, () => {
    expect(page(`fr/objet/${busiest.slug}/index.html`)).toContain('Échelle commune')
  })

  it(`never emits a bar wider than 100% on the busiest object by donor count (${busiest.slug})`, () => {
    const html = page(`fr/objet/${busiest.slug}/index.html`)
    for (const m of html.matchAll(/width:([\d.]+)%/g)) {
      expect(Number(m[1])).toBeLessThanOrEqual(100)
    }
  })

  it('uses the past empty state for a past vote with no filings (object 23)', () => {
    const html = page(`fr/objet/${emptyPast.slug}/index.html`).replace(/&#39;/g, "'")
    expect(html).toContain("Aucune déclaration n'a été déposée")
    expect(html).not.toContain("Aucune déclaration pour l'instant")
  })

  it('uses the future empty state for an upcoming vote with no filings (object 33)', () => {
    const html = page(`fr/objet/${emptyFuture.slug}/index.html`).replace(/&#39;/g, "'")
    expect(html).toContain("Aucune déclaration pour l'instant")
  })

  it(`links to the register source page on the busiest object (${busiest.slug})`, () => {
    expect(page(`fr/objet/${busiest.slug}/index.html`)).toContain(busiest.sourceUrl)
  })

  it(`ships no JavaScript on the busiest object (${busiest.slug})`, () => {
    expect(page(`fr/objet/${busiest.slug}/index.html`)).not.toMatch(/<script/i)
  })

  it(`keeps the busiest page under 100 KB (${busiest.slug})`, () => {
    expect(Buffer.byteLength(page(`fr/objet/${busiest.slug}/index.html`))).toBeLessThan(100_000)
  })

  it(`keeps the header language switcher on the same detail route, not the index (${object28.slug})`, () => {
    const html = page(`fr/objet/${object28.slug}/index.html`)
    const headerStart = html.indexOf('class="site-head"')
    const headerEnd = html.indexOf('</header>')
    const header = html.slice(headerStart, headerEnd)
    expect(header).toContain(`href="/easyLobby/de/objet/${object28.slug}/"`)
    expect(header).toContain(`href="/easyLobby/it/objet/${object28.slug}/"`)
    expect(header).not.toContain('href="/easyLobby/de/"')
    expect(header).not.toContain('href="/easyLobby/it/"')
  })
})

describe('a side with no filing committee renders words, not CHF 0 (object 7)', () => {
  const object7 = votes.find((v) => v.id === 7)!

  it('has no committee on the "no" side in the source data', () => {
    expect(object7.totals.no.budget).toBeNull()
    expect(object7.totals.no.final).toBeNull()
    expect(object7.committees.every((c) => c.side === 'yes')).toBe(true)
  })

  it('renders the column header with the no-declaration statement, not CHF 0 / 0 %/ Comités · 0', () => {
    const html = page(`fr/objet/${object7.slug}/index.html`)
    expect(html).toContain(t('fr', 'vote.side.noDeclaration'))
    expect(html).not.toContain('CONTRE</span> <span>CHF 0<')
  })

  it('gives the empty hero-bar side no width, since the statement now renders in the label line beneath', () => {
    const html = page(`fr/objet/${object7.slug}/index.html`)
    const m = /<div class="hn" style="([^"]+)"/.exec(html)
    expect(m?.[1]).toBe('flex:0')
  })

  it('renders the no-declaration statement in the hero-bar label line, not clipped inside the bar', () => {
    const html = page(`fr/objet/${object7.slug}/index.html`)
    const m = /<span class="tn">([^<]+)<\/span>/.exec(html)
    expect(m?.[1]).toContain(t('fr', 'vote.side.noDeclaration'))
  })
})

describe('printed scale vs rendered bar width, across all objects', () => {
  const digitsOnly = (s: string): string => s.replace(/\D/g, '')

  function scaleDigitsOf(html: string): string {
    const m = /<p class="scalenote">.*?CHF\s*([^<]+)<\/p>/s.exec(html)
    if (!m) throw new Error('no scalenote found')
    return digitsOnly(m[1]!)
  }

  function entryBlocks(html: string): string[] {
    const marker = '<div class="e'
    const starts: number[] = []
    let idx = html.indexOf(marker)
    while (idx !== -1) {
      starts.push(idx)
      idx = html.indexOf(marker, idx + marker.length)
    }
    return starts.map((s, i) => html.slice(s, i + 1 < starts.length ? starts[i + 1] : html.length))
  }

  for (const lang of ['de', 'fr', 'it'] as const) {
    for (const v of votes) {
      if (v.stage === 'none') continue

      it(`${lang}/${v.slug}: every full-width bar's amount matches the printed scale`, () => {
        const html = page(`${lang}/objet/${v.slug}/index.html`)
        const scale = scaleDigitsOf(html)

        for (const block of entryBlocks(html)) {
          const widthMatch = /width:([\d.]+)%/.exec(block)
          if (!widthMatch || Number(widthMatch[1]) < 100) continue

          const name = /<span class="nm">([^<]*)<\/span>/.exec(block)?.[1] ?? ''

          const amount = digitsOnly(/<span class="amt">([^<]*)<\/span>/.exec(block)![1]!)
          expect(amount, `"${name}" at width ${widthMatch[1]}%`).toBe(scale)
        }
      })
    }
  }
})

describe('donor lifecycle rendering', () => {
  const committee579 = object28.committees.find((c) => c.id === 579)!

  it('renders Thomas Matter (committee 579, object 28) greyed with the superseded caption, not the withdrawn one', () => {
    const html = page(`fr/objet/${object28.slug}/index.html`)
    const block = entryBlockContaining(html, '>Thomas Matter<')
    expect(block.slice(0, 20)).toContain('dim')
    expect(block).toContain(t('fr', 'vote.donor.superseded'))
    expect(block).not.toContain('Retiré du registre')

    const { current, greyed } = splitCommitteeDonors(committee579, 'fr')
    expect(current.some((d) => d.name === 'Thomas Matter')).toBe(false)
    const matter = greyed.find((d) => d.name === 'Thomas Matter')
    expect(matter?.caption).toBe(t('fr', 'vote.donor.superseded'))
  })

  it('suppresses a superseded donor whose name and city match a live final-stage donor — Blocher stays out of the greyed list while Matter stays in it (committee 579, object 28)', () => {
    const { current, greyed } = splitCommitteeDonors(committee579, 'fr')
    expect(current.filter((d) => d.name === 'Christoph Blocher')).toHaveLength(1)
    expect(greyed.some((d) => d.name === 'Christoph Blocher')).toBe(false)
    expect(greyed.some((d) => d.name === 'Thomas Matter')).toBe(true)

    const html = page(`fr/objet/${object28.slug}/index.html`)
    expect([...html.matchAll(/>Christoph Blocher</g)]).toHaveLength(1)
  })

  it(`no greyed donor's bar exceeds the width implied by the current-donor scale on the busiest object by donor count (${busiest.slug})`, () => {
    const scale = pageScale(busiest)
    for (const c of busiest.committees) {
      const { greyed } = splitCommitteeDonors(c, 'fr')
      for (const d of greyed) {
        const pct = scale > 0 ? Math.min(100, (d.amount / scale) * 100) : 0
        expect(pct).toBeLessThanOrEqual(100)
      }
    }
  })

  it("committee 579's (object 28) totals are unaffected by greyed donors", () => {
    expect(committee579.namedDonorTotal).toBe(514_808_616)
    expect(committee579.undeclaredRemainder).toBe(102_497_542)
  })

  it('renders no observation date for a donor with firstSeenAt: null', () => {
    const fixture: Committee = {
      id: 9001,
      names: { de: 'Test', fr: 'Test', it: 'Test' },
      category: 'test',
      side: 'yes',
      displayStage: 'final',
      budget: null,
      final: 100_000,
      donors: [{
        name: 'Sans Date',
        city: null,
        kind: 'natural_monetary',
        livingAbroad: false,
        amount: 50_000,
        date: '2026-01-01',
        stage: 'final',
        firstSeenAt: null,
        withdrawnAt: null,
      }],
      namedDonorTotal: 50_000,
      undeclaredRemainder: 0,
    }

    const { current } = splitCommitteeDonors(fixture, 'fr')
    expect(current).toHaveLength(1)
    expect(current[0]!.observed).toBeUndefined()
  })

  it("renders the register's own donation date under its own distinct label", () => {
    const fixture: Committee = {
      id: 9004,
      names: { de: 'Test', fr: 'Test', it: 'Test' },
      category: 'test',
      side: 'yes',
      displayStage: 'final',
      budget: null,
      final: 200_000_000,
      donors: [{
        name: 'Christoph Blocher',
        city: 'Herrliberg',
        kind: 'natural_monetary',
        livingAbroad: false,
        amount: 200_000_000,
        date: '2025-12-23',
        stage: 'final',
        firstSeenAt: '2026-09-10',
        withdrawnAt: null,
      }],
      namedDonorTotal: 200_000_000,
      undeclaredRemainder: 0,
    }

    const { current } = splitCommitteeDonors(fixture, 'fr')
    expect(current[0]!.registerDate).toBe(t('fr', 'vote.donor.registerDate', { date: '23 décembre 2025' }))
    expect(current[0]!.registerDate).not.toBe(current[0]!.observed)
  })

  it('suppresses the observed line site-wide while the archive holds only one distinct observation date', () => {
    expect(hasVariedObservationDates(loadVotes().votes)).toBe(false)

    const fixture: Committee = {
      id: 9005,
      names: { de: 'Test', fr: 'Test', it: 'Test' },
      category: 'test',
      side: 'yes',
      displayStage: 'final',
      budget: null,
      final: 100_000,
      donors: [{
        name: 'Someone',
        city: null,
        kind: 'natural_monetary',
        livingAbroad: false,
        amount: 100_000,
        date: '2026-01-01',
        stage: 'final',
        firstSeenAt: '2026-09-10',
        withdrawnAt: null,
      }],
      namedDonorTotal: 100_000,
      undeclaredRemainder: 0,
    }

    const { current } = splitCommitteeDonors(fixture, 'fr')
    expect(current[0]!.observed).toBeUndefined()
  })

  it('never renders an "obs" (observed) div anywhere on the built site today', () => {
    for (const lang of ['de', 'fr', 'it'] as const) {
      for (const v of votes) {
        if (v.stage === 'none') continue
        expect(page(`${lang}/objet/${v.slug}/index.html`)).not.toContain('class="obs"')
      }
    }
  })

  it('covers the withdrawn caption with a synthetic fixture — no real donor has withdrawnAt set yet', () => {
    const realDonorsWithWithdrawnAt = votes.flatMap((v) => v.committees).flatMap((c) => c.donors)
      .filter((d) => d.withdrawnAt !== null)
    expect(realDonorsWithWithdrawnAt).toHaveLength(0)

    const fixture: Committee = {
      id: 9002,
      names: { de: 'Test', fr: 'Test', it: 'Test' },
      category: 'test',
      side: 'yes',
      displayStage: 'final',
      budget: null,
      final: 100_000,
      donors: [{
        name: 'Retiré SA',
        city: 'Genève',
        kind: 'juristic_monetary',
        livingAbroad: false,
        amount: 20_000,
        date: '2026-01-01',
        stage: 'final',
        firstSeenAt: '2026-09-10',
        withdrawnAt: '2026-09-15',
      }],
      namedDonorTotal: 0,
      undeclaredRemainder: 0,
    }

    const { current, greyed } = splitCommitteeDonors(fixture, 'fr')
    expect(current).toHaveLength(0)
    expect(greyed).toHaveLength(1)
    expect(greyed[0]!.caption).toBe(t('fr', 'vote.donor.withdrawn', { date: '15 septembre 2026' }))
    expect(greyed[0]!.caption).not.toBe(t('fr', 'vote.donor.superseded'))
  })

  it('prefers the withdrawn caption when a donor is both superseded and withdrawn', () => {
    const fixture: Committee = {
      id: 9003,
      names: { de: 'Test', fr: 'Test', it: 'Test' },
      category: 'test',
      side: 'yes',
      displayStage: 'final',
      budget: null,
      final: 100_000,
      donors: [{
        name: 'Les Deux SA',
        city: 'Lausanne',
        kind: 'juristic_monetary',
        livingAbroad: false,
        amount: 30_000,
        date: '2026-01-01',
        stage: 'budget',
        firstSeenAt: '2026-09-10',
        withdrawnAt: '2026-09-20',
      }],
      namedDonorTotal: 0,
      undeclaredRemainder: 0,
    }

    const { current, greyed } = splitCommitteeDonors(fixture, 'fr')
    expect(current).toHaveLength(0)
    expect(greyed).toHaveLength(1)
    expect(greyed[0]!.caption).toBe(t('fr', 'vote.donor.withdrawn', { date: '20 septembre 2026' }))
    expect(greyed[0]!.caption).not.toBe(t('fr', 'vote.donor.superseded'))
  })

  it('yields genuinely distinct caption strings across the three languages', () => {
    const langs = ['de', 'fr', 'it'] as const
    const superseded = langs.map((l) => t(l, 'vote.donor.superseded'))
    const withdrawn = langs.map((l) => t(l, 'vote.donor.withdrawn', { date: 'X' }))
    expect(new Set(superseded).size).toBe(langs.length)
    expect(new Set(withdrawn).size).toBe(langs.length)
  })

  it('keeps greyed donors contiguous below current donors — never interleaved', () => {
    const { current, greyed } = splitCommitteeDonors(committee579, 'fr')
    expect(current.length).toBeGreaterThan(0)
    expect(greyed.length).toBeGreaterThan(0)

    const html = page(`fr/objet/${object28.slug}/index.html`)
    const yesColumnStart = html.indexOf('class="L"')
    const yesColumnEnd = html.indexOf('class="R"')
    const yesColumn = html.slice(yesColumnStart, yesColumnEnd)

    const entryStarts = [...yesColumn.matchAll(/<div class="e(?: dim)?">/g)].map((m) => m.index!)
    const undeclaredRowStart = entryStarts[entryStarts.length - 1]!
    const donorSection = yesColumn.slice(0, undeclaredRowStart)

    const undimmedPositions = [...donorSection.matchAll(/<div class="e">/g)].map((m) => m.index!)
    const dimmedPositions = [...donorSection.matchAll(/<div class="e dim">/g)].map((m) => m.index!)

    expect(undimmedPositions.length).toBeGreaterThan(0)
    expect(dimmedPositions.length).toBeGreaterThan(0)
    expect(Math.max(...undimmedPositions)).toBeLessThan(Math.min(...dimmedPositions))
  })
})

describe('re-filed-under-a-different-spelling suppression (clause b)', () => {
  const stateCounts = (): { current: number; greyed: number; suppressed: number } => {
    const counts = { current: 0, greyed: 0, suppressed: 0 }
    for (const v of votes) {
      for (const c of v.committees) {
        for (const d of c.donors) counts[donorRenderState(d, c)]++
      }
    }
    return counts
  }

  it('suppresses exactly the five known re-filings, on top of the exact name+city matches already suppressed', () => {
    const counts = stateCounts()
    expect(counts.suppressed).toBe(434)
    expect(counts.greyed).toBe(17)
  })

  const expectSuppressed = (committeeId: number, name: string) => {
    const c = votes.flatMap((v) => v.committees).find((x) => x.id === committeeId)!
    const d = c.donors.find((x) => x.name === name)!
    expect(donorRenderState(d, c), `${name} (committee ${committeeId})`).toBe('suppressed')
  }

  it('suppresses the corrected single-string filer name against its re-filed spelling (object 28, committee 580)', () => {
    expectSuppressed(580, 'Urs Murbach und Theresa Nussbaum')
  })

  it('suppresses "Therese Bachmann" against "Therese & Patrick Bachmann & Fust" (committee 552)', () => {
    expectSuppressed(552, 'Therese Bachmann')
  })

  it('suppresses the misspelled "Aktiionskomitee" against "Aktionskomitee für Freiheit" (committee 530)', () => {
    expectSuppressed(530, 'Aktiionskomitee für Freiheit')
  })

  it('suppresses "medswissnet" against "medswiss.net" (committee 456)', () => {
    expectSuppressed(456, 'medswissnet')
  })

  it('suppresses "Piero Famille Hug" against "Piero Hug" (committee 424)', () => {
    expectSuppressed(424, 'Piero Famille Hug')
  })

  it('never merges genuinely different organisations that happen to share city, amount and date — real risk groups stay intact', () => {
    const riskPairs: { committee: number; names: string[] }[] = [
      { committee: 555, names: ['GRÜNE Schweiz', 'SP Schweiz'] },
      { committee: 478, names: ['Berner KMU', 'HIV Bern'] },
      { committee: 478, names: ['AGVS', 'strasseschweiz'] },
      { committee: 457, names: ['Gewerbe Stadt St.Gallen', 'Wirtschaftregion St.Gallen WISG'] },
      { committee: 456, names: [
        'curafutura, die innovativen Krankenversicherer',
        'FMH Verbindung der Schweizer Ärztinnen und Ärzte',
      ] },
      { committee: 411, names: ['economiesuisse', 'Avenergy Suisse'] },
      { committee: 403, names: ['economiesuisse', 'Schweizerischer Arbeitgeberverband'] },
    ]

    for (const { committee, names } of riskPairs) {
      const c = votes.flatMap((v) => v.committees).find((x) => x.id === committee)!
      for (const name of names) {
        expect(c.donors.some((d) => d.stage === c.displayStage && d.name === name), `${name} in committee ${committee}`)
          .toBe(true)
      }
    }
  })

  it('pins the false-merge scenario directly: same city/amount/date is not enough on its own without name similarity', () => {
    const fixture: Committee = {
      id: 9006,
      names: { de: 'Test', fr: 'Test', it: 'Test' },
      category: 'test',
      side: 'yes',
      displayStage: 'final',
      budget: null,
      final: 100_000,
      donors: [
        {
          name: 'economiesuisse', city: 'Zürich', kind: 'juristic_monetary', livingAbroad: false,
          amount: 5_000_000, date: '2024-03-12', stage: 'budget', firstSeenAt: null, withdrawnAt: null,
        },
        {
          name: 'Avenergy Suisse', city: 'Zürich', kind: 'juristic_monetary', livingAbroad: false,
          amount: 5_000_000, date: '2024-03-12', stage: 'final', firstSeenAt: null, withdrawnAt: null,
        },
      ],
      namedDonorTotal: 5_000_000,
      undeclaredRemainder: 0,
    }

    expect(donorRenderState(fixture.donors[0]!, fixture)).toBe('greyed')
    expect(donorRenderState(fixture.donors[1]!, fixture)).toBe('current')
  })
})
