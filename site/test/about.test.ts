import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LANGS, loadVotes } from '../src/lib/data.js'
import { t } from '../src/i18n/index.js'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const page = (p: string) => readFileSync(`${dist}${p}`, 'utf8')
const decoded = (p: string) => page(p).replace(/&#39;/g, "'")

describe('about and root', () => {
  it('builds an about page per language', () => {
    for (const lang of LANGS) {
      expect(existsSync(`${dist}${lang}/a-propos/index.html`), lang).toBe(true)
    }
  })

  it('ships no JavaScript on the about page', () => {
    for (const lang of LANGS) {
      expect(page(`${lang}/a-propos/index.html`), lang).not.toMatch(/<script/i)
    }
  })

  it('explains the verbatim-donor policy in general terms, without naming a real donor', () => {
    for (const lang of LANGS) {
      const html = decoded(`${lang}/a-propos/index.html`)
      expect(html, lang).toContain(t(lang, 'about.p3'))
      expect(html, lang).not.toContain('economiesuisse')
      expect(html, lang).not.toContain('Economiesuisse')
    }
  })

  it('explains what greyed contributions mean, in general terms, without a real donor example', () => {
    for (const lang of LANGS) {
      const html = decoded(`${lang}/a-propos/index.html`)
      expect(html, lang).toContain(t(lang, 'about.p8superseded'))
      expect(html, lang).toContain(t(lang, 'about.p8withdrawn'))
      expect(html, lang).not.toContain('Thomas Matter')
      expect(html, lang).not.toContain('250 000')
      expect(html, lang).not.toContain('29.04.2026')
    }
  })

  it('states the CHF 50 000 disclosure and CHF 15 000 naming thresholds', () => {
    for (const lang of LANGS) {
      const html = page(`${lang}/a-propos/index.html`)
      expect(html, lang).toContain('50 000')
      expect(html, lang).toContain('15 000')
    }
  })

  it('states that "first recorded here" dates are ours, not the register\'s', () => {
    const notTheRegisters: Record<(typeof LANGS)[number], string> = {
      fr: 'pas celles du registre',
      de: 'nicht vom Register',
      it: 'non del registro',
    }
    for (const lang of LANGS) {
      expect(page(`${lang}/a-propos/index.html`), lang).toContain(notTheRegisters[lang])
    }
  })

  it('carries the same explanatory content in every language, untranslated placeholder-free', () => {
    for (const lang of LANGS) {
      const html = decoded(`${lang}/a-propos/index.html`)
      expect(html.toLowerCase()).not.toContain('todo')
      expect(html.toLowerCase()).not.toContain('lorem ipsum')
      expect(html).toContain(t(lang, 'about.p1'))
    }
  })

  it('offers three languages at the root, and only three', () => {
    const html = page('index.html')
    for (const lang of LANGS) expect(html).toContain(`/${lang}/`)
    expect(html).not.toContain('/en/')
  })

  it('redirects the root to German via meta-refresh', () => {
    const html = page('index.html')
    expect(html).toMatch(/<meta http-equiv="refresh" content="0; url=[^"]*\/de\/"/)
  })
})

describe('page-weight report', () => {
  it('reports total site size and the largest page', () => {
    const files: { path: string; bytes: number }[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name)
        if (entry.isDirectory()) walk(p)
        else if (entry.name.endsWith('.html')) files.push({ path: p, bytes: statSync(p).size })
      }
    }
    walk(dist)

    const total = files.reduce((s, f) => s + f.bytes, 0)
    const largest = files.reduce((a, b) => (b.bytes > a.bytes ? b : a))
    console.log(
      `pages: ${files.length}, total: ${(total / 1024).toFixed(0)} KB, ` +
        `mean: ${(total / files.length / 1024).toFixed(1)} KB, ` +
        `largest: ${largest.path.replace(dist, '')} at ${(largest.bytes / 1024).toFixed(1)} KB`,
    )

    const { votes } = loadVotes()
    const indexPage = 1
    const aboutPage = 1
    const pagesPerLanguage = indexPage + votes.length + aboutPage
    const rootRedirect = 1
    const expectedPageCount = LANGS.length * pagesPerLanguage + rootRedirect
    expect(files.length).toBe(expectedPageCount)
  })
})
