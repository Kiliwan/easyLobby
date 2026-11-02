import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkFormShape, checkTreeShape, checkVotationContentShape, checkResultsShape, runContractCheck } from '../src/contract.js'
import type { RawNode, TreeResponse } from '../src/tree.js'

const load = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))
const fr: TreeResponse = load('./fixtures/trees/fr-campaign_financings.json')
const elections: TreeResponse = load('./fixtures/trees/fr-exports-elections.json')

describe('checkTreeShape', () => {
  it('passes the real tree fixture', () => {
    expect(checkTreeShape(load('./fixtures/trees/fr-campaign_financings.json'))).toEqual([])
  })

  it.each([
    [{}, 'tree_roots_present'],
    [{ data: {} }, 'tree_roots_present'],
    [{ data: { tree_roots: [] } }, 'tree_roots_non_empty'],
    [{ data: { tree_roots: [{ label: 'x', type: 'campaign_financing' }] } }, 'root_has_id'],
    [{ data: { tree_roots: [{ id: 1, type: 'campaign_financing' }] } }, 'root_has_label'],
  ])('fails %j with %s', (body, check) => {
    expect(checkTreeShape(body).map((f) => f.check)).toContain(check)
  })
})

describe('checkFormShape', () => {
  it('passes a real totals payload', () => {
    expect(checkFormShape(load('./fixtures/forms/607_111.json'))).toEqual([])
  })

  it('passes a real allowances payload', () => {
    expect(checkFormShape(load('./fixtures/forms/602_112.json'))).toEqual([])
  })

  it.each([
    [{}, 'form_data_present'],
    [{ data: { form_data: {} } }, 'checksum_present'],
    [{ data: { form_data: {} }, meta: { data_checksum_sha256: 'nothex' } }, 'checksum_is_sha256'],
    [{ data: { form_data: { totals: {} } }, meta: { data_checksum_sha256: 'a'.repeat(64) } },
     'totals_has_total'],
  ])('fails %j with %s', (body, check) => {
    expect(checkFormShape(body).map((f) => f.check)).toContain(check)
  })

  it('fails a payload with neither totals nor allowances', () => {
    const body = { data: { form_data: {} }, meta: { data_checksum_sha256: 'b'.repeat(64) } }
    expect(checkFormShape(body).map((f) => f.check)).toContain('has_totals_or_allowances')
  })

  it.each(['monetary_allowances', 'non_monetary_allowances', 'events', 'sales', 'equity'])(
    'fails when form_data.totals.%s is missing',
    (field) => {
      const totals: Record<string, string> = {
        total: 'CHF 1.00', monetary_allowances: 'CHF 1.00', non_monetary_allowances: 'CHF 0.00',
        events: 'CHF 0.00', sales: 'CHF 0.00', equity: 'CHF 0.00',
      }
      delete totals[field]
      const body = { data: { form_data: { totals } }, meta: { data_checksum_sha256: 'c'.repeat(64) } }
      expect(checkFormShape(body).map((f) => f.check)).toContain(`totals_has_${field}`)
    },
  )

  it('fails an allowance entry with no value', () => {
    const body = {
      data: { form_data: { allowances: { natural_monetary: [{ natural_name: 'X' }] } } },
      meta: { data_checksum_sha256: 'd'.repeat(64) },
    }
    expect(checkFormShape(body).map((f) => f.check)).toContain('allowance_entry_has_value')
  })

  it('fails an allowance entry with neither a natural nor a juristic name', () => {
    const body = {
      data: { form_data: { allowances: { natural_monetary: [{ value: '1.00' }] } } },
      meta: { data_checksum_sha256: 'e'.repeat(64) },
    }
    expect(checkFormShape(body).map((f) => f.check)).toContain('allowance_entry_has_name')
  })
})

describe('checkVotationContentShape', () => {
  it('finds no failures against the real fixture tree', () => {
    expect(checkVotationContentShape(fr, elections)).toEqual([])
  })

  it('the election exclusion is load-bearing: treating no root as an election flags real candidate-name campaigns', () => {
    const failures = checkVotationContentShape(fr, { data: { tree_roots: [] } })
    expect(failures.some((f) => f.check === 'campaign_label_recognised')).toBe(true)
  })

  it('flags an unrecognised campaign label on an in-scope votation', () => {
    const poisoned: TreeResponse = JSON.parse(JSON.stringify(fr))
    let poisonedCount = 0
    const recurse = (nodes: RawNode[]): boolean => {
      for (const node of nodes) {
        if (node.type === 'campaign') { node.label = 'Une nouvelle position inconnue'; poisonedCount += 1; return true }
        if (node.children && recurse(node.children)) return true
      }
      return false
    }
    recurse(poisoned.data.tree_roots)
    expect(poisonedCount).toBe(1)

    const failures = checkVotationContentShape(poisoned, elections)
    expect(failures).toContainEqual(
      expect.objectContaining({ check: 'campaign_label_recognised' }),
    )
  })

  it('flags an unrecognised form label anywhere in the tree', () => {
    const poisoned: TreeResponse = JSON.parse(JSON.stringify(fr))
    let poisonedCount = 0
    const recurse = (nodes: RawNode[]): boolean => {
      for (const node of nodes) {
        if (node.type === 'form') { node.label = 'Déclaration de quelque chose de nouveau'; poisonedCount += 1; return true }
        if (node.children && recurse(node.children)) return true
      }
      return false
    }
    recurse(poisoned.data.tree_roots)
    expect(poisonedCount).toBe(1)

    const failures = checkVotationContentShape(poisoned, elections)
    expect(failures).toContainEqual(
      expect.objectContaining({ check: 'form_label_recognised' }),
    )
  })
})

describe('checkResultsShape', () => {
  const good = () => ({
    abstimmtag: '20260614',
    schweiz: {
      vorlagen: [{
        vorlagenId: 6860,
        hauptvorlagenId: null,
        vorlagenArtId: 3,
        doppeltesMehr: true,
        vorlagenTitel: [{ langKey: 'de', text: 'x' }, { langKey: 'fr', text: 'y' }],
        resultat: { jaStimmenAbsolut: 1, neinStimmenAbsolut: 2, jaStimmenInProzent: 33.3 },
        staende: { jaStaendeGanz: 1, neinStaendeGanz: 2, jaStaendeHalb: 3, neinStaendeHalb: 4 },
      }],
    },
  })

  it('passes a payload shaped like the one we consume', () => {
    expect(checkResultsShape(good())).toEqual([])
  })

  it('flags a payload that is not the expected envelope', () => {
    expect(checkResultsShape(null)).toContainEqual(
      expect.objectContaining({ check: 'results_is_object' }))
    expect(checkResultsShape({ abstimmtag: '20260614', schweiz: {} })).toContainEqual(
      expect.objectContaining({ check: 'results_has_vorlagen' }))
  })

  it('flags the loss of hauptvorlagenId, which links a counter-project to its initiative', () => {
    const p = good()
    delete (p.schweiz.vorlagen[0] as Record<string, unknown>)['hauptvorlagenId']
    expect(checkResultsShape(p)).toContainEqual(
      expect.objectContaining({ check: 'vorlage_has_hauptvorlagenId' }))
  })

  it('flags the loss of the French title, which title matching depends on', () => {
    const p = good()
    p.schweiz.vorlagen[0]!.vorlagenTitel = [{ langKey: 'de', text: 'x' }]
    expect(checkResultsShape(p)).toContainEqual(
      expect.objectContaining({ check: 'vorlage_has_fr_title' }))
  })

  it('flags a missing half-canton count, which would silently skew the tally', () => {
    const p = good()
    delete (p.schweiz.vorlagen[0]!.staende as Record<string, unknown>)['jaStaendeHalb']
    expect(checkResultsShape(p)).toContainEqual(
      expect.objectContaining({ check: 'staende_has_jaStaendeHalb' }))
  })

  it('flags a vote count that stopped being a number', () => {
    const p = good()
    ;(p.schweiz.vorlagen[0]!.resultat as Record<string, unknown>)['jaStimmenAbsolut'] = '1234'
    expect(checkResultsShape(p)).toContainEqual(
      expect.objectContaining({ check: 'resultat_jaStimmenAbsolut_numeric' }))
  })
})

describe('runContractCheck', () => {
  const goodResults = {
    abstimmtag: '20260614',
    schweiz: {
      vorlagen: [{
        vorlagenId: 6860, hauptvorlagenId: null, vorlagenArtId: 3, doppeltesMehr: true,
        vorlagenTitel: [{ langKey: 'fr', text: 'y' }],
        resultat: { jaStimmenAbsolut: 1, neinStimmenAbsolut: 2, jaStimmenInProzent: 33.3 },
        staende: { jaStaendeGanz: 1, neinStaendeGanz: 2, jaStaendeHalb: 3, neinStaendeHalb: 4 },
      }],
    },
  }

  const fetcherFor = (results: unknown) => {
    const urls: string[] = []
    return {
      urls,
      getJson: async <T>(url: string): Promise<T> => {
        urls.push(url)
        if (url.includes('eidgAbstimmung')) return results as T
        if (url.includes('group_by=elections')) return elections as T
        if (url.includes('campaign_financings')) return fr as T
        return { data: { form_data: {} }, meta: { data_checksum_sha256: 'x'.repeat(64) } } as T
      },
    }
  }

  it('checks the ballot-results source, not only the register', async () => {
    const fetcher = fetcherFor(goodResults)
    await runContractCheck(fetcher)
    expect(fetcher.urls.filter((u) => u.includes('eidgAbstimmung'))).toHaveLength(1)
  })

  it('reports a results-shape regression as a contract failure', async () => {
    const broken = JSON.parse(JSON.stringify(goodResults))
    delete broken.schweiz.vorlagen[0].hauptvorlagenId
    const failures = await runContractCheck(fetcherFor(broken))
    expect(failures).toContainEqual(
      expect.objectContaining({ check: 'vorlage_has_hauptvorlagenId' }))
  })
})
