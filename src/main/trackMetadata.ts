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

/** What a song's tags say about it. Anything missing or blank is left out. */
export interface TrackTags {
  title?: string
  artist?: string
  album?: string
  albumArtist?: string
  trackNumber?: number
  discNumber?: number
  durationSeconds?: number
}

// Tags come from arbitrary files, so text is trimmed and capped, and numbers must be sensible.
function text(value: string | undefined): string | undefined {
  const cleaned = value?.trim().slice(0, 500)
  return cleaned || undefined
}

function count(value: number | null | undefined): number | undefined {
  return value && Number.isSafeInteger(value) && value > 0 && value < 10_000 ? value : undefined
}

// Reads a song's tags from the file's headers. Throws if the file is missing or unreadable.
export async function readTrackTags(filePath: string): Promise<TrackTags> {
  const { common, format } = await parseFile(filePath, { duration: false, skipCovers: true, skipPostHeaders: true })
  const duration = format.duration
  return {
    title: text(common.title),
    artist: text(common.artist),
    album: text(common.album),
    albumArtist: text(common.albumartist),
    trackNumber: count(common.track.no),
    discNumber: count(common.disk.no),
    durationSeconds: duration && Number.isFinite(duration) && duration > 0 ? Math.round(duration) : undefined,
  }
}

// Reads tags for many files, a few at a time. Files that can't be read are left out of the result.
export async function readTagsForFiles(filePaths: string[]): Promise<Map<string, TrackTags>> {
  const tags = new Map<string, TrackTags>()
  const pending = [...new Set(filePaths)]
  async function worker(): Promise<void> {
    for (let filePath = pending.shift(); filePath !== undefined; filePath = pending.shift()) {
      try {
        tags.set(filePath, await readTrackTags(filePath))
      } catch {
        // Missing or unreadable files keep their file-name title; they're retried next launch.
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  return tags
}
