export class MoneyParseError extends Error {
  constructor(input: string) {
    super(`Cannot parse money value: ${JSON.stringify(input)}`)
    this.name = 'MoneyParseError'
  }
}

const PATTERN = /^-?\d+(\.\d{1,2})?$/

export function parseRappen(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null
  const trimmed = input.trim()
  if (trimmed === '') return null

  const cleaned = trimmed
    .replace(/^CHF\s*/i, '')
    .replace(/['’ \s]/g, '')

  if (!PATTERN.test(cleaned)) throw new MoneyParseError(input)

  const negative = cleaned.startsWith('-')
  const [whole = '0', frac = ''] = cleaned.replace(/^-/, '').split('.')
  const rappen = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  return negative ? -rappen : rappen
}
