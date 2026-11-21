import { readFileSync } from "node:fs"

const network = JSON.parse(readFileSync(new URL("../src/data/network.json", import.meta.url)))
const cameras = JSON.parse(readFileSync(new URL("../src/data/cameras.json", import.meta.url)))

const expectedLines = ["ISL", "TWL", "KTL", "TKL", "EAL", "TML", "TCL", "AEL", "SIL", "DRL"]
const lineCodes = network.lines.map((line) => line.code)
if (lineCodes.join() !== expectedLines.join()) {
  throw new Error(`路線不符：${lineCodes.join()}`)
}
if (network.stations.length !== 98) {
  throw new Error(`車站應有 98 個，實際 ${network.stations.length}`)
}

const byCode = new Map(network.stations.map((station) => [station.code, station]))
if (!byCode.has("RAC") || !byCode.get("RAC").lines.includes("EAL")) {
  throw new Error("馬場站未列入東鐵綫")
}

function requireCoordinate(lat, lng, label) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error(`${label} 座標不是有效數字`)
  }
}

for (const station of network.stations) {
  requireCoordinate(station.lat, station.lng, station.name)
  if (station.lat < 22.18 || station.lat > 22.56 || station.lng < 113.82 || station.lng > 114.46) {
    throw new Error(`${station.name} 座標超出香港範圍`)
  }
  if (station.lines.length === 0) throw new Error(`${station.name} 沒有所屬路綫`)
}

for (const line of network.lines) {
  const longest = Math.max(...line.segments.map((segment) => segment.length))
  if (longest < 30) throw new Error(`${line.name} 仍然只是直線，未跟路軌彎曲`)
  for (const segment of line.segments) {
    if (segment.length < 2) throw new Error(`${line.name} 有不完整路段`)
    for (const point of segment) {
      requireCoordinate(point[1], point[0], line.name)
    }
  }
}

if (cameras.length !== 1013) throw new Error(`快拍點應有 1013 個，實際 ${cameras.length}`)
const regions = { 香港島: 0, 九龍: 0, 新界: 0 }
const keys = new Set()
for (const camera of cameras) {
  if (keys.has(camera.key)) throw new Error(`快拍編號重複：${camera.key}`)
  keys.add(camera.key)
  if (!Object.hasOwn(regions, camera.region)) throw new Error(`未知地區：${camera.region}`)
  regions[camera.region] += 1
  if (!camera.url.startsWith("https://tdcctv.data.one.gov.hk/")) {
    throw new Error(`快拍網址不屬於運輸署：${camera.url}`)
  }
  requireCoordinate(camera.lat, camera.lng, camera.key)
  if (camera.lat < 22.15 || camera.lat > 22.58 || camera.lng < 113.8 || camera.lng > 114.5) {
    throw new Error(`${camera.key} 座標超出香港範圍`)
  }
}

function distanceKm(point, line) {
  const lat = (point[1] * Math.PI) / 180
  const xy = (coord) => [coord[0] * 111.32 * Math.cos(lat), coord[1] * 110.57]
  const [px, py] = xy(point)
  let best = Infinity
  for (const segment of line.segments) {
    for (let index = 1; index < segment.length; index += 1) {
      const [ax, ay] = xy(segment[index - 1])
      const [bx, by] = xy(segment[index])
      const dx = bx - ax
      const dy = by - ay
      const denom = dx * dx + dy * dy
      const t = denom === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denom))
      const qx = ax + t * dx
      const qy = ay + t * dy
      best = Math.min(best, Math.hypot(px - qx, py - qy))
    }
  }
  return best
}

for (const line of network.lines) {
  for (const station of network.stations) {
    if (!station.lines.includes(line.code)) continue
    const distance = distanceKm([station.lng, station.lat], line)
    if (distance > 0.45) {
      throw new Error(`${station.name} 距離${line.name} ${distance.toFixed(2)} 公里`)
    }
  }
}
if (regions["香港島"] !== 116 || regions["九龍"] !== 232 || regions["新界"] !== 665) {
  throw new Error(`地區數目不符：${JSON.stringify(regions)}`)
}

console.log("資料檢查通過：98 個車站、10 條重鐵綫、1013 個快拍點。")
