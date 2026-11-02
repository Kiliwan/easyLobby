import { describe, expect, it, vi } from 'vitest'
import { Fetcher, RequestCapExceeded, TooManyFailures } from '../src/fetcher.js'

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

function harness(responses: (() => Response)[]) {
  const calls: string[] = []
  const sleeps: number[] = []
  let i = 0
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    calls.push(String(url))
    const next = responses[Math.min(i, responses.length - 1)]!
    i += 1
    return next()
  }) as unknown as typeof fetch
  const sleep = async (ms: number) => { sleeps.push(ms) }
  return { calls, sleeps, fetchImpl, sleep }
}

describe('Fetcher', () => {
  it('returns parsed JSON', async () => {
    const h = harness([() => ok({ hello: 'world' })])
    const f = new Fetcher({ fetchImpl: h.fetchImpl, sleep: h.sleep })
    await expect(f.getJson<{ hello: string }>('https://x/1')).resolves.toEqual({ hello: 'world' })
  })

  it('sends the identifying User-Agent', async () => {
    const h = harness([() => ok({})])
    const f = new Fetcher({ fetchImpl: h.fetchImpl, sleep: h.sleep, userAgent: 'test-agent/1.0' })
    await f.getJson('https://x/1')
    const init = (h.fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('test-agent/1.0')
  })

  it('waits the minimum interval between requests but not before the first, driven by a deterministic clock', async () => {
    const h = harness([() => ok({})])
    let clock = 0
    const now = () => clock
    const sleep = async (ms: number) => {
      h.sleeps.push(ms)
      clock += ms
    }
    const f = new Fetcher({ fetchImpl: h.fetchImpl, sleep, minIntervalMs: 1500, now })
    await f.getJson('https://x/1')
    await f.getJson('https://x/2')
    await f.getJson('https://x/3')
    expect(h.sleeps).toEqual([1500, 1500])
  })

  it('sleeps only the remaining interval, not the full one, when more than the interval has already elapsed', async () => {
    const h = harness([() => ok({}), () => ok({})])
    let clock = 0
    const now = () => clock
    const sleep = async (ms: number) => { h.sleeps.push(ms) }
    const f = new Fetcher({ fetchImpl: h.fetchImpl, sleep, minIntervalMs: 1500, now })
    await f.getJson('https://x/1')
    clock += 5000
    await f.getJson('https://x/2')
    expect(h.sleeps).toEqual([])
  })

  it('is strictly sequential — never two requests in flight', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const log: string[] = []
    const fetchImpl = (async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      log.push(`start (inFlight=${inFlight})`)
      await Promise.resolve()
      inFlight -= 1
      log.push(`end (inFlight=${inFlight})`)
      return ok({})
    }) as unknown as typeof fetch
    const f = new Fetcher({ fetchImpl, sleep: async () => {}, minIntervalMs: 0 })
    await Promise.all([f.getJson('https://x/1'), f.getJson('https://x/2'), f.getJson('https://x/3')])
    console.log('sequential-execution log:', log, 'maxInFlight:', maxInFlight)
    expect(maxInFlight).toBe(1)
  })

  it('backs off 5s, 15s, 45s on 429 then succeeds', async () => {
    let n = 0
    const fetchImpl = (async () => {
      n += 1
      return n <= 2 ? new Response('', { status: 429 }) : ok({ done: true })
    }) as unknown as typeof fetch
    const sleeps: number[] = []
    const f = new Fetcher({ fetchImpl, sleep: async (ms) => { sleeps.push(ms) }, minIntervalMs: 0 })
    await expect(f.getJson('https://x/1')).resolves.toEqual({ done: true })
    expect(sleeps).toEqual([5000, 15000])
  })

  it('aborts after the backoff ladder is exhausted', async () => {
    const h = harness([() => new Response('', { status: 503 })])
    const f = new Fetcher({ fetchImpl: h.fetchImpl, sleep: h.sleep, minIntervalMs: 0 })
    await expect(f.getJson('https://x/1')).rejects.toThrow()
    expect(h.sleeps).toEqual([5000, 15000, 45000])
  })

  it('treats a 200 response with an HTML body as a retryable failure, going through the backoff ladder', async () => {
    const htmlPage = () =>
      new Response(
        '<!DOCTYPE html><html><head><title>404</title></head><body>Not Found</body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      )
    const h = harness([htmlPage])
    const f = new Fetcher({ fetchImpl: h.fetchImpl, sleep: h.sleep, minIntervalMs: 0 })
    await expect(f.getJson('https://x/1')).rejects.toThrow()
    expect(h.sleeps).toEqual([5000, 15000, 45000])
  })

  it('counts a 200 HTML-body failure toward TooManyFailures after 5 consecutive occurrences', async () => {
    const htmlPage = () =>
      new Response(
        '<!DOCTYPE html><html><head><title>404</title></head><body>Not Found</body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      )
    const h = harness([htmlPage])
    const f = new Fetcher({
      fetchImpl: h.fetchImpl, sleep: h.sleep, minIntervalMs: 0,
      backoffMs: [], maxConsecutiveFailures: 5, maxRequests: 1000,
    })
    for (let i = 0; i < 4; i += 1) {
      await expect(f.getJson(`https://x/${i}`)).rejects.toThrow()
    }
    await expect(f.getJson('https://x/5')).rejects.toThrow(TooManyFailures)
  })

  it('throws RequestCapExceeded past the hard cap', async () => {
    const h = harness([() => ok({})])
    const f = new Fetcher({ fetchImpl: h.fetchImpl, sleep: h.sleep, minIntervalMs: 0, maxRequests: 2 })
    await f.getJson('https://x/1')
    await f.getJson('https://x/2')
    await expect(f.getJson('https://x/3')).rejects.toThrow(RequestCapExceeded)
  })

  it('throws TooManyFailures after 5 consecutive failed urls', async () => {
    const h = harness([() => new Response('', { status: 500 })])
    const f = new Fetcher({
      fetchImpl: h.fetchImpl, sleep: h.sleep, minIntervalMs: 0,
      backoffMs: [], maxConsecutiveFailures: 5, maxRequests: 1000,
    })
    for (let i = 0; i < 4; i += 1) {
      await expect(f.getJson(`https://x/${i}`)).rejects.toThrow()
    }
    await expect(f.getJson('https://x/5')).rejects.toThrow(TooManyFailures)
  })

  it('resets the consecutive-failure counter on success, so alternating failures never trip the cap', async () => {
    let n = 0
    const fetchImpl = (async () => {
      n += 1
      return n % 2 === 1 ? new Response('', { status: 500 }) : ok({})
    }) as unknown as typeof fetch
    const f = new Fetcher({
      fetchImpl, sleep: async () => {}, minIntervalMs: 0, backoffMs: [], maxConsecutiveFailures: 2,
    })

    for (let i = 0; i < 20; i += 1) {
      if (i % 2 === 0) {
        let caught: unknown
        try {
          await f.getJson(`https://x/${i}`)
        } catch (err) {
          caught = err
        }
        expect(caught).toBeInstanceOf(Error)
        expect(caught).not.toBeInstanceOf(TooManyFailures)
      } else {
        await expect(f.getJson(`https://x/${i}`)).resolves.toEqual({})
      }
    }
  })

  it('contrast: two consecutive failures do throw TooManyFailures', async () => {
    const h = harness([() => new Response('', { status: 500 })])
    const f = new Fetcher({
      fetchImpl: h.fetchImpl, sleep: h.sleep, minIntervalMs: 0,
      backoffMs: [], maxConsecutiveFailures: 2,
    })
    await expect(f.getJson('https://x/1')).rejects.toThrow()
    await expect(f.getJson('https://x/2')).rejects.toThrow(TooManyFailures)
  })
})
