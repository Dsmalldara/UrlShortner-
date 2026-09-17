import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createHono } from '../createHono.js'

describe('URL routes', () => {
  it('creates a short URL for a new URL', async () => {
    const app = createHono()
    const longUrl = `https://create.example.test/${randomUUID()}`
    const response = await app.request(`/shorten?url=${encodeURIComponent(longUrl)}`, {
      method: 'POST',
    })

    expect(response.status).toBe(201)
    const body: { shortUrl: string } = await response.json()
    expect(body.shortUrl).toBeTypeOf('string')
    expect(body.shortUrl.length).toBeGreaterThan(0)
  })

  it('returns the existing short URL for a duplicate long URL', async () => {
    const app = createHono()
    const longUrl = `https://duplicate.example.test/${randomUUID()}`
    const request = `/shorten?url=${encodeURIComponent(longUrl)}`

    const firstResponse = await app.request(request, { method: 'POST' })
    const firstBody: { shortUrl: string } = await firstResponse.json()
    const secondResponse = await app.request(request, { method: 'POST' })
    const secondBody: { shortUrl: string } = await secondResponse.json()

    expect(firstResponse.status).toBe(201)
    expect(secondResponse.status).toBe(200)
    expect(secondBody.shortUrl).toBe(firstBody.shortUrl)
  })

  it('expands a short URL', async () => {
    const app = createHono()
    const longUrl = `https://expand.example.test/${randomUUID()}`
    const shortenResponse = await app.request(
      `/shorten?url=${encodeURIComponent(longUrl)}`,
      { method: 'POST' },
    )
    const shortenBody: { shortUrl: string } = await shortenResponse.json()
    const expandResponse = await app.request(
      `/expand?shortUrl=${shortenBody.shortUrl}`,
      { method: 'GET' },
    )

    expect(shortenResponse.status).toBe(201)
    expect(expandResponse.status).toBe(301)
    expect(expandResponse.headers.get('Location')).toBe(longUrl)
  })

  it('returns 404 for an unknown short URL', async () => {
    const app = createHono()
    const response = await app.request('/expand?shortUrl=zzzzzzz', {
      method: 'GET',
    })

    expect(response.status).toBe(404)
    const body: { error: string } = await response.json()
    expect(body.error).toBe('Short URL not found')
  })
})
