import type { Lang } from './data.js'

const LOCALES: Record<Lang, string> = { de: 'de-CH', fr: 'fr-CH', it: 'it-CH' }
const GROUP_SEPARATOR = '’'

function formatGrouped(value: number, locale: string, options: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options)
    .formatToParts(value)
    .map((part) => (part.type === 'group' ? GROUP_SEPARATOR : part.value))
    .join('')
}

export function formatChf(rappen: number, lang: Lang): string {
  return formatGrouped(Math.round(rappen / 100), LOCALES[lang], { maximumFractionDigits: 0 })
}

export function formatChfCompact(rappen: number, lang: Lang): string {
  const francs = rappen / 100
  const locale = LOCALES[lang]
  if (Math.abs(francs) >= 1_000_000) {
    return `${formatGrouped(francs / 1_000_000, locale, { maximumFractionDigits: 2 })} mio`
  }
  if (Math.abs(francs) >= 10_000) {
    return `${formatGrouped(francs / 1000, locale, { maximumFractionDigits: 0 })} k`
  }
  return formatGrouped(francs, locale, { maximumFractionDigits: 0 })
}

export function formatDate(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALES[lang], {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`))
}

export function formatPercent(part: number, whole: number): string {
  if (whole === 0) return '0'
  return String(Math.round((part / whole) * 100))
}

export function formatPercent1(value: number, lang: Lang): string {
  return formatGrouped(value, LOCALES[lang], {
    minimumFractionDigits: 1, maximumFractionDigits: 1,
  })
}
