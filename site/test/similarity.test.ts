import { describe, expect, it } from 'vitest'
import { nameSimilarity, sequenceMatcherRatio } from '../src/lib/similarity.js'

describe('nameSimilarity', () => {
  it('accepts identical token sets regardless of word order or repeated connective words', () => {
    const r = nameSimilarity('Urs Murbach und Theresa Nussbaum', 'Urs und Theresa Murbach und Nussbaum')
    expect(r.similar).toBe(true)
    expect(r.reason).toBe('token-set-equal')
  })

  it('accepts one token set as a subset of the other', () => {
    const r = nameSimilarity('Therese Bachmann', 'Therese & Patrick Bachmann & Fust')
    expect(r.similar).toBe(true)
    expect(r.reason).toBe('token-subset')
  })

  it('accepts a near-identical spelling via the sequence-ratio fallback', () => {
    const r = nameSimilarity('Aktiionskomitee für Freiheit', 'Aktionskomitee für Freiheit')
    expect(r.similar).toBe(true)
    expect(r.reason).toBe('sequence-ratio')
    expect(r.ratio).toBeGreaterThanOrEqual(0.9)
  })

  it('accepts a missing separator via the sequence-ratio fallback', () => {
    const r = nameSimilarity('medswissnet', 'medswiss.net')
    expect(r.similar).toBe(true)
    expect(r.reason).toBe('sequence-ratio')
  })

  it('accepts a dropped middle word as a token subset', () => {
    const r = nameSimilarity('Piero Famille Hug', 'Piero Hug')
    expect(r.similar).toBe(true)
    expect(r.reason).toBe('token-subset')
  })

  it('rejects genuinely different organisations sharing no tokens', () => {
    const r = nameSimilarity('economiesuisse', 'Avenergy Suisse')
    expect(r.similar).toBe(false)
    expect(r.reason).toBeNull()
  })

  it('rejects other genuinely distinct organisation pairs that happen to file under the same city/amount/date', () => {
    const pairs: [string, string][] = [
      ['Prométerre', 'AgorA'],
      ['GRÜNE Schweiz', 'SP Schweiz'],
      ['Berner KMU', 'HIV Bern'],
      ['AGVS', 'strasseschweiz'],
      ['Gewerbe Stadt St.Gallen', 'Wirtschaftregion St.Gallen WISG'],
      ['curafutura, die innovativen Krankenversicherer', 'FMH Verbindung der Schweizer Ärztinnen und Ärzte'],
      ['economiesuisse', 'Schweizerischer Arbeitgeberverband'],
    ]
    for (const [a, b] of pairs) {
      const r = nameSimilarity(a, b)
      expect(r.similar, `${a} vs ${b}`).toBe(false)
    }
  })

  it('does not use fuzzy logic beyond the three defined tests — a low-overlap pair stays rejected', () => {
    const r = nameSimilarity('Hans Müller', 'Hans Meier')
    expect(r.similar).toBe(false)
  })
})

describe('sequenceMatcherRatio', () => {
  it('is 1 for identical strings', () => {
    expect(sequenceMatcherRatio('abc', 'abc')).toBe(1)
  })

  it('is 0 for strings with no common characters', () => {
    expect(sequenceMatcherRatio('abc', 'xyz')).toBe(0)
  })

  it('is 1 for two empty strings', () => {
    expect(sequenceMatcherRatio('', '')).toBe(1)
  })

  it('matches a known difflib result', () => {
    expect(sequenceMatcherRatio('rain', 'train')).toBeCloseTo(8 / 9, 5)
  })
})
