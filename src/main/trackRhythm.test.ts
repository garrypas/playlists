import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { detectRhythm } from './trackRhythm'
import { beat, silence, song } from './test/wav'

let music: string
const file = (name: string): string => join(music, name)

// 126 BPM: 1 s of silence, 16 bars of kick and bass, a 16-bar breakdown of bass alone (30 s without a beat), 32 bars of
// kick and bass again, then a quiet 8-bar outro.
const bar126 = (4 * 60) / 126
const structured = [
  { bars: 16, kick: true, pad: true },
  { bars: 16, pad: true },
  { bars: 32, kick: true, pad: true },
  { bars: 8, pad: true, level: 0.05 },
]
// 138.7 BPM trance, DJ-friendly: 16 bars of kick alone, then a sidechained bassline on every off-beat (rising more
// sharply than the kick, but quieter) with open hi-hats, a breakdown of the bassline alone, the kick, bassline and hats
// again, and a 16-bar outro of kick alone.
const trance = [
  { bars: 16, kick: true },
  { bars: 32, kick: true, offbeatBass: true, hats: true },
  { bars: 16, offbeatBass: true },
  { bars: 64, kick: true, offbeatBass: true, hats: true },
  { bars: 16, kick: true },
]
// 126 BPM, after 1 s of silence: 16 bars of pad alone, 16 bars where the kick comes in on the third beat, an 8-bar
// breakdown, then 32 bars with the kick back on the bar line.
const beat126 = 60 / 126
const lateKick = [
  { bars: 16, pad: true },
  { bars: 16, kick: true, pad: true, kickFromBeat: 2 },
  { bars: 8, pad: true },
  { bars: 32, kick: true, pad: true },
]

beforeAll(() => {
  music = mkdtempSync(join(tmpdir(), 'playlists-rhythm-'))
  writeFileSync(file('120.wav'), beat(120))
  writeFileSync(file('128.wav'), beat(128))
  writeFileSync(file('intro.wav'), beat(124, 30, { introSeconds: 20 }))
  writeFileSync(file('structured.wav'), song(126, structured, { silenceSeconds: 1 }))
  writeFileSync(file('six-minutes.wav'), song(128, [{ bars: 192, kick: true, pad: true }]))
  writeFileSync(file('trance.wav'), song(138.7, trance))
  writeFileSync(file('late-kick.wav'), song(126, lateKick, { silenceSeconds: 1 }))
  writeFileSync(file('silence.wav'), silence())
  writeFileSync(file('not-audio.mp3'), 'This is not audio.')
})

afterAll(() => {
  rmSync(music, { recursive: true, force: true })
})

describe('detecting a song’s tempo', () => {
  it.each([120, 128])('finds the tempo of a steady %i BPM beat', async (bpm) => {
    expect((await detectRhythm(file(`${bpm}.wav`))).bpm).toBeCloseTo(bpm, 0)
  })

  it('finds the tempo of a song whose beat starts after a long intro', async () => {
    expect((await detectRhythm(file('intro.wav'))).bpm).toBeCloseTo(124, 0)
  })

  it('finds no tempo in a song without a beat', async () => {
    expect((await detectRhythm(file('silence.wav'))).bpm).toBeUndefined()
  })

  it('fails for a missing file or one that is not audio', async () => {
    await expect(detectRhythm(file('deleted.mp3'))).rejects.toThrow()
    await expect(detectRhythm(file('not-audio.mp3'))).rejects.toThrow()
  })
})

describe('finding what a DJ needs to mix a song', () => {
  it.each([120, 128])('puts a %i BPM beat on a grid starting at the first kick', async (bpm) => {
    const { grid } = (await detectRhythm(file(`${bpm}.wav`))).dj
    expect(grid?.bpm).toBeCloseTo(bpm, 2)
    expect(grid?.firstBeat).toBeCloseTo(0, 1)
    expect(grid?.lastBeat).toBeCloseTo(30 - 60 / bpm, 1)
    expect(grid?.phraseStart).toBe(grid?.firstBeat)
    expect(grid?.confidence).toBeGreaterThan(0.9)
  })

  it('measures the tempo exactly enough to stay within 5 ms of the beat for 64 bars', async () => {
    const { grid } = (await detectRhythm(file('structured.wav'))).dj
    const driftPerBeat = Math.abs(60 / grid!.bpm - 60 / 126)
    expect(driftPerBeat * 64 * 4).toBeLessThan(0.005)
  })

  it('starts the grid and the first phrase where the kick comes in after a beatless intro', async () => {
    const { grid, sections } = (await detectRhythm(file('intro.wav'))).dj
    expect(grid?.firstBeat).toBeCloseTo(20, 1)
    expect(grid?.phraseStart).toBeCloseTo(20, 1)
    // The last kick fades out a moment before the file ends.
    expect(sections.map((section) => section.kind)).toEqual(['beatless', 'beat', 'silent'])
    expect(sections[1].start).toBeCloseTo(20, 1)
  })

  it('finds the silence, the beat, a long breakdown, the drop and the quiet outro, on bar lines', async () => {
    const { dj } = await detectRhythm(file('structured.wav'))
    const barLine = (bars: number): number => 1 + bars * bar126
    expect(dj.soundStart).toBeCloseTo(1, 1)
    expect(dj.soundEnd).toBeCloseTo(barLine(72), 1)
    expect(dj.grid?.firstBeat).toBeCloseTo(1, 1)
    expect(dj.grid?.phraseStart).toBeCloseTo(1, 1)
    expect(dj.sections.map((section) => section.kind)).toEqual(['silent', 'beat', 'beatless', 'beat', 'quiet'])
    dj.sections.slice(1).forEach((section, i) => expect(section.start).toBeCloseTo(barLine([0, 16, 32, 64][i]), 1))
    expect(dj.sections.at(-1)?.end).toBeCloseTo(barLine(72), 1)
    expect(dj.drops).toHaveLength(1)
    expect(dj.drops[0]).toBeCloseTo(barLine(32), 1)
    expect(dj.grid?.confidence).toBeGreaterThan(0.9)
    expect(dj.analysedSeconds).toBeCloseTo(barLine(72), 1)
  })

  it('measures how loud each bar is, to tell an intro, a breakdown or an outro from the main part', async () => {
    const levels = (await detectRhythm(file('structured.wav'))).dj.grid!.barLevels!
    expect(levels.from).toBeCloseTo(1, 1)
    expect(levels.db.length).toBeGreaterThanOrEqual(71)
    const average = (from: number, to: number): number =>
      levels.db.slice(from, to).reduce((total, db) => total + db, 0) / (to - from)
    // The breakdown has the pad without the kick; the outro is the pad at 5%, about 26 dB down.
    expect(average(16, 32)).toBeLessThan(average(0, 16))
    expect(average(32, 64)).toBeCloseTo(average(0, 16), 0)
    expect(average(64, 70)).toBeCloseTo(average(16, 32) - 26, -1)
  })

  it('puts the grid on the kicks, not on an off-beat bassline that rises more sharply', async () => {
    const { grid } = (await detectRhythm(file('trance.wav'))).dj
    expect(grid?.bpm).toBeCloseTo(138.7, 2)
    expect(grid?.firstBeat).toBeCloseTo(0, 2)
    expect(grid?.phraseStart).toBeCloseTo(0, 2)
  })

  it('starts phrases on the bar lines where the music changes, not on a kick that comes in mid-bar', async () => {
    const { grid } = (await detectRhythm(file('late-kick.wav'))).dj
    expect(grid?.firstBeat).toBeCloseTo(1 + 66 * beat126, 1)
    // The first 16-bar line after the first kick, where the breakdown starts.
    expect(grid?.phraseStart).toBeCloseTo(1 + 128 * beat126, 1)
  })

  it('measures how loud the song is, ignoring silence and quiet parts', async () => {
    const quietFirst = (await detectRhythm(file('structured.wav'))).dj.loudness!
    const steady = (await detectRhythm(file('six-minutes.wav'))).dj.loudness!
    expect(quietFirst).toBeLessThan(0)
    expect(quietFirst).toBeCloseTo(steady, 0)
  })

  it('has no grid, sound or loudness for a silent song', async () => {
    expect((await detectRhythm(file('silence.wav'))).dj).toEqual({
      soundStart: null,
      soundEnd: null,
      loudness: null,
      grid: null,
      sections: [{ kind: 'silent', start: 0, end: 10 }],
      drops: [],
      analysedSeconds: 10,
    })
  })

  it('analyses a six-minute song in well under 5 seconds', async () => {
    const started = performance.now()
    const { bpm, dj } = await detectRhythm(file('six-minutes.wav'))
    expect(performance.now() - started).toBeLessThan(5000)
    expect(bpm).toBe(128)
    expect(dj.analysedSeconds).toBeCloseTo(360, 0)
  })
})
