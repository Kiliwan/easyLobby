export type SimilarityReason = 'token-set-equal' | 'token-subset' | 'sequence-ratio'

export interface SimilarityResult {
  similar: boolean
  reason: SimilarityReason | null
  ratio: number
}

const COMBINING_DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g')

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(COMBINING_DIACRITICS, '')
}

function tokenSet(name: string): Set<string> {
  return new Set(stripDiacritics(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (!b.has(x)) return false
  return true
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && isSubset(a, b)
}

function findLongestMatch(
  a: string,
  alo: number,
  ahi: number,
  blo: number,
  bhi: number,
  b2j: Map<string, number[]>,
): [number, number, number] {
  let besti = alo
  let bestj = blo
  let bestsize = 0
  let j2len = new Map<number, number>()
  for (let i = alo; i < ahi; i++) {
    const newj2len = new Map<number, number>()
    const indices = b2j.get(a[i]!) ?? []
    for (const j of indices) {
      if (j < blo) continue
      if (j >= bhi) break
      const k = (j2len.get(j - 1) ?? 0) + 1
      newj2len.set(j, k)
      if (k > bestsize) {
        besti = i - k + 1
        bestj = j - k + 1
        bestsize = k
      }
    }
    j2len = newj2len
  }
  return [besti, bestj, bestsize]
}

function matchingLength(
  a: string,
  b: string,
  alo: number,
  ahi: number,
  blo: number,
  bhi: number,
  b2j: Map<string, number[]>,
): number {
  const [bi, bj, bsize] = findLongestMatch(a, alo, ahi, blo, bhi, b2j)
  if (bsize === 0) return 0
  let total = bsize
  if (alo < bi && blo < bj) total += matchingLength(a, b, alo, bi, blo, bj, b2j)
  if (bi + bsize < ahi && bj + bsize < bhi) total += matchingLength(a, b, bi + bsize, ahi, bj + bsize, bhi, b2j)
  return total
}

export function sequenceMatcherRatio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1
  const b2j = new Map<string, number[]>()
  for (let j = 0; j < b.length; j++) {
    const ch = b[j]!
    const list = b2j.get(ch)
    if (list) list.push(j)
    else b2j.set(ch, [j])
  }
  const matches = matchingLength(a, b, 0, a.length, 0, b.length, b2j)
  return (2 * matches) / (a.length + b.length)
}

export function nameSimilarity(a: string, b: string): SimilarityResult {
  const tokensA = tokenSet(a)
  const tokensB = tokenSet(b)

  if (setsEqual(tokensA, tokensB)) return { similar: true, reason: 'token-set-equal', ratio: 1 }
  if (isSubset(tokensA, tokensB) || isSubset(tokensB, tokensA)) {
    return { similar: true, reason: 'token-subset', ratio: 1 }
  }

  const sortedA = [...tokensA].sort().join(' ')
  const sortedB = [...tokensB].sort().join(' ')
  const ratio = sequenceMatcherRatio(sortedA, sortedB)
  if (ratio >= 0.9) return { similar: true, reason: 'sequence-ratio', ratio }
  return { similar: false, reason: null, ratio }
}
