const minPreviewZoom = 0.25
const maxPreviewZoom = 4

export function clampPreviewZoom(zoom: number): number {
  return Math.min(maxPreviewZoom, Math.max(minPreviewZoom, Number(zoom.toFixed(2))))
}
