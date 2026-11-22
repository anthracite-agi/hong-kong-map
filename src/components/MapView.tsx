import { useEffect, useRef, useState } from "react"
import {
  Map,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type Map as MapLibreMap,
  type MapMouseEvent,
  type Source,
} from "maplibre-gl"
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"
import "maplibre-gl/dist/maplibre-gl.css"
import { Button } from "@/components/ui/button"
import { cameraByKey, camerasIn, lines, stationByCode, stations, type Region } from "@/lib/network"
import { emptyTrainCollection, trainFeatureCollection, type Sighting } from "@/lib/trains"

setWorkerUrl(workerUrl)

const styleUrl = "https://tiles.openfreemap.org/styles/liberty"

type Props = {
  showRail: boolean
  showTrains: boolean
  showCameras: boolean
  trainSightings: Sighting[]
  region: Region
  activeLine: string | null
  selectedStation: string | null
  selectedCamera: string | null
  onSelectStation: (code: string) => void
  onSelectCamera: (key: string) => void
}

type ViewState = Props

function railCollection() {
  return {
    type: "FeatureCollection" as const,
    features: lines.flatMap((line) =>
      line.segments.map((segment) => ({
        type: "Feature" as const,
        properties: {
          code: line.code,
          name: line.name,
          color: line.color,
          offset: line.offset,
        },
        geometry: { type: "LineString" as const, coordinates: segment },
      })),
    ),
  }
}

function stationCollection() {
  return {
    type: "FeatureCollection" as const,
    features: stations.map((station) => ({
      type: "Feature" as const,
      properties: {
        code: station.code,
        name: station.name,
        lines: `,${station.lines.join(",")},`,
      },
      geometry: { type: "Point" as const, coordinates: [station.lng, station.lat] },
    })),
  }
}

function cameraCollection(region: Region) {
  return {
    type: "FeatureCollection" as const,
    features: camerasIn(region).map((camera) => ({
      type: "Feature" as const,
      properties: {
        key: camera.key,
        description: camera.description,
      },
      geometry: { type: "Point" as const, coordinates: [camera.lng, camera.lat] },
    })),
  }
}

function highlightCollection(stationCode: string | null, cameraKey: string | null) {
  const station = stationCode ? stationByCode.get(stationCode) : undefined
  const camera = cameraKey ? cameraByKey.get(cameraKey) : undefined
  const point = station ?? camera
  return {
    type: "FeatureCollection" as const,
    features: point
      ? [
          {
            type: "Feature" as const,
            properties: {},
            geometry: { type: "Point" as const, coordinates: [point.lng, point.lat] },
          },
        ]
      : [],
  }
}

function closestHit(map: MapLibreMap, point: { x: number; y: number }, layers: string[], limit = 26) {
  const hits = map.queryRenderedFeatures(
    [
      [point.x - limit, point.y - limit],
      [point.x + limit, point.y + limit],
    ],
    { layers },
  )
  let best: (typeof hits)[number] | undefined
  let bestDistance = limit
  for (const hit of hits) {
    if (hit.geometry.type !== "Point") continue
    const projected = map.project(hit.geometry.coordinates as [number, number])
    const distance = Math.hypot(projected.x - point.x, projected.y - point.y)
    if (distance <= bestDistance) {
      best = hit
      bestDistance = distance
    }
  }
  return best ? { feature: best, distance: bestDistance } : null
}

function geoJsonSource(source: Source | undefined): GeoJSONSource | null {
  if (source?.type !== "geojson") return null
  return source as GeoJSONSource
}

function applyView(map: MapLibreMap, view: ViewState, replaceCameras: boolean) {
  const visibility = (show: boolean) => (show ? "visible" : "none")
  const showTrains = view.showRail && view.showTrains
  map.setLayoutProperty("rail-lines", "visibility", visibility(view.showRail))
  map.setLayoutProperty("trains", "visibility", visibility(showTrains))
  map.setLayoutProperty("train-labels", "visibility", visibility(showTrains))
  map.setLayoutProperty("stations", "visibility", visibility(view.showRail))
  map.setLayoutProperty("station-labels", "visibility", visibility(view.showRail))
  map.setLayoutProperty("camera-clusters", "visibility", visibility(view.showCameras))
  map.setLayoutProperty("camera-counts", "visibility", visibility(view.showCameras))
  map.setLayoutProperty("camera-points", "visibility", visibility(view.showCameras))

  map.setFilter(
    "rail-lines",
    view.activeLine ? ["==", ["get", "code"], view.activeLine] : ["has", "code"],
  )
  map.setFilter(
    "stations",
    view.activeLine ? ["in", `,${view.activeLine},`, ["get", "lines"]] : ["has", "code"],
  )
  map.setFilter(
    "station-labels",
    view.activeLine ? ["in", `,${view.activeLine},`, ["get", "lines"]] : ["has", "code"],
  )
  map.setFilter("trains", view.activeLine ? ["==", ["get", "line"], view.activeLine] : ["has", "line"])
  map.setFilter(
    "train-labels",
    view.activeLine ? ["==", ["get", "line"], view.activeLine] : ["has", "line"],
  )

  if (replaceCameras) {
    geoJsonSource(map.getSource("cameras"))?.setData(cameraCollection(view.region))
  }
  geoJsonSource(map.getSource("highlight"))?.setData(
    highlightCollection(
      view.showRail ? view.selectedStation : null,
      view.showCameras ? view.selectedCamera : null,
    ),
  )
}

function addLayers(map: MapLibreMap) {
  map.addSource("rail", { type: "geojson", data: railCollection() })
  map.addSource("station-points", { type: "geojson", data: stationCollection() })
  map.addSource("cameras", {
    type: "geojson",
    data: cameraCollection("全部"),
    cluster: true,
    clusterRadius: 48,
    clusterMaxZoom: 13,
  })
  map.addSource("trains", { type: "geojson", data: emptyTrainCollection })
  map.addSource("highlight", { type: "geojson", data: highlightCollection(null, null) })

  map.addLayer({
    id: "rail-lines",
    type: "line",
    source: "rail",
    paint: {
      "line-color": ["get", "color"],
      "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2.4, 13, 4.5, 16, 7],
      "line-offset": ["get", "offset"],
      "line-opacity": 0.92,
    },
  })
  map.addLayer({
    id: "camera-clusters",
    type: "circle",
    source: "cameras",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#9a3412",
      "circle-radius": ["step", ["get", "point_count"], 14, 20, 18, 80, 24],
      "circle-stroke-width": 2,
      "circle-stroke-color": "#f7f1e4",
    },
  })
  map.addLayer({
    id: "camera-counts",
    type: "symbol",
    source: "cameras",
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 12,
    },
    paint: { "text-color": "#fffaf3" },
  })
  map.addLayer({
    id: "camera-points",
    type: "circle",
    source: "cameras",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": "#c2410c",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4.5, 14, 6.5],
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#fffaf3",
    },
  })
  map.addLayer({
    id: "trains",
    type: "circle",
    source: "trains",
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 4, 13, 6.5, 16, 8],
      "circle-stroke-width": 2,
      "circle-stroke-color": "#fffaf3",
    },
  })
  map.addLayer({
    id: "train-labels",
    type: "symbol",
    source: "trains",
    minzoom: 13,
    layout: {
      "text-field": ["concat", "往", ["get", "destName"]],
      "text-font": ["Noto Sans Regular"],
      "text-size": 11,
      "text-offset": [0, -1.1],
      "text-anchor": "bottom",
      "text-optional": true,
    },
    paint: {
      "text-color": "#1c1915",
      "text-halo-color": "#f6f0e4",
      "text-halo-width": 1.2,
    },
  })
  map.addLayer({
    id: "stations",
    type: "circle",
    source: "station-points",
    paint: {
      "circle-color": "#fffaf3",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 5, 13, 6.5, 16, 8],
      "circle-stroke-width": 2,
      "circle-stroke-color": "#1c1915",
    },
  })
  map.addLayer({
    id: "station-labels",
    type: "symbol",
    source: "station-points",
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 10, 11, 15, 14],
      "text-offset": [0, 0.85],
      "text-anchor": "top",
      "text-optional": true,
    },
    paint: {
      "text-color": "#1c1915",
      "text-halo-color": "#f6f0e4",
      "text-halo-width": 1.3,
    },
  })
  map.addLayer({
    id: "highlight",
    type: "circle",
    source: "highlight",
    paint: {
      "circle-color": "transparent",
      "circle-radius": 16,
      "circle-stroke-width": 3,
      "circle-stroke-color": "#0f3d4c",
    },
  })
}

export function MapView(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const propsRef = useRef(props)
  const sightingsRef = useRef(props.trainSightings)
  const [ready, setReady] = useState(false)
  const [basemapError, setBasemapError] = useState(false)
  const regionRef = useRef<Region | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const map = new Map({
      container,
      style: styleUrl,
      center: [114.15, 22.35],
      zoom: 10,
      attributionControl: { compact: true },
    })
    map.addControl(new NavigationControl({ showCompass: false }), "top-right")
    mapRef.current = map
    if (import.meta.env.DEV) {
      ;(window as Window & { __hkMap?: MapLibreMap }).__hkMap = map
    }

    let overlaysReady = false
    const showOverlays = () => {
      if (!map.isStyleLoaded()) return
      if (map.getSource("rail")) {
        overlaysReady = true
        setReady(true)
        setBasemapError(false)
        return
      }
      if (overlaysReady) return
      map.resize()
      addLayers(map)
      applyView(map, propsRef.current, true)
      regionRef.current = propsRef.current.region
      map.fitBounds(
        [
          [113.83, 22.2],
          [114.44, 22.56],
        ],
        { padding: 28, animate: false },
      )
      for (const layer of ["stations", "camera-points", "camera-clusters"] as const) {
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer"
        })
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = ""
        })
      }
      overlaysReady = true
      setBasemapError(false)
      setReady(true)
    }

    const timer = window.setTimeout(() => {
      if (!map.getSource("rail")) setBasemapError(true)
    }, 12000)

    map.on("style.load", showOverlays)
    map.on("load", () => {
      window.clearTimeout(timer)
      setBasemapError(false)
      showOverlays()
    })

    map.on("click", (event: MapMouseEvent) => {
      const current = propsRef.current
      const station =
        current.showRail && map.getLayer("stations")
          ? closestHit(map, event.point, ["stations"])
          : null
      const camera =
        current.showCameras && map.getLayer("camera-points")
          ? closestHit(map, event.point, ["camera-points"])
          : null
      if (station && (!camera || station.distance <= camera.distance)) {
        const code = station.feature.properties?.code
        if (typeof code === "string") {
          current.onSelectStation(code)
          return
        }
      }
      if (camera) {
        const key = camera.feature.properties?.key
        if (typeof key === "string") {
          current.onSelectCamera(key)
          return
        }
      }
      if (!current.showCameras || !map.getLayer("camera-clusters")) return
      const cluster = closestHit(map, event.point, ["camera-clusters"], 32)
      const clusterId = cluster?.feature.properties?.cluster_id
      const geometry = cluster?.feature.geometry
      if (typeof clusterId !== "number" || geometry?.type !== "Point") return
      const source = geoJsonSource(map.getSource("cameras"))
      if (!source) return
      void source.getClusterExpansionZoom(clusterId).then((zoom: number) => {
        map.easeTo({
          center: geometry.coordinates as [number, number],
          zoom,
        })
      })
    })

    return () => {
      window.clearTimeout(timer)
      map.remove()
      mapRef.current = null
      if (import.meta.env.DEV) {
        delete (window as Window & { __hkMap?: MapLibreMap }).__hkMap
      }
      setReady(false)
    }
  }, [])

  useEffect(() => {
    propsRef.current = props
    sightingsRef.current = props.trainSightings
    const map = mapRef.current
    if (!map || !ready) return
    applyView(map, props, regionRef.current !== props.region)
    regionRef.current = props.region
  }, [ready, props])

  useEffect(() => {
    if (!ready) return
    const map = mapRef.current
    if (!map) return

    const drawTrains = () => {
      const current = propsRef.current
      const show = current.showRail && current.showTrains
      const data = show
        ? trainFeatureCollection(sightingsRef.current, current.activeLine)
        : emptyTrainCollection
      geoJsonSource(map.getSource("trains"))?.setData(data)
      if (import.meta.env.DEV) {
        ;(window as Window & { __hkTrains?: typeof data }).__hkTrains = data
      }
    }

    drawTrains()
    const timer = window.setInterval(drawTrains, 150)
    return () => window.clearInterval(timer)
  }, [ready])

  function showHongKong() {
    mapRef.current?.fitBounds(
      [
        [113.83, 22.2],
        [114.44, 22.56],
      ],
      { padding: 28, duration: 700 },
    )
  }

  return (
    <div className="relative h-full w-full">
      <div id="map" ref={containerRef} className="h-full w-full" />
      <div className="absolute top-3 left-3 z-10 flex max-w-[16rem] flex-col items-start gap-2">
        <Button type="button" variant="outline" className="bg-card shadow-sm" onClick={showHongKong}>
          回到全港
        </Button>
        {props.showRail && props.showTrains ? (
          <p className="rounded-lg border bg-card/95 px-3 py-2 text-xs leading-relaxed shadow-sm">
            列車位置按到站時間估算，並非港鐵即時定位。
          </p>
        ) : null}
      </div>
      {basemapError ? (
        <div className="absolute inset-x-3 bottom-8 z-10 rounded-lg border bg-card px-3 py-2 text-sm shadow-sm">
          底圖暫時載入不到。OpenFreeMap 沒有回應，車站和快拍點也無法顯示。請稍後再試。
        </div>
      ) : null}
    </div>
  )
}
