import { fileURLToPath } from 'node:url'
import type { Lang } from './join.js'

export const API_BASE = 'https://politikfinanzierung.efk.admin.ch/api/frontend/v1'
export const APP_BASE = 'https://politikfinanzierung.efk.admin.ch/app'

export const USER_AGENT =
  'easyLobby/1.0 (static mirror of the EFK political financing register ' +
  'and of official federal ballot results; +https://github.com/Kiliwan/easyLobby)'

export const MIN_INTERVAL_MS = 1500
export const MAX_REQUESTS_PER_RUN = 600
export const MAX_CONSECUTIVE_FAILURES = 5
export const BACKOFF_MS = [5000, 15000, 45000] as const
export const WINDOW_DAYS = 270

export const DATA_DIR = fileURLToPath(new URL('../../data/', import.meta.url))

export const RESULTS_BASE = 'https://ogd-static.voteinfo-app.ch/v1/ogd'
export const RESULTS_NOT_PUBLISHED = [403, 404] as const

export const LAST_COUNTED_BALLOT_DATE = '2026-06-14'

export const resultsUrl = (ballotDate: string) =>
  `${RESULTS_BASE}/sd-t-17-02-${ballotDate.replaceAll('-', '')}-eidgAbstimmung.json`

export const treeUrl = (lang: Lang) => `${API_BASE}/${lang}/campaign_financings`
export const electionsExportUrl = () => `${API_BASE}/fr/exports?group_by=elections`
export const formUrl = (campaignId: number, formId: number) =>
  `${API_BASE}/fr/campaigns/${campaignId}/forms/${formId}`
export const sourcePageUrl = (voteId: number, lang: Lang = 'fr') =>
  `${APP_BASE}/${lang}/campaign-financings/${voteId}`
