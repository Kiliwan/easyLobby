import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { allForms, formKeyOf, selectFetchSet } from '../src/fetchset.js'
import { electionIds, inScopeRoots } from '../src/scope.js'
import type { TreeResponse } from '../src/tree.js'

const load = (p: string) =>
  JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as TreeResponse
const fr = load('./fixtures/trees/fr-campaign_financings.json')
const roots = inScopeRoots(fr, electionIds(load('./fixtures/trees/fr-exports-elections.json')))
const refs = allForms(roots)

describe('allForms', () => {
  it('enumerates the 485 in-scope forms with their vote and ballot date', () => {
    expect(refs).toHaveLength(485)
    const one = refs.find((r) => r.campaignId === 602 && r.formId === 112)!
    expect(one.voteId).toBe(31)
    expect(one.ballotDate).toBe('2026-09-27')
  })

  it('skips a root whose label has no date prefix instead of throwing', () => {
    const malformed = {
      id: 999_001, label: 'No date prefix here', type: 'campaign_financing',
      children: [{
        id: 0, label: 'cat', type: 'actor_category',
        children: [{
          id: 1, label: 'Comité', type: 'actor',
          children: [{
            id: 2, label: "Adoption de l'objet de la votation populaire", type: 'campaign',
            children: [{ id: 3, label: 'Déclaration des recettes budgétées', type: 'form' }],
          }],
        }],
      }],
    }
    expect(() => allForms([...roots, malformed])).not.toThrow()
    const withBad = allForms([...roots, malformed])
    expect(withBad).toHaveLength(485)
    expect(withBad.some((r) => r.voteId === 999_001)).toBe(false)
  })
})

describe('selectFetchSet', () => {
  const today = '2026-09-09'

  it('on a cold cache fetches the entire in-scope corpus', () => {
    const set = selectFetchSet(refs, { today, cached: new Set() })
    expect(set).toHaveLength(485)
  })

  it('on a warm cache fetches only the 270-day window', () => {
    const cached = new Set(refs.map(formKeyOf))
    const set = selectFetchSet(refs, { today, cached })
    expect(set).toHaveLength(160)
  })

  it('always fetches an uncached form however old it is', () => {
    const cached = new Set(refs.map(formKeyOf))
    const oldRef = refs.find((r) => r.ballotDate < '2024-06-01')!
    cached.delete(formKeyOf(oldRef))
    const set = selectFetchSet(refs, { today, cached })
    expect(set.map(formKeyOf)).toContain(formKeyOf(oldRef))
  })

  it('includes future ballot dates regardless of window', () => {
    const cached = new Set(refs.map(formKeyOf))
    const set = selectFetchSet(refs, { today, cached })
    const future = refs.filter((r) => r.ballotDate > today)
    for (const r of future) expect(set.map(formKeyOf)).toContain(formKeyOf(r))
  })

  it('honours a narrower window', () => {
    const cached = new Set(refs.map(formKeyOf))
    expect(selectFetchSet(refs, { today, cached, windowDays: 180 })).toHaveLength(81)
  })

  it('never returns duplicates', () => {
    const set = selectFetchSet(refs, { today, cached: new Set() })
    expect(new Set(set.map(formKeyOf)).size).toBe(set.length)
  })
})
