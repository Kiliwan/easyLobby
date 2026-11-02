import type { Lang } from './join.js'

export type BallotKind = 'main' | 'counterProject' | 'subsidiary' | 'related'

export interface RawVorlage {
  vorlagenId: number
  hauptvorlagenId: number | null
  vorlagenArtId: number
  vorlagenTitel: { langKey: string; text: string }[]
  vorlageBeendet: boolean
  vorlageAngenommen: boolean | null
  provisorisch: boolean
  doppeltesMehr: boolean
  staende?: {
    jaStaendeGanz?: number
    neinStaendeGanz?: number
    jaStaendeHalb?: number
    neinStaendeHalb?: number
  } | null
  resultat?: {
    gebietAusgezaehlt?: boolean
    jaStimmenInProzent?: number
    jaStimmenAbsolut?: number
    neinStimmenAbsolut?: number
    stimmbeteiligungInProzent?: number
  } | null
}

export interface RawResultsPayload {
  abstimmtag: string
  timestamp: string
  schweiz: { vorlagen: RawVorlage[] }
}

export interface BallotObject {
  vorlagenId: number
  mainId: number
  kind: BallotKind
  titles: Record<string, string>
  counted: boolean
  provisional: boolean
  accepted: boolean | null
  doubleMajority: boolean
  yesPct: number | null
  yesVotes: number | null
  noVotes: number | null
  turnoutPct: number | null
  cantonsYes: number | null
  cantonsNo: number | null
  cantonsYesHalf: number | null
  cantonsNoHalf: number | null
}

export interface BallotDay {
  ballotDate: string
  timestamp: string
  objects: BallotObject[]
}

export interface VoteResult {
  vorlagenId: number
  provisional: boolean
  bars: BallotObject[]
}

export type VorlagenMap = Record<string, number>

export class ResultsShapeError extends Error {
  constructor(detail: string) {
    super(`Unexpected results payload shape: ${detail}`)
    this.name = 'ResultsShapeError'
  }
}

const KIND_BY_ART: Record<number, BallotKind> = { 5: 'counterProject', 6: 'subsidiary' }

const TITLE_LANGS: readonly Lang[] = ['de', 'fr', 'it']

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function reduceBallotDay(payload: RawResultsPayload): BallotDay {
  const ballotDate = payload.abstimmtag
  if (!/^\d{8}$/.test(ballotDate)) throw new ResultsShapeError(`abstimmtag ${JSON.stringify(ballotDate)}`)
  const vorlagen = payload.schweiz?.vorlagen
  if (!Array.isArray(vorlagen)) throw new ResultsShapeError('schweiz.vorlagen is not an array')

  const objects = vorlagen.map((v): BallotObject => {
    const titles: Record<string, string> = {}
    for (const lang of TITLE_LANGS) {
      const hit = v.vorlagenTitel?.find((t) => t.langKey === lang)
      if (hit) titles[lang] = hit.text
    }
    const r = v.resultat ?? {}
    return {
      vorlagenId: v.vorlagenId,
      mainId: v.hauptvorlagenId ?? v.vorlagenId,
      kind: v.hauptvorlagenId === null ? 'main' : KIND_BY_ART[v.vorlagenArtId] ?? 'related',
      titles,
      counted: r.gebietAusgezaehlt === true,
      provisional: v.provisorisch === true,
      accepted: typeof v.vorlageAngenommen === 'boolean' ? v.vorlageAngenommen : null,
      doubleMajority: v.doppeltesMehr === true,
      yesPct: num(r.jaStimmenInProzent),
      yesVotes: num(r.jaStimmenAbsolut),
      noVotes: num(r.neinStimmenAbsolut),
      turnoutPct: num(r.stimmbeteiligungInProzent),
      cantonsYes: num(v.staende?.jaStaendeGanz),
      cantonsNo: num(v.staende?.neinStaendeGanz),
      cantonsYesHalf: num(v.staende?.jaStaendeHalb),
      cantonsNoHalf: num(v.staende?.neinStaendeHalb),
    }
  })

  const iso = `${ballotDate.slice(0, 4)}-${ballotDate.slice(4, 6)}-${ballotDate.slice(6, 8)}`
  return { ballotDate: iso, timestamp: payload.timestamp, objects }
}

export function isFinal(day: BallotDay): boolean {
  return day.objects.length > 0 && day.objects.every((o) => o.counted)
}

const LEAD_IN = /^(initiative populaire|volksinitiative|iniziativa popolare)\s*/

export function normaliseTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u00ab\u00bb]/g, ' ')
    .replace(LEAD_IN, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const MIN_CONTAINMENT = 25

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i += 1) {
    const g = s.slice(i, i + 2)
    out.set(g, (out.get(g) ?? 0) + 1)
  }
  return out
}

export function titleSimilarity(a: string, b: string): number {
  const x = normaliseTitle(a)
  const y = normaliseTitle(b)
  if (x.length === 0 || y.length === 0) return 0
  if (x === y) return 1
  const shorter = x.length <= y.length ? x : y
  const longer = shorter === x ? y : x
  if (shorter.length >= MIN_CONTAINMENT && longer.includes(shorter)) return 1

  const ga = bigrams(x)
  const gb = bigrams(y)
  let shared = 0
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) ?? 0)
  const total = [...ga.values()].reduce((s, n) => s + n, 0) + [...gb.values()].reduce((s, n) => s + n, 0)
  return total === 0 ? 0 : (2 * shared) / total
}

export const MATCH_THRESHOLD = 0.75
export const MATCH_MARGIN = 0.05

export interface MatchCandidate {
  id: number
  frenchTitle: string
  ballotDate: string
}

export interface AssignResult {
  map: VorlagenMap
  unmatched: { id: number; reason: string }[]
}

export function assignVorlagen(
  existing: VorlagenMap,
  candidates: readonly MatchCandidate[],
  days: readonly BallotDay[],
): AssignResult {
  const map: VorlagenMap = { ...existing }
  const unmatched: { id: number; reason: string }[] = []
  const byDate = new Map(days.map((d) => [d.ballotDate, d]))

  for (const c of candidates) {
    if (map[String(c.id)] !== undefined) continue
    const day = byDate.get(c.ballotDate)
    if (!day) {
      unmatched.push({ id: c.id, reason: 'no results published for this ballot date' })
      continue
    }
    const mains = day.objects.filter((o) => o.kind === 'main')
    const scored = mains
      .map((o) => ({ o, score: titleSimilarity(c.frenchTitle, o.titles['fr'] ?? '') }))
      .sort((a, b) => b.score - a.score)

    const best = scored[0]
    if (!best || best.score < MATCH_THRESHOLD) {
      unmatched.push({ id: c.id, reason: `best title score ${(best?.score ?? 0).toFixed(2)}` })
      continue
    }
    const runnerUp = scored[1]
    if (runnerUp && best.score - runnerUp.score < MATCH_MARGIN) {
      unmatched.push({
        id: c.id,
        reason: `ambiguous: ${best.o.vorlagenId} (${best.score.toFixed(2)}) vs ` +
          `${runnerUp.o.vorlagenId} (${runnerUp.score.toFixed(2)})`,
      })
      continue
    }
    map[String(c.id)] = best.o.vorlagenId
  }

  return { map, unmatched }
}

export interface ResultsStore {
  readResults(ballotDate: string): Promise<BallotDay | null>
  writeResults(day: BallotDay): Promise<void>
}

export interface RefreshResultsDeps {
  fetcher: { getJsonOrNull<T>(url: string, absentStatuses: readonly number[]): Promise<T | null> }
  store: ResultsStore
  ballotDates: readonly string[]
  urlFor: (ballotDate: string) => string
  absentStatuses: readonly number[]
  log?: (msg: string) => void
}

export interface RefreshResultsSummary {
  fetched: number
  skipped: number
  notPublished: string[]
}

export async function refreshResults(deps: RefreshResultsDeps): Promise<RefreshResultsSummary> {
  const log = deps.log ?? (() => {})
  const summary: RefreshResultsSummary = { fetched: 0, skipped: 0, notPublished: [] }

  for (const date of [...new Set(deps.ballotDates)].sort()) {
    const cached = await deps.store.readResults(date)
    if (cached && isFinal(cached)) {
      summary.skipped += 1
      continue
    }
    const payload = await deps.fetcher.getJsonOrNull<RawResultsPayload>(
      deps.urlFor(date), deps.absentStatuses,
    )
    if (payload === null) {
      summary.notPublished.push(date)
      log(`results ${date}: not published yet`)
      continue
    }
    const day = reduceBallotDay(payload)
    if (day.ballotDate !== date) {
      throw new ResultsShapeError(`requested ${date} but payload is for ${day.ballotDate}`)
    }
    await deps.store.writeResults(day)
    summary.fetched += 1
    log(`results ${date}: ${day.objects.length} object(s), final=${isFinal(day)}`)
  }

  return summary
}

const KIND_ORDER: Record<BallotKind, number> = { main: 0, counterProject: 1, subsidiary: 2, related: 3 }

export function buildVoteResults(
  map: VorlagenMap,
  days: readonly BallotDay[],
): Record<string, VoteResult> {
  const objectsByMain = new Map<number, BallotObject[]>()
  for (const day of days) {
    for (const o of day.objects) {
      const list = objectsByMain.get(o.mainId) ?? []
      list.push(o)
      objectsByMain.set(o.mainId, list)
    }
  }

  const out: Record<string, VoteResult> = {}
  for (const [voteId, vorlagenId] of Object.entries(map)) {
    const bars = (objectsByMain.get(vorlagenId) ?? [])
      .slice()
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.vorlagenId - b.vorlagenId)
    if (bars.length === 0) continue
    const main = bars.find((b) => b.kind === 'main')
    if (!main?.counted) continue
    out[voteId] = {
      vorlagenId,
      provisional: bars.some((b) => b.provisional),
      bars,
    }
  }
  return out
}
