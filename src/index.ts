import { serve } from '@hono/node-server'
import {createHono} from './createHono.js'
export const app = createHono()


app.get('/', (c) => {
  return c.text('Hello Hono!')
})


serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
