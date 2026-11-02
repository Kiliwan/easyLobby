import { describe, expect, it } from 'vitest'
import { MoneyParseError, parseRappen } from '../src/money.js'

describe('parseRappen', () => {
  it.each([
    ["CHF 2'000'000.00", 200_000_000],
    ["28'665.42", 2_866_542],
    ['0.00', 0],
    ['CHF 15’000.00', 1_500_000],
    ['1234', 123_400],
    ['  CHF 100.5  ', 10_050],
    ['-100.00', -10_000],
    ["-1'234.50", -123_450],
  ])('parses %s to %i rappen', (input, expected) => {
    expect(parseRappen(input)).toBe(expected)
  })

  it.each([null, undefined, '', '   '])('returns null for %s', (input) => {
    expect(parseRappen(input)).toBeNull()
  })

  it.each(['abc', 'CHF', '1.2.3', '12,50'])('throws on %s', (input) => {
    expect(() => parseRappen(input)).toThrow(MoneyParseError)
  })

  it('sums of parsed values are exact integer rappen', () => {
    const values = ['0.07', '0.14', '0.28', '0.55', '0.56'].map((s) => parseRappen(s)!)
    for (const v of values) expect(Number.isInteger(v)).toBe(true)
    expect(values.reduce((a, v) => a + v, 0)).toBe(160)
  })
})
