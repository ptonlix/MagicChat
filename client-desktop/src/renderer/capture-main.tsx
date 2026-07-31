import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@/styles/index.css"
import "./capture/capture.css"
import { CaptureApp } from "./capture/capture-app"

const root = document.getElementById("root")
if (!root) throw new Error("截图渲染器根节点缺失")

createRoot(root).render(
  <StrictMode>
    <CaptureApp />
  </StrictMode>,
)
