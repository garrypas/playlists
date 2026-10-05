import { createReadStream, statSync } from 'node:fs'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'

// The sandboxed renderer can't read local files, so audio is streamed through this scheme.
// URLs look like playlist-audio://track/<trackId>; only tracks saved in a playlist can be served.
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

// Must run before the app is ready.
export function registerAudioScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: AUDIO_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  ])
}

export function handleAudioRequests(getTrackFilePath: (trackId: number) => string | undefined): void {
  protocol.handle(AUDIO_SCHEME, (request) => {
    const url = new URL(request.url)
    const trackId = Number(url.pathname.slice(1))
    if (url.hostname !== 'track' || !Number.isSafeInteger(trackId) || trackId < 1) {
      return new Response(null, { status: 400 })
    }

    const filePath = getTrackFilePath(trackId)
    let size: number
    try {
      if (!filePath) throw new Error('Unknown track.')
      size = statSync(filePath).size
    } catch {
      return new Response(null, { status: 404 })
    }

    const headers = {
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
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    return new Response(streamFile(filePath, start, end), {
      status: 206,
      headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` },
    })
  })
}

function streamFile(filePath: string, start: number, end: number): ReadableStream {
  return Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream
}
