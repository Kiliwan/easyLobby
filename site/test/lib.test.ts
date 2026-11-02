import { describe, expect, it } from 'vitest'
import { loadVotes, sideTotals, voteBySlug } from '../src/lib/data.js'
import { hasVariedObservationDates } from '../src/lib/donors.js'
import { formatChf, formatChfCompact, formatDate, formatPercent } from '../src/lib/format.js'
import { barWidth, pageScale } from '../src/lib/scale.js'
import { LANGS, messageKeys, messagesFor, t } from '../src/i18n/index.js'

describe('loadVotes', () => {
  const data = loadVotes()

  it('loads all 29 in-scope votations', () => {
    expect(data.votes).toHaveLength(29)
  })

  it('sorts newest ballot date first', () => {
    const dates = data.votes.map((v) => v.ballotDate)
    expect([...dates].sort().reverse()).toEqual(dates)
  })

  it('finds a vote by slug', () => {
    const v = data.votes[0]!
    expect(voteBySlug(v.slug)!.id).toBe(v.id)
  })
})

describe('sideTotals', () => {
  it('prefers final over budget', () => {
    expect(sideTotals({
      totals: { yes: { budget: 100, final: 200 }, no: { budget: 300, final: null } },
    } as never)).toEqual({ yes: 200, no: 300 })
  })
})

const digitsOnly = (s: string): string => s.replace(/\D/g, '')

describe('formatChf', () => {
  it.each([
    [665_491_800, 'fr', '6654918', /^\d’\d{3}’\d{3}$/],
    [1_500_000, 'de', '15000', /^\d{2}’\d{3}$/],
  ])('formats %i for %s to the exact digits, grouped in threes with U+2019', (rappen, lang, expectedDigits, groupingShape) => {
    const out = formatChf(rappen, lang as never)
    expect(digitsOnly(out)).toBe(expectedDigits)
    expect(out).toMatch(groupingShape)
  })

  it('uses the apostrophe separator (U+2019) in every language, not the narrow no-break space (U+202F)', () => {
    for (const lang of ['de', 'fr', 'it'] as const) {
      const out = formatChf(665_491_800, lang)
      expect(out, lang).not.toContain(' ')
      expect(out, lang).toContain('’')
    }
  })

  it('rounds to whole francs — rappen are never displayed', () => {
    expect(formatChf(1_50, 'fr')).not.toContain('.')
  })
})

describe('formatChfCompact', () => {
  it('compacts millions to two decimal digits with an mio suffix', () => {
    const out = formatChfCompact(665_491_800, 'fr')
    expect(digitsOnly(out)).toBe('665')
    expect(out).toContain('mio')
  })

  it('compacts thousands to whole units with a k suffix', () => {
    const out = formatChfCompact(1_500_000, 'fr')
    expect(digitsOnly(out)).toBe('15')
    expect(out).toContain('k')
  })

  it('shows plain digits below the compacting thresholds', () => {
    expect(formatChfCompact(0, 'fr')).toBe('0')
  })
})

describe('formatDate', () => {
  it('formats an ISO date for the locale', () => {
    expect(formatDate('2026-06-14', 'de')).toContain('2026')
    expect(formatDate('2026-06-14', 'fr')).toContain('2026')
  })
})

describe('formatPercent', () => {
  it('rounds to whole percent', () => {
    expect(formatPercent(41, 100)).toBe('41')
  })
  it('returns 0 when the whole is zero', () => {
    expect(formatPercent(0, 0)).toBe('0')
  })
})

describe('pageScale / barWidth', () => {
  const vote = {
    committees: [
      { displayStage: 'final', budget: null, final: 617_306_158,
        donors: [{ amount: 457_156_000, stage: 'final', withdrawnAt: null }],
        undeclaredRemainder: 10 },
      { displayStage: 'final', budget: null, final: 190_172_400,
        donors: [{ amount: 30_141_000, stage: 'final', withdrawnAt: null }],
        undeclaredRemainder: 20 },
    ],
  } as never

  it('pegs the scale to the largest single amount on the page', () => {
    expect(pageScale(vote)).toBe(617_306_158)
  })

  it('excludes superseded donors from the scale', () => {
    const withSuperseded = {
      committees: [
        { displayStage: 'final', budget: null, final: 100_000,
          donors: [
            { amount: 50_000, stage: 'final', withdrawnAt: null },
            { amount: 900_000, stage: 'budget', withdrawnAt: null },
          ],
          undeclaredRemainder: 0 },
      ],
    } as never
    expect(pageScale(withSuperseded)).toBe(100_000)
  })

  it('pegs the scale to a per-column undeclared aggregate that exceeds every single amount', () => {
    const withBigColumnRemainder = {
      committees: [
        { side: 'no', displayStage: 'final', budget: null, final: 160_625_800,
          donors: [], undeclaredRemainder: 160_625_800 },
        { side: 'no', displayStage: 'final', budget: null, final: 154_664_357,
          donors: [{ amount: 100_000, stage: 'final', withdrawnAt: null }],
          undeclaredRemainder: 100_000_000 },
      ],
    } as never
    expect(pageScale(withBigColumnRemainder)).toBe(260_625_800)
  })

  it('excludes withdrawn donors from the scale', () => {
    const withWithdrawn = {
      committees: [
        { displayStage: 'final', budget: null, final: 100_000,
          donors: [
            { amount: 50_000, stage: 'final', withdrawnAt: null },
            { amount: 900_000, stage: 'final', withdrawnAt: '2026-10-01' },
          ],
          undeclaredRemainder: 0 },
      ],
    } as never
    expect(pageScale(withWithdrawn)).toBe(100_000)
  })

  it('returns a percentage width capped at 100', () => {
    expect(barWidth(617_306_200, 617_306_200)).toBe('100%')
    expect(barWidth(308_653_100, 617_306_200)).toBe('50%')
    expect(barWidth(999_999_999, 617_306_200)).toBe('100%')
  })

  it('clamps a negative amount to zero width', () => {
    expect(barWidth(-5_000, 617_306_200)).toBe('0%')
  })

  it('returns 0% when the scale is zero', () => {
    expect(barWidth(100, 0)).toBe('0%')
  })
})

describe('hasVariedObservationDates', () => {
  it('is false when every donor observation carries the same date', () => {
    const votes = [{ committees: [{ donors: [
      { firstSeenAt: '2026-09-10' }, { firstSeenAt: '2026-09-10' }, { firstSeenAt: null },
    ] }] }] as never
    expect(hasVariedObservationDates(votes)).toBe(false)
  })

  it('is true as soon as two distinct observation dates appear, even across different votes', () => {
    const votes = [
      { committees: [{ donors: [{ firstSeenAt: '2026-09-10' }] }] },
      { committees: [{ donors: [{ firstSeenAt: '2026-09-14' }] }] },
    ] as never
    expect(hasVariedObservationDates(votes)).toBe(true)
  })

  it('is false for an archive with no observations at all', () => {
    expect(hasVariedObservationDates([{ committees: [] }] as never)).toBe(false)
  })

  it('is currently false for the real site data — the archive only has one day of depth', () => {
    expect(hasVariedObservationDates(loadVotes().votes)).toBe(false)
  })
})

describe('t', () => {
  it('returns a string for every language for a known key', () => {
    for (const lang of ['de', 'fr', 'it'] as const) {
      expect(typeof t(lang, 'site.title')).toBe('string')
      expect(t(lang, 'site.title').length).toBeGreaterThan(0)
    }
  })

  it('has identical key sets across all three languages', () => {
    const reference = messageKeys().sort()
    for (const lang of LANGS) {
      expect(Object.keys(messagesFor(lang)).sort(), lang).toEqual(reference)
    }
  })

  it('returns a non-empty string for every key in every language', () => {
    for (const lang of LANGS) {
      for (const key of messageKeys()) {
        expect(t(lang, key as never), `${lang}.${key}`).not.toBe(key)
      }
    }
  })

  it('interpolates variables', () => {
    expect(t('fr', 'vote.viaCommittees', { n: '2' })).toBe('via 2 comités')
  })
})
