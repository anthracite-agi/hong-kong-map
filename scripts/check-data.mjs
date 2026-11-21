import { readFileSync } from "node:fs"

const network = JSON.parse(readFileSync(new URL("../src/data/network.json", import.meta.url)))
const cameras = JSON.parse(readFileSync(new URL("../src/data/cameras.json", import.meta.url)))
const routes = JSON.parse(readFileSync(new URL("../src/data/routes.json", import.meta.url)))

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

function kilometers(a, b) {
  const toRad = Math.PI / 180
  const lat1 = a[1] * toRad
  const lat2 = b[1] * toRad
  const dLat = lat2 - lat1
  const dLon = (b[0] - a[0]) * toRad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(Math.max(h, 0)), Math.sqrt(Math.max(1 - h, 0)))
}

if (!Array.isArray(routes.paths) || routes.paths.length < 10) {
  throw new Error("列車路軌資料不完整")
}
const covered = new Set()
for (const path of routes.paths) {
  if (!lineCodes.includes(path.line)) throw new Error(`未知路綫 ${path.line}`)
  if (typeof path.increasingIsDown !== "boolean") throw new Error(`${path.line} 缺少行車方向`)
  if (!Array.isArray(path.stations) || path.stations.length < 2) throw new Error(`${path.line} 路段太短`)
  if (path.stations.length !== path.chainage.length) throw new Error(`${path.line} 里程和車站數目不符`)
  if (new Set(path.stations).size !== path.stations.length) throw new Error(`${path.line} 車站重複`)
  let length = 0
  for (let index = 0; index < path.coordinates.length; index += 1) {
    const point = path.coordinates[index]
    requireCoordinate(point[1], point[0], path.line)
    if (point[1] < 22.15 || point[1] > 22.58 || point[0] < 113.8 || point[0] > 114.5) {
      throw new Error(`${path.line} 路軌超出香港範圍`)
    }
    if (index > 0) length += kilometers(path.coordinates[index - 1], point)
  }
  for (let index = 0; index < path.stations.length; index += 1) {
    const code = path.stations[index]
    const station = byCode.get(code)
    if (!station || !station.lines.includes(path.line)) throw new Error(`${path.line} 包含不屬於該綫的 ${code}`)
    covered.add(`${path.line}:${code}`)
    if (index > 0 && path.chainage[index] - path.chainage[index - 1] < 150) {
      throw new Error(`${path.line} ${path.stations[index - 1]} 至 ${code} 路段過短`)
    }
  }
  const tail = Math.abs(length * 1000 - path.chainage[path.chainage.length - 1])
  if (tail > 400) throw new Error(`${path.line} 里程和路軌長度相差 ${Math.round(tail)} 米`)
}
for (const station of network.stations) {
  for (const line of station.lines) {
    if (!covered.has(`${line}:${station.code}`)) throw new Error(`${station.name} 沒有 ${line} 的行車路段`)
  }
}

console.log("資料檢查通過：98 個車站、10 條重鐵綫、1013 個快拍點。")
