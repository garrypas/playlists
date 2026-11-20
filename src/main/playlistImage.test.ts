import { describe, expect, it, vi } from 'vitest'
import { imageDimensions } from './playlistImage'

vi.mock('electron', () => ({ nativeImage: {} }))

function png(width: number, height: number): Uint8Array {
  const header = Buffer.alloc(24)
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(header)
  header.writeUInt32BE(width, 16)
  header.writeUInt32BE(height, 20)
  return header
}

// A JPEG start: an APP0 (JFIF) segment, then a frame header of the given kind with the size.
function jpeg(width: number, height: number, frameMarker = 0xc0): Uint8Array {
  const app0 = Buffer.from('ffe000104a46494600010100000100010000', 'hex')
  const frame = Buffer.alloc(19)
  frame.writeUInt16BE(0xff00 | frameMarker, 0)
  frame.writeUInt16BE(17, 2)
  frame[4] = 8
  frame.writeUInt16BE(height, 5)
  frame.writeUInt16BE(width, 7)
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, frame])
}

describe('reading an image’s size from its header', () => {
  it('reads a PNG’s width and height', () => {
    expect(imageDimensions(png(1200, 800))).toEqual({ width: 1200, height: 800 })
  })

  it('reads a JPEG’s width and height, baseline or progressive', () => {
    expect(imageDimensions(jpeg(640, 480))).toEqual({ width: 640, height: 480 })
    expect(imageDimensions(jpeg(30000, 20000, 0xc2))).toEqual({ width: 30000, height: 20000 })
  })

  it('skips markers with no length, so a crafted file can’t hide its real size', () => {
    const real = jpeg(30000, 30000)
    // A restart marker, then bytes that would read as a short segment hiding a fake 10×10 frame header.
    const crafted = Buffer.concat([real.subarray(0, 2), Buffer.from([0xff, 0xd0]), real.subarray(2)])
    expect(imageDimensions(crafted)).toEqual({ width: 30000, height: 30000 })
  })

  it('gives up on damaged headers rather than reading past the end', () => {
    expect(imageDimensions(Buffer.from([0xff, 0xd8, ...new Array(40).fill(0xff)]))).toBeUndefined()
    expect(imageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))).toBeUndefined()
  })

  it('knows nothing about files that are not PNG or JPEG, or are cut short', () => {
    expect(imageDimensions(Buffer.from('hello'))).toBeUndefined()
    expect(imageDimensions(png(10, 10).subarray(0, 20))).toBeUndefined()
    expect(imageDimensions(jpeg(10, 10).subarray(0, 12))).toBeUndefined()
  })
})
