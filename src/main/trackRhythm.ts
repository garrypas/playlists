import MusicTempo from 'music-tempo'
import type { BeatGrid, DjDetails, DjSection, DjSectionKind } from '../shared/djDetails'
import { decodeAudio } from './audioDecoding'

/** A song's BPM (to 0.1; undefined with no steady beat) and what a DJ needs to mix it. */
export interface RhythmAnalysis {
  bpm: number | undefined
  dj: DjDetails
}

// One plain decode feeds everything. A kick's energy is below 150 Hz, so 11,025 samples a second is plenty, and
// skipping ffmpeg filters keeps decoding to well under a second (its loudnorm filter alone took 8 s for 6 minutes).
const sampleRate = 11025
// Long mixes would need too much memory, so only the first 20 minutes (about 53 MB of samples) are analysed.
const maxSeconds = 1200
// music-tempo follows the beat best in the low end up to 500 Hz; kicks are placed using only the lowest part, below
// 150 Hz.
const beatCutoffHz = 500
const kickCutoffHz = 150
// Energy is summed in hops of 32 samples (2.9 ms), which sets how precisely a kick is placed before the grid is fitted.
const hop = 32
// A kick is where energy over 4 hops (11.6 ms) jumps compared with the 4 hops before it. A shorter window would see a
// held bass note's own cycles as kicks.
const onsetHops = 4
// music-tempo only follows beats that begin within this many seconds (long intros are common in dance music).
const beatSearchSeconds = 60
// It stops following a beat after this long without one; its default of 10 s loses the beat in a long breakdown.
const beatlessSeconds = 90
const beatsPerBar = 4
const beatsPerPhrase = 64
const silentDb = -60
// A stretch this far below the song's usual level counts as quiet.
const quietBelowDb = 12
// A song whose kicks land on fewer of the grid's beats than this has no steady beat.
const minimumConfidence = 0.3

/**
 * Finds a song's tempo and DJ details from its audio: where its kicks fall (a beat grid with an exact BPM), where its
 * 16-bar phrases start, its loudness, its silent, quiet, beatless and beat sections, and its drops.
 * Throws if the file is missing or can't be decoded.
 */
export async function detectRhythm(filePath: string): Promise<RhythmAnalysis> {
  return rhythmOfSamples(await decodeAudio(filePath, { sampleRate, maxSeconds }))
}

function rhythmOfSamples(samples: Float32Array): RhythmAnalysis {
  const analysedSeconds = samples.length / sampleRate
  const full = new EnergyTrack(samples)
  lowPassInPlace(samples, beatCutoffHz)
  const tempo = musicTempo(samples)
  lowPassInPlace(samples, kickCutoffHz)
  const low = new EnergyTrack(samples)
  const onsets = onsetStrengths(low.hops)

  const sound = soundBounds(full)
  const loudness = loudnessOf(full)
  const grid = sound && tempo ? beatGrid(tempo, onsets, analysedSeconds) : undefined
  const bpm = grid ? round(grid.bpm, 1) : tempo && inRange(tempo.bpm) ? round(tempo.bpm, 1) : undefined

  const cuts = grid ? barLines(grid, full, low, analysedSeconds) : blockLines(analysedSeconds)
  const segments = segmentsBetween(withSoundBounds(cuts, sound, analysedSeconds), grid)
  const sections = mergeSections(
    segments.map(({ start, end, kicks }) => ({ start, end, kind: kindOf(full.db(start, end), loudness, kicks) })),
  )
  return {
    bpm,
    dj: {
      soundStart: sound ? round(sound.start, 3) : null,
      soundEnd: sound ? round(sound.end, 3) : null,
      loudness: loudness === undefined ? null : round(loudness, 1),
      grid: grid ? publicGrid(grid) : null,
      sections: sections.map((section) => ({ ...section, start: round(section.start, 3), end: round(section.end, 3) })),
      drops: grid ? dropsIn(sections, grid).map((time) => round(time, 3)) : [],
      analysedSeconds: round(analysedSeconds, 3),
    },
  }
}

/** Energy of the audio in hops of `hop` samples, with running totals for the energy of any stretch of time. */
class EnergyTrack {
  readonly hops: Float64Array
  private readonly totals: Float64Array

  constructor(samples: Float32Array) {
    this.hops = new Float64Array(Math.ceil(samples.length / hop))
    for (let i = 0; i < samples.length; i++) this.hops[(i / hop) | 0] += samples[i] * samples[i]
    this.totals = new Float64Array(this.hops.length + 1)
    for (let i = 0; i < this.hops.length; i++) this.totals[i + 1] = this.totals[i] + this.hops[i]
  }

  /** Mean power between two times (in seconds). */
  power(start: number, end: number): number {
    const from = clamp(Math.round((start * sampleRate) / hop), 0, this.hops.length)
    const to = clamp(Math.round((end * sampleRate) / hop), 0, this.hops.length)
    return to > from ? (this.totals[to] - this.totals[from]) / ((to - from) * hop) : 0
  }

  /** Level between two times, in dB relative to full scale (-Infinity for digital silence). */
  db(start: number, end: number): number {
    return 10 * Math.log10(this.power(start, end))
  }
}

// A two-pole (12 dB per octave) low-pass filter, keeping the kick and bass.
function lowPassInPlace(samples: Float32Array, cutoffHz: number): void {
  const w = (2 * Math.PI * cutoffHz) / sampleRate
  const alpha = Math.sin(w) / Math.SQRT2
  const a0 = 1 + alpha
  const b0 = (1 - Math.cos(w)) / 2 / a0
  const b1 = (1 - Math.cos(w)) / a0
  const a1 = (-2 * Math.cos(w)) / a0
  const a2 = (1 - alpha) / a0
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]
    const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    samples[i] = y
  }
}

// How sharply the low end gets louder at each hop: the log of the energy over the next window against the one before.
function onsetStrengths(hops: Float64Array): Float32Array {
  const window = new Float64Array(hops.length)
  let sum = 0
  for (let i = hops.length - 1; i >= 0; i--) {
    sum += hops[i] - (i + onsetHops < hops.length ? hops[i + onsetHops] : 0)
    window[i] = Math.max(sum, 0)
  }
  const floor = 1e-7 * hop * onsetHops
  const strengths = new Float32Array(hops.length)
  for (let i = 0; i < hops.length; i++) {
    // Before the start of the file is silence, so a song can open on a kick.
    const before = i >= onsetHops ? window[i - onsetHops] : 0
    strengths[i] = Math.max(0, Math.log((window[i] + floor) / (before + floor)))
  }
  return strengths
}

// Where the sound starts and ends: the first and last 10 ms above the silence threshold.
function soundBounds(full: EnergyTrack): { start: number; end: number } | undefined {
  const step = 0.01
  const count = Math.floor((full.hops.length * hop) / sampleRate / step)
  let first = -1
  let last = -1
  for (let i = 0; i < count; i++) {
    if (full.db(i * step, (i + 1) * step) > silentDb) {
      if (first < 0) first = i
      last = i
    }
  }
  return first < 0 ? undefined : { start: first * step, end: (last + 1) * step }
}

// The song's usual level: the mean power of its 400 ms blocks, leaving out silence and anything 10 dB below the
// average (like the gating in broadcast loudness meters, without the frequency weighting).
function loudnessOf(full: EnergyTrack): number | undefined {
  const block = 0.4
  const powers: number[] = []
  const count = Math.floor((full.hops.length * hop) / sampleRate / block)
  for (let i = 0; i < count; i++) {
    const power = full.power(i * block, (i + 1) * block)
    if (10 * Math.log10(power) > silentDb) powers.push(power)
  }
  if (powers.length === 0) return undefined
  const gate = mean(powers) / 10
  return 10 * Math.log10(mean(powers.filter((power) => power >= gate)))
}

interface TempoEstimate {
  bpm: number
  beats: number[]
}

// music-tempo's tempo and beats, from the low end (at this sample rate, a 512-sample FFT every 10 ms matches its
// defaults at 44.1 kHz; it assumes 10 ms per hop unless told). It throws when it finds no beats (e.g. silence).
const musicTempoHop = 110

function musicTempo(samples: Float32Array): TempoEstimate | undefined {
  try {
    const { tempo, beats } = new MusicTempo(samples, {
      sampleRate,
      bufferSize: 512,
      hopSize: musicTempoHop,
      timeStep: musicTempoHop / sampleRate,
      initPeriod: beatSearchSeconds,
      expiryTime: beatlessSeconds,
    })
    const bpm = Number(tempo)
    return Number.isFinite(bpm) ? { bpm, beats } : undefined
  } catch {
    return undefined
  }
}

const inRange = (bpm: number): boolean => bpm >= 40 && bpm <= 250

interface Grid {
  /** Seconds per beat. */
  period: number
  /** Time of beat 0 (the first kick). */
  origin: number
  /** Beat numbers (from the first kick) of the last kick and the first phrase start. */
  last: number
  phrase: number
  /** Whether each beat from `low` to `high` (beat numbers, possibly negative) has a kick on it. */
  low: number
  kicks: boolean[]
  bpm: number
  confidence: number
}

// Fits a grid to the kicks near music-tempo's beats: first roughly, through its beats, then exactly, through the kicks
// found at each predicted beat.
function beatGrid(tempo: TempoEstimate, onsets: Float32Array, seconds: number): Grid | undefined {
  const { beats } = tempo
  if (beats.length < 8) return undefined
  // Number each beat by how many periods it is after the previous one, so a missed beat doesn't shift the rest.
  const roughPeriod = 60 / tempo.bpm
  const numbered = beats.map((time) => ({ n: 0, time }))
  for (let i = 1; i < beats.length; i++) {
    numbered[i].n = numbered[i - 1].n + Math.max(1, Math.round((beats[i] - beats[i - 1]) / roughPeriod))
  }
  const rough = fitWithoutOutliers(numbered, 0.05)
  if (!rough) return undefined
  let line = onTheKicks(rough, onsets)

  // Kicks are looked for close to each predicted beat, so off-beat hits (a rolling bassline) aren't mistaken for them.
  for (const tolerance of [0.06, 0.03, 0.03]) {
    const kicks = kicksOnGrid(line, onsets, seconds, Math.min(tolerance, line.period / 8))
    line =
      fitWithoutOutliers(
        kicks.filter((kick) => kick.found),
        0.02,
      ) ?? line
  }
  const kicks = kicksOnGrid(line, onsets, seconds, Math.min(0.03, line.period / 8))

  // The first and last kicks that start or end a run of at least 3 in 4 beats, so a stray hit doesn't count.
  const found = (i: number): number => (kicks[i]?.found ? 1 : 0)
  const run = (i: number, step: number): boolean =>
    kicks[i].found && found(i + step) + found(i + 2 * step) + found(i + 3 * step) + found(i + 4 * step) >= 3
  const startsRun = (i: number): boolean => run(i, 1)
  const endsRun = (i: number): boolean => run(i, -1)
  const first = kicks.findIndex((_, i) => startsRun(i))
  let last = kicks.length - 1
  while (last >= 0 && !endsRun(last)) last--
  if (first < 0 || last <= first) return undefined
  // How steady the beat is: the share of beats with a kick, in the bars (from the first kick) that have a beat at all,
  // so breakdowns don't count against it.
  let hits = 0
  let counted = 0
  for (let bar = first; bar <= last; bar += beatsPerBar) {
    const inBar = found(bar) + found(bar + 1) + found(bar + 2) + found(bar + 3)
    if (inBar >= 2) {
      hits += inBar
      counted += beatsPerBar
    }
  }
  const confidence = counted ? hits / counted : 0
  const bpm = 60 / line.period
  if (confidence < minimumConfidence || !inRange(bpm)) return undefined

  const firstN = kicks[first].n
  return {
    period: line.period,
    origin: line.origin + firstN * line.period,
    last: kicks[last].n - firstN,
    phrase: 0,
    low: kicks[0].n - firstN,
    kicks: kicks.map((kick) => kick.found),
    bpm,
    confidence,
  }
}

// music-tempo can follow an off-beat (a rolling bassline between the kicks), so the rough grid is shifted by a quarter,
// half or three quarters of a beat if that lands it on more kick energy.
function onTheKicks(line: Line, onsets: Float32Array): Line {
  const secondsPerHop = hop / sampleRate
  const reach = Math.round(line.period / 8 / secondsPerHop)
  let best = line
  let bestEnergy = -1
  for (const shift of [0, 0.25, 0.5, 0.75]) {
    const origin = line.origin + shift * line.period
    let energy = 0
    for (let time = origin - Math.floor(origin / line.period) * line.period; ; time += line.period) {
      const centre = Math.round(time / secondsPerHop)
      if (centre + reach >= onsets.length) break
      let peak = 0
      for (let i = Math.max(0, centre - reach); i <= centre + reach; i++) peak = Math.max(peak, onsets[i])
      energy += peak
    }
    if (energy > bestEnergy) {
      best = { origin, period: line.period }
      bestEnergy = energy
    }
  }
  return best
}

interface Line {
  /** Time of beat 0 and seconds per beat. */
  origin: number
  period: number
}

interface Kick {
  n: number
  time: number
  found: boolean
}

// Least-squares fit of time against beat number, refitted without beats further than `tolerance` seconds off it.
function fitWithoutOutliers(points: { n: number; time: number }[], tolerance: number): Line | undefined {
  let line = fit(points)
  for (let pass = 0; pass < 2 && line; pass++) {
    const fitted = line
    line = fit(points.filter(({ n, time }) => Math.abs(time - (fitted.origin + n * fitted.period)) <= tolerance))
  }
  return line
}

function fit(points: { n: number; time: number }[]): Line | undefined {
  if (points.length < 8) return undefined
  const meanN = mean(points.map((point) => point.n))
  const meanTime = mean(points.map((point) => point.time))
  let covariance = 0
  let variance = 0
  for (const { n, time } of points) {
    covariance += (n - meanN) * (time - meanTime)
    variance += (n - meanN) ** 2
  }
  if (variance === 0) return undefined
  const period = covariance / variance
  return period > 0 ? { origin: meanTime - period * meanN, period } : undefined
}

// For every beat the line predicts in the song, the strongest kick within `tolerance` seconds of it, and whether it's
// strong enough to count. Kicks are placed between hops by fitting a parabola through the peak.
function kicksOnGrid(line: Line, onsets: Float32Array, seconds: number, tolerance: number): Kick[] {
  const secondsPerHop = hop / sampleRate
  // A kick right at the start can fit a fraction of a millisecond before it.
  const low = Math.ceil((-line.origin - 0.05) / line.period)
  const high = Math.floor((seconds - line.origin) / line.period)
  const kicks: (Kick & { strength: number })[] = []
  for (let n = low; n <= high; n++) {
    const predicted = line.origin + n * line.period
    const from = Math.max(0, Math.round((predicted - tolerance) / secondsPerHop))
    const to = Math.min(onsets.length - 2, Math.round((predicted + tolerance) / secondsPerHop))
    let peak = -1
    for (let i = from; i <= to; i++) if (peak < 0 || onsets[i] > onsets[peak]) peak = i
    if (peak < 0) {
      kicks.push({ n, time: predicted, found: false, strength: 0 })
      continue
    }
    const [before, at, after] = [peak > 0 ? onsets[peak - 1] : 0, onsets[peak], onsets[peak + 1]]
    const curve = before - 2 * at + after
    const offset = curve < 0 ? clamp((0.5 * (before - after)) / curve, -0.5, 0.5) : 0
    kicks.push({ n, time: (peak + offset) * secondsPerHop, found: false, strength: at })
  }
  // A hit counts as a kick if it at least doubles the low end's energy over a held bass note (a log ratio of 0.8),
  // or is a third as strong as the song's typical kick when that's lower (a busy low end), but never under 1.65 times
  // (0.5).
  const typical = percentile(
    kicks.map((kick) => kick.strength),
    0.75,
  )
  const threshold = clamp(typical / 3, 0.5, 0.8)
  return kicks.map(({ n, time, strength }) => ({ n, time, found: strength >= threshold }))
}

// Picks which beat starts the 16-bar phrases (one of the first 64 from the first kick): the one that puts the most
// change in the music (the beat, the low end or the overall level coming or going) on bar lines, and then on phrase,
// half-phrase and 4-bar lines. With no change at all, the first kick starts a phrase.
function choosePhraseStart(grid: Grid, full: EnergyTrack, low: EnergyTrack, seconds: number): void {
  const beatTime = (i: number): number => grid.origin + (i + grid.low) * grid.period
  // Only beats that end before the end of the analysed audio, so a part-beat at the end doesn't look like silence.
  let count = grid.kicks.length
  while (count > 0 && beatTime(count) > seconds) count--
  const fullDb = Array.from({ length: count }, (_, i) => clampDb(full.db(beatTime(i), beatTime(i + 1))))
  const lowDb = Array.from({ length: count }, (_, i) => clampDb(low.db(beatTime(i), beatTime(i + 1))))
  const kick = grid.kicks.slice(0, count).map((found) => (found ? 1 : 0))
  // Before the start of the file counts as silence, so a song that opens on its beat starts a phrase there. Changes in
  // level are smoothly limited to about 12 dB, so sound starting after silence doesn't outweigh every other change in
  // the song, while the biggest change still peaks on the beat where it happens.
  const average = (values: number[], from: number, to: number, before: number): number => {
    let sum = 0
    for (let i = from; i < to; i++) sum += i < 0 ? before : values[Math.min(i, count - 1)]
    return sum / (to - from)
  }
  const difference = (values: number[], i: number, before: number, cap: number): number =>
    cap * Math.tanh(Math.abs(average(values, i, i + 4, before) - average(values, i - 4, i, before)) / cap)
  const change = Array.from(
    { length: count },
    (_, i) => difference(fullDb, i, -100, 12) + difference(lowDb, i, -100, 12) + 12 * difference(kick, i, 0, 1),
  )
  // Only clear changes count, once each, on the beat where they peak, by how far they stand out from the song's usual
  // beat-to-beat variation (squared, so a few section changes outweigh many small ones).
  const usual = 2 * percentile(change, 0.5)
  const peaks = change.map((value, i) => {
    for (let j = Math.max(0, i - 2); j <= Math.min(count - 1, i + 2); j++) {
      if (change[j] > value || (j < i && change[j] === value)) return 0
    }
    return value
  })
  const novelty = peaks.map((value) => Math.max(0, value - usual) ** 2)
  const beatOf = (i: number, offset: number, length: number): number =>
    (((i + grid.low - offset) % length) + length) % length
  // First the bar lines, then which of the 16 bars starts the phrase. Dance music almost always brings its kick in on
  // the first beat of a bar, so the first kick starts a bar unless twice as much change falls on another beat.
  const barLine = bestOffset(beatsPerBar, (offset) =>
    novelty.reduce((score, value, i) => score + (beatOf(i, offset, beatsPerBar) === 0 ? value : 0), 0) *
    (offset === 0 ? 2 : 1),
  )
  const phraseBar = bestOffset(beatsPerPhrase / beatsPerBar, (bar) =>
    novelty.reduce((score, value, i) => {
      const beat = beatOf(i, barLine + bar * beatsPerBar, beatsPerPhrase)
      return score + value * (beat === 0 ? 4 : beat === 32 ? 2 : beat % 16 === 0 ? 1 : 0)
    }, 0),
  )
  grid.phrase = barLine + phraseBar * beatsPerBar
}

// The offset from 0 to count - 1 with the highest score; the lowest one on a tie.
function bestOffset(count: number, score: (offset: number) => number): number {
  let best = 0
  let bestScore = -1
  for (let offset = 0; offset < count; offset++) {
    const value = score(offset)
    if (value > bestScore + 1e-9) {
      best = offset
      bestScore = value
    }
  }
  return best
}

interface Segment {
  start: number
  end: number
  /** The share of the segment's beats with a kick, or 0 without a grid. */
  kicks: number
}

// The bar lines (counted from the phrase start) between the start and end of the analysed audio.
function barLines(grid: Grid, full: EnergyTrack, low: EnergyTrack, seconds: number): number[] {
  choosePhraseStart(grid, full, low, seconds)
  const barLength = grid.period * beatsPerBar
  const firstBar = grid.origin + grid.phrase * grid.period
  const lines: number[] = []
  for (let time = firstBar - Math.floor(firstBar / barLength) * barLength; time < seconds; time += barLength) {
    lines.push(time)
  }
  return lines
}

// With no beat, a line every 2 seconds.
function blockLines(seconds: number): number[] {
  const lines: number[] = []
  for (let time = 2; time < seconds; time += 2) lines.push(time)
  return lines
}

// The start and end of the audio, and where its sound starts and ends, with the lines in between. A line within a
// quarter of a second of where the sound starts or ends gives way to it, so silence is never cut into slivers.
function withSoundBounds(
  lines: number[],
  sound: { start: number; end: number } | undefined,
  seconds: number,
): number[] {
  const near = (time: number, bound: number): boolean => Math.abs(time - bound) < 0.25
  const inside = lines.filter(
    (time) => time > 0.05 && time < seconds - 0.05 && (!sound || (time > sound.start && time < sound.end)),
  )
  const bounds = sound ? [sound.start, sound.end].filter((time) => time > 0.05 && time < seconds - 0.05) : []
  const kept = inside.filter((time) => !bounds.some((bound) => near(time, bound)))
  return [0, ...[...kept, ...bounds].sort((a, b) => a - b), seconds]
}

function segmentsBetween(lines: number[], grid: Grid | undefined): Segment[] {
  return lines.slice(1).map((end, i) => {
    const start = lines[i]
    if (!grid) return { start, end, kicks: 0 }
    let beats = 0
    let hits = 0
    for (let n = Math.ceil((start - grid.origin) / grid.period); grid.origin + n * grid.period < end; n++) {
      beats++
      if (n >= 0 && n <= grid.last && grid.kicks[n - grid.low]) hits++
    }
    return { start, end, kicks: beats ? hits / beats : 0 }
  })
}

function kindOf(db: number, loudness: number | undefined, kicks: number): DjSectionKind {
  if (db <= silentDb || loudness === undefined) return 'silent'
  if (db < loudness - quietBelowDb) return 'quiet'
  return kicks >= 0.5 ? 'beat' : 'beatless'
}

// Joins neighbouring segments of the same kind, after folding a single odd segment between two of the same kind into
// them (a missed kick or a one-bar fill isn't a new section).
function mergeSections(segments: DjSection[]): DjSection[] {
  const kinds = segments.map((segment) => segment.kind)
  for (let i = 1; i < kinds.length - 1; i++) {
    if (kinds[i - 1] === kinds[i + 1] && kinds[i] !== kinds[i - 1]) kinds[i] = kinds[i - 1]
  }
  const sections: DjSection[] = []
  segments.forEach((segment, i) => {
    const previous = sections.at(-1)
    if (previous?.kind === kinds[i]) previous.end = segment.end
    else sections.push({ kind: kinds[i], start: segment.start, end: segment.end })
  })
  return sections
}

// A drop is where the beat comes back after a beatless or quiet stretch of 8 bars or more (shorter gaps in the kick
// are fills), once the song's beat has
// already started (the beat first coming in after an intro is where to mix in, not a drop).
function dropsIn(sections: DjSection[], grid: Grid): number[] {
  const minimumBreak = grid.period * beatsPerBar * 8 - 0.01
  const drops: number[] = []
  let beatSoFar = false
  sections.forEach((section, i) => {
    const previous = sections[i - 1]
    if (section.kind !== 'beat') return
    const afterBreak =
      previous &&
      (previous.kind === 'beatless' || previous.kind === 'quiet') &&
      previous.end - previous.start >= minimumBreak
    if (beatSoFar && afterBreak) drops.push(section.start)
    beatSoFar = true
  })
  return drops
}

function publicGrid(grid: Grid): BeatGrid {
  return {
    bpm: round(grid.bpm, 4),
    // The first kick can fit a fraction of a millisecond before the start of the file.
    firstBeat: round(Math.max(0, grid.origin), 3),
    lastBeat: round(grid.origin + grid.last * grid.period, 3),
    phraseStart: round(Math.max(0, grid.origin + grid.phrase * grid.period), 3),
    confidence: round(grid.confidence, 2),
  }
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const clampDb = (db: number): number => Math.max(db, -100)
const round = (value: number, places: number): number => Math.round(value * 10 ** places) / 10 ** places
const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]
}
