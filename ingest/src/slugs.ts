export type SlugMap = Record<string, string>

const MAX_LENGTH = 80

export function slugify(frenchTitle: string): string {
  const base = frenchTitle
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (base.length <= MAX_LENGTH) return base

  const cut = base.slice(0, MAX_LENGTH)
  const lastDash = cut.lastIndexOf('-')
  return (lastDash > 0 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '')
}

export function assignSlugs(
  existing: SlugMap,
  votes: readonly { id: number; frenchTitle: string }[],
): SlugMap {
  const out: SlugMap = { ...existing }
  const claimed = new Set(Object.values(existing))

  for (const vote of votes) {
    const key = String(vote.id)
    if (out[key]) continue

    const base = slugify(vote.frenchTitle)
    let candidate = base
    let n = 1
    while (claimed.has(candidate)) {
      n += 1
      candidate = `${base}-${n}`
    }
    out[key] = candidate
    claimed.add(candidate)
  }

  return out
}
