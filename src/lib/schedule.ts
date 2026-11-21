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

export function minutesLabel(ttnt?: string): string {
  if (ttnt == null || ttnt.trim() === "") return "時間未明"
  const value = ttnt.trim()
  if (value === "0" || value === "-") return "即將到站"
  const minutes = Number(value)
  if (Number.isFinite(minutes)) {
    if (minutes <= 0) return "即將到站"
    return `約 ${minutes} 分鐘`
  }
  return value
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

  const value = (await response.json()) as SchedulePayload
  cache.set(key, { at: Date.now(), value })
  return value
}
