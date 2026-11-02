import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_DIR } from '../src/config.js'
import { trySplitRootLabel } from '../src/dates.js'
import { joinLabels } from '../src/join.js'
import { replaySnapshots } from '../src/lifecycle.js'
import type { FormResponse, NormalisedOutput } from '../src/model.js'
import { normalise } from '../src/normalise.js'
import { electionIds, inScopeRoots } from '../src/scope.js'
import { assignSlugs } from '../src/slugs.js'
import { createStore } from '../src/store.js'
import type { TreeResponse } from '../src/tree.js'

const fixtures = fileURLToPath(new URL('../test/fixtures/', import.meta.url))
const load = (p: string) => JSON.parse(readFileSync(join(fixtures, p), 'utf8')) as TreeResponse

const fr = load('trees/fr-campaign_financings.json')
const de = load('trees/de-campaign_financings.json')
const roots = inScopeRoots(fr, electionIds(load('trees/fr-exports-elections.json')))

const forms = new Map<string, FormResponse>()
for (const name of readdirSync(join(fixtures, 'forms'))) {
  if (!name.endsWith('.json')) continue
  forms.set(name.replace(/\.json$/, ''),
    JSON.parse(readFileSync(join(fixtures, 'forms', name), 'utf8')) as FormResponse)
}

const store = createStore(DATA_DIR, new Date().toISOString().slice(0, 10))

const withFigures = (votes: NormalisedOutput['votes']) => votes.filter((v) => v.stage !== 'none').length
const votesPath = join(DATA_DIR, 'normalised', 'votes.json')
const force = process.argv.includes('--force')

const { observations, warnings: snapshotWarnings } = await replaySnapshots(join(DATA_DIR, 'snapshots'))
for (const w of snapshotWarnings) console.warn(`SNAPSHOT WARNING: ${w}`)
const slugs = assignSlugs(await store.readSlugs(),
  roots.flatMap((r) => {
    const parsed = trySplitRootLabel(r.label)
    return parsed ? [{ id: r.id, frenchTitle: parsed.title }] : []
  }))

const { output, violations } = normalise({
  roots, labels: joinLabels({ fr, de }), forms, slugs,
  generatedAt: new Date().toISOString(),
  observations,
})

if (existsSync(votesPath) && !force) {
  const existing = JSON.parse(readFileSync(votesPath, 'utf8')) as NormalisedOutput
  console.log(`refusing to overwrite ${votesPath} — pass --force to override`)
  console.log(`existing: ${existing.votes.length} votes, ${withFigures(existing.votes)} with figures`)
  console.log(`fixture-derived: ${output.votes.length} votes, ${withFigures(output.votes)} with figures`)
  process.exit(1)
}

await store.writeSlugs(slugs)
await store.writeNormalised('votes.json', output)
await store.writeNormalised('meta.json', {
  generatedAt: output.generatedAt,
  votes: output.votes.length,
  formsFetched: 0,
  formsCached: forms.size,
  violations,
})
console.log(`wrote ${output.votes.length} votes; ${violations.length} structural violations`)
console.log('NOTE: fixture-derived — it titles fall back to French, only 4 objects have figures')
