import { describe, expect, it } from 'vitest'
import { assignSlugs, slugify, type SlugMap } from '../src/slugs.js'

describe('slugify', () => {
  it.each([
    ['Sauvegarder la neutralité suisse (initiative sur la neutralité)',
     'sauvegarder-la-neutralite-suisse-initiative-sur-la-neutralite'],
    ['Pas de Suisse à 10 millions ! (initiative pour la durabilité)',
     'pas-de-suisse-a-10-millions-initiative-pour-la-durabilite'],
    ['200 francs, ça suffit ! (initiative SSR)', '200-francs-ca-suffit-initiative-ssr'],
  ])('slugifies %s', (title, expected) => {
    expect(slugify(title)).toBe(expected)
  })

  it('truncates at a word boundary, never mid-word', () => {
    const long = 'Modification du 29 septembre 2023 du code des obligations (droit du bail: résiliation pour besoin propre)'
    const base = long
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    const s = slugify(long)
    expect(s.length).toBeLessThanOrEqual(80)
    expect(s.endsWith('-')).toBe(false)
    expect(base.startsWith(s)).toBe(true)
    if (base.length > s.length) {
      expect(base[s.length]).toBe('-')
    }
  })
})

describe('assignSlugs', () => {
  const tenancy = [
    { id: 13, frenchTitle: 'Modification du 29 septembre 2023 du code des obligations (droit du bail: sous-location)' },
    { id: 14, frenchTitle: 'Modification du 29 septembre 2023 du code des obligations (droit du bail: résiliation pour besoin propre)' },
  ]

  it('gives the two tenancy objects distinct slugs', () => {
    const map = assignSlugs({}, tenancy)
    expect(map['13']).toBeDefined()
    expect(map['14']).toBeDefined()
    expect(map['13']).not.toBe(map['14'])
  })

  it('deduplicates with a numeric suffix when slugs would collide', () => {
    const collide = [
      { id: 1, frenchTitle: 'Même titre' },
      { id: 2, frenchTitle: 'Même titre' },
      { id: 3, frenchTitle: 'Même titre' },
    ]
    const map = assignSlugs({}, collide)
    expect(map['1']).toBe('meme-titre')
    expect(map['2']).toBe('meme-titre-2')
    expect(map['3']).toBe('meme-titre-3')
  })

  it('never recomputes an existing assignment even if the title changes', () => {
    const existing: SlugMap = { '31': 'ancien-titre-publie' }
    const map = assignSlugs(existing, [{ id: 31, frenchTitle: 'Titre totalement réécrit' }])
    expect(map['31']).toBe('ancien-titre-publie')
  })

  it('does not collide a new object with an existing claimed slug', () => {
    const existing: SlugMap = { '10': 'meme-titre' }
    const map = assignSlugs(existing, [{ id: 11, frenchTitle: 'Même titre' }])
    expect(map['11']).toBe('meme-titre-2')
  })

  it('is stable across repeated runs', () => {
    const first = assignSlugs({}, tenancy)
    const second = assignSlugs(first, tenancy)
    expect(second).toEqual(first)
  })
})
