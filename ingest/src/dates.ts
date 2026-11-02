export class DateParseError extends Error {
  constructor(input: string) {
    super(`Cannot parse Swiss date: ${JSON.stringify(input)}`)
    this.name = 'DateParseError'
  }
}

const SWISS_DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/
const ROOT_PREFIX = /^(\d{2}\.\d{2}\.\d{4})\s+(.+)$/s

export function parseSwissDate(input: string): string {
  const m = SWISS_DATE.exec(input.trim())
  if (!m) throw new DateParseError(input)
  const [, dd, mm, yyyy] = m as unknown as [string, string, string, string]
  const day = Number(dd)
  const month = Number(mm)
  if (month < 1 || month > 12 || day < 1 || day > 31) throw new DateParseError(input)
  const iso = `${yyyy}-${mm}-${dd}`
  const check = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(check.getTime()) || check.getUTCDate() !== day) {
    throw new DateParseError(input)
  }
  return iso
}

export function splitRootLabel(label: string): { ballotDate: string; title: string } {
  const m = ROOT_PREFIX.exec(label.trim())
  if (!m) throw new DateParseError(label)
  const [, datePart, title] = m as unknown as [string, string, string]
  return { ballotDate: parseSwissDate(datePart), title: title.trim() }
}

export function trySplitRootLabel(label: string): { ballotDate: string; title: string } | null {
  try {
    return splitRootLabel(label)
  } catch (error) {
    if (error instanceof DateParseError) return null
    throw error
  }
}
