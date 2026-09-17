import type { Hono } from 'hono'
import {
  Base62ToDecimal,
  base62Conversion,
  queryIdFromDb,
  queryLongUrlFromDb,
  storeLongUrlInDb,
} from '../store/store.js'

export const registerUrlRoutes = (app: Hono, redirectStatus: 301 | 302 = 301) => {
  app.post('/shorten', async (c) => {
    const { url } = c.req.query()
    if (!url) {
      return c.json({ error: 'Missing url parameter' }, 400)
    }

    const existingId = await queryIdFromDb(url)
    if (existingId !== null) {
      return c.json({ shortUrl: base62Conversion(existingId) }, 200)
    }

    const id = await storeLongUrlInDb(url)
    return c.json({ shortUrl: base62Conversion(id) }, 201)
  })

  app.get('/expand', async (c) => {
    const { shortUrl } = c.req.query()
    if (!shortUrl) {
      return c.json({ error: 'Missing shortUrl parameter' }, 400)
    }

    let id: number
    try {
      id = Base62ToDecimal(shortUrl)
    } catch {
      return c.json({ error: 'Short URL not found' }, 404)
    }
    const longUrl = await queryLongUrlFromDb(id)
    if (!longUrl) {
      return c.json({ error: 'Short URL not found' }, 404)
    }
    return c.redirect(longUrl, redirectStatus)
  })
}
