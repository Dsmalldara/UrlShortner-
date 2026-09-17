import http from 'k6/http'
import { check } from 'k6'

export const options = {
  vus: 1,
  iterations: 1,
}

export default function () {
  const response = http.get(
    'http://localhost:3000/expand?shortUrl=9',
    {
      redirects: 0,
    },
  )

  check(response, {
    'returns 301': (response) => response.status === 301,
    'sets Location header': (response) => response.headers.Location !== undefined,
  })
  const response2 = http.post('http://localhost:3000/shorten?url=https://example45.com',
  )
  check(response2, {
    'returns 201': (response2) => response2.status === 201,
  })
}
