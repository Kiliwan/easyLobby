import { buildFromCache } from '../src/buildFromCache.js'
import { DATA_DIR } from '../src/config.js'

const result = await buildFromCache({ dataDir: DATA_DIR, now: new Date(), log: (m) => console.log(m) })

const withFigures = result.output.votes.filter((v) => v.stage !== 'none').length
console.log(
  `wrote ${result.output.votes.length} votes (${withFigures} with figures) from ` +
  `${result.formsCached} cached forms; ${result.violations.length} structural violations`,
)
if (result.violations.length > 0) process.exitCode = 1
