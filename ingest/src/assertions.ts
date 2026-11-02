import { ClassificationError, classifySide } from './classify.js'
import { DateParseError, splitRootLabel } from './dates.js'
import type { RawNode } from './tree.js'

export interface StructuralViolation {
  rule: string
  detail: string
}

export function checkStructure(roots: readonly RawNode[]): StructuralViolation[] {
  const violations: StructuralViolation[] = []
  const seenFormKeys = new Set<string>()

  for (const root of roots) {
    try {
      splitRootLabel(root.label)
    } catch (error) {
      if (!(error instanceof DateParseError)) throw error
      violations.push({
        rule: 'root_label_date_prefix',
        detail: `root ${root.id} label has no DD.MM.YYYY prefix: ${root.label}`,
      })
    }

    for (const category of root.children ?? []) {
      for (const actor of category.children ?? []) {
        const sides = new Set<string>()
        const perSide = new Map<string, number>()

        for (const campaign of actor.children ?? []) {
          let side: string
          try {
            side = classifySide(campaign.label)
          } catch (error) {
            if (!(error instanceof ClassificationError)) throw error
            violations.push({
              rule: 'campaign_side_recognised',
              detail: `root ${root.id} campaign ${campaign.id}: ${campaign.label}`,
            })
            continue
          }
          sides.add(side)
          perSide.set(side, (perSide.get(side) ?? 0) + 1)

          for (const form of campaign.children ?? []) {
            if (form.campaign_id !== undefined && form.campaign_id !== campaign.id) {
              violations.push({
                rule: 'form_campaign_id_matches_parent',
                detail: `form ${form.id} says campaign_id ${form.campaign_id}, parent is ${campaign.id}`,
              })
            }
            const key = `${campaign.id}/${form.id}`
            if (seenFormKeys.has(key)) {
              violations.push({ rule: 'form_key_unique', detail: `duplicate (campaign_id, form_id) ${key}` })
            }
            seenFormKeys.add(key)
          }
        }

        if (sides.size > 1) {
          violations.push({
            rule: 'actor_single_side',
            detail: `root ${root.id} actor ${actor.id} (${actor.label}) appears on both sides`,
          })
        }
        for (const [side, count] of perSide) {
          if (count > 1) {
            violations.push({
              rule: 'actor_single_campaign_per_side',
              detail: `root ${root.id} actor ${actor.id} has ${count} campaigns on side ${side}`,
            })
          }
        }
      }
    }
  }

  return violations
}
