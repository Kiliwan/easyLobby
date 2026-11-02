import { describe, expect, it } from 'vitest'
import {
  assignVorlagen, buildVoteResults, isFinal, normaliseTitle, reduceBallotDay, refreshResults,
  ResultsShapeError, titleSimilarity,
  type BallotDay, type RawResultsPayload,
} from '../src/results.js'

const vorlage = (over: Record<string, unknown> = {}) => ({
  vorlagenId: 6800,
  hauptvorlagenId: null,
  vorlagenArtId: 3,
  vorlagenTitel: [
    { langKey: 'de', text: 'Volksinitiative «Für X»' },
    { langKey: 'fr', text: 'Initiative populaire « Pour X »' },
    { langKey: 'it', text: 'Iniziativa popolare «Per X»' },
    { langKey: 'rm', text: 'ignored' },
  ],
  vorlageBeendet: true,
  vorlageAngenommen: false,
  provisorisch: false,
  doppeltesMehr: true,
  staende: { jaStaendeGanz: 0, neinStaendeGanz: 20 },
  resultat: {
    gebietAusgezaehlt: true,
    jaStimmenInProzent: 15.854424512,
    jaStimmenAbsolut: 379638,
    neinStimmenAbsolut: 2014886,
    stimmbeteiligungInProzent: 42.94406305,
  },
  ...over,
})

const payload = (over: Record<string, unknown> = {}): RawResultsPayload => ({
  abstimmtag: '20251130',
  timestamp: '2026-02-27T18:34:29',
  schweiz: { vorlagen: [vorlage()] },
  ...over,
}) as RawResultsPayload

describe('reduceBallotDay', () => {
  it('converts the compact date to ISO and keeps only de/fr/it titles', () => {
    const day = reduceBallotDay(payload())
    expect(day.ballotDate).toBe('2025-11-30')
    expect(Object.keys(day.objects[0]!.titles).sort()).toEqual(['de', 'fr', 'it'])
  })

  it('carries the figures the site renders', () => {
    const o = reduceBallotDay(payload()).objects[0]!
    expect(o).toMatchObject({
      vorlagenId: 6800, mainId: 6800, kind: 'main', counted: true, accepted: false,
      doubleMajority: true, yesVotes: 379638, noVotes: 2014886, cantonsYes: 0, cantonsNo: 20,
    })
    expect(o.yesPct).toBeCloseTo(15.8544, 4)
  })

  it('labels a counter-project and a subsidiary question by their art id', () => {
    const day = reduceBallotDay(payload({
      schweiz: {
        vorlagen: [
          vorlage({ vorlagenId: 6821, vorlagenArtId: 4 }),
          vorlage({ vorlagenId: 6822, vorlagenArtId: 5, hauptvorlagenId: 6821 }),
          vorlage({ vorlagenId: 6823, vorlagenArtId: 6, hauptvorlagenId: 6821 }),
          vorlage({ vorlagenId: 6824, vorlagenArtId: 99, hauptvorlagenId: 6821 }),
        ],
      },
    }))
    expect(day.objects.map((o) => o.kind)).toEqual(['main', 'counterProject', 'subsidiary', 'related'])
    expect(day.objects.every((o) => o.mainId === 6821)).toBe(true)
  })

  it('treats a missing resultat as unknown rather than zero', () => {
    const day = reduceBallotDay(payload({
      schweiz: { vorlagen: [vorlage({ resultat: null, vorlageAngenommen: null })] },
    }))
    const o = day.objects[0]!
    expect(o.counted).toBe(false)
    expect(o.yesPct).toBeNull()
    expect(o.yesVotes).toBeNull()
    expect(o.accepted).toBeNull()
  })

  it('rejects a payload whose date is not 8 digits', () => {
    expect(() => reduceBallotDay(payload({ abstimmtag: '2025-11-30' }))).toThrow(ResultsShapeError)
  })

  it('rejects a payload with no vorlagen array', () => {
    expect(() => reduceBallotDay(payload({ schweiz: {} }))).toThrow(ResultsShapeError)
  })
})

describe('isFinal', () => {
  it('is false while any object is still uncounted, and false for an empty day', () => {
    const counted = reduceBallotDay(payload())
    expect(isFinal(counted)).toBe(true)

    const partial = reduceBallotDay(payload({
      schweiz: {
        vorlagen: [vorlage(), vorlage({ vorlagenId: 6801, resultat: { gebietAusgezaehlt: false } })],
      },
    }))
    expect(isFinal(partial)).toBe(false)
    expect(isFinal({ ballotDate: '2026-01-01', timestamp: '', objects: [] })).toBe(false)
  })
})

describe('titleSimilarity', () => {
  it('ignores the lead-in, accents, guillemets and curly apostrophes', () => {
    expect(titleSimilarity(
      'Pour une suisse qui s’engage (initiative service citoyen)',
      'Initiative populaire « Pour une suisse qui s\'engage (initiative service citoyen) »',
    )).toBe(1)
  })

  it('matches an EFK title that additionally names the counter-project', () => {
    const efk = 'Oui à une monnaie suisse libre et indépendante sous forme de pièces ou de billets ' +
      '(l’argent liquide, c’est la liberté) et contre-projet direct, à savoir l’arrêté fédéral ' +
      'sur la monnaie suisse et l’approvisionnement en numéraire'
    const bfs = 'Initiative populaire « Oui à une monnaie suisse libre et indépendante sous forme ' +
      'de pièces ou de billets (l’argent liquide, c’est la liberté) »'
    expect(titleSimilarity(efk, bfs)).toBe(1)
  })

  it('does not call two different objects from the same day a match', () => {
    expect(titleSimilarity(
      'Mieux vivre à la retraite (initiative pour une 13e rente AVS)',
      'Pour une prévoyance vieillesse sûre et pérenne (initiative sur les rentes)',
    )).toBeLessThan(0.75)
  })

  it('does not let a short common substring force a containment match', () => {
    expect(titleSimilarity('Pour X', 'Initiative populaire « Pour X et tout le reste du texte »'))
      .toBeLessThan(1)
  })

  it('normalises to a bare comparable string', () => {
    expect(normaliseTitle('Initiative populaire « Pour l’avenir! »')).toBe('pour l avenir')
  })
})

const dayWith = (objects: Partial<BallotDay['objects'][number]>[]): BallotDay => ({
  ballotDate: '2026-03-08',
  timestamp: 't',
  objects: objects.map((o) => ({
    vorlagenId: 1, mainId: 1, kind: 'main', titles: { fr: '' }, counted: true, provisional: false,
    accepted: false, doubleMajority: true, yesPct: 10, yesVotes: 1, noVotes: 9, turnoutPct: 40,
    cantonsYes: 0, cantonsNo: 20, cantonsYesHalf: 0, cantonsNoHalf: 6, ...o,
  })),
})

describe('assignVorlagen', () => {
  const day = dayWith([
    { vorlagenId: 6830, mainId: 6830, titles: { fr: 'Initiative populaire « 200 francs, ça suffit ! (initiative SSR) »' } },
    { vorlagenId: 6850, mainId: 6850, titles: { fr: 'Loi fédérale du 20 juin 2025 sur l’imposition individuelle' } },
    { vorlagenId: 6822, mainId: 6830, kind: 'counterProject', titles: { fr: '200 francs, ça suffit ! (initiative SSR)' } },
  ])

  it('matches a vote to the main object and never to a counter-project', () => {
    const { map, unmatched } = assignVorlagen(
      {}, [{ id: 24, frenchTitle: '200 francs, ça suffit ! (initiative SSR)', ballotDate: '2026-03-08' }], [day],
    )
    expect(map['24']).toBe(6830)
    expect(unmatched).toEqual([])
  })

  it('never re-decides a mapping it already holds', () => {
    const { map } = assignVorlagen(
      { '24': 9999 },
      [{ id: 24, frenchTitle: '200 francs, ça suffit ! (initiative SSR)', ballotDate: '2026-03-08' }],
      [day],
    )
    expect(map['24']).toBe(9999)
  })

  it('reports rather than guesses when no title is close enough', () => {
    const { map, unmatched } = assignVorlagen(
      {}, [{ id: 99, frenchTitle: 'Un objet totalement étranger à ce dimanche', ballotDate: '2026-03-08' }], [day],
    )
    expect(map['99']).toBeUndefined()
    expect(unmatched[0]!.reason).toMatch(/best title score/)
  })

  it('refuses an ambiguous match instead of taking the first', () => {
    const twins = dayWith([
      { vorlagenId: 1, mainId: 1, titles: { fr: 'Modification du 29 septembre 2023 du code des obligations (droit du bail)' } },
      { vorlagenId: 2, mainId: 2, titles: { fr: 'Modification du 29 septembre 2023 du code des obligations (droit du bail)' } },
    ])
    const { map, unmatched } = assignVorlagen(
      {},
      [{ id: 13, frenchTitle: 'Modification du 29 septembre 2023 du code des obligations (droit du bail)', ballotDate: '2026-03-08' }],
      [twins],
    )
    expect(map['13']).toBeUndefined()
    expect(unmatched[0]!.reason).toMatch(/ambiguous/)
  })

  it('says so when the ballot date has no published results', () => {
    const { unmatched } = assignVorlagen(
      {}, [{ id: 33, frenchTitle: 'Peu importe', ballotDate: '2026-11-29' }], [day],
    )
    expect(unmatched[0]!.reason).toMatch(/no results published/)
  })
})

describe('buildVoteResults', () => {
  const day = dayWith([
    { vorlagenId: 6821, mainId: 6821, kind: 'main', accepted: false, yesPct: 45.6 },
    { vorlagenId: 6823, mainId: 6821, kind: 'subsidiary', accepted: false, yesPct: 37.4 },
    { vorlagenId: 6822, mainId: 6821, kind: 'counterProject', accepted: true, yesPct: 73.4, provisional: true },
  ])

  it('groups the package under its main object, main first', () => {
    const out = buildVoteResults({ '23': 6821 }, [day])
    expect(out['23']!.bars.map((b) => b.kind)).toEqual(['main', 'counterProject', 'subsidiary'])
    expect(out['23']!.provisional).toBe(true)
  })

  it('withholds a result until the main object is counted', () => {
    const pending = dayWith([{ vorlagenId: 6880, mainId: 6880, counted: false, accepted: null, yesPct: null }])
    expect(buildVoteResults({ '31': 6880 }, [pending])).toEqual({})
  })

  it('skips a mapping whose object is not in any cached day', () => {
    expect(buildVoteResults({ '99': 12345 }, [day])).toEqual({})
  })
})

describe('refreshResults', () => {
  const fakeStore = (seed: Record<string, BallotDay> = {}) => {
    const written: BallotDay[] = []
    return {
      written,
      readResults: async (d: string) => seed[d] ?? null,
      writeResults: async (day: BallotDay) => { written.push(day) },
    }
  }

  it('does not request a date whose cached results are already final', async () => {
    const urls: string[] = []
    const store = fakeStore({ '2025-11-30': reduceBallotDay(payload()) })
    const summary = await refreshResults({
      fetcher: { getJsonOrNull: async <T>(u: string): Promise<T | null> => { urls.push(u); return null } },
      store, ballotDates: ['2025-11-30'], urlFor: (d) => `u/${d}`, absentStatuses: [403, 404],
    })
    expect(urls).toEqual([])
    expect(summary).toMatchObject({ fetched: 0, skipped: 1 })
  })

  it('records an unpublished date without treating it as a failure', async () => {
    const store = fakeStore()
    const summary = await refreshResults({
      fetcher: { getJsonOrNull: async <T>(): Promise<T | null> => null },
      store, ballotDates: ['2026-11-29'], urlFor: (d) => `u/${d}`, absentStatuses: [403, 404],
    })
    expect(summary.notPublished).toEqual(['2026-11-29'])
    expect(store.written).toEqual([])
  })

  it('refetches a date that is published but not yet fully counted', async () => {
    const partial = reduceBallotDay(payload({
      schweiz: { vorlagen: [vorlage({ resultat: { gebietAusgezaehlt: false } })] },
    }))
    const store = fakeStore({ '2025-11-30': partial })
    const summary = await refreshResults({
      fetcher: { getJsonOrNull: async <T>(): Promise<T | null> => payload() as T },
      store, ballotDates: ['2025-11-30'], urlFor: (d) => `u/${d}`, absentStatuses: [403, 404],
    })
    expect(summary.fetched).toBe(1)
    expect(store.written[0]!.ballotDate).toBe('2025-11-30')
  })

  it('refuses a payload served for a different ballot date', async () => {
    await expect(refreshResults({
      fetcher: { getJsonOrNull: async <T>(): Promise<T | null> => payload() as T },
      store: fakeStore(), ballotDates: ['2024-03-03'], urlFor: (d) => `u/${d}`, absentStatuses: [403],
    })).rejects.toThrow(ResultsShapeError)
  })

  it('requests each date once even when a date is listed by several votes', async () => {
    const urls: string[] = []
    const summary = await refreshResults({
      fetcher: { getJsonOrNull: async <T>(u: string): Promise<T | null> => { urls.push(u); return null } },
      store: fakeStore(),
      ballotDates: ['2026-11-29', '2026-11-29', '2026-11-29', '2026-11-29'],
      urlFor: (d) => `u/${d}`, absentStatuses: [403, 404],
    })
    expect(urls).toEqual(['u/2026-11-29'])
    expect(summary.notPublished).toEqual(['2026-11-29'])
  })
})
