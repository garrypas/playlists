import { readFile, stat } from 'node:fs/promises'
import { nativeImage } from 'electron'

// Covers are shown at most a few hundred pixels across, so a bigger image would only bloat the database.
export const PLAYLIST_IMAGE_SIZE = 512

// Files bigger than this aren't opened at all, so a huge file can't stall main while it's decoded.
const MAX_SOURCE_BYTES = 40 * 1024 * 1024

// Images wider or taller than this aren't decoded (8000 × 8000 is already about 256 MB once decoded).
const MAX_SOURCE_SIDE = 8000

/**
 * The width and height a PNG or JPEG file's header gives, or undefined when it's neither (or its header is damaged).
 * Only the header is trusted here; nativeImage still has to decode the file successfully afterwards.
 */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (data.length >= 24 && data.subarray(0, 8).equals(PNG_SIGNATURE) && data.toString('latin1', 12, 16) === 'IHDR') {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
  }
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return undefined
  // JPEG: walk the segments to the frame header (SOF0–SOF15, apart from DHT, JPG and DAC), which holds the size.
  let offset = 2
  while (offset + 9 <= data.length) {
    if (data[offset] !== 0xff) return undefined
    const marker = data[offset + 1]
    if (marker === 0xff) {
      offset += 1
      continue
    }
    // TEM and RST0–RST7 have no length; skip just the marker, as decoders do.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const length = data.readUInt16BE(offset + 2)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) }
    }
    if (length < 2) return undefined
    offset += 2 + length
  }
  return undefined
}

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')

const UNREADABLE = 'That file couldn’t be opened as an image. Choose a JPEG or PNG.'

/**
 * Reads an image the user picked and turns it into a playlist cover: cropped to a centred square, shrunk to at most
 * PLAYLIST_IMAGE_SIZE pixels across, and saved as a JPEG. Decoding it proves it's an image, and re-encoding drops
 * anything else the file carried (such as location metadata).
 */
export async function preparePlaylistImage(filePath: string): Promise<Uint8Array> {
  const size = await stat(filePath).then(
    (stats) => (stats.isFile() ? stats.size : -1),
    () => -1,
  )
  if (size <= 0) throw new Error(UNREADABLE)
  if (size > MAX_SOURCE_BYTES) throw new Error('That image is too large. Choose one under 40 MB.')
  // A small file can still claim an enormous size in pixels, which would take gigabytes to decode, so the size its
  // header gives is checked before decoding.
  const dimensions = imageDimensions(await readFile(filePath))
  if (!dimensions) throw new Error(UNREADABLE)
  if (Math.max(dimensions.width, dimensions.height) > MAX_SOURCE_SIDE) {
    throw new Error(`That image is too large. Choose one under ${MAX_SOURCE_SIDE} pixels across.`)
  }

  const image = nativeImage.createFromPath(filePath)
  if (image.isEmpty()) throw new Error(UNREADABLE)
  const { width, height } = image.getSize()
  const side = Math.min(width, height)
  if (side < 1) throw new Error(UNREADABLE)
  const square = image.crop({
    x: Math.floor((width - side) / 2),
    y: Math.floor((height - side) / 2),
    width: side,
    height: side,
  })
  const target = Math.min(side, PLAYLIST_IMAGE_SIZE)
  const resized = target < side ? square.resize({ width: target, height: target, quality: 'best' }) : square
  const jpeg = resized.toJPEG(85)
  if (jpeg.length === 0) throw new Error(UNREADABLE)
  return new Uint8Array(jpeg)
}
