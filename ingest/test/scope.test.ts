import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { electionIds, inScopeRoots } from '../src/scope.js'
import { countByType, type TreeResponse } from '../src/tree.js'

const load = (p: string) =>
  JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as TreeResponse

const fr = load('./fixtures/trees/fr-campaign_financings.json')
const exportsElections = load('./fixtures/trees/fr-exports-elections.json')

describe('electionIds', () => {
  it('extracts exactly the four known election ids', () => {
    expect([...electionIds(exportsElections)].sort((a, b) => a - b)).toEqual([1, 2, 22, 27])
  })
})

describe('inScopeRoots', () => {
  const roots = inScopeRoots(fr, electionIds(exportsElections))

  it('keeps 29 votation objects out of 33 roots', () => {
    expect(fr.data.tree_roots).toHaveLength(33)
    expect(roots).toHaveLength(29)
  })

  it('excludes every election id', () => {
    const ids = new Set(roots.map((r) => r.id))
    for (const excluded of [1, 2, 22, 27]) expect(ids.has(excluded)).toBe(false)
  })

  it('reduces the form corpus from 1353 to 485', () => {
    expect(countByType(fr.data.tree_roots, 'form')).toBe(1353)
    expect(countByType(roots, 'form')).toBe(485)
  })

  it('keeps future objects that have no filings yet', () => {
    const ids = new Set(roots.map((r) => r.id))
    for (const empty of [33, 34, 35, 36, 23]) expect(ids.has(empty)).toBe(true)
  })
})
