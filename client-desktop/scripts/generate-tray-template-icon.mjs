import { writeFile } from "node:fs/promises"
import path from "node:path"
import { deflateSync } from "node:zlib"

const size = 64
const pixels = new Uint8Array(size * size * 4)
const points = [
  [38, 5],
  [13, 31],
  [28, 31],
  [20, 59],
  [51, 25],
  [36, 25],
]
const strokeRadius = 2.8

for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    let distance = Number.POSITIVE_INFINITY
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index]
      const end = points[(index + 1) % points.length]
      distance = Math.min(
        distance,
        distanceToSegment(x + 0.5, y + 0.5, start, end),
      )
    }
    const alpha = Math.round(
      255 * Math.max(0, Math.min(1, strokeRadius + 1 - distance)),
    )
    if (alpha === 0) continue
    const offset = (y * size + x) * 4
    pixels[offset] = 38
    pixels[offset + 1] = 42
    pixels[offset + 2] = 48
    pixels[offset + 3] = alpha
  }
}

const scanlines = Buffer.alloc((size * 4 + 1) * size)
for (let y = 0; y < size; y += 1) {
  const rowOffset = y * (size * 4 + 1)
  scanlines[rowOffset] = 0
  scanlines.set(
    pixels.subarray(y * size * 4, (y + 1) * size * 4),
    rowOffset + 1,
  )
}

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk("IHDR", createHeader(size, size)),
  pngChunk("IDAT", deflateSync(scanlines)),
  pngChunk("IEND", Buffer.alloc(0)),
])

await writeFile(path.resolve("public/trayTemplate.png"), png)

function createHeader(width, height) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return header
}

function distanceToSegment(x, y, start, end) {
  const deltaX = end[0] - start[0]
  const deltaY = end[1] - start[1]
  const lengthSquared = deltaX * deltaX + deltaY * deltaY
  const ratio = Math.max(
    0,
    Math.min(
      1,
      ((x - start[0]) * deltaX + (y - start[1]) * deltaY) /
        lengthSquared,
    ),
  )
  return Math.hypot(
    x - (start[0] + ratio * deltaX),
    y - (start[1] + ratio * deltaY),
  )
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type)
  const chunk = Buffer.alloc(data.length + 12)
  chunk.writeUInt32BE(data.length, 0)
  typeBuffer.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), data.length + 8)
  return chunk
}

function crc32(data) {
  let checksum = 0xffffffff
  for (const byte of data) {
    checksum ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      checksum =
        (checksum >>> 1) ^ (0xedb88320 & -(checksum & 1))
    }
  }
  return (checksum ^ 0xffffffff) >>> 0
}
