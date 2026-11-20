import { createReadStream, statSync } from 'node:fs'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { readTrackArtwork } from './trackMetadata'

// The sandboxed renderer can't read local files, so audio is streamed through this scheme.
// URLs look like playlist-audio://track/<trackId>, or playlist-audio://artwork/<trackId> for the
// cover embedded in that file. Only tracks saved in a playlist can be served. playlist-audio://playlist-image/<playlistId>
// serves the cover image the user chose for a playlist (a JPEG kept in the database).
export const AUDIO_SCHEME = 'playlist-audio'

const mimeTypes: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.aiff': 'audio/aiff',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
}

// Must run before the app is ready. `corsEnabled`, with the header below, lets DJ mode route the window's <audio>
// elements (crossOrigin="anonymous") through Web Audio for its bass controls; without it Web Audio hears silence.
export function registerAudioScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: AUDIO_SCHEME,
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true },
    },
  ])
}

// Only this app's own window can load this scheme (navigation and new windows are denied), and it serves only songs
// saved in a playlist, so any origin may read them.
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' }

const ROUTES = new Set(['track', 'artwork', 'playlist-image'])

export function handleAudioRequests(
  getTrackFilePath: (trackId: number) => string | undefined,
  getPlaylistImage: (playlistId: number) => Uint8Array | undefined,
): void {
  protocol.handle(AUDIO_SCHEME, (request) => {
    const url = new URL(request.url)
    const id = Number(url.pathname.slice(1))
    if (!ROUTES.has(url.hostname) || !/^\/\d+$/.test(url.pathname) || !Number.isSafeInteger(id) || id < 1) {
      return new Response(null, { status: 400 })
    }
    if (url.hostname === 'playlist-image') return playlistImageResponse(getPlaylistImage(id))
    const trackId = id
    if (url.hostname === 'artwork') return artworkResponse(getTrackFilePath(trackId))

    const filePath = getTrackFilePath(trackId)
    let size: number
    try {
      if (!filePath) throw new Error('Unknown track.')
      size = statSync(filePath).size
    } catch {
      return new Response(null, { status: 404, headers: CORS_HEADERS })
    }

    const headers = {
      ...CORS_HEADERS,
      'Content-Type': mimeTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
    }
    if (size === 0) return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': '0' } })

    // Audio elements request byte ranges so they can seek.
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('Range') ?? '')
    if (!range || (range[1] === '' && range[2] === '')) {
      return new Response(streamFile(filePath, 0, size - 1), {
        status: 200,
        headers: { ...headers, 'Content-Length': String(size) },
      })
    }

    const start = range[1] === '' ? Math.max(0, size - Number(range[2])) : Number(range[1])
    const end = range[1] === '' || range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1)
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...CORS_HEADERS, 'Content-Range': `bytes */${size}` } })
    }
    return new Response(streamFile(filePath, start, end), {
      status: 206,
      headers: {
        ...headers,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
      },
    })
  })
}

// 404 means "no image": the playlist shows its gradient and symbol instead.
function playlistImageResponse(image: Uint8Array | undefined): Response {
  if (!image) return new Response(null, { status: 404 })
  return new Response(image.slice(), {
    status: 200,
    headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(image.length) },
  })
}

// 404 means "no artwork"; the renderer shows its generic icon instead.
async function artworkResponse(filePath: string | undefined): Promise<Response> {
  try {
    const artwork = filePath ? await readTrackArtwork(filePath) : undefined
    if (!artwork) return new Response(null, { status: 404 })
    return new Response(artwork.data.slice(), {
      status: 200,
      headers: { 'Content-Type': artwork.mimeType, 'Content-Length': String(artwork.data.length) },
    })
  } catch {
    return new Response(null, { status: 404 })
  }
}

function streamFile(filePath: string, start: number, end: number): ReadableStream {
  return Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream
}
