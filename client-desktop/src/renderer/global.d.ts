import type { DesktopBridge } from "@shared/bridge"
import type { CaptureBridge } from "@shared/screenshot-contract"

declare global {
  interface Window {
    capture?: CaptureBridge
    desktop: DesktopBridge
  }
}

export {}
