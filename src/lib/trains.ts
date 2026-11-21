import { useEffect, useState } from "react"
import routes from "@/data/routes.json"
import { lineByCode, stationByCode } from "@/lib/network"
import {
  ScheduleError,
  fetchSchedule,
  isNormal,
  parseStamp,
  type SchedulePayload,
  type Train,
} from "@/lib/schedule"

export type TravelDirection = "UP" | "DOWN"

export type Sighting = {
  line: string
  station: string
  dest: string
  direction: TravelDirection
  arrivalAt: number
}

export type TrainFeedStatus = "off" | "loading" | "ok" | "limited" | "error"

type RoutePath = {
  line: string
  increasingIsDown: boolean
  stations: string[]
  coordinates: number[][]
  chainage: number[]
  cumulative: number[]
}

type Approach = {
  path: RoutePath
  stationIndex: number
  previousIndex: number
}

const runningSpeed = 13
const requestGapMs = 280

function kilometers(a: number[], b: number[]): number {
  const toRad = Math.PI / 180
  const lat1 = a[1] * toRad
  const lat2 = b[1] * toRad
  const dLat = lat2 - lat1
  const dLon = (b[0] - a[0]) * toRad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(Math.max(h, 0)), Math.sqrt(Math.max(1 - h, 0)))
}

const routePaths: RoutePath[] = routes.paths.map((path) => {
  const cumulative = [0]
  for (let index = 1; index < path.coordinates.length; index += 1) {
    const step = kilometers(path.coordinates[index - 1], path.coordinates[index]) * 1000
    cumulative.push(cumulative[index - 1] + step)
  }
  return { ...path, cumulative }
})

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function queriesFor(activeLine: string | null): { line: string; station: string }[] {
  const byLine = new Map<string, string[]>()
  for (const path of routePaths) {
    if (activeLine && path.line !== activeLine) continue
    const stations = byLine.get(path.line) ?? []
    for (const station of path.stations) {
      if (!stations.includes(station)) stations.push(station)
    }
    byLine.set(path.line, stations)
  }
  const entries = [...byLine.entries()]
  const longest = Math.max(0, ...entries.map(([, stations]) => stations.length))
  const queries: { line: string; station: string }[] = []
  for (let index = 0; index < longest; index += 1) {
    for (const [line, stations] of entries) {
      const station = stations[index]
      if (station) queries.push({ line, station })
    }
  }
  return queries
}

function approachOf(
  path: RoutePath,
  station: string,
  dest: string,
  direction: TravelDirection,
): Approach | null {
  const stationIndex = path.stations.indexOf(station)
  if (stationIndex < 0) return null
  const towardHigher = path.increasingIsDown === (direction === "DOWN")
  const previousIndex = towardHigher ? stationIndex - 1 : stationIndex + 1
  if (previousIndex < 0 || previousIndex >= path.stations.length) return null
  const destIndex = path.stations.indexOf(dest)
  if (destIndex >= 0 && destIndex !== stationIndex) {
    if (Math.sign(stationIndex - previousIndex) !== Math.sign(destIndex - stationIndex)) return null
  }
  return { path, stationIndex, previousIndex }
}

function chooseApproach(sighting: Sighting): Approach | null {
  const matches: Approach[] = []
  for (const path of routePaths) {
    if (path.line !== sighting.line) continue
    const approach = approachOf(path, sighting.station, sighting.dest, sighting.direction)
    if (approach) matches.push(approach)
  }
  matches.sort((a, b) => {
    const destA = a.path.stations.includes(sighting.dest) ? 1 : 0
    const destB = b.path.stations.includes(sighting.dest) ? 1 : 0
    if (destA !== destB) return destB - destA
    const hopA = Math.abs(a.path.chainage[a.stationIndex] - a.path.chainage[a.previousIndex])
    const hopB = Math.abs(b.path.chainage[b.stationIndex] - b.path.chainage[b.previousIndex])
    return hopA - hopB
  })
  return matches[0] ?? null
}

function pointAlong(path: RoutePath, meters: number): [number, number] {
  const { coordinates, cumulative } = path
  const last = coordinates[coordinates.length - 1]
  if (!last) return [0, 0]
  const end = cumulative[cumulative.length - 1] ?? 0
  const target = Math.min(Math.max(meters, 0), end)
  let index = 1
  while (index < cumulative.length && cumulative[index] < target) index += 1
  if (index >= coordinates.length) return [last[0], last[1]]
  const start = cumulative[index - 1] ?? 0
  const span = (cumulative[index] ?? start) - start
  const t = span === 0 ? 0 : (target - start) / span
  const from = coordinates[index - 1]
  const to = coordinates[index]
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]
}

function sameTrain(earlier: Sighting, later: Sighting): boolean {
  if (earlier.line !== later.line || earlier.dest !== later.dest || earlier.direction !== later.direction) {
    return false
  }
  const path = routePaths.find(
    (item) =>
      item.line === earlier.line &&
      item.stations.includes(earlier.station) &&
      item.stations.includes(later.station) &&
      item.stations.includes(earlier.dest),
  )
  if (!path) return false
  const earlierIndex = path.stations.indexOf(earlier.station)
  const laterIndex = path.stations.indexOf(later.station)
  const destIndex = path.stations.indexOf(earlier.dest)
  if (earlierIndex < 0 || laterIndex < 0 || earlierIndex === laterIndex) return false
  if (Math.abs(destIndex - laterIndex) >= Math.abs(destIndex - earlierIndex)) return false
  const expected = Math.abs(path.chainage[earlierIndex] - path.chainage[laterIndex]) / runningSpeed
  const etaDiff = (later.arrivalAt - earlier.arrivalAt) / 1000
  if (etaDiff < 25) return false
  const slack = Math.max(40, expected * 0.4)
  return Math.abs(etaDiff - expected) <= slack
}

export function dedupeSightings(sightings: Sighting[]): Sighting[] {
  const grouped = new Map<string, Sighting[]>()
  for (const sighting of sightings) {
    const key = `${sighting.line}|${sighting.station}|${sighting.dest}|${sighting.direction}`
    const list = grouped.get(key) ?? []
    list.push(sighting)
    grouped.set(key, list)
  }
  const capped: Sighting[] = []
  for (const list of grouped.values()) {
    list.sort((a, b) => a.arrivalAt - b.arrivalAt)
    capped.push(...list.slice(0, 2))
  }
  const ordered = capped.sort((a, b) => a.arrivalAt - b.arrivalAt)
  const kept: Sighting[] = []
  for (const sighting of ordered) {
    if (kept.some((earlier) => sameTrain(earlier, sighting))) continue
    kept.push(sighting)
  }
  return kept
}

function readDirection(value: Train[] | null | undefined, direction: TravelDirection, now: number, clock: number) {
  if (!Array.isArray(value)) return []
  const sightings: { dest: string; direction: TravelDirection; arrivalAt: number }[] = []
  for (const train of value) {
    if (train.valid === "N" || !train.dest || !train.time) continue
    const arrival = parseStamp(train.time)
    if (arrival == null) continue
    const remaining = arrival - clock
    if (remaining < -20_000 || remaining > 45 * 60_000) continue
    sightings.push({ dest: train.dest, direction, arrivalAt: now + remaining })
  }
  return sightings
}

export function sightingsFromSchedule(
  line: string,
  station: string,
  payload: SchedulePayload,
  now = Date.now(),
): Sighting[] {
  const block = payload.data?.[`${line}-${station}`]
  const clockText = block?.curr_time ?? block?.sys_time ?? payload.curr_time ?? payload.sys_time
  const clock = clockText ? parseStamp(clockText) : null
  if (!block || clock == null || !isNormal(payload)) return []
  return [...readDirection(block.UP, "UP", now, clock), ...readDirection(block.DOWN, "DOWN", now, clock)].map(
    (item) => ({ line, station, ...item }),
  )
}

function replaceStation(
  current: Map<string, Sighting[]>,
  line: string,
  station: string,
  payload: SchedulePayload,
) {
  current.set(`${line}|${station}`, sightingsFromSchedule(line, station, payload))
}

export function useTrainSightings(enabled: boolean, activeLine: string | null) {
  const [sightings, setSightings] = useState<Sighting[]>([])
  const [status, setStatus] = useState<TrainFeedStatus>(enabled ? "loading" : "off")

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    const current = new Map<string, Sighting[]>()
    let nextStart = 0

    const publish = (next: TrainFeedStatus) => {
      if (cancelled) return
      setSightings(dedupeSightings([...current.values()].flat()))
      setStatus(next)
    }

    const waitTurn = async () => {
      const now = Date.now()
      const wait = Math.max(0, nextStart - now)
      nextStart = Math.max(now, nextStart) + requestGapMs
      if (wait > 0) await delay(wait)
    }

    const run = async () => {
      publish("loading")
      while (!cancelled) {
        const queries = queriesFor(activeLine)
        let cursor = 0
        let limited = false
        let okCount = 0
        let failCount = 0

        const worker = async () => {
          while (!cancelled && !limited) {
            if (document.visibilityState === "hidden") {
              await delay(1000)
              continue
            }
            const index = cursor
            cursor += 1
            if (index >= queries.length) return
            await waitTurn()
            if (cancelled || limited) return
            const job = queries[index]
            try {
              const payload = await fetchSchedule(job.line, job.station)
              okCount += 1
              replaceStation(current, job.line, job.station, payload)
              if (okCount === 1 || okCount % 4 === 0) publish("ok")
            } catch (error) {
              if (error instanceof ScheduleError && error.status === 429) {
                limited = true
                return
              }
              failCount += 1
            }
          }
        }

        await Promise.all([worker(), worker()])
        if (cancelled) return
        if (limited) publish("limited")
        else if (okCount === 0 && failCount > 0) publish("error")
        else publish("ok")
        await delay(limited ? 60_000 : 25_000)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [enabled, activeLine])

  if (!enabled) return { sightings: [] as Sighting[], status: "off" as const }
  return { sightings, status }
}

type TrainFeature = {
  type: "Feature"
  properties: {
    line: string
    dest: string
    direction: TravelDirection
    destName: string
    color: string
  }
  geometry: { type: "Point"; coordinates: [number, number] }
}

function metersBetween(a: [number, number], b: [number, number]): number {
  return kilometers(a, b) * 1000
}

export function trainFeatureCollection(sightings: Sighting[], activeLine: string | null, now = Date.now()) {
  const features: TrainFeature[] = []
  const ordered = [...sightings]
    .filter((sighting) => !activeLine || sighting.line === activeLine)
    .sort((a, b) => a.arrivalAt - b.arrivalAt)

  for (const sighting of ordered) {
    if (now - sighting.arrivalAt > 40_000) continue
    const line = lineByCode.get(sighting.line)
    const station = stationByCode.get(sighting.station)
    if (!line || !station) continue
    const approach = chooseApproach(sighting)
    let coordinates: [number, number] = [station.lng, station.lat]
    if (approach) {
      const { path, stationIndex, previousIndex } = approach
      const stationChain = path.chainage[stationIndex]
      const previousChain = path.chainage[previousIndex]
      const remaining = Math.max(0, (sighting.arrivalAt - now) / 1000)
      const direction = Math.sign(stationChain - previousChain) || 1
      const rewind = Math.min(remaining * runningSpeed, 5000)
      const end = path.chainage[path.chainage.length - 1] ?? stationChain
      const meters = Math.min(Math.max(stationChain - direction * rewind, 0), end)
      coordinates = pointAlong(path, meters)
    }
    const crowded = features.some(
      (feature) =>
        feature.properties.line === sighting.line &&
        feature.properties.dest === sighting.dest &&
        feature.properties.direction === sighting.direction &&
        metersBetween(feature.geometry.coordinates, coordinates) < 400,
    )
    if (crowded) continue
    const destName = stationByCode.get(sighting.dest)?.name ?? sighting.dest
    features.push({
      type: "Feature",
      properties: {
        line: sighting.line,
        dest: sighting.dest,
        direction: sighting.direction,
        destName,
        color: line.color,
      },
      geometry: { type: "Point", coordinates },
    })
  }

  return { type: "FeatureCollection" as const, features }
}

export const emptyTrainCollection = {
  type: "FeatureCollection" as const,
  features: [] as TrainFeature[],
}
