import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import {
  cameraByKey,
  camerasIn,
  emptyArrivalCopy,
  lineByCode,
  lines,
  regions,
  stationByCode,
  type Region,
} from "@/lib/network"
import {
  ScheduleError,
  clockLabel,
  delayNotice,
  fetchSchedule,
  hasBothDirections,
  minutesUntil,
  problemNotice,
  trainsFor,
  type SchedulePayload,
} from "@/lib/schedule"
import type { TrainFeedStatus } from "@/lib/trains"

type Selection =
  | { type: "station"; code: string }
  | { type: "camera"; key: string }
  | null

type LineResult =
  | { line: string; ok: true; payload: SchedulePayload }
  | { line: string; ok: false; message: string }

type Props = {
  showRail: boolean
  showTrains: boolean
  showCameras: boolean
  trainStatus: TrainFeedStatus
  trainCount: number
  region: Region
  activeLine: string | null
  selection: Selection
  onShowRail: (value: boolean) => void
  onShowTrains: (value: boolean) => void
  onShowCameras: (value: boolean) => void
  onRegion: (region: Region) => void
  onActiveLine: (code: string | null) => void
  onClear: () => void
}

function trainNotice(status: TrainFeedStatus, count: number, railOn: boolean): string {
  if (!railOn) return "打開港鐵網絡後，列車會沿路軌顯示。"
  if (status === "loading" && count === 0) {
    return "正在向各站查詢班次，列車會陸續出現。位置按到站時間估算，並非港鐵即時定位。"
  }
  if (status === "limited") {
    return "港鐵暫時拒絕部分查詢，先顯示已取得的列車。位置是估算，並非即時定位。"
  }
  if (status === "error") return "暫時未能估算列車位置，請稍後再試。"
  if (count === 0) return "現時沒有可顯示的列車。可能是非服務時間。"
  return "圓點沿路軌移動。位置按到站時間估算，並非港鐵即時定位。"
}

function snapshotSrc(url: string, token: number, bare: boolean): string {
  if (bare) return url
  return `${url}${url.includes("?") ? "&" : "?"}t=${token}`
}

function Snapshot({ url, description }: { url: string; description: string }) {
  const [bare, setBare] = useState(false)
  const [failed, setFailed] = useState(false)
  const [token, setToken] = useState(() => Math.floor(Date.now() / 120_000))

  useEffect(() => {
    const refresh = window.setInterval(() => {
      setToken(Math.floor(Date.now() / 120_000))
      setBare(false)
      setFailed(false)
    }, 120_000)
    return () => window.clearInterval(refresh)
  }, [url])

  if (failed) {
    return (
      <p className="rounded-lg border border-dashed bg-muted px-3 py-6 text-sm">
        暫時未能取得這張快拍。運輸署的圖像服務沒有回應，請稍後再試。
      </p>
    )
  }

  return (
    <img
      key={`${token}-${bare ? "bare" : "fresh"}`}
      src={snapshotSrc(url, token, bare)}
      alt={description}
      referrerPolicy="no-referrer"
      className="w-full rounded-lg bg-neutral-950"
      onError={() => {
        if (!bare) setBare(true)
        else setFailed(true)
      }}
    />
  )
}

function TrainList({
  payload,
  line,
  station,
}: {
  payload: SchedulePayload
  line: string
  station: string
}) {
  const problem = problemNotice(payload)
  if (problem) return <p className="text-sm">{problem}</p>

  const trains = trainsFor(payload, line, station)
  const directions = hasBothDirections(payload, line, station)
  if (trains.length === 0) {
    return <p className="text-sm">{emptyArrivalCopy(station)}</p>
  }

  return (
    <div className="space-y-2">
      {delayNotice(payload) ? <p className="text-sm font-medium">{delayNotice(payload)}</p> : null}
      <ul className="space-y-1.5">
        {trains.map((train, index) => {
          const dest = train.dest ? stationByCode.get(train.dest)?.name ?? train.dest : "終點未明"
          const when = minutesUntil(train.time, payload.curr_time ?? payload.sys_time)
          const clock = clockLabel(train.time)
          const platform = train.plat ? `${train.plat} 號月台` : null
          return (
            <li key={`${train.seq ?? index}-${train.dest ?? ""}-${train.time ?? ""}`} className="text-sm">
              <span className="font-medium">往{dest}</span>
              <span className="text-muted-foreground">
                {" "}
                · {when}
                {platform ? ` · ${platform}` : ""}
                {clock ? ` · ${clock}` : ""}
              </span>
            </li>
          )
        })}
      </ul>
      {directions.up !== directions.down ? (
        <p className="text-sm text-muted-foreground">另一方向暫無到站班次。</p>
      ) : null}
      {payload.url ? (
        <a className="text-sm underline" href={payload.url} target="_blank" rel="noreferrer">
          特別車務安排
        </a>
      ) : null}
      {clockLabel(payload.sys_time ?? payload.curr_time) ? (
        <p className="text-xs text-muted-foreground">
          港鐵更新時間 {payload.sys_time ?? payload.curr_time}
        </p>
      ) : null}
    </div>
  )
}

function StationDetail({ code }: { code: string }) {
  const station = stationByCode.get(code)
  const [results, setResults] = useState<LineResult[] | null>(null)

  useEffect(() => {
    if (!station) return
    let cancelled = false
    void Promise.all(
      station.lines.map(async (line) => {
        try {
          const payload = await fetchSchedule(line, station.code)
          return { line, ok: true as const, payload }
        } catch (error) {
          const message =
            error instanceof ScheduleError ? error.message : "暫時未能取得到站班次。"
          return { line, ok: false as const, message }
        }
      }),
    ).then((next) => {
      if (!cancelled) setResults(next)
    })
    return () => {
      cancelled = true
    }
  }, [station])

  if (!station) {
    return <p className="text-sm">找不到這個車站。</p>
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-3xl leading-none">{station.name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{station.nameEn}</p>
      </div>
      {results === null ? <p className="text-sm">正在查詢到站班次…</p> : null}
      {results?.map((result) => {
        const line = lineByCode.get(result.line)
        if (!line) return null
        return (
          <section key={result.line} className="space-y-2">
            <h3 className="flex items-center gap-2 text-base font-medium">
              <span className="inline-block size-2.5 rounded-full" style={{ background: line.color }} />
              {line.name}
            </h3>
            {result.ok ? (
              <TrainList payload={result.payload} line={result.line} station={station.code} />
            ) : (
              <p className="text-sm">{result.message}</p>
            )}
          </section>
        )
      })}
    </div>
  )
}

function CameraDetail({ id }: { id: string }) {
  const camera = cameraByKey.get(id)
  if (!camera) return <p className="text-sm">找不到這個快拍點。</p>
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-2xl leading-snug">{camera.description}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {camera.region} · {camera.district}
        </p>
      </div>
      <Snapshot url={camera.url} description={camera.description} />
      <p className="text-sm text-muted-foreground">
        圖像約每兩分鐘更新，尺寸 320×240。若畫面寫著「暫時未能提供服務」，表示運輸署此刻未能提供該點的照片。
      </p>
    </div>
  )
}

export function Panel(props: Props) {
  const {
    showRail,
    showTrains,
    showCameras,
    trainStatus,
    trainCount,
    region,
    activeLine,
    selection,
    onShowRail,
    onShowTrains,
    onShowCameras,
    onRegion,
    onActiveLine,
    onClear,
  } = props

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain border-t-4 border-t-[#c8102e] bg-background pb-[env(safe-area-inset-bottom)] md:overflow-hidden md:border-t-0 md:border-r md:border-r-border md:pb-0">
      <div className={`shrink-0 ${selection ? "max-md:order-2" : ""}`}>
      <header className="space-y-4 px-4 pt-4 pb-3">
        <div>
          <p className="text-xs tracking-[0.18em] text-muted-foreground">香港</p>
          <h1 className="text-3xl leading-tight">智慧城市地圖</h1>
          <p className="mt-1 text-sm text-muted-foreground">重鐵到站班次，以及主要道路的交通快拍。</p>
        </div>
        <div className="space-y-2">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>港鐵網絡</span>
            <Switch checked={showRail} onCheckedChange={onShowRail} aria-label="顯示港鐵網絡" />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>列車位置</span>
            <Switch checked={showTrains} onCheckedChange={onShowTrains} aria-label="顯示列車位置" />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>交通快拍</span>
            <Switch checked={showCameras} onCheckedChange={onShowCameras} aria-label="顯示交通快拍" />
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {regions.map((item) => (
            <Button
              key={item}
              type="button"
              size="sm"
              variant={region === item ? "default" : "outline"}
              aria-pressed={region === item}
              onClick={() => onRegion(item)}
            >
              {item}
              <Badge variant="secondary" className="ml-1">
                {camerasIn(item).length}
              </Badge>
            </Button>
          ))}
        </div>
      </header>
      <Separator />
      </div>
      <div
        className={`shrink-0 px-4 py-4 md:min-h-0 md:flex-1 md:shrink md:overflow-y-auto md:overscroll-contain ${
          selection ? "max-md:order-1" : ""
        }`}
      >
        <div className="space-y-4">
          {showTrains ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {trainNotice(trainStatus, trainCount, showRail)}
            </p>
          ) : null}
          {selection?.type === "station" ? (
            <StationDetail key={selection.code} code={selection.code} />
          ) : null}
          {selection?.type === "camera" ? <CameraDetail key={selection.key} id={selection.key} /> : null}
          {selection === null ? (
            <div className="space-y-2 text-sm">
              <p>點地圖上的車站，查看即將到站的班次。點快拍點，查看該處最新路面照片。</p>
              {!showRail && !showCameras ? <p>兩層資料都已關掉。打開其中一層即可在地圖上選點。</p> : null}
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={onClear}>
              關閉資料
            </Button>
          )}
          <Separator />
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium">港鐵綫</h2>
              {activeLine ? (
                <Button type="button" size="xs" variant="ghost" onClick={() => onActiveLine(null)}>
                  顯示全部
                </Button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {lines.map((line) => (
                <Button
                  key={line.code}
                  type="button"
                  size="sm"
                  variant={activeLine === line.code ? "default" : "outline"}
                  aria-pressed={activeLine === line.code}
                  onClick={() => onActiveLine(activeLine === line.code ? null : line.code)}
                >
                  <span className="size-2 rounded-full" style={{ background: line.color }} />
                  {line.name}
                </Button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              路綫跟隨路軌的實際彎道，包括落馬洲、康城和馬場支綫。
            </p>
          </div>
        </div>
      </div>
      <footer
        className={`shrink-0 space-y-1 border-t px-4 py-3 text-xs leading-relaxed text-muted-foreground md:mt-auto ${
          selection ? "max-md:order-3" : ""
        }`}
      >
        <p>底圖：OpenFreeMap、OpenMapTiles、OpenStreetMap。</p>
        <p>到站班次：香港鐵路有限公司，經 DATA.GOV.HK。點選車站可看該站班次。地圖上的列車位置是按這些到站時間估算。</p>
        <p>快拍圖像與位置：運輸署，經 DATA.GOV.HK。車站位置來自 OpenStreetMap，對上港鐵路綫表。</p>
        <p>本網站並非港鐵或香港特別行政區政府的官方服務。</p>
      </footer>
    </aside>
  )
}
