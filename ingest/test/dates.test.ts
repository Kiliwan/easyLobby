import { describe, expect, it } from 'vitest'
import { DateParseError, parseSwissDate, splitRootLabel, trySplitRootLabel } from '../src/dates.js'

describe('parseSwissDate', () => {
  it.each([
    ['23.12.2025', '2025-12-23'],
    ['01.01.2023', '2023-01-01'],
    ['29.07.2026', '2026-07-29'],
  ])('parses %s', (input, expected) => {
    expect(parseSwissDate(input)).toBe(expected)
  })

  it.each(['2025-12-23', '23/12/2025', '', '32.01.2025', '01.13.2025', '31.02.2025', '31.04.2025'])(
    'throws on %s',
    (input) => expect(() => parseSwissDate(input)).toThrow(DateParseError),
  )
})

describe('splitRootLabel', () => {
  it('splits the date prefix from the title', () => {
    expect(
      splitRootLabel('27.09.2026 Sauvegarder la neutralité suisse (initiative sur la neutralité)'),
    ).toEqual({
      ballotDate: '2026-09-27',
      title: 'Sauvegarder la neutralité suisse (initiative sur la neutralité)',
    })
  })

  it('handles a title containing further dates', () => {
    expect(
      splitRootLabel('14.06.2026 Modification du 26 septembre 2025 de la loi fédérale'),
    ).toEqual({
      ballotDate: '2026-06-14',
      title: 'Modification du 26 septembre 2025 de la loi fédérale',
    })
  })

  it('throws when the label has no date prefix', () => {
    expect(() => splitRootLabel('Some object')).toThrow(DateParseError)
  })
})

describe('trySplitRootLabel', () => {
  it('returns the same result as splitRootLabel for a well-formed label', () => {
    expect(trySplitRootLabel('27.09.2026 Sauvegarder la neutralité suisse')).toEqual({
      ballotDate: '2026-09-27',
      title: 'Sauvegarder la neutralité suisse',
    })
  })

  it('returns null instead of throwing when the label has no date prefix', () => {
    expect(trySplitRootLabel('Some object')).toBeNull()
  })
})
