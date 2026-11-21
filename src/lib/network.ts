import cameras from "@/data/cameras.json"
import network from "@/data/network.json"

export type Station = (typeof network.stations)[number]
export type RailLine = (typeof network.lines)[number]
export type CameraSite = (typeof cameras)[number]
export type Region = "全部" | "香港島" | "九龍" | "新界"

export const regions: Region[] = ["全部", "香港島", "九龍", "新界"]
export const lines = network.lines
export const stations = network.stations
export const cameraSites = cameras

export const stationByCode = new Map(stations.map((station) => [station.code, station]))
export const lineByCode = new Map(lines.map((line) => [line.code, line]))
export const cameraByKey = new Map(cameraSites.map((camera) => [camera.key, camera]))

export function camerasIn(region: Region): CameraSite[] {
  if (region === "全部") return cameraSites
  return cameraSites.filter((camera) => camera.region === region)
}

export function emptyArrivalCopy(stationCode: string): string {
  if (stationCode === "RAC") {
    return "暫無到站班次。馬場站一般只在賽馬日有列車。"
  }
  return "暫無到站班次。可能是非服務時間，或末班車已經開出。"
}
