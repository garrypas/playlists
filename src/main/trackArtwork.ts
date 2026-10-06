import { parseFile, selectCover } from 'music-metadata'

export interface TrackArtwork {
  data: Uint8Array
  mimeType: string
}

// Only raster formats an <img> can show; anything else (e.g. SVG, or a URL in an ID3 "-->" frame) is ignored.
const imageTypes: Record<string, string> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  'image/png': 'image/png',
  png: 'image/png',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
  'image/bmp': 'image/bmp',
}

// Returns the cover picture embedded in an audio file's tags, or undefined if it has none.
export async function readTrackArtwork(filePath: string): Promise<TrackArtwork | undefined> {
  const { common } = await parseFile(filePath, { duration: false, skipPostHeaders: true })
  const cover = selectCover(common.picture)
  const mimeType = cover && imageTypes[cover.format.toLowerCase()]
  if (!cover || !mimeType || cover.data.length === 0) return undefined
  return { data: cover.data, mimeType }
}
