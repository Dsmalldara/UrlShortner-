import { Hono } from 'hono'
import { registerUrlRoutes } from './routes/url.js'



export const createHono = (redirectStatus: 301 | 302 = 301) => {
    const app = new Hono()

registerUrlRoutes(app, redirectStatus)
    return app
}
