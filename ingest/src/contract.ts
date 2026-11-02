import { ClassificationError, classifyForm, classifySide } from './classify.js'
import { LAST_COUNTED_BALLOT_DATE, electionsExportUrl, formUrl, resultsUrl, treeUrl } from './config.js'
import { Fetcher } from './fetcher.js'
import { electionIds, inScopeRoots } from './scope.js'
import { walk, type RawNode, type TreeResponse } from './tree.js'

export interface ContractFailure {
  check: string
  detail: string
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const TOTALS_FIELDS = [
  'total', 'monetary_allowances', 'non_monetary_allowances', 'events', 'sales', 'equity',
] as const

export function checkTreeShape(body: unknown): ContractFailure[] {
  const out: ContractFailure[] = []
  const data = isObject(body) ? body['data'] : undefined
  const roots = isObject(data) ? data['tree_roots'] : undefined

  if (!Array.isArray(roots)) {
    return [{ check: 'tree_roots_present', detail: 'data.tree_roots is not an array' }]
  }
  if (roots.length === 0) {
    return [{ check: 'tree_roots_non_empty', detail: 'data.tree_roots is empty' }]
  }

  for (const root of roots) {
    if (!isObject(root)) {
      out.push({ check: 'root_is_object', detail: 'a tree root is not an object' })
      continue
    }
    if (typeof root['id'] !== 'number') out.push({ check: 'root_has_id', detail: 'root.id missing' })
    if (typeof root['label'] !== 'string') {
      out.push({ check: 'root_has_label', detail: 'root.label missing' })
    }
    if (root['type'] !== 'campaign_financing') {
      out.push({ check: 'root_type', detail: `root.type is ${String(root['type'])}` })
    }
  }
  return out
}

export function checkVotationContentShape(
  treeBody: unknown, electionsBody: unknown,
): ContractFailure[] {
  const out: ContractFailure[] = []
  const tree = treeBody as TreeResponse
  const elections = electionsBody as TreeResponse
  if (!Array.isArray(tree?.data?.tree_roots) || !Array.isArray(elections?.data?.tree_roots)) {
    return out
  }

  const inScope = inScopeRoots(tree, electionIds(elections))
  walk(inScope, (node) => {
    if (node.type !== 'campaign') return
    try {
      classifySide(node.label)
    } catch (error) {
      if (!(error instanceof ClassificationError)) throw error
      out.push({ check: 'campaign_label_recognised', detail: `campaign ${node.id}: ${node.label}` })
    }
  })

  const allRoots: readonly RawNode[] = tree.data.tree_roots
  walk(allRoots, (node) => {
    if (node.type !== 'form') return
    try {
      classifyForm(node.label)
    } catch (error) {
      if (!(error instanceof ClassificationError)) throw error
      out.push({ check: 'form_label_recognised', detail: `form ${node.id}: ${node.label}` })
    }
  })

  return out
}

function checkTotalsShape(totals: unknown): ContractFailure[] {
  const out: ContractFailure[] = []
  if (!isObject(totals)) {
    return [{ check: 'totals_is_object', detail: 'form_data.totals is not an object' }]
  }
  for (const field of TOTALS_FIELDS) {
    if (typeof totals[field] !== 'string') {
      out.push({ check: `totals_has_${field}`, detail: `form_data.totals.${field} is not a string` })
    }
  }
  return out
}

function checkAllowanceEntryShape(kind: string, entry: unknown): ContractFailure[] {
  const out: ContractFailure[] = []
  if (!isObject(entry)) {
    return [{ check: 'allowance_entry_is_object', detail: `${kind} entry is not an object` }]
  }
  if (typeof entry['value'] !== 'string') {
    out.push({ check: 'allowance_entry_has_value', detail: `${kind} entry.value is not a string` })
  }
  const hasName = typeof entry['juristic_name'] === 'string' || typeof entry['natural_name'] === 'string'
  if (!hasName) {
    out.push({ check: 'allowance_entry_has_name', detail: `${kind} entry has neither juristic_name nor natural_name` })
  }
  return out
}

function checkAllowancesShape(allowances: unknown): ContractFailure[] {
  const out: ContractFailure[] = []
  if (!isObject(allowances)) {
    return [{ check: 'allowances_is_object', detail: 'form_data.allowances is not an object' }]
  }
  for (const [kind, entries] of Object.entries(allowances)) {
    if (!Array.isArray(entries)) {
      out.push({ check: 'allowance_kind_is_array', detail: `form_data.allowances.${kind} is not an array` })
      continue
    }
    if (entries.length > 0) out.push(...checkAllowanceEntryShape(kind, entries[0]))
  }
  return out
}

export function checkFormShape(body: unknown): ContractFailure[] {
  const out: ContractFailure[] = []
  const data = isObject(body) ? body['data'] : undefined
  const formData = isObject(data) ? data['form_data'] : undefined

  if (!isObject(formData)) {
    return [{ check: 'form_data_present', detail: 'data.form_data missing' }]
  }

  const meta = isObject(body) ? body['meta'] : undefined
  const checksum = isObject(meta) ? meta['data_checksum_sha256'] : undefined
  if (typeof checksum !== 'string') {
    out.push({ check: 'checksum_present', detail: 'meta.data_checksum_sha256 missing' })
  } else if (!/^[0-9a-f]{64}$/.test(checksum)) {
    out.push({ check: 'checksum_is_sha256', detail: `not a sha256: ${checksum}` })
  }

  const totals = formData['totals']
  const allowances = formData['allowances']
  if (totals === undefined && allowances === undefined) {
    out.push({ check: 'has_totals_or_allowances', detail: 'form_data has neither key' })
  }
  if (totals !== undefined) out.push(...checkTotalsShape(totals))
  if (allowances !== undefined) out.push(...checkAllowancesShape(allowances))
  return out
}

export function checkResultsShape(body: unknown): ContractFailure[] {
  const out: ContractFailure[] = []
  if (!isObject(body)) return [{ check: 'results_is_object', detail: 'payload is not an object' }]
  if (typeof body['abstimmtag'] !== 'string') {
    out.push({ check: 'results_has_abstimmtag', detail: 'abstimmtag missing' })
  }
  const schweiz = body['schweiz']
  const vorlagen = isObject(schweiz) ? schweiz['vorlagen'] : undefined
  if (!Array.isArray(vorlagen) || vorlagen.length === 0) {
    return [...out, { check: 'results_has_vorlagen', detail: 'schweiz.vorlagen missing or empty' }]
  }

  const first = vorlagen[0]
  if (!isObject(first)) {
    return [...out, { check: 'vorlage_is_object', detail: 'a vorlage is not an object' }]
  }
  for (const field of ['vorlagenId', 'vorlagenArtId'] as const) {
    if (typeof first[field] !== 'number') {
      out.push({ check: `vorlage_has_${field}`, detail: `${field} is not a number` })
    }
  }
  if (!('hauptvorlagenId' in first)) {
    out.push({ check: 'vorlage_has_hauptvorlagenId', detail: 'hauptvorlagenId absent — counter-project linkage would be lost' })
  }
  if (typeof first['doppeltesMehr'] !== 'boolean') {
    out.push({ check: 'vorlage_has_doppeltesMehr', detail: 'doppeltesMehr is not a boolean' })
  }
  if (!Array.isArray(first['vorlagenTitel'])
      || !(first['vorlagenTitel'] as unknown[]).some((x) => isObject(x) && x['langKey'] === 'fr')) {
    out.push({ check: 'vorlage_has_fr_title', detail: 'no fr entry in vorlagenTitel — title matching would fail' })
  }

  const resultat = first['resultat']
  if (isObject(resultat)) {
    for (const field of ['jaStimmenAbsolut', 'neinStimmenAbsolut', 'jaStimmenInProzent'] as const) {
      if (resultat[field] !== undefined && typeof resultat[field] !== 'number') {
        out.push({ check: `resultat_${field}_numeric`, detail: `resultat.${field} is not a number` })
      }
    }
  }

  const staende = first['staende']
  if (isObject(staende)) {
    for (const field of ['jaStaendeGanz', 'neinStaendeGanz', 'jaStaendeHalb', 'neinStaendeHalb'] as const) {
      if (staende[field] === undefined) {
        out.push({ check: `staende_has_${field}`, detail: `staende.${field} absent — cantonal tally would be wrong` })
      }
    }
  }

  return out
}

export async function runContractCheck(
  fetcher: Pick<Fetcher, 'getJson'>,
  resultsDate = LAST_COUNTED_BALLOT_DATE,
): Promise<ContractFailure[]> {
  const failures: ContractFailure[] = []
  const tree = await fetcher.getJson(treeUrl('fr'))
  const elections = await fetcher.getJson(electionsExportUrl())
  failures.push(...checkTreeShape(tree))
  failures.push(...checkTreeShape(elections))
  failures.push(...checkVotationContentShape(tree, elections))
  failures.push(...checkFormShape(await fetcher.getJson(formUrl(607, 111))))
  failures.push(...checkFormShape(await fetcher.getJson(formUrl(602, 112))))
  failures.push(...checkResultsShape(await fetcher.getJson(resultsUrl(resultsDate))))
  return failures
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = await runContractCheck(new Fetcher({ maxRequests: 12 }))
  if (failures.length === 0) {
    console.log('contract OK')
  } else {
    for (const f of failures) console.error(`CONTRACT FAILURE ${f.check}: ${f.detail}`)
    process.exitCode = 1
  }
}
