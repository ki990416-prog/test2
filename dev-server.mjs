// 내 PC에서 Vercel 배포 전에 미리 확인하는 간단한 개발용 서버.
//   1) .env.local 파일에 DATA_GO_KR_KEY=인증키 를 적는다 (이 파일은 GitHub에 올라가지 않는다)
//   2) node dev-server.mjs  →  http://localhost:3000
import http from 'node:http'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const here = new URL('.', import.meta.url)

// .env.local 을 아주 단순하게 읽는다 (이미 설정된 환경변수는 덮어쓰지 않는다)
try {
  for (const line of fs.readFileSync(new URL('.env.local', here), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {}

const handler = createRequire(import.meta.url)('./api/places.js')
const port = Number(process.env.PORT) || 3000

http.createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  // Vercel 의 res.status().json() 모양을 흉내 낸다
  res.status = code => { res.statusCode = code; return res }
  res.json = body => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)) }

  if (path === '/api/places') return handler(req, res)
  if (path === '/' || path === '/index.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.end(fs.readFileSync(new URL('index.html', here)))
  }
  res.statusCode = 404
  res.end('Not found')
}).listen(port, () => console.log('http://localhost:' + port + '  (종료: Ctrl + C)'))
