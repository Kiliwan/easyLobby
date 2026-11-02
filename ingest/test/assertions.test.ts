import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkStructure } from '../src/assertions.js'
import { electionIds, inScopeRoots } from '../src/scope.js'
import type { RawNode, TreeResponse } from '../src/tree.js'

const load = (p: string) =>
  JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as TreeResponse
const fr = load('./fixtures/trees/fr-campaign_financings.json')
const roots = inScopeRoots(fr, electionIds(load('./fixtures/trees/fr-exports-elections.json')))

describe('checkStructure', () => {
  it('finds no violations in the real in-scope tree', () => {
    expect(checkStructure(roots)).toEqual([])
  })

  it('flags a root label with no date prefix', () => {
    const bad: RawNode = { id: 900, label: 'No date here', type: 'campaign_financing', children: [] }
    expect(checkStructure([bad]).map((v) => v.rule)).toContain('root_label_date_prefix')
  })

  it('flags an unrecognised campaign side label', () => {
    const bad: RawNode = {
      id: 905, label: '01.01.2027 Test', type: 'campaign_financing',
      children: [{
        id: 0, label: 'cat', type: 'actor_category',
        children: [{
          id: 14, label: 'Comité W', type: 'actor',
          children: [
            { id: 500, label: 'Gössi Petra (Schwytz, PLR.Les Libéraux-Radicaux)', type: 'campaign', children: [] },
          ],
        }],
      }],
    }
    expect(checkStructure([bad]).map((v) => v.rule)).toContain('campaign_side_recognised')
  })

  it('flags an actor appearing on both sides of one object', () => {
    const bad: RawNode = {
      id: 901, label: '01.01.2027 Test', type: 'campaign_financing',
      children: [{
        id: 0, label: 'cat', type: 'actor_category',
        children: [{
          id: 10, label: 'Comité X', type: 'actor',
          children: [
            { id: 100, label: "Adoption de l'objet de la votation populaire", type: 'campaign', children: [] },
            { id: 101, label: "Rejet de l'objet de la votation populaire", type: 'campaign', children: [] },
          ],
        }],
      }],
    }
    expect(checkStructure([bad]).map((v) => v.rule)).toContain('actor_single_side')
  })

  it('flags a form whose campaign_id disagrees with its parent', () => {
    const bad: RawNode = {
      id: 902, label: '01.01.2027 Test', type: 'campaign_financing',
      children: [{
        id: 0, label: 'cat', type: 'actor_category',
        children: [{
          id: 11, label: 'Comité Y', type: 'actor',
          children: [{
            id: 200, label: "Adoption de l'objet de la votation populaire", type: 'campaign',
            children: [{ id: 1, label: 'Déclaration des recettes budgétées', type: 'form', campaign_id: 999 }],
          }],
        }],
      }],
    }
    expect(checkStructure([bad]).map((v) => v.rule)).toContain('form_campaign_id_matches_parent')
  })

  it('flags a duplicated (campaign_id, form_id) pair', () => {
    const form = { id: 1, label: 'Déclaration des recettes budgétées', type: 'form', campaign_id: 300 }
    const bad: RawNode = {
      id: 903, label: '01.01.2027 Test', type: 'campaign_financing',
      children: [{
        id: 0, label: 'cat', type: 'actor_category',
        children: [{
          id: 12, label: 'Comité Z', type: 'actor',
          children: [{
            id: 300, label: "Adoption de l'objet de la votation populaire", type: 'campaign',
            children: [{ ...form }, { ...form }],
          }],
        }],
      }],
    }
    expect(checkStructure([bad]).map((v) => v.rule)).toContain('form_key_unique')
  })

  it('flags an actor with multiple campaigns on the same side', () => {
    const bad: RawNode = {
      id: 904, label: '01.01.2027 Test', type: 'campaign_financing',
      children: [{
        id: 0, label: 'cat', type: 'actor_category',
        children: [{
          id: 13, label: 'Comité Multiple', type: 'actor',
          children: [
            { id: 400, label: "Adoption de l'objet de la votation populaire", type: 'campaign', children: [] },
            { id: 401, label: "Adoption de l'objet de la votation populaire (second)", type: 'campaign', children: [] },
          ],
        }],
      }],
    }
    expect(checkStructure([bad]).map((v) => v.rule)).toContain('actor_single_campaign_per_side')
  })
})
