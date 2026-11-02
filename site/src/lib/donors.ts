import { donorRenderState, loadVotes, type Committee, type Donor, type Lang, type Vote } from './data.js'
import { formatDate } from './format.js'
import { t } from '../i18n/index.js'

export interface RenderDonor {
  name: string
  sub: string
  amount: number
  caption?: string
  observed?: string
  registerDate?: string
}

function subFor(d: Donor, c: Committee, lang: Lang): string {
  return [d.city, d.kind.startsWith('natural') ? t(lang, 'vote.naturalPerson') : null, c.names[lang]]
    .filter(Boolean).join(' · ')
}

export function hasVariedObservationDates(votes: readonly Pick<Vote, 'committees'>[]): boolean {
  const dates = new Set<string>()
  for (const vote of votes) {
    for (const c of vote.committees) {
      for (const d of c.donors) {
        if (d.firstSeenAt) dates.add(d.firstSeenAt)
        if (dates.size > 1) return true
      }
    }
  }
  return false
}

let cachedSiteHasVariedObservationDates: boolean | undefined

function observedFor(d: Donor, lang: Lang): string | undefined {
  if (!d.firstSeenAt) return undefined
  if (cachedSiteHasVariedObservationDates === undefined) {
    cachedSiteHasVariedObservationDates = hasVariedObservationDates(loadVotes().votes)
  }
  if (!cachedSiteHasVariedObservationDates) return undefined
  return t(lang, 'vote.donor.firstSeen', { date: formatDate(d.firstSeenAt, lang) })
}

function registerDateFor(d: Donor, lang: Lang): string | undefined {
  return d.date ? t(lang, 'vote.donor.registerDate', { date: formatDate(d.date, lang) }) : undefined
}

export function splitCommitteeDonors(c: Committee, lang: Lang): { current: RenderDonor[]; greyed: RenderDonor[] } {
  const current: RenderDonor[] = []
  const greyed: RenderDonor[] = []
  for (const d of c.donors) {
    const state = donorRenderState(d, c)
    if (state === 'suppressed') continue
    const sub = subFor(d, c, lang)
    const observed = observedFor(d, lang)
    const registerDate = registerDateFor(d, lang)
    if (state === 'current') {
      current.push({ name: d.name, sub, amount: d.amount, observed, registerDate })
      continue
    }
    const caption = d.withdrawnAt !== null
      ? t(lang, 'vote.donor.withdrawn', { date: formatDate(d.withdrawnAt, lang) })
      : t(lang, 'vote.donor.superseded')
    greyed.push({ name: d.name, sub, amount: d.amount, observed, registerDate, caption })
  }
  return { current, greyed }
}
