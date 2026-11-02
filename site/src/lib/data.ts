import raw from '../../../data/normalised/votes.json' with { type: 'json' }
import { nameSimilarity } from './similarity.js'

export const LANGS = ['de', 'fr', 'it'] as const
export type Lang = (typeof LANGS)[number]
export type Side = 'yes' | 'no'
export type Stage = 'budget' | 'final'

export const REGISTER_APP_BASE = 'https://politikfinanzierung.efk.admin.ch/app'

export interface Donor {
  name: string
  city: string | null
  kind: string
  livingAbroad: boolean
  amount: number
  date: string | null
  stage: Stage
  firstSeenAt: string | null
  withdrawnAt: string | null
}

export interface Committee {
  id: number
  names: Record<Lang, string>
  category: string
  side: Side
  displayStage: Stage
  budget: number | null
  final: number | null
  donors: Donor[]
  namedDonorTotal: number
  undeclaredRemainder: number | null
}

export interface Vote {
  id: number
  slug: string
  ballotDate: string
  titles: Record<Lang, string>
  stage: Stage | 'none'
  totals: Record<Side, { budget: number | null; final: number | null }>
  committees: Committee[]
  sourceUrl: string
}

export type BallotKind = 'main' | 'counterProject' | 'subsidiary' | 'related'

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

export interface VoteResult {
  vorlagenId: number
  provisional: boolean
  bars: BallotObject[]
}

export interface NormalisedOutput {
  generatedAt: string
  votes: Vote[]
  results?: Record<string, VoteResult>
}

export function loadVotes(): NormalisedOutput {
  return raw as NormalisedOutput
}

export function resultFor(voteId: number): VoteResult | null {
  return loadVotes().results?.[String(voteId)] ?? null
}

export function cantonMajorityFailed(b: Pick<BallotObject, 'doubleMajority' | 'accepted' | 'yesPct'>): boolean {
  return b.doubleMajority && b.accepted === false && b.yesPct !== null && b.yesPct > 50
}

export function formatCantons(full: number | null, half: number | null): string {
  if (full === null) return '—'
  const halves = half ?? 0
  const whole = full + Math.floor(halves / 2)
  return halves % 2 === 1 ? `${whole}½` : String(whole)
}

export function voteBySlug(slug: string): Vote | undefined {
  return loadVotes().votes.find((v) => v.slug === slug)
}

export function sideTotals(vote: Pick<Vote, 'totals'>): Record<Side, number | null> {
  return {
    yes: vote.totals.yes.final ?? vote.totals.yes.budget,
    no: vote.totals.no.final ?? vote.totals.no.budget,
  }
}

export function committeeTotal(c: Pick<Committee, 'budget' | 'final'>): number | null {
  return c.final ?? c.budget
}

export type DonorRenderState = 'current' | 'greyed' | 'suppressed'

type RenderableDonor = Pick<Donor, 'stage' | 'withdrawnAt' | 'name' | 'city' | 'amount' | 'date'>
type RenderableCommittee = Pick<Committee, 'id' | 'displayStage'> & { donors: readonly RenderableDonor[] }

const loggedClauseBSuppressions = new Set<string>()

function logClauseBSuppression(
  committeeId: number,
  superseded: RenderableDonor,
  current: RenderableDonor,
  reason: string,
): void {
  const key = `${committeeId}|${superseded.name}|${superseded.city}|${superseded.amount}|${superseded.date}|${current.name}`
  if (loggedClauseBSuppressions.has(key)) return
  loggedClauseBSuppressions.add(key)
  console.log(
    `[dupe-suppress] committee ${committeeId}: "${superseded.name}" superseded by "${current.name}" ` +
    `(CHF rappen ${superseded.amount}, ${superseded.date}, ${superseded.city}) — matched via ${reason}`,
  )
}

export function donorRenderState(d: RenderableDonor, c: RenderableCommittee): DonorRenderState {
  if (d.withdrawnAt !== null) return 'greyed'
  if (d.stage === c.displayStage) return 'current'

  const currentDonors = c.donors.filter((o) => o.stage === c.displayStage && o.withdrawnAt === null)

  const exactMatch = currentDonors.some((o) => o.name === d.name && o.city === d.city)
  if (exactMatch) return 'suppressed'

  for (const o of currentDonors) {
    if (o.city !== d.city || o.amount !== d.amount || o.date !== d.date) continue
    const { similar, reason, ratio } = nameSimilarity(d.name, o.name)
    if (similar) {
      logClauseBSuppression(c.id, d, o, reason === 'sequence-ratio' ? `sequence-ratio(${ratio.toFixed(2)})` : reason!)
      return 'suppressed'
    }
  }

  return 'greyed'
}

export function isGreyedDonor(d: RenderableDonor, c: RenderableCommittee): boolean {
  return donorRenderState(d, c) !== 'current'
}
