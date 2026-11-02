import { checkStructure, type StructuralViolation } from './assertions.js'
import { ClassificationError, classifyForm, classifySide, payloadOf, stageOf } from './classify.js'
import { sourcePageUrl } from './config.js'
import { DateParseError, parseSwissDate, splitRootLabel } from './dates.js'
import { LANGS, type Labels, type Lang } from './join.js'
import { donorKey, donorName, type DonorObservation } from './lifecycle.js'
import { MoneyParseError, parseRappen } from './money.js'
import type { Committee, Donor, NormalisedOutput, Stage, Vote } from './model.js'
import type { FormResponse } from './model.js'
import type { SlugMap } from './slugs.js'
import { pathKey, type IdPath, type RawNode } from './tree.js'

export interface NormaliseInput {
  roots: readonly RawNode[]
  labels: Map<IdPath, Labels>
  forms: Map<string, FormResponse>
  slugs: SlugMap
  generatedAt: string
  observations?: Map<string, DonorObservation>
}

const emptyLabels = (fallback: string): Labels =>
  Object.fromEntries(LANGS.map((l) => [l, fallback])) as Labels

export function normalise(input: NormaliseInput): {
  output: NormalisedOutput
  violations: StructuralViolation[]
} {
  const violations = checkStructure(input.roots)
  const votes: Vote[] = []

  for (const root of input.roots) {
    let ballotDate: string
    let frTitle: string
    try {
      const parsed = splitRootLabel(root.label)
      ballotDate = parsed.ballotDate
      frTitle = parsed.title
    } catch (error) {
      if (!(error instanceof DateParseError)) throw error
      continue
    }

    const rootLabels = input.labels.get(pathKey([root.id])) ?? emptyLabels(root.label)
    const titles = Object.fromEntries(
      LANGS.map((lang) => {
        try {
          return [lang, splitRootLabel(rootLabels[lang]).title]
        } catch (error) {
          if (!(error instanceof DateParseError)) throw error
          return [lang, frTitle]
        }
      }),
    ) as Record<Lang, string>

    const committees: Committee[] = []
    let sawBudget = false
    let sawFinal = false

    for (const category of root.children ?? []) {
      for (const actor of category.children ?? []) {
        for (const campaign of actor.children ?? []) {
          let side
          try {
            side = classifySide(campaign.label)
          } catch (error) {
            if (!(error instanceof ClassificationError)) throw error
            continue
          }

          const names = input.labels.get(pathKey([root.id, category.id, actor.id]))
            ?? emptyLabels(actor.label)

          let budget: number | null = null
          let final: number | null = null
          const donors: Donor[] = []

          for (const form of campaign.children ?? []) {
            const payload = input.forms.get(`${campaign.id}_${form.id}`)
            if (!payload) continue

            let kind
            try {
              kind = classifyForm(form.label)
            } catch (error) {
              if (!(error instanceof ClassificationError)) throw error
              violations.push({
                rule: 'form_label_recognised',
                detail: `campaign ${campaign.id} form ${form.id}: ${form.label}`,
              })
              continue
            }
            const stage: Stage = stageOf(kind)

            if (payloadOf(kind) === 'totals') {
              let total: number | null
              try {
                total = parseRappen(payload.data.form_data.totals?.['total'])
              } catch (error) {
                if (!(error instanceof MoneyParseError)) throw error
                violations.push({
                  rule: 'form_total_parseable',
                  detail: `campaign ${campaign.id} form ${form.id}: ${payload.data.form_data.totals?.['total']}`,
                })
                continue
              }
              if (total !== null) {
                if (stage === 'budget') { budget = total; sawBudget = true }
                else { final = total; sawFinal = true }
              }
              continue
            }

            for (const [donorKind, entries] of Object.entries(payload.data.form_data.allowances ?? {})) {
              for (const entry of entries) {
                let amount: number | null
                try {
                  amount = parseRappen(entry.value)
                } catch (error) {
                  if (!(error instanceof MoneyParseError)) throw error
                  violations.push({
                    rule: 'donor_amount_parseable',
                    detail: `campaign ${campaign.id} form ${form.id} donor ${donorName(entry)}: ${entry.value}`,
                  })
                  continue
                }
                if (amount === null) continue

                let date: string | null
                try {
                  date = entry.date ? parseSwissDate(entry.date) : null
                } catch (error) {
                  if (!(error instanceof DateParseError)) throw error
                  violations.push({
                    rule: 'donor_date_parseable',
                    detail: `campaign ${campaign.id} form ${form.id} donor ${donorName(entry)}: ${entry.date}`,
                  })
                  date = null
                }

                let observation: DonorObservation | undefined
                try {
                  observation = input.observations?.get(donorKey(campaign.id, form.id, entry))
                } catch (error) {
                  if (!(error instanceof DateParseError)) throw error
                  observation = undefined
                }

                donors.push({
                  name: donorName(entry),
                  city: entry.juristic_city ?? entry.natural_city ?? null,
                  kind: donorKind,
                  livingAbroad: entry.living_abroad === true,
                  amount,
                  date,
                  stage,
                  firstSeenAt: observation?.firstSeenAt ?? null,
                  withdrawnAt: observation?.withdrawnAt ?? null,
                })
              }
            }
          }

          const displayStage: Stage = donors.some((d) => d.stage === 'final') ? 'final' : 'budget'
          donors.sort((a, b) => b.amount - a.amount)

          const declaredTotal = final ?? budget
          const namedDonorTotal = donors
            .filter((d) => d.stage === displayStage)
            .reduce((sum, d) => sum + d.amount, 0)

          committees.push({
            id: campaign.id,
            names,
            category: category.label,
            side,
            budget,
            final,
            donors,
            displayStage,
            namedDonorTotal,
            undeclaredRemainder: declaredTotal === null ? null : declaredTotal - namedDonorTotal,
          })
        }
      }
    }

    const sum = (side: 'yes' | 'no', stage: 'budget' | 'final'): number | null => {
      const values = committees.filter((c) => c.side === side).map((c) => c[stage])
      const present = values.filter((v): v is number => v !== null)
      return present.length === 0 ? null : present.reduce((a, b) => a + b, 0)
    }

    committees.sort((a, b) => (b.final ?? b.budget ?? 0) - (a.final ?? a.budget ?? 0))

    votes.push({
      id: root.id,
      slug: input.slugs[String(root.id)] ?? String(root.id),
      ballotDate,
      titles,
      stage: sawFinal ? 'final' : sawBudget ? 'budget' : 'none',
      totals: {
        yes: { budget: sum('yes', 'budget'), final: sum('yes', 'final') },
        no: { budget: sum('no', 'budget'), final: sum('no', 'final') },
      },
      committees,
      sourceUrl: sourcePageUrl(root.id),
    })
  }

  votes.sort((a, b) => (a.ballotDate < b.ballotDate ? 1 : a.ballotDate > b.ballotDate ? -1 : a.id - b.id))

  return { output: { generatedAt: input.generatedAt, votes }, violations }
}
