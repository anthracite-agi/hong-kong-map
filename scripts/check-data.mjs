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

const segmentCounts = {
  ISL: 16,
  TWL: 15,
  KTL: 16,
  TKL: 7,
  EAL: 16,
  TML: 26,
  TCL: 7,
  AEL: 4,
  SIL: 4,
  DRL: 1,
}
for (const line of network.lines) {
  const expected = segmentCounts[line.code]
  if (line.segments.length !== expected) {
    throw new Error(`${line.name} 應有 ${expected} 段，實際 ${line.segments.length}`)
  }
  for (const segment of line.segments) {
    if (segment.length !== 2) throw new Error(`${line.name} 有不完整路段`)
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

function pointOf(code) {
  const station = byCode.get(code)
  return [station.lng, station.lat]
}

function near(left, right) {
  return Math.abs(left[0] - right[0]) < 1e-5 && Math.abs(left[1] - right[1]) < 1e-5
}

function links(line, from, to) {
  const start = pointOf(from)
  const end = pointOf(to)
  return line.segments.some(
    (segment) =>
      (near(segment[0], start) && near(segment[1], end)) ||
      (near(segment[0], end) && near(segment[1], start)),
  )
}

const eastRail = network.lines.find((line) => line.code === "EAL")
if (
  !links(eastRail, "UNI", "FOT") ||
  !links(eastRail, "FOT", "SHT") ||
  !links(eastRail, "UNI", "RAC") ||
  !links(eastRail, "RAC", "SHT")
) {
  throw new Error("東鐵綫未同時保留火炭正綫和馬場支綫")
}
if (links(eastRail, "RAC", "FOT")) {
  throw new Error("馬場站不應直接連接火炭站")
}
if (regions["香港島"] !== 116 || regions["九龍"] !== 232 || regions["新界"] !== 665) {
  throw new Error(`地區數目不符：${JSON.stringify(regions)}`)
}

console.log("資料檢查通過：98 個車站、10 條重鐵綫、1013 個快拍點。")
