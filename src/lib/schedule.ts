export type Train = {
  seq?: string
  dest?: string
  plat?: string
  time?: string
  ttnt?: string
}

export type DirectionBlock = {
  UP?: Train[] | null
  DOWN?: Train[] | null
  curr_time?: string
  sys_time?: string
}

export type SchedulePayload = {
  status?: number | string
  message?: string
  url?: string
  curr_time?: string
  sys_time?: string
  isdelay?: string
  data?: Record<string, DirectionBlock>
}

export class ScheduleError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null) {
    super(message)
    this.name = "ScheduleError"
    this.status = status
  }
}

const cache = new Map<string, { at: number; value: SchedulePayload }>()
const cacheMs = 10_000

export function isNormal(payload: SchedulePayload): boolean {
  return String(payload.status ?? "1") === "1"
}

function isSchedulePayload(value: unknown): value is SchedulePayload {
  if (value == null || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  if ("status" in record && record.status != null && typeof record.status !== "number" && typeof record.status !== "string") {
    return false
  }
  if ("data" in record && record.data != null && typeof record.data !== "object") return false
  if ("message" in record && record.message != null && typeof record.message !== "string") return false
  if ("url" in record && record.url != null && typeof record.url !== "string") return false
  return true
}

export function trainsFor(
  payload: SchedulePayload,
  line: string,
  station: string,
): Train[] {
  const block = payload.data?.[`${line}-${station}`]
  const up = Array.isArray(block?.UP) ? block.UP : []
  const down = Array.isArray(block?.DOWN) ? block.DOWN : []
  return [...up, ...down].sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))
}

export function hasBothDirections(payload: SchedulePayload, line: string, station: string): {
  up: boolean
  down: boolean
} {
  const block = payload.data?.[`${line}-${station}`]
  const up = Array.isArray(block?.UP) && block.UP.length > 0
  const down = Array.isArray(block?.DOWN) && block.DOWN.length > 0
  return { up, down }
}

function parseStamp(value: string): number | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!match) return null
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0),
  )
}

export function minutesUntil(trainTime?: string, currentTime?: string): string {
  if (!trainTime || !currentTime) return "時間未明"
  const train = parseStamp(trainTime)
  const current = parseStamp(currentTime)
  if (train == null || current == null) return "時間未明"
  const minutes = Math.round((train - current) / 60_000)
  if (minutes <= 0) return "即將到站"
  return `約 ${minutes} 分鐘`
}

export function clockLabel(value?: string): string | null {
  if (!value) return null
  const match = value.match(/(\d{2}:\d{2})/)
  return match?.[1] ?? null
}

export function delayNotice(payload: SchedulePayload): string | null {
  if (payload.isdelay === "Y") return "港鐵表示列車服務有延誤。"
  return null
}

export function problemNotice(payload: SchedulePayload): string | null {
  if (isNormal(payload)) return null
  const message = payload.message?.trim()
  if (message && message.toLowerCase() !== "successful") return message
  return "港鐵回覆這條綫暫時沒有班次資料。"
}

export async function fetchSchedule(line: string, station: string): Promise<SchedulePayload> {
  const key = `${line}:${station}`
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < cacheMs) return cached.value

  const url = new URL("https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php")
  url.searchParams.set("line", line)
  url.searchParams.set("sta", station)
  url.searchParams.set("lang", "TC")

  let response: Response
  try {
    response = await fetch(url)
  } catch {
    throw new ScheduleError("暫時連不上港鐵到站服務。", null)
  }
  if (response.status === 429) {
    throw new ScheduleError("港鐵暫時拒絕查詢，請稍後再試。", 429)
  }
  if (!response.ok) {
    throw new ScheduleError("暫時未能取得到站班次。", response.status)
  }

  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    throw new ScheduleError("暫時未能取得到站班次。", response.status)
  }
  if (!isSchedulePayload(parsed)) {
    throw new ScheduleError("暫時未能取得到站班次。", response.status)
  }
  if (isNormal(parsed)) {
    cache.set(key, { at: Date.now(), value: parsed })
  }
  return parsed
}
