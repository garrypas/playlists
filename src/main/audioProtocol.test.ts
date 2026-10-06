import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { handleAudioRequests } from './audioProtocol'

const electron = vi.hoisted(() => ({
  handler: undefined as ((request: Request) => Response | Promise<Response>) | undefined,
}))

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: (_scheme: string, handler: (request: Request) => Response | Promise<Response>) => { electron.handler = handler },
  },
}))

let folder: string
const files: Record<number, string> = {}
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex')
const audioBytes = Buffer.from('0123456789abcdefghij')

// A minimal MP3: an ID3v2.3 tag (optionally holding a cover picture) followed by two silent MPEG frames.
function mp3(picture?: { mimeType: string, data: Buffer }): Buffer {
  const frames: Buffer[] = []
  if (picture) {
    const body = Buffer.concat([Buffer.from([0]), Buffer.from(`${picture.mimeType}\0`), Buffer.from([3, 0]), picture.data])
    const size = Buffer.alloc(4)
    size.writeUInt32BE(body.length)
    frames.push(Buffer.concat([Buffer.from('APIC'), size, Buffer.from([0, 0]), body]))
  }
  const tag = Buffer.concat(frames)
  const n = tag.length
  const header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, (n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127])
  const frame = Buffer.alloc(417)
  frame.set([0xff, 0xfb, 0x90, 0x64])
  return Buffer.concat([header, tag, frame, frame])
}

function save(trackId: number, name: string, contents: Buffer): void {
  files[trackId] = join(folder, name)
  writeFileSync(files[trackId], contents)
}

function request(url: string, headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(electron.handler!(new Request(url, { headers })))
}

beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), 'playlists-audio-'))
  save(1, 'song.mp3', audioBytes)
  save(2, 'with-cover.mp3', mp3({ mimeType: 'image/png', data: png }))
  save(3, 'no-cover.mp3', mp3())
  save(4, 'svg-cover.mp3', mp3({ mimeType: 'image/svg+xml', data: Buffer.from('<svg/>') }))
  save(5, 'empty.wav', Buffer.alloc(0))
  files[6] = join(folder, 'deleted.mp3')
  handleAudioRequests((trackId) => files[trackId])
})

afterAll(() => rmSync(folder, { recursive: true, force: true }))

describe('streaming songs', () => {
  it('serves the whole file with its audio type', async () => {
    const response = await request('playlist-audio://track/1')
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg')
    expect(response.headers.get('Accept-Ranges')).toBe('bytes')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(audioBytes)
  })

  it.each([
    ['bytes=5-9', '56789', 'bytes 5-9/20'],
    ['bytes=15-', 'fghij', 'bytes 15-19/20'],
    ['bytes=-3', 'hij', 'bytes 17-19/20'],
    ['bytes=18-99', 'ij', 'bytes 18-19/20'],
  ])('serves the requested part of the file for seeking (%s)', async (range, body, contentRange) => {
    const response = await request('playlist-audio://track/1', { Range: range })
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe(contentRange)
    expect(await response.text()).toBe(body)
  })

  it('refuses a range past the end of the file', async () => {
    const response = await request('playlist-audio://track/1', { Range: 'bytes=50-60' })
    expect(response.status).toBe(416)
    expect(response.headers.get('Content-Range')).toBe('bytes */20')
  })

  it('serves an empty file as empty', async () => {
    const response = await request('playlist-audio://track/5')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
  })

  it.each([
    ['a song that is not in any playlist', 'playlist-audio://track/99'],
    ['a song whose file has been deleted', 'playlist-audio://track/6'],
  ])('reports %s as not found', async (_case, url) => {
    expect((await request(url)).status).toBe(404)
  })

  it.each([
    'playlist-audio://track/abc',
    'playlist-audio://track/0',
    'playlist-audio://track/-1',
    'playlist-audio://track/1.5',
    'playlist-audio://other/1',
    'playlist-audio://track/..%2F..%2Fetc%2Fpasswd',
  ])('rejects the malformed address %s', async (url) => {
    expect((await request(url)).status).toBe(400)
  })
})

describe('song artwork', () => {
  it('serves the cover picture embedded in the file', async () => {
    const response = await request('playlist-audio://artwork/2')
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png)
  })

  it.each([
    ['a file with no cover', 3],
    ['a cover in a format the app does not show', 4],
    ['a file that is not really audio', 1],
    ['a file that has been deleted', 6],
    ['a song that is not in any playlist', 99],
  ])('reports no artwork for %s', async (_case, trackId) => {
    expect((await request(`playlist-audio://artwork/${trackId}`)).status).toBe(404)
  })
})
