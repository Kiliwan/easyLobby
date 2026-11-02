import de from './de.json' with { type: 'json' }
import fr from './fr.json' with { type: 'json' }
import it from './it.json' with { type: 'json' }

export const LANGS = ['de', 'fr', 'it'] as const
export type Lang = (typeof LANGS)[number]

const MESSAGES = { de, fr, it } satisfies Record<Lang, Record<string, string>>
export type MessageKey = keyof typeof fr

export function t(lang: Lang, key: MessageKey, vars: Record<string, string> = {}): string {
  const template = (MESSAGES[lang] as Record<string, string>)[key] ?? (fr as Record<string, string>)[key] ?? key
  return template.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? `{${name}}`)
}

export const messageKeys = (): string[] => Object.keys(fr)
export const messagesFor = (lang: Lang): Record<string, string> => MESSAGES[lang]
