import {
  BACKOFF_MS, MAX_CONSECUTIVE_FAILURES, MAX_REQUESTS_PER_RUN, MIN_INTERVAL_MS, USER_AGENT,
} from './config.js'

export class RequestCapExceeded extends Error {
  constructor(cap: number) {
    super(`Request cap of ${cap} exceeded — this is a bug, not a big day at the register`)
    this.name = 'RequestCapExceeded'
  }
}

export class TooManyFailures extends Error {
  constructor(n: number) {
    super(`${n} consecutive request failures — aborting rather than hammering the server`)
    this.name = 'TooManyFailures'
  }
}

export interface FetcherOptions {
  minIntervalMs?: number
  maxRequests?: number
  maxConsecutiveFailures?: number
  backoffMs?: readonly number[]
  userAgent?: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export class Fetcher {
  #minIntervalMs: number
  #maxRequests: number
  #maxConsecutiveFailures: number
  #backoffMs: readonly number[]
  #userAgent: string
  #fetch: typeof fetch
  #sleep: (ms: number) => Promise<void>
  #now: () => number

  #count = 0
  #consecutiveFailures = 0
  #lastFinishedAt: number | null = null
  #queue: Promise<unknown> = Promise.resolve()

  constructor(opts: FetcherOptions = {}) {
    this.#minIntervalMs = opts.minIntervalMs ?? MIN_INTERVAL_MS
    this.#maxRequests = opts.maxRequests ?? MAX_REQUESTS_PER_RUN
    this.#maxConsecutiveFailures = opts.maxConsecutiveFailures ?? MAX_CONSECUTIVE_FAILURES
    this.#backoffMs = opts.backoffMs ?? BACKOFF_MS
    this.#userAgent = opts.userAgent ?? USER_AGENT
    this.#fetch = opts.fetchImpl ?? globalThis.fetch
    this.#sleep = opts.sleep ?? defaultSleep
    this.#now = opts.now ?? Date.now
  }

  get requestCount(): number {
    return this.#count
  }

  async getJson<T>(url: string): Promise<T> {
    const run = this.#queue.then(
      () => this.#getJsonSerial<T>(url, []),
      () => this.#getJsonSerial<T>(url, []),
    )
    this.#queue = run.catch(() => undefined)
    return run as Promise<T>
  }

  async getJsonOrNull<T>(url: string, absentStatuses: readonly number[]): Promise<T | null> {
    const run = this.#queue.then(
      () => this.#getJsonSerial<T>(url, absentStatuses),
      () => this.#getJsonSerial<T>(url, absentStatuses),
    )
    this.#queue = run.catch(() => undefined)
    return run
  }

  async #getJsonSerial<T>(url: string, absentStatuses: readonly number[]): Promise<T | null> {
    if (this.#consecutiveFailures >= this.#maxConsecutiveFailures) {
      throw new TooManyFailures(this.#consecutiveFailures)
    }

    let lastError: Error | undefined

    for (let attempt = 0; attempt <= this.#backoffMs.length; attempt += 1) {
      if (this.#count >= this.#maxRequests) throw new RequestCapExceeded(this.#maxRequests)

      await this.#respectInterval()
      this.#count += 1

      let response: Response
      try {
        response = await this.#fetch(url, { headers: { 'User-Agent': this.#userAgent } })
      } catch (cause) {
        lastError = new Error(`Network error for ${url}`, { cause })
        this.#lastFinishedAt = this.#now()
        await this.#backoff(attempt)
        continue
      }
      this.#lastFinishedAt = this.#now()

      if (absentStatuses.includes(response.status)) return null

      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status} for ${url}`)
        await this.#backoff(attempt)
        continue
      }

      if (!response.ok) {
        this.#recordFailure(new Error(`HTTP ${response.status} for ${url}`))
      }

      try {
        const parsed = (await response.json()) as T
        this.#consecutiveFailures = 0
        return parsed
      } catch (cause) {
        lastError = new Error(`Invalid JSON body for ${url}`, { cause })
        await this.#backoff(attempt)
        continue
      }
    }

    this.#recordFailure(lastError ?? new Error(`Request failed for ${url}`))
  }

  #recordFailure(fallback: Error): never {
    this.#consecutiveFailures += 1
    if (this.#consecutiveFailures >= this.#maxConsecutiveFailures) {
      throw new TooManyFailures(this.#consecutiveFailures)
    }
    throw fallback
  }

  async #respectInterval(): Promise<void> {
    if (this.#lastFinishedAt === null || this.#minIntervalMs <= 0) return
    const waited = this.#now() - this.#lastFinishedAt
    const remaining = this.#minIntervalMs - waited
    if (remaining > 0) await this.#sleep(remaining)
  }

  async #backoff(attempt: number): Promise<void> {
    const delay = this.#backoffMs[attempt]
    if (delay === undefined) return
    await this.#sleep(delay)
  }
}
