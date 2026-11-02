import { committeeTotal, isGreyedDonor, type Side, type Vote } from './data.js'

export function pageScale(vote: Pick<Vote, 'committees'>): number {
  let max = 0
  const undeclaredBySide: Record<Side, number> = { yes: 0, no: 0 }

  for (const c of vote.committees) {
    max = Math.max(max, committeeTotal(c) ?? 0)
    undeclaredBySide[c.side] += c.undeclaredRemainder ?? 0
    for (const d of c.donors) {
      if (isGreyedDonor(d, c)) continue
      max = Math.max(max, d.amount)
    }
  }

  max = Math.max(max, undeclaredBySide.yes, undeclaredBySide.no)
  return max
}

export function barWidth(amount: number, scale: number): string {
  if (scale <= 0 || amount <= 0) return '0%'
  const pct = Math.min(100, (amount / scale) * 100)
  return `${Number(pct.toFixed(2))}%`
}
