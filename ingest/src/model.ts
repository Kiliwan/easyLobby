import type { Side, Stage } from './classify.js'
import type { VoteResult } from './results.js'

export type { Side, Stage } from './classify.js'

export interface AllowanceEntry {
  natural_first_name?: string
  natural_name?: string
  natural_city?: string
  juristic_name?: string
  juristic_city?: string
  living_abroad?: boolean
  value?: string
  date?: string
}

export interface FormResponse {
  data: {
    label: string
    actor_label: string
    form_label?: string
    campaign_label?: string
    download_path?: string
    form_data: {
      totals?: Record<string, string>
      allowances?: Record<string, AllowanceEntry[]>
    }
  }
  meta: { data_checksum_sha256: string }
}

export interface Donor {
  name: string
  city: string | null
  kind: string
  livingAbroad: boolean
  amount: number
  date: string | null
  stage: Stage
  firstSeenAt: string | null
  withdrawnAt: string | null
}

export interface Committee {
  id: number
  names: Record<string, string>
  category: string
  side: Side
  budget: number | null
  final: number | null
  donors: Donor[]
  displayStage: Stage
  namedDonorTotal: number
  undeclaredRemainder: number | null
}

export interface Vote {
  id: number
  slug: string
  ballotDate: string
  titles: Record<string, string>
  stage: Stage | 'none'
  totals: {
    yes: { budget: number | null; final: number | null }
    no: { budget: number | null; final: number | null }
  }
  committees: Committee[]
  sourceUrl: string
}

export interface NormalisedOutput {
  generatedAt: string
  votes: Vote[]
  results?: Record<string, VoteResult>
}
