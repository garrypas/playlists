import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { detectKey, parseKey } from './trackKey'
import { mp3 } from './test/mp3'
import { beat, chords, silence } from './test/wav'

let music: string
const file = (name: string): string => join(music, name)

// Chords as MIDI note numbers (60 is middle C), each a bass note and a triad.
const progressions: Record<string, number[][]> = {
  // C, F, G, C
  C: [[48, 60, 64, 67], [53, 60, 65, 69], [55, 59, 62, 67], [48, 60, 64, 67]],
  // Am, Dm, E, Am
  Am: [[45, 57, 60, 64], [50, 57, 62, 65], [52, 56, 59, 64], [45, 57, 60, 64]],
  // E♭m, A♭m, B♭, E♭m
  Ebm: [[51, 63, 66, 70], [56, 63, 68, 71], [46, 58, 62, 65], [51, 63, 66, 70]],
  // F#, B, C#, F#
  'F#': [[54, 61, 66, 70], [47, 59, 63, 66], [49, 61, 65, 68], [54, 61, 66, 70]],
}

beforeAll(() => {
  music = mkdtempSync(join(tmpdir(), 'playlists-key-'))
  for (const [key, progression] of Object.entries(progressions)) writeFileSync(file(`${key}.wav`), chords(progression))
  writeFileSync(file('silence.wav'), silence())
  writeFileSync(file('tagged.mp3'), mp3({ title: 'Tagged', key: '2A' }))
  writeFileSync(file('untagged.mp3'), mp3({ title: 'Untagged' }))
  writeFileSync(file('not-audio.mp3'), 'This is not audio.')
  writeFileSync(file('drums.wav'), beat(120))
})

afterAll(() => {
  rmSync(music, { recursive: true, force: true })
})

describe('detecting a song’s key', () => {
  it.each(Object.keys(progressions))('finds the key of a chord progression in %s', async (key) => {
    expect(await detectKey(file(`${key}.wav`))).toBe(key)
  })

  it('uses the key from the song’s tags when it has one', async () => {
    expect(await detectKey(file('tagged.mp3'))).toBe('Ebm')
  })

  it('finds no key in silence', async () => {
    expect(await detectKey(file('silence.wav'))).toBeUndefined()
    expect(await detectKey(file('untagged.mp3'))).toBeUndefined()
  })

  it('finds no key in drums alone', async () => {
    expect(await detectKey(file('drums.wav'))).toBeUndefined()
  })

  it('fails for a missing file or one that is not audio', async () => {
    await expect(detectKey(file('deleted.mp3'))).rejects.toThrow()
    await expect(detectKey(file('not-audio.mp3'))).rejects.toThrow()
  })
})

describe('reading a key from tags', () => {
  it.each([
    ['Ebm', 'Ebm'],
    ['E♭ minor', 'Ebm'],
    ['D#m', 'Ebm'],
    ['ebmin', 'Ebm'],
    ['2A', 'Ebm'],
    ['7m', 'Ebm'],
    ['8B', 'C'],
    ['1d', 'C'],
    ['A minor', 'Am'],
    ['8A', 'Am'],
    ['Gb', 'F#'],
    ['A#', 'Bb'],
    ['G#m', 'G#m'],
    ['Abm', 'G#m'],
    ['12B', 'E'],
    ['1A', 'G#m'],
  ])('reads “%s” as %s', (tag, key) => {
    expect(parseKey(tag)).toBe(key)
  })

  it.each(['', 'o', 'Off key', '13A', '0B', 'H', 'C major 7'])('ignores “%s”', (tag) => {
    expect(parseKey(tag)).toBeUndefined()
  })
})
