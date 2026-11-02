import { join } from 'node:path'
import type { StructuralViolation } from './assertions.js'
import {
  DATA_DIR, RESULTS_NOT_PUBLISHED, electionsExportUrl, formUrl, resultsUrl, treeUrl,
} from './config.js'
import { trySplitRootLabel } from './dates.js'
import { Fetcher, RequestCapExceeded, TooManyFailures } from './fetcher.js'
import { allForms, formKeyOf, selectFetchSet } from './fetchset.js'
import { appendEvents, classifyChange, type HistoryEvent } from './history.js'
import { joinLabels, LANGS, type Lang } from './join.js'
import { replaySnapshots } from './lifecycle.js'
import type { FormResponse } from './model.js'
import { parseRappen } from './money.js'
import { normalise } from './normalise.js'
import { assignVorlagen, buildVoteResults, refreshResults } from './results.js'
import { electionIds, inScopeRoots } from './scope.js'
import { assignSlugs } from './slugs.js'
import { createStore, type Store } from './store.js'
import type { TreeResponse } from './tree.js'

export interface RunDeps {
  fetcher: Pick<Fetcher, 'getJson' | 'getJsonOrNull'>
  store: Store
  dataDir: string
  now: Date
  windowDays?: number
  log?: (msg: string) => void
}

export interface RunResult {
  votes: number
  formsFetched: number
  events: HistoryEvent[]
  violations: StructuralViolation[]
  snapshotWarnings: string[]
  resultsFetched: number
  votesWithResult: number
}

const totalOf = (payload: FormResponse): number | null =>
  parseRappen(payload.data.form_data.totals?.['total'])

export async function run(deps: RunDeps): Promise<RunResult> {
  const log = deps.log ?? (() => {})
  const today = deps.now.toISOString().slice(0, 10)

  const trees: Partial<Record<Lang, TreeResponse>> = {}
  for (const lang of LANGS) {
    const previous = await deps.store.readTree(lang)
    const tree = await deps.fetcher.getJson<TreeResponse>(treeUrl(lang))
    trees[lang] = tree
    const changed = JSON.stringify(previous) !== JSON.stringify(tree)
    await deps.store.writeTree(lang, tree, { snapshot: changed })
  }

  const previousElections = await deps.store.readElections()
  const electionsExport = await deps.fetcher.getJson<TreeResponse>(electionsExportUrl())
  const electionsChanged = JSON.stringify(previousElections) !== JSON.stringify(electionsExport)
  await deps.store.writeElections(electionsExport, { snapshot: electionsChanged })

  const elections = electionIds(electionsExport)
  const roots = inScopeRoots(trees.fr!, elections)
  log(`in scope: ${roots.length} votations`)

  const refs = allForms(roots)
  const cachedKeys = new Set((await deps.store.listCachedForms()).map(formKeyOf))
  const fetchSet = selectFetchSet(refs, {
    today,
    cached: cachedKeys,
    windowDays: deps.windowDays,
  })
  log(`fetching ${fetchSet.length} of ${refs.length} forms`)

  const events: HistoryEvent[] = []
  let formsFetched = 0

  for (const ref of fetchSet) {
    const key = { campaignId: ref.campaignId, formId: ref.formId }
    let payload: FormResponse
    try {
      payload = await deps.fetcher.getJson<FormResponse>(formUrl(ref.campaignId, ref.formId))
    } catch (error) {
      if (error instanceof TooManyFailures || error instanceof RequestCapExceeded) throw error
      log(`skip ${formKeyOf(ref)}: ${(error as Error).message}`)
      continue
    }
    formsFetched += 1

    const previous = await deps.store.readForm(key)
    const change = classifyChange(previous, payload)

    if (change === 'first_seen') {
      events.push({
        event: 'form_first_seen', voteId: ref.voteId, ...key,
        checksum: payload.meta.data_checksum_sha256, total: totalOf(payload),
      })
    } else if (change === 'data_changed') {
      events.push({
        event: 'form_changed', voteId: ref.voteId, ...key,
        checksum: payload.meta.data_checksum_sha256,
        previousChecksum: previous!.meta.data_checksum_sha256,
        total: totalOf(payload), previousTotal: totalOf(previous!),
      })
    } else if (change === 'label_only') {
      events.push({
        event: 'form_label_changed', voteId: ref.voteId, ...key,
        checksum: payload.meta.data_checksum_sha256,
        previousChecksum: previous!.meta.data_checksum_sha256,
      })
    }

    await deps.store.writeForm(key, payload, { snapshot: change !== 'unchanged' })
  }

  const liveKeys = new Set(refs.map(formKeyOf))
  for (const cached of await deps.store.listCachedForms()) {
    if (!liveKeys.has(formKeyOf(cached))) {
      events.push({ event: 'form_removed', voteId: -1, ...cached })
    }
  }

  const slugs = assignSlugs(
    await deps.store.readSlugs(),
    roots.flatMap((r) => {
      const parsed = trySplitRootLabel(r.label)
      return parsed ? [{ id: r.id, frenchTitle: parsed.title }] : []
    }),
  )
  await deps.store.writeSlugs(slugs)

  const forms = new Map<string, FormResponse>()
  for (const cached of await deps.store.listCachedForms()) {
    const payload = await deps.store.readForm(cached)
    if (payload) forms.set(formKeyOf(cached), payload)
  }

  const { observations, warnings: snapshotWarnings } = await replaySnapshots(join(deps.dataDir, 'snapshots'))
  for (const w of snapshotWarnings) log(`SNAPSHOT WARNING: ${w}`)

  const { output, violations } = normalise({
    roots,
    labels: joinLabels(trees),
    forms,
    slugs,
    generatedAt: deps.now.toISOString(),
    observations,
  })

  let resultsFetched = 0
  try {
    const refreshed = await refreshResults({
      fetcher: deps.fetcher,
      store: deps.store,
      ballotDates: output.votes.map((v) => v.ballotDate),
      urlFor: resultsUrl,
      absentStatuses: RESULTS_NOT_PUBLISHED,
      log,
    })
    resultsFetched = refreshed.fetched
    log(`results: ${refreshed.fetched} fetched, ${refreshed.skipped} already final`)
  } catch (error) {
    log(
      `RESULTS STEP SKIPPED (${(error as Error).name}): ${(error as Error).message} — ` +
      'keeping the cached results. The register archive from this run is unaffected.',
    )
  }

  const days = await deps.store.listCachedResults()
  const { map, unmatched } = assignVorlagen(
    await deps.store.readVorlagen(),
    output.votes.map((v) => ({ id: v.id, frenchTitle: v.titles['fr'] ?? '', ballotDate: v.ballotDate })),
    days,
  )
  await deps.store.writeVorlagen(map)
  for (const u of unmatched) log(`no result match for vote ${u.id}: ${u.reason}`)
  output.results = buildVoteResults(map, days)
  log(`results: ${Object.keys(output.results).length} votes with a result`)

  const displayStageFinalMismatchCount = output.votes
    .flatMap((vote) => vote.committees)
    .filter((c) => c.displayStage === 'budget' && c.final !== null && c.namedDonorTotal > 0)
    .length
  if (displayStageFinalMismatchCount > 0) {
    log(
      `INVARIANT displayStage/final mismatch: ${displayStageFinalMismatchCount} committee(s) ` +
      `show a budget-donor total alongside a non-null final total`,
    )
  }

  await deps.store.writeNormalised('votes.json', output)
  await deps.store.writeNormalised('meta.json', {
    generatedAt: deps.now.toISOString(),
    votes: output.votes.length,
    formsFetched,
    formsCached: forms.size,
    violations,
    displayStageFinalMismatchCount,
  })
  await appendEvents(deps.dataDir, events, deps.now)

  for (const v of violations) log(`STRUCTURAL VIOLATION ${v.rule}: ${v.detail}`)

  return {
    votes: output.votes.length, formsFetched, events, violations, snapshotWarnings,
    resultsFetched,
    votesWithResult: Object.keys(output.results ?? {}).length,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const now = new Date()
  const store = createStore(DATA_DIR, now.toISOString().slice(0, 10))
  const result = await run({
    fetcher: new Fetcher(),
    store,
    dataDir: DATA_DIR,
    now,
    log: (m) => console.log(m),
  })
  console.log(
    `done: ${result.votes} votes, ${result.formsFetched} forms fetched, ` +
    `${result.resultsFetched} ballot-result files fetched, ${result.votesWithResult} votes with a result, ` +
    `${result.events.length} events, ${result.violations.length} violations`,
  )
  if (result.violations.length > 0) process.exitCode = 1
}
