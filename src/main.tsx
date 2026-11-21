import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@fontsource-variable/noto-sans-tc/wght.css"
import "@fontsource-variable/noto-serif-tc/wght.css"
import "./index.css"
import App from "./App.tsx"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
