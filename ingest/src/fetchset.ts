import { WINDOW_DAYS } from './config.js'
import { trySplitRootLabel } from './dates.js'
import type { RawNode } from './tree.js'

export interface FormRef {
  voteId: number
  campaignId: number
  formId: number
  label: string
  ballotDate: string
}

export const formKeyOf = (ref: { campaignId: number; formId: number }): string =>
  `${ref.campaignId}_${ref.formId}`

export function allForms(roots: readonly RawNode[]): FormRef[] {
  const out: FormRef[] = []
  for (const root of roots) {
    const parsed = trySplitRootLabel(root.label)
    if (!parsed) continue
    const { ballotDate } = parsed
    for (const category of root.children ?? []) {
      for (const actor of category.children ?? []) {
        for (const campaign of actor.children ?? []) {
          for (const form of campaign.children ?? []) {
            out.push({
              voteId: root.id,
              campaignId: campaign.id,
              formId: form.id,
              label: form.label,
              ballotDate,
            })
          }
        }
      }
    }
  }
  return out
}

export function selectFetchSet(
  refs: readonly FormRef[],
  opts: { today: string; cached: ReadonlySet<string>; windowDays?: number },
): FormRef[] {
  const windowDays = opts.windowDays ?? WINDOW_DAYS
  const cutoffMs = Date.parse(`${opts.today}T00:00:00Z`) - windowDays * 86_400_000
  const cutoff = new Date(cutoffMs).toISOString().slice(0, 10)

  const seen = new Set<string>()
  const out: FormRef[] = []

  for (const ref of refs) {
    const key = formKeyOf(ref)
    if (seen.has(key)) continue
    const inWindow = ref.ballotDate >= cutoff
    const uncached = !opts.cached.has(key)
    if (inWindow || uncached) {
      seen.add(key)
      out.push(ref)
    }
  }

  return out
}
