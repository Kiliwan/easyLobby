import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { JoinMismatchError, joinLabels } from '../src/join.js'
import { indexByIdPath, type TreeResponse } from '../src/tree.js'

const load = (p: string) =>
  JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as TreeResponse
const fr = load('./fixtures/trees/fr-campaign_financings.json')
const de = load('./fixtures/trees/de-campaign_financings.json')

describe('tree parity', () => {
  it('has identical id-path sets and node types across languages', () => {
    const ifr = indexByIdPath(fr.data.tree_roots)
    const ide = indexByIdPath(de.data.tree_roots)
    expect(ifr.size).toBe(2411)
    expect(ide.size).toBe(2411)
    for (const [path, node] of ifr) {
      const other = ide.get(path)
      expect(other, `path ${path} missing in de`).toBeDefined()
      expect(other!.type).toBe(node.type)
    }
  })

  it('DOES differ in sibling order — the reason we join by id', () => {
    const frFirst = fr.data.tree_roots.find((r) => r.id === 28)!.children![0]!.children![0]!.id
    const deFirst = de.data.tree_roots.find((r) => r.id === 28)!.children![0]!.children![0]!.id
    expect(frFirst).toBe(452)
    expect(deFirst).toBe(454)
    expect(frFirst).not.toBe(deFirst)
  })
})

describe('joinLabels', () => {
  const labels = joinLabels({ fr, de })

  it('attaches each language label to the same id path', () => {
    const path = '28/0/452'
    expect(labels.get(path)!.fr).toBe('Alliance pour une Suisse qui fonctionne, Berne')
    expect(labels.get(path)!.de).toBe('Allianz für eine funktionierende Schweiz, Bern')
  })

  it('does NOT swap committee 452 and 454 — the positional-zip bug', () => {
    expect(labels.get('28/0/454')!.de).toBe('Allianz "Nein zur Chaos-Initiative", Bern')
    expect(labels.get('28/0/452')!.de).not.toContain('Chaos')
  })

  it('translates the ballot object title', () => {
    expect(labels.get('28')!.fr).toContain('Pas de Suisse à 10 millions')
    expect(labels.get('28')!.de).toContain('Keine 10-Millionen-Schweiz')
  })

  it('throws when a language tree has a path the reference tree lacks', () => {
    const rogue: TreeResponse = {
      data: { tree_roots: [{ id: 999, label: 'x', type: 'campaign_financing' }] },
    }
    expect(() => joinLabels({ fr, de: rogue })).toThrow(JoinMismatchError)
  })
})
