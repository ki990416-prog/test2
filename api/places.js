// Vercel 서버리스 함수: GET /api/places
// 공공데이터포털 API 2개(일반정보 + 위치정보)를 불러와 하나로 합쳐 돌려준다.
// 인증키는 환경변수 DATA_GO_KR_KEY 에서만 읽는다. (코드·화면·GitHub 어디에도 키를 쓰지 않는다)

const BASE = 'https://api.odcloud.kr/api'
const GENERAL = '/15109587/v1/uddi:56c2b3a4-4b4b-46cd-a1fa-f928ef731ffb' // 제주역사문화 일반정보
const LOCATION = '/15109570/v1/uddi:8781448b-81a8-487c-bc95-d26335bafa82' // 제주역사문화 위치정보
const PER_PAGE = 100
const MAX_PAGES = 20

class ApiError extends Error {
  constructor(code, message, status) {
    super(message)
    this.code = code
    this.status = status
  }
}

function getKey() {
  const raw = (process.env.DATA_GO_KR_KEY || '').trim()
  if (!raw) {
    throw new ApiError('KEY_MISSING', '서버에 인증키(DATA_GO_KR_KEY)가 설정되어 있지 않아요. Vercel 환경변수를 확인하고 다시 배포해 주세요.', 500)
  }
  // 포털에서 복사한 'Encoding 키'(%가 들어 있음)를 넣었더라도 동작하도록 한 번 풀어 준다.
  return raw.includes('%') ? decodeURIComponent(raw) : raw
}

async function fetchPage(path, key, page) {
  const url = new URL(BASE + path)
  url.searchParams.set('page', String(page))
  url.searchParams.set('perPage', String(PER_PAGE))
  url.searchParams.set('serviceKey', key)

  let res
  try {
    res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
  } catch {
    throw new ApiError('NETWORK', '공공데이터포털 서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.', 502)
  }
  if (res.status === 401 || res.status === 403) {
    throw new ApiError('AUTH', '공공데이터포털이 인증키를 받아주지 않았어요. 키 값과, 두 데이터(일반정보·위치정보)의 활용신청 승인 여부를 확인해 주세요.', 502)
  }
  if (res.status === 429) {
    throw new ApiError('QUOTA', '하루 호출 한도를 넘었어요. 내일 다시 시도해 주세요.', 502)
  }
  if (!res.ok) {
    throw new ApiError('UPSTREAM', '공공데이터포털에서 오류가 왔어요 (HTTP ' + res.status + ').', 502)
  }
  try {
    return await res.json()
  } catch {
    throw new ApiError('UPSTREAM', '공공데이터포털 응답을 읽지 못했어요.', 502)
  }
}

async function fetchAll(path, key) {
  const rows = []
  let total = Infinity
  for (let page = 1; page <= MAX_PAGES && rows.length < total; page++) {
    const json = await fetchPage(path, key, page)
    if (!Array.isArray(json.data)) throw new ApiError('UPSTREAM', '예상과 다른 응답 형식이에요.', 502)
    rows.push(...json.data)
    total = Number(json.totalCount) || rows.length
    if (json.data.length === 0) break
  }
  return rows
}

const str = v => String(v ?? '').trim()
const clean = v => (str(v) === '해당없음' ? '' : str(v))

function merge(general, location) {
  const locById = new Map(location.map(r => [str(r['데이터 고유번호']), r]))
  return general.map(g => {
    const l = locById.get(str(g['데이터 고유번호'])) || {}
    const addr = str(l['위치'])
    return {
      id: Number(g['데이터 고유번호']),
      name: str(g['장소명']),
      lat: Number(l['위도'] || g['위도']),
      lng: Number(l['경도'] || g['경도']),
      zip: str(l['우편번호']),
      addr,
      crs: str(l['좌표계값']),
      url: str(l['데이터 상세보기 URL']),
      region: addr.includes('서귀포시') ? '서귀포시' : addr.includes('제주시') ? '제주시' : '기타',
      cat: str(g['분류']),
      d1: str(g['디렉토리1']),
      d2: clean(g['디렉토리2']),
      title: str(g['제목']),
      sub: clean(g['부제목']),
      author: clean(g['저작자']),
      topic: clean(g['주제']),
      body: clean(g['내용']),
      toc: clean(g['목차']),
      abs: clean(g['초록']),
      publisher: clean(g['발행자']),
      date: clean(g['발행일']),
      type: clean(g['자료유형']),
      range: clean(g['범위']),
      source: clean(g['출처']),
      contrib: clean(g['기여자']),
      refs: clean(g['참고문헌']),
      base: str(g['데이터기준일자']),
    }
  })
}

module.exports = async function handler(req, res) {
  try {
    const key = getKey()
    const [general, location] = await Promise.all([fetchAll(GENERAL, key), fetchAll(LOCATION, key)])
    const places = merge(general, location).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    // 데이터가 자주 바뀌지 않으므로 Vercel 에 1시간 캐시해 호출 횟수를 아낀다. (실패 응답은 캐시하지 않는다)
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
    res.status(200).json({ total: places.length, places })
  } catch (e) {
    const known = e instanceof ApiError
    if (!known) console.error('places handler failed:', e && e.name) // 키가 섞일 수 있는 상세 내용은 남기지 않는다
    res.setHeader('Cache-Control', 'no-store')
    res.status(known ? e.status : 500).json({
      error: known ? e.code : 'INTERNAL',
      message: known ? e.message : '서버에서 알 수 없는 오류가 났어요.',
    })
  }
}
