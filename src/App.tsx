import { useState } from "react"
import { MapView } from "@/components/MapView"
import { Panel } from "@/components/Panel"
import type { Region } from "@/lib/network"

type Selection =
  | { type: "station"; code: string }
  | { type: "camera"; key: string }
  | null

export default function App() {
  const [showRail, setShowRail] = useState(true)
  const [showCameras, setShowCameras] = useState(true)
  const [region, setRegion] = useState<Region>("全部")
  const [activeLine, setActiveLine] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection>(null)

  return (
    <main
      className={`grid h-dvh min-h-0 grid-cols-1 md:grid-cols-[minmax(340px,430px)_minmax(0,1fr)] md:grid-rows-1 ${
        selection
          ? "grid-rows-[minmax(180px,1fr)_minmax(340px,64dvh)]"
          : "grid-rows-[minmax(0,1fr)_minmax(210px,40dvh)]"
      }`}
    >
      <div className="order-2 h-full min-h-0 md:order-1">
        <Panel
          showRail={showRail}
          showCameras={showCameras}
          region={region}
          activeLine={activeLine}
          selection={selection}
          onShowRail={setShowRail}
          onShowCameras={setShowCameras}
          onRegion={setRegion}
          onActiveLine={setActiveLine}
          onClear={() => setSelection(null)}
        />
      </div>
      <div className="relative order-1 h-full min-h-0 md:order-2">
        <MapView
          showRail={showRail}
          showCameras={showCameras}
          region={region}
          activeLine={activeLine}
          selectedStation={selection?.type === "station" ? selection.code : null}
          selectedCamera={selection?.type === "camera" ? selection.key : null}
          onSelectStation={(code) => setSelection({ type: "station", code })}
          onSelectCamera={(key) => setSelection({ type: "camera", key })}
        />
      </div>
    </main>
  )
}
