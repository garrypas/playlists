import { describe, expect, it } from 'vitest'
import type { DjDetails } from '../../../shared/djDetails'
import { camelotCode } from '../../../shared/musicalKey'
import { incomingTimeAt, keyAtRate, keysCompatible, levelsAt, matchRate, planTransition, type Deck } from './djMix'

// A steady track: `bars` bars of kicks at `bpm` from `firstBeat`, phrases from there.
function track(bpm: number, bars: number, { firstBeat = 0, drops = [] as number[] } = {}): DjDetails {
  const beat = 60 / bpm
  const lastBeat = firstBeat + (bars * 4 - 1) * beat
  return {
    soundStart: firstBeat,
    soundEnd: lastBeat + beat,
    loudness: -9,
    grid: { bpm, firstBeat, lastBeat, phraseStart: firstBeat, confidence: 0.95 },
    sections: [],
    drops,
    analysedSeconds: lastBeat + beat,
  }
}

function deck(details: DjDetails | null, overrides: Partial<Deck> = {}): Deck {
  return { bpm: details?.grid?.bpm ?? null, key: null, rate: 1, duration: details?.soundEnd ?? 240, details, ...overrides }
}

describe('matching tempos', () => {
  it('matches 126 BPM to 128 by speeding up 1.6%', () => {
    expect(matchRate(128, 126)).toBeCloseTo(1.01587, 5)
  })

  it('treats 87 BPM as half of 174', () => {
    expect(matchRate(174, 87)).toBeCloseTo(1, 5)
    expect(matchRate(85, 172)).toBeCloseTo(85 / 86, 5)
  })

  it('gives up when the tempos are more than 10% apart, even at half or double time', () => {
    expect(matchRate(120, 150)).toBeUndefined()
  })
})

describe('harmonic mixing', () => {
  it('places keys on the Camelot wheel', () => {
    expect(['C', 'Am', 'G', 'G#m', 'F#', 'Ebm', 'E'].map(camelotCode)).toEqual(['8B', '8A', '9B', '1A', '2B', '2A', '12B'])
  })

  it('blends 8A with 8A, 9A, 7A and 8B, but not 3B or 10A', () => {
    expect(keysCompatible('Am', 'Am')).toBe(true)
    expect(keysCompatible('Am', 'Em')).toBe(true)
    expect(keysCompatible('Am', 'Dm')).toBe(true)
    expect(keysCompatible('Am', 'C')).toBe(true)
    expect(keysCompatible('Am', 'Bb')).toBe(false)
    expect(keysCompatible('Am', 'Bm')).toBe(false)
  })

  it('goes round the wheel from 12 to 1', () => {
    expect(keysCompatible('G#m', 'C#m')).toBe(true)
  })

  it("doesn't judge an unknown key", () => {
    expect(keysCompatible(null, 'Am')).toBeUndefined()
  })

  it('compares keys after the tempo shift', () => {
    expect(keyAtRate('Am', 1.06)).toBe('Bbm')
    expect(keyAtRate('Am', 1.02)).toBe('Am')
  })
})

describe('planning a transition', () => {
  const outgoing = track(120, 128) // 4:16 of beats: phrases every 32 s, the last ending at 256 s

  it('blends over the last 16 bars, phrase against phrase, swapping the bass halfway', () => {
    const plan = planTransition(deck(outgoing, { key: 'Am' }), deck(track(122, 64, { firstBeat: 0.5 }), { key: 'Em' }), 10)!
    expect(plan).toMatchObject({ kind: 'blend', bars: 16, startAt: 224, swapAt: 240, endAt: 256, incomingFrom: 0.5 })
    expect(plan.incomingRate).toBeCloseTo(120 / 122, 6)
    expect(plan.beatmatched).toBe(true)
  })

  it('lands each incoming beat on an outgoing beat for 64 bars, within a millisecond', () => {
    const incoming = track(126.37, 128, { firstBeat: 1.234 })
    const plan = planTransition(deck(outgoing), deck(incoming), 10)!
    const outBeat = 60 / 120
    for (let beat = 0; beat <= 256; beat += 16) {
      const inTime = incomingTimeAt(plan, plan.startAt + beat * outBeat)
      const inBeat = (inTime - incoming.grid!.firstBeat) / (60 / 126.37)
      expect(Math.abs(inBeat - Math.round(inBeat)) * (60 / 120)).toBeLessThan(0.001)
    }
  })

  it('keeps the outgoing speed, matching the next song to the DJ tempo', () => {
    const plan = planTransition(deck(outgoing, { rate: 1.02, key: 'Am' }), deck(track(122, 64), { key: 'Am' }), 10)!
    expect(plan.incomingRate * 122).toBeCloseTo(120 * 1.02, 6)
    // The outgoing song plays faster, so its phrases still fall at the same file times.
    expect(plan.startAt).toBe(224)
  })

  it('keeps the blend short when a key is unknown', () => {
    expect(planTransition(deck(outgoing, { key: 'Am' }), deck(track(120, 64)), 10)).toMatchObject({ kind: 'blend', bars: 8, startAt: 240 })
  })

  it('drop-mixes a clashing key, so the drop lands as the outgoing song stops', () => {
    const plan = planTransition(deck(outgoing, { key: 'Am' }), deck(track(120, 64, { drops: [64] }), { key: 'F#' }), 10)!
    expect(plan).toMatchObject({ kind: 'drop', bars: 16, startAt: 224, incomingFrom: 32, swapAt: 256 })
    expect(levelsAt(plan, 240)).toMatchObject({ outLevel: 1, inLows: 0 })
    expect(levelsAt(plan, 256)).toMatchObject({ inLevel: 1, inLows: 1, outLevel: 1 })
    expect(levelsAt(plan, plan.endAt).outLevel).toBe(0)
  })

  it('cuts on the last phrase when the keys clash and there is no drop', () => {
    expect(planTransition(deck(outgoing, { key: 'Am' }), deck(track(120, 64), { key: 'F#' }), 10)).toMatchObject({
      kind: 'cut',
      startAt: 256,
      beatmatched: true,
    })
  })

  it('cuts at the next song’s own speed when the tempos are 15% apart', () => {
    const plan = planTransition(deck(outgoing), deck(track(140, 64), { rate: 1.03 }), 10)!
    expect(plan).toMatchObject({ kind: 'cut', startAt: 256, incomingRate: 1.03, beatmatched: false })
  })

  it('makes a shorter blend when the song is already past the 16-bar mix-in point', () => {
    expect(planTransition(deck(outgoing, { key: 'Am' }), deck(track(120, 64), { key: 'Am' }), 230)).toMatchObject({ kind: 'blend', bars: 8, startAt: 240 })
  })

  it('cuts on the last phrase line when it’s too late for any blend', () => {
    expect(planTransition(deck(outgoing), deck(track(120, 64)), 250.2)).toMatchObject({ kind: 'cut', startAt: 256 })
  })

  it('cuts on the next bar line once the last phrase line has passed', () => {
    expect(planTransition(deck(track(120, 130)), deck(track(120, 64)), 255.5)).toMatchObject({ kind: 'cut', startAt: 258 })
  })

  it('fades quickly over the last 3 seconds when there is no beat grid', () => {
    const plan = planTransition(deck(null, { duration: 200 }), deck(null), 10)!
    expect(plan).toMatchObject({ kind: 'fade', startAt: 197, endAt: 200, swapAt: 198.5, incomingFrom: 0 })
    // Equal power: halfway, each is at about 71%, so the overall level doesn't dip.
    const halfway = levelsAt(plan, 198.5)
    expect(halfway.outLevel ** 2 + halfway.inLevel ** 2).toBeCloseTo(1, 6)
  })

  it('fades over the last 2 bars when the BPM is known but the beat is too loose to mix on', () => {
    const loose = { ...track(120, 100), grid: { ...track(120, 100).grid!, confidence: 0.2 } }
    expect(planTransition(deck(loose, { duration: 200 }), deck(track(120, 64)), 10)).toMatchObject({ kind: 'fade', startAt: 196 })
  })

  it('does not mix on a grid that stops before the end of a very long file', () => {
    expect(planTransition(deck(outgoing, { duration: 3600 }), deck(track(120, 64)), 10)?.kind).toBe('fade')
  })

  it('plans nothing in the last half second', () => {
    expect(planTransition(deck(null, { duration: 200 }), deck(null), 199.2)).toBeNull()
  })
})

describe('blend levels', () => {
  const plan = planTransition(deck(track(120, 128), { key: 'Am' }), deck(track(120, 64), { key: 'Am' }), 10)!

  it('brings the next song in without its bass, then swaps basslines halfway', () => {
    expect(levelsAt(plan, 200)).toEqual({ outLevel: 1, outLows: 1, inLevel: 0, inLows: 0 })
    const quarter = levelsAt(plan, 232)
    expect(quarter.outLevel).toBeCloseTo(Math.cos(Math.PI / 8), 6)
    expect(quarter.inLevel).toBeCloseTo(Math.sin(Math.PI / 8), 6)
    expect(levelsAt(plan, 240)).toMatchObject({ outLows: 0, inLows: 1 })
    expect(levelsAt(plan, 256)).toMatchObject({ outLevel: expect.closeTo(0, 6), inLevel: 1 })
  })
})
