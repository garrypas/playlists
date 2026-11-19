import type { BeatGrid, DjDetails } from '../../../shared/djDetails'
import { camelotCode, transposeKey } from '../../../shared/musicalKey'
import { MAX_TEMPO_CHANGE } from '../../../shared/playlist'

// The pure maths of DJ mode: matching tempos and keys, and planning how one song mixes into the next. Times are
// seconds into a file at normal speed ("file time") unless they say otherwise; nothing here touches audio or React.

/** A song on a deck, as the planner sees it. */
export interface Deck {
  /** The song's BPM (to 0.1), used only when it has no beat grid. */
  bpm: number | null
  key: string | null
  /** How fast the deck plays it: 1 + tempo / 100. For the incoming song, the speed it plays at if it isn't matched. */
  rate: number
  /** The file's length in seconds. */
  duration: number
  details: DjDetails | null
}

export type TransitionKind = 'blend' | 'filter' | 'cut' | 'fade'

/**
 * How the playing (outgoing) song hands over to the next (incoming) one. Every moment is in the outgoing song's file
 * time, which keeps running until the outgoing song stops.
 */
export interface TransitionPlan {
  kind: TransitionKind
  /** The blend's or filter fade's length in bars; 0 for a cut or a quick fade. */
  bars: number
  /**
   * When the transition starts to be heard: `startAt`, except in a filter fade into a song that opens on its beat,
   * where the outgoing song filters out for a few bars before the incoming one comes in.
   */
  sweepFrom: number
  /** When the incoming song comes in. */
  startAt: number
  /** Where in the incoming song it comes in (its file time at `startAt`). */
  incomingFrom: number
  /** The speed the incoming song plays at. */
  incomingRate: number
  /** Incoming file seconds per outgoing file second: incomingRate / the outgoing rate. */
  ratio: number
  /** Whether the beats are matched, so the decks must be kept in phase. */
  beatmatched: boolean
  /** When the incoming song becomes the playing song. */
  swapAt: number
  /** When the outgoing song is silent and stops. */
  endAt: number
}

/**
 * How loud each deck is (0–1), whether its bass is in (0 cut, 1 full), and how far its sweep filter is closed (0 open,
 * 1 fully closed), at one moment of a transition. The outgoing song's filter is a high-pass (sweeping up, taking the
 * bass and then the body away); the incoming song's is a low-pass (opening up from a muffled sound).
 */
export interface MixLevels {
  outLevel: number
  outLows: number
  outHighPass: number
  inLevel: number
  inLows: number
  inLowPass: number
}

/** Grids below this confidence don't hold a beat well enough to mix on. */
const MIN_GRID_CONFIDENCE = 0.5
/** The incoming song needs this much warning (seconds) to load and start. */
const MIN_LEAD_SECONDS = 1
/** A quick fade's length when there's no beat to count bars in. */
const FADE_SECONDS = 3
/** A filter fade's lengths to try, in the outgoing song's bars. */
const FILTER_BARS = [4, 2]
/** An incoming song with at least this many bars before its first kick opens without a beat. */
const BEATLESS_INTRO_BARS = 4
/** A blend's lengths to try, in bars: as long as there's room for, shorter when the keys clash. */
const BLEND_BARS = [32, 16, 8]
const CLASHING_BLEND_BARS = [16, 8]
/**
 * Where the incoming song may come in: on its phrase lines, up to this many bars after its first one, when its intro
 * has less energy than the outgoing song's outro.
 */
const ENTRY_STEP_BARS = 16
const MAX_ENTRY_BARS = 64
/** How much quieter (dB, each against its own usual level) the incoming song may be as it takes over. */
const ENERGY_DROP_DB = 3

export function secondsPerBeat(bpm: number): number {
  return 60 / bpm
}

/**
 * The speed (1 = normal) that brings `bpmIn` to `targetBpm`, trying half and double time as well, since detectors
 * often report 87 for a 174 BPM song. Undefined if no candidate is within the tempo control's ±10%.
 */
export function matchRate(targetBpm: number, bpmIn: number): number | undefined {
  let best: number | undefined
  for (const multiple of [1, 2, 0.5]) {
    const rate = targetBpm / (bpmIn * multiple)
    if (Math.abs(rate - 1) <= MAX_TEMPO_CHANGE / 100 + 1e-9 && (best === undefined || Math.abs(rate - 1) < Math.abs(best - 1))) {
      best = rate
    }
  }
  return best
}

/** The key a song plays in at `rate`, since pitch moves with speed (rounded to the nearest semitone). */
export function keyAtRate(key: string, rate: number): string | undefined {
  return transposeKey(key, Math.round(12 * Math.log2(rate)) || 0)
}

/**
 * Whether two keys mix harmonically on the Camelot wheel: the same key, one step either way with the same letter
 * (a fifth apart), or the relative major or minor. Undefined if either key is unknown.
 */
export function keysCompatible(a: string | null, b: string | null): boolean | undefined {
  const codeA = a === null ? undefined : camelotCode(a)
  const codeB = b === null ? undefined : camelotCode(b)
  if (!codeA || !codeB) return undefined
  const numberA = Number(codeA.slice(0, -1))
  const numberB = Number(codeB.slice(0, -1))
  const steps = Math.min((numberA - numberB + 12) % 12, (numberB - numberA + 12) % 12)
  return codeA.at(-1) === codeB.at(-1) ? steps <= 1 : steps === 0
}

// A grid good enough to mix on, or null.
function usableGrid(details: DjDetails | null): BeatGrid | null {
  const grid = details?.grid
  return grid && grid.confidence >= MIN_GRID_CONFIDENCE ? grid : null
}

/**
 * Where a song's music ends: the end of its last section with a beat or sound at its usual level, or of its last bar
 * of beats if that's later, and never after `songEnd`. An outro that drops the kick but carries on (pads, the
 * bassline) is still music to mix over; a fade into near silence isn't.
 */
function musicEnd(details: DjDetails, grid: BeatGrid, songEnd: number): number {
  const lastBar = grid.lastBeat + secondsPerBeat(grid.bpm)
  const sounding = details.sections.filter((section) => section.kind === 'beat' || section.kind === 'beatless')
  return Math.min(Math.max(lastBar, sounding.at(-1)?.end ?? lastBar), songEnd)
}

/**
 * The last line every `bars` bars (counted from the phrase start) at or before `end`, where the song's music ends:
 * where a mix out of the song should finish.
 */
function mixOutLine(grid: BeatGrid, bars: number, end: number): number {
  const step = bars * 4 * secondsPerBeat(grid.bpm)
  return grid.phraseStart + Math.floor((end + 0.05 - grid.phraseStart) / step) * step
}

/**
 * How much energy a song has between two of its file times, against its own louder parts (dB; 0 is as much as usual),
 * or undefined if that isn't known. It's the average of the whole sound's level and the low end's, each against the
 * song's 75th-percentile bar: an intro of drums alone can be nearly as loud as the full song but lack its bassline.
 */
function energyBetween(grid: BeatGrid, from: number, to: number): number | undefined {
  const levels = grid.barLevels
  if (!levels) return undefined
  const bar = 4 * secondsPerBeat(grid.bpm)
  const first = Math.max(0, Math.round((from - levels.from) / bar))
  const last = Math.min(levels.db.length, Math.round((to - levels.from) / bar))
  if (last <= first) return undefined
  const against = (db: number[]): number => {
    const usual = [...db].sort((a, b) => a - b)[Math.floor(db.length * 0.75)]
    return db.slice(first, last).reduce((total, level) => total + level - usual, 0) / (last - first)
  }
  return (against(levels.db) + against(levels.lowDb)) / 2
}

// Whether the song has a beat at `time`.
function hasBeatAt(details: DjDetails, time: number): boolean {
  return details.sections.some((section) => section.kind === 'beat' && section.start <= time && time < section.end)
}

/**
 * Where the incoming song comes in, for a blend from `startAt` to `end` (outgoing file time), as a DJ cues it: its
 * first phrase, unless that leaves it with clearly less energy than the outgoing song as it takes over (its level over
 * the blend's second half, against the outgoing song's over the first, each against its own usual level). Then the
 * first later phrase line with a beat that has the energy (up to `MAX_ENTRY_BARS` in), or failing that the one with
 * the most.
 */
function entryPoint(
  outGrid: BeatGrid,
  incoming: Deck,
  inGrid: BeatGrid,
  startAt: number,
  end: number,
  ratio: number,
): number {
  const details = incoming.details!
  const length = (end - startAt) * ratio
  const target = energyBetween(outGrid, startAt, (startAt + end) / 2)
  const phrase = ENTRY_STEP_BARS * 4 * secondsPerBeat(inGrid.bpm)
  const candidates: { from: number; energy: number }[] = []
  for (let step = 0; step <= MAX_ENTRY_BARS / ENTRY_STEP_BARS; step++) {
    const from = inGrid.phraseStart + step * phrase
    if (from + length > Math.min(incoming.duration, details.analysedSeconds)) break
    if (step > 0 && !hasBeatAt(details, from + 0.01)) continue
    const energy = energyBetween(inGrid, from + length / 2, from + length)
    if (energy === undefined) break
    candidates.push({ from, energy })
  }
  if (target === undefined || candidates.length === 0) return inGrid.phraseStart
  const enough = candidates.find((candidate) => candidate.energy >= target - ENERGY_DROP_DB)
  if (enough) return enough.from
  const loudest = candidates.reduce((best, candidate) => (candidate.energy > best.energy ? candidate : best))
  return loudest.energy >= candidates[0].energy + ENERGY_DROP_DB ? loudest.from : candidates[0].from
}

// The first bar line in the song at or after `time`.
function nextBarLine(grid: BeatGrid, time: number): number {
  const bar = 4 * secondsPerBeat(grid.bpm)
  return grid.phraseStart + Math.ceil((time - grid.phraseStart - 1e-6) / bar) * bar
}

/**
 * Plans how `outgoing` hands over to `incoming`, with `now` the outgoing song's current file time. In order of
 * preference:
 * - a phrase-matched **blend** over the outgoing song's last 32 bars when the tempos match within ±10%, or its last 16
 *   when the keys clash (or shorter when that doesn't fit). The incoming song comes in on its first phrase, or a later
 *   one if its intro has clearly less energy than the outgoing song's outro;
 * - a **filter fade** onto the outgoing song's last phrase line when the beats can't be matched: its high-pass sweeps
 *   up over 4 (or 2) bars. An incoming song that opens without a beat fades in over the same bars, its low-pass
 *   opening; one that opens on its beat comes in on the line, so two unmatched beats never play together;
 * - a **cut** on the next bar line when it's too late for anything else;
 * - a **quick fade** at the end when the outgoing song has no beat grid.
 * Returns null when the outgoing song is too near its end to mix at all.
 */
export function planTransition(outgoing: Deck, incoming: Deck, now: number): TransitionPlan | null {
  const songEnd = Math.min(outgoing.duration, outgoing.details?.soundEnd ?? outgoing.duration)
  const outGrid = outgoing.details && outgoing.duration <= outgoing.details.analysedSeconds + 1 ? usableGrid(outgoing.details) : null
  const inGrid = usableGrid(incoming.details)
  const earliest = now + MIN_LEAD_SECONDS

  if (outGrid) {
    const outBar = 4 * secondsPerBeat(outGrid.bpm)
    const outEnd = musicEnd(outgoing.details!, outGrid, songEnd)
    const matched = inGrid ? matchRate(outGrid.bpm * outgoing.rate, inGrid.bpm) : undefined
    const incomingRate = matched ?? incoming.rate
    const ratio = incomingRate / outgoing.rate
    const base = { incomingRate, ratio, beatmatched: matched !== undefined }

    if (inGrid && matched !== undefined) {
      const inKey = incoming.key === null ? null : (keyAtRate(incoming.key, matched) ?? null)
      const outKey = outgoing.key === null ? null : (keyAtRate(outgoing.key, outgoing.rate) ?? null)
      // Clashing keys get a shorter blend, so they overlap for less time.
      for (const bars of keysCompatible(outKey, inKey) === false ? CLASHING_BLEND_BARS : BLEND_BARS) {
        const end = mixOutLine(outGrid, bars, outEnd)
        const startAt = end - bars * outBar
        if (startAt < earliest || startAt < outGrid.firstBeat - 0.05) continue
        if (inGrid.phraseStart + (end - startAt) * ratio > incoming.duration) continue
        const incomingFrom = entryPoint(outGrid, incoming, inGrid, startAt, end, ratio)
        const swapAt = (startAt + end) / 2
        return { kind: 'blend', bars, startAt, sweepFrom: startAt, incomingFrom, swapAt, endAt: end, ...base }
      }
    }

    const end = mixOutLine(outGrid, 16, outEnd)
    const soundStart = incoming.details?.soundStart ?? 0
    const opensBeatless =
      !inGrid || soundStart <= inGrid.firstBeat - BEATLESS_INTRO_BARS * 4 * secondsPerBeat(inGrid.bpm)

    // A filter fade onto the last phrase line.
    for (const bars of FILTER_BARS) {
      const sweepFrom = end - bars * outBar
      if (sweepFrom < earliest || sweepFrom < outGrid.firstBeat - 0.05) continue
      if (opensBeatless) {
        if (soundStart + (end - sweepFrom) * ratio > incoming.duration) continue
        const swapAt = (sweepFrom + end) / 2
        return { kind: 'filter', bars, startAt: sweepFrom, sweepFrom, incomingFrom: soundStart, swapAt, endAt: end, ...base }
      }
      return { kind: 'filter', bars, startAt: end, sweepFrom, incomingFrom: inGrid!.phraseStart, swapAt: end, endAt: end, ...base }
    }

    // Too late for that: a cut on the next bar line.
    const cutAt = nextBarLine(outGrid, earliest)
    if (cutAt <= songEnd) {
      const incomingFrom = inGrid?.phraseStart ?? soundStart
      return { kind: 'cut', bars: 0, startAt: cutAt, sweepFrom: cutAt, incomingFrom, swapAt: cutAt, endAt: cutAt, ...base }
    }
  }

  // A quick equal-power fade over the last 2 bars (or 3 seconds), at the incoming song's own speed.
  const outBpm = outGrid?.bpm ?? outgoing.bpm
  const fade = outBpm ? 8 * secondsPerBeat(outBpm) : FADE_SECONDS
  const endAt = songEnd
  const startAt = Math.max(endAt - fade, earliest)
  if (endAt - startAt < 0.5) return null
  return {
    kind: 'fade',
    bars: 0,
    startAt,
    sweepFrom: startAt,
    incomingFrom: incoming.details?.soundStart ?? 0,
    incomingRate: incoming.rate,
    ratio: incoming.rate / outgoing.rate,
    beatmatched: false,
    swapAt: (startAt + endAt) / 2,
    endAt,
  }
}

// 0 at `from`, 1 at `to`, clamped.
function progress(time: number, from: number, to: number): number {
  if (to <= from) return time >= to ? 1 : 0
  return Math.min(1, Math.max(0, (time - from) / (to - from)))
}

/** How loud each deck is, and whether its bass is in, at outgoing file time `time`. */
export function levelsAt(plan: TransitionPlan, time: number): MixLevels {
  const swapped = time >= plan.swapAt
  const open = { outHighPass: 0, inLowPass: 0 }
  switch (plan.kind) {
    case 'blend': {
      // Equal power over the whole blend, so the overall level doesn't dip, and the basslines swap halfway.
      const x = progress(time, plan.startAt, plan.endAt)
      return {
        outLevel: Math.cos((x * Math.PI) / 2),
        outLows: swapped ? 0 : 1,
        inLevel: time < plan.startAt ? 0 : Math.sin((x * Math.PI) / 2),
        inLows: swapped ? 1 : 0,
        ...open,
      }
    }
    case 'filter': {
      // The outgoing song's high-pass sweeps up to the line, where it's gone.
      const x = progress(time, plan.sweepFrom, plan.endAt)
      const done = time >= plan.endAt
      if (plan.startAt >= plan.endAt) {
        // Into a beat: the incoming song comes in, unfiltered, on the line.
        return done
          ? { outLevel: 0, outLows: 1, outHighPass: 1, inLevel: 1, inLows: 1, inLowPass: 0 }
          : { outLevel: 1, outLows: 1, outHighPass: x, inLevel: 0, inLows: 1, inLowPass: 0 }
      }
      // Into a beatless intro: it fades in as its low-pass opens. The levels add up to 1, as the beats aren't matched.
      const out = done ? 0 : Math.cos((x * Math.PI) / 2) ** 2
      return { outLevel: out, outLows: 1, outHighPass: x, inLevel: time < plan.startAt ? 0 : 1 - out, inLows: 1, inLowPass: 1 - x }
    }
    case 'cut':
      return swapped
        ? { outLevel: 0, outLows: 1, inLevel: 1, inLows: 1, ...open }
        : { outLevel: 1, outLows: 1, inLevel: 0, inLows: 1, ...open }
    case 'fade': {
      // The songs aren't beatmatched, so they can peak together: the levels always add up to 1 (half each in the
      // middle), which can never go over full scale, unlike equal power (71% each). The basslines swap halfway.
      const x = progress(time, plan.startAt, plan.endAt)
      const out = Math.cos((x * Math.PI) / 2) ** 2
      return { outLevel: out, outLows: swapped ? 0 : 1, inLevel: time < plan.startAt ? 0 : 1 - out, inLows: swapped ? 1 : 0, ...open }
    }
  }
}

/** Where the incoming song should be (its file time) when the outgoing song is at `outgoingTime`. */
export function incomingTimeAt(plan: TransitionPlan, outgoingTime: number): number {
  return plan.incomingFrom + (outgoingTime - plan.startAt) * plan.ratio
}

/** Where the outgoing song is (its file time) when the incoming song is at `incomingTime`. */
export function outgoingTimeAt(plan: TransitionPlan, incomingTime: number): number {
  return plan.startAt + (incomingTime - plan.incomingFrom) / plan.ratio
}

/**
 * The speed to play a deck that's `errorSeconds` (real time) ahead of where it should be (negative: behind), to
 * bring it back into phase within a few seconds, as a DJ nudges a jog wheel. While it's silent it may move further.
 */
export function nudgedRate(rate: number, errorSeconds: number, silent: boolean): number {
  if (Math.abs(errorSeconds) < 0.004) return rate
  const limit = silent ? 0.05 : 0.015
  return rate * (1 - Math.min(limit, Math.max(-limit, errorSeconds)))
}

/** The plan's short name, e.g. "16-bar blend" or "Filter fade". */
export function transitionName(plan: TransitionPlan): string {
  return { blend: `${plan.bars}-bar blend`, filter: 'Filter fade', cut: 'Cut', fade: 'Quick fade' }[plan.kind]
}
