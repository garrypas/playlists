import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { detectTempo } from './trackTempo'
import { beat, silence } from './test/wav'

let music: string
const file = (name: string): string => join(music, name)

beforeAll(() => {
  music = mkdtempSync(join(tmpdir(), 'playlists-tempo-'))
  writeFileSync(file('120.wav'), beat(120))
  writeFileSync(file('128.wav'), beat(128))
  writeFileSync(file('intro.wav'), beat(124, 30, { introSeconds: 20 }))
  writeFileSync(file('silence.wav'), silence())
  writeFileSync(file('not-audio.mp3'), 'This is not audio.')
})

afterAll(() => {
  rmSync(music, { recursive: true, force: true })
})

describe('detecting a song’s tempo', () => {
  it.each([120, 128])('finds the tempo of a steady %i BPM beat', async (bpm) => {
    expect(await detectTempo(file(`${bpm}.wav`))).toBeCloseTo(bpm, 0)
  })

  it('finds the tempo of a song whose beat starts after a long intro', async () => {
    expect(await detectTempo(file('intro.wav'))).toBeCloseTo(124, 0)
  })

  it('finds no tempo in a song without a beat', async () => {
    expect(await detectTempo(file('silence.wav'))).toBeUndefined()
  })

  it('fails for a missing file or one that is not audio', async () => {
    await expect(detectTempo(file('deleted.mp3'))).rejects.toThrow()
    await expect(detectTempo(file('not-audio.mp3'))).rejects.toThrow()
  })
})
