import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Lang } from './join.js'
import type { TreeResponse } from './tree.js'
import type { FormResponse } from './model.js'
import type { BallotDay, VorlagenMap } from './results.js'
import type { SlugMap } from './slugs.js'

export interface FormKey {
  campaignId: number
  formId: number
}

export interface WriteOptions {
  snapshot?: boolean
}

export interface Store {
  readTree(lang: Lang): Promise<TreeResponse | null>
  writeTree(lang: Lang, body: unknown, opts?: WriteOptions): Promise<void>
  readElections(): Promise<TreeResponse | null>
  writeElections(body: unknown, opts?: WriteOptions): Promise<void>
  readForm(key: FormKey): Promise<FormResponse | null>
  writeForm(key: FormKey, body: unknown, opts?: WriteOptions): Promise<void>
  hasForm(key: FormKey): Promise<boolean>
  listCachedForms(): Promise<FormKey[]>
  readSlugs(): Promise<SlugMap>
  writeSlugs(slugs: SlugMap): Promise<void>
  readResults(ballotDate: string): Promise<BallotDay | null>
  writeResults(day: BallotDay): Promise<void>
  listCachedResults(): Promise<BallotDay[]>
  readVorlagen(): Promise<VorlagenMap>
  writeVorlagen(map: VorlagenMap): Promise<void>
  writeNormalised(name: string, body: unknown): Promise<void>
}

const formFile = (key: FormKey) => `${key.campaignId}_${key.formId}.json`

async function writeJson(path: string, body: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export function createStore(dataDir: string, today: string): Store {
  const rawTree = (lang: Lang) => join(dataDir, 'raw', 'trees', lang, 'campaign_financings.json')
  const rawForm = (key: FormKey) => join(dataDir, 'raw', 'forms', formFile(key))
  const rawElections = () => join(dataDir, 'raw', 'elections.json')
  const snapTree = (lang: Lang) =>
    join(dataDir, 'snapshots', today, 'trees', lang, 'campaign_financings.json')
  const snapForm = (key: FormKey) => join(dataDir, 'snapshots', today, 'forms', formFile(key))
  const snapElections = () => join(dataDir, 'snapshots', today, 'elections.json')
  const slugsPath = join(dataDir, 'slugs.json')
  const vorlagenPath = join(dataDir, 'vorlagen.json')
  const rawResults = (ballotDate: string) => join(dataDir, 'raw', 'results', `${ballotDate}.json`)

  return {
    readTree: (lang) => readJson<TreeResponse>(rawTree(lang)),

    async writeTree(lang, body, opts = {}) {
      await writeJson(rawTree(lang), body)
      if (opts.snapshot) await writeJson(snapTree(lang), body)
    },

    readElections: () => readJson<TreeResponse>(rawElections()),

    async writeElections(body, opts = {}) {
      await writeJson(rawElections(), body)
      if (opts.snapshot) await writeJson(snapElections(), body)
    },

    readForm: (key) => readJson<FormResponse>(rawForm(key)),

    async writeForm(key, body, opts = {}) {
      await writeJson(rawForm(key), body)
      if (opts.snapshot) await writeJson(snapForm(key), body)
    },

    async hasForm(key) {
      return (await readJson<unknown>(rawForm(key))) !== null
    },

    async listCachedForms() {
      let entries: string[]
      try {
        entries = await readdir(join(dataDir, 'raw', 'forms'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      }
      const FORM_FILE_NAME = /^(\d+)_(\d+)\.json$/
      return entries
        .map((name) => name.match(FORM_FILE_NAME))
        .filter((match): match is RegExpMatchArray => match !== null)
        .map((match) => ({ campaignId: Number(match[1]!), formId: Number(match[2]!) }))
    },

    async readSlugs() {
      return (await readJson<SlugMap>(slugsPath)) ?? {}
    },

    writeSlugs: (slugs) => writeJson(slugsPath, slugs),

    readResults: (ballotDate) => readJson<BallotDay>(rawResults(ballotDate)),

    writeResults: (day) => writeJson(rawResults(day.ballotDate), day),

    async listCachedResults() {
      let entries: string[]
      try {
        entries = await readdir(join(dataDir, 'raw', 'results'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      }
      const RESULT_FILE_NAME = /^(\d{4}-\d{2}-\d{2})\.json$/
      const days: BallotDay[] = []
      for (const name of entries.sort()) {
        if (!RESULT_FILE_NAME.test(name)) continue
        const day = await readJson<BallotDay>(join(dataDir, 'raw', 'results', name))
        if (day) days.push(day)
      }
      return days
    },

    async readVorlagen() {
      return (await readJson<VorlagenMap>(vorlagenPath)) ?? {}
    },

    writeVorlagen: (map) => writeJson(vorlagenPath, map),

    writeNormalised: (name, body) => writeJson(join(dataDir, 'normalised', name), body),
  }
}
