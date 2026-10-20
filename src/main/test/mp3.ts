export interface Mp3Tags {
  title?: string
  artist?: string
  album?: string
  albumArtist?: string
  /** e.g. "3" or "3/12" */
  track?: string
  /** e.g. "1" or "2/2" */
  disc?: string
  /** The song's key as DJ software writes it, e.g. "Ebm" or "2A" */
  key?: string
  picture?: { mimeType: string; data: Buffer }
}

function frame(id: string, body: Buffer): Buffer {
  const size = Buffer.alloc(4)
  size.writeUInt32BE(body.length)
  return Buffer.concat([Buffer.from(id), size, Buffer.from([0, 0]), body])
}

// Text frames use encoding 3 (UTF-8), which ID3v2.3 readers accept in practice.
function textFrame(id: string, value: string): Buffer {
  return frame(id, Buffer.concat([Buffer.from([3]), Buffer.from(value, 'utf8')]))
}

/** A minimal MP3: an ID3v2.3 tag holding the given tags, followed by two silent MPEG frames. */
export function mp3(tags: Mp3Tags = {}): Buffer {
  const textFrames: [string, string | undefined][] = [
    ['TIT2', tags.title],
    ['TPE1', tags.artist],
    ['TALB', tags.album],
    ['TPE2', tags.albumArtist],
    ['TRCK', tags.track],
    ['TPOS', tags.disc],
    ['TKEY', tags.key],
  ]
  const frames = textFrames.flatMap(([id, value]) => (value === undefined ? [] : [textFrame(id, value)]))
  if (tags.picture) {
    const { mimeType, data } = tags.picture
    frames.push(frame('APIC', Buffer.concat([Buffer.from([0]), Buffer.from(`${mimeType}\0`), Buffer.from([3, 0]), data])))
  }
  const tag = Buffer.concat(frames)
  const n = tag.length
  const header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, (n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127])
  const audio = Buffer.alloc(417)
  audio.set([0xff, 0xfb, 0x90, 0x64])
  return Buffer.concat([header, tag, audio, audio])
}
