import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ClassificationError, classifyForm, classifySide, payloadOf, stageOf,
} from '../src/classify.js'
import { electionIds, inScopeRoots } from '../src/scope.js'
import { walk, type TreeResponse } from '../src/tree.js'

const load = (p: string) =>
  JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as TreeResponse
const fr = load('./fixtures/trees/fr-campaign_financings.json')
const elections = electionIds(load('./fixtures/trees/fr-exports-elections.json'))

describe('classifyForm', () => {
  it.each([
    ['Déclaration des recettes budgétées', 'budget_totals'],
    ['Déclaration du décompte final des recettes', 'final_totals'],
    ['Déclaration de libéralités supérieures à 15 000 francs', 'budget_allowances'],
    ['Déclaration de libéralités supérieures à 15 000 francs (décompte final)', 'final_allowances'],
    ['Déclaration de libéralités supérieures à 15 000 francs (y.c. étranger/anonymes)',
     'foreign_anonymous_allowances'],
  ])('classifies %s', (label, expected) => {
    expect(classifyForm(label)).toBe(expected)
  })

  it('throws on an unknown label rather than guessing', () => {
    expect(() => classifyForm('Déclaration de quelque chose de nouveau')).toThrow(ClassificationError)
  })

  it('classifies every form label present in the whole fixture tree', () => {
    walk(fr.data.tree_roots, (node) => {
      if (node.type === 'form') expect(() => classifyForm(node.label)).not.toThrow()
    })
  })

  it('does not classify by form id — the same label spans many ids', () => {
    const idsForBudget = new Set<number>()
    walk(fr.data.tree_roots, (node) => {
      if (node.type === 'form' && node.label === 'Déclaration des recettes budgétées') {
        idsForBudget.add(node.id)
      }
    })
    expect(idsForBudget.size).toBeGreaterThan(20)
  })
})

describe('stageOf / payloadOf', () => {
  it('maps kinds to stage and payload shape', () => {
    expect(stageOf('budget_totals')).toBe('budget')
    expect(stageOf('final_allowances')).toBe('final')
    expect(payloadOf('budget_totals')).toBe('totals')
    expect(payloadOf('budget_allowances')).toBe('allowances')
  })

  it('classifies the foreign/anonymous allowances label as budget stage, like the other undated allowances label', () => {
    expect(stageOf('foreign_anonymous_allowances')).toBe('budget')
  })
})

describe('classifySide', () => {
  it.each([
    ["Adoption de l'objet de la votation populaire", 'yes'],
    ["Rejet de l'objet de la votation populaire", 'no'],
  ])('classifies %s', (label, expected) => {
    expect(classifySide(label)).toBe(expected)
  })

  it('throws on a candidate-style label (election leakage)', () => {
    expect(() => classifySide('Gössi Petra (Schwytz, PLR.Les Libéraux-Radicaux)'))
      .toThrow(ClassificationError)
  })

  it('classifies every campaign in every in-scope votation', () => {
    const roots = inScopeRoots(fr, elections)
    let n = 0
    walk(roots, (node) => {
      if (node.type === 'campaign') { expect(() => classifySide(node.label)).not.toThrow(); n += 1 }
    })
    expect(n).toBe(159)
  })
})
