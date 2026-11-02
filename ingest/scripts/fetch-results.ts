import { DATA_DIR, RESULTS_NOT_PUBLISHED, resultsUrl } from '../src/config.js'
import { Fetcher } from '../src/fetcher.js'
import type { NormalisedOutput } from '../src/model.js'
import { refreshResults } from '../src/results.js'
import { createStore } from '../src/store.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const votesPath = join(DATA_DIR, 'normalised', 'votes.json')
const output = JSON.parse(await readFile(votesPath, 'utf8')) as NormalisedOutput
const store = createStore(DATA_DIR, new Date().toISOString().slice(0, 10))

const summary = await refreshResults({
  fetcher: new Fetcher(),
  store,
  ballotDates: output.votes.map((v) => v.ballotDate),
  urlFor: resultsUrl,
  absentStatuses: RESULTS_NOT_PUBLISHED,
  log: (m) => console.log(m),
})

console.log(
  `done: ${summary.fetched} fetched, ${summary.skipped} already final, ` +
  `${summary.notPublished.length} not published (${summary.notPublished.join(', ') || 'none'})`,
)
