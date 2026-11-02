import { join } from 'node:path'
import type { StructuralViolation } from './assertions.js'
import { trySplitRootLabel } from './dates.js'
import { formKeyOf } from './fetchset.js'
import { joinLabels, LANGS, type Lang } from './join.js'
import { replaySnapshots } from './lifecycle.js'
import type { FormResponse, NormalisedOutput } from './model.js'
import { normalise } from './normalise.js'
import { assignVorlagen, buildVoteResults } from './results.js'
import { electionIds, inScopeRoots } from './scope.js'
import { assignSlugs } from './slugs.js'
import { createStore } from './store.js'
import type { TreeResponse } from './tree.js'

export interface BuildFromCacheDeps {
  dataDir: string
  now: Date
  log?: (msg: string) => void
}

export interface BuildFromCacheResult {
  output: NormalisedOutput
  violations: StructuralViolation[]
  formsCached: number
  displayStageFinalMismatchCount: number
  snapshotWarnings: string[]
  votesWithResult: number
}

export class MissingElectionsExportError extends Error {
  constructor(dataDir: string) {
    super(
      `no cached elections export at ${join(dataDir, 'raw', 'elections.json')} — ` +
      'run the ingest once (npm run start --workspace ingest) to populate it before ' +
      'running build-from-cache',
    )
    this.name = 'MissingElectionsExportError'
  }
}

export async function buildFromCache(deps: BuildFromCacheDeps): Promise<BuildFromCacheResult> {
  const log = deps.log ?? (() => {})
  const store = createStore(deps.dataDir, deps.now.toISOString().slice(0, 10))

  const trees: Partial<Record<Lang, TreeResponse>> = {}
  for (const lang of LANGS) {
    const tree = await store.readTree(lang)
    if (tree) trees[lang] = tree
  }
  if (!trees.fr) throw new Error(`no cached fr tree under ${deps.dataDir}`)

  const electionsExport = await store.readElections()
  if (!electionsExport) throw new MissingElectionsExportError(deps.dataDir)

  const elections = electionIds(electionsExport)
  const roots = inScopeRoots(trees.fr, elections)

  const slugs = assignSlugs(
    await store.readSlugs(),
    roots.flatMap((r) => {
      const parsed = trySplitRootLabel(r.label)
      return parsed ? [{ id: r.id, frenchTitle: parsed.title }] : []
    }),
  )
  await store.writeSlugs(slugs)

  const forms = new Map<string, FormResponse>()
  for (const cached of await store.listCachedForms()) {
    const payload = await store.readForm(cached)
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

  const days = await store.listCachedResults()
  const { map, unmatched } = assignVorlagen(
    await store.readVorlagen(),
    output.votes.map((v) => ({ id: v.id, frenchTitle: v.titles['fr'] ?? '', ballotDate: v.ballotDate })),
    days,
  )
  await store.writeVorlagen(map)
  for (const u of unmatched) log(`no result match for vote ${u.id}: ${u.reason}`)
  output.results = buildVoteResults(map, days)
  log(`results: ${Object.keys(output.results).length} votes with a result from ${days.length} cached day(s)`)

  const displayStageFinalMismatchCount = output.votes
    .flatMap((vote) => vote.committees)
    .filter((c) => c.displayStage === 'budget' && c.final !== null && c.namedDonorTotal > 0)
    .length

  await store.writeNormalised('votes.json', output)
  await store.writeNormalised('meta.json', {
    generatedAt: deps.now.toISOString(),
    votes: output.votes.length,
    formsFetched: 0,
    formsCached: forms.size,
    violations,
    displayStageFinalMismatchCount,
  })

  return {
    output, violations, formsCached: forms.size, displayStageFinalMismatchCount, snapshotWarnings,
    votesWithResult: Object.keys(output.results ?? {}).length,
  }
}
