import { parseFile } from 'music-metadata'
import { keyName } from '../shared/musicalKey'
import { decodeAudio } from './audioDecoding'

const noteLetters: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }

/**
 * A key as written in a song's tags, in the app's spelling (e.g. "Ebm"), or undefined if it isn't one. DJ software
 * writes keys as note names ("E♭ minor", "D#m", "Ebmin"), Camelot codes ("2A") or Open Key codes ("7m").
 */
export function parseKey(value: string | undefined): string | undefined {
  const text = value?.trim().toLowerCase().replace(/♯/g, '#').replace(/♭/g, 'b') ?? ''
  const wheel = /^(\d{1,2})\s*([abdm])$/.exec(text)
  if (wheel) {
    const position = Number(wheel[1])
    if (position < 1 || position > 12) return undefined
    // Camelot 8B is C major and 8A is A minor; Open Key 1d is C major and 1m is A minor. Each step is a fifth.
    const [code, minor] = [wheel[2], wheel[2] === 'a' || wheel[2] === 'm']
    const steps = position - (code === 'a' || code === 'b' ? 8 : 1)
    return keyName((minor ? 9 : 0) + 7 * steps, minor)
  }
  const note = /^([a-g])\s*(#|b)?\s*(m|min|minor|maj|major)?$/.exec(text)
  if (!note) return undefined
  const tonic = noteLetters[note[1]] + (note[2] === '#' ? 1 : note[2] === 'b' ? -1 : 0)
  return keyName(tonic, note[3] === 'm' || note[3] === 'min' || note[3] === 'minor')
}

const sampleRate = 11025
// Long mixes would need a lot of memory, so only the first ten minutes are analysed.
const maxSeconds = 600
// Each frame is about 0.75s, fine enough to tell semitones apart down to C2.
const frameSize = 8192
const hopSize = frameSize / 2
const lowestHz = 65
const highestHz = 2100

// Krumhansl and Kessler's ratings of how well each note, counted up from the tonic, fits a major or minor key.
const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
// Below this, no key fits the notes well enough to name one (e.g. drums only).
const minimumFit = 0.5

// In-place radix-2 FFT of `real` and `imaginary`, whose length must be a power of two.
function fft(real: Float64Array, imaginary: Float64Array): void {
  const n = real.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[real[i], real[j]] = [real[j], real[i]]
      ;[imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]]
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const [cos, sin] = [Math.cos(angle * k), Math.sin(angle * k)]
        const [a, b] = [start + k, start + k + size / 2]
        const re = real[b] * cos - imaginary[b] * sin
        const im = real[b] * sin + imaginary[b] * cos
        real[b] = real[a] - re
        imaginary[b] = imaginary[a] - im
        real[a] += re
        imaginary[a] += im
      }
    }
  }
}

// How strongly each of the 12 pitch classes (C to B) sounds across the whole song.
function chroma(samples: Float32Array): number[] {
  const window = Float64Array.from({ length: frameSize }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frameSize))
  const firstBin = Math.ceil((lowestHz * frameSize) / sampleRate)
  const lastBin = Math.floor((highestHz * frameSize) / sampleRate)
  const pitchClassOf = Array.from({ length: lastBin + 1 }, (_, bin) => {
    const midiNote = 69 + 12 * Math.log2((bin * sampleRate) / frameSize / 440)
    return ((Math.round(midiNote) % 12) + 12) % 12
  })
  const totals = new Array<number>(12).fill(0)
  const real = new Float64Array(frameSize)
  const imaginary = new Float64Array(frameSize)
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    for (let i = 0; i < frameSize; i++) real[i] = samples[start + i] * window[i]
    imaginary.fill(0)
    fft(real, imaginary)
    for (let bin = firstBin; bin <= lastBin; bin++) totals[pitchClassOf[bin]] += Math.hypot(real[bin], imaginary[bin])
  }
  return totals
}

function correlation(a: number[], b: number[]): number {
  const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length
  const [meanA, meanB] = [mean(a), mean(b)]
  let [product, squaresA, squaresB] = [0, 0, 0]
  for (let i = 0; i < a.length; i++) {
    product += (a[i] - meanA) * (b[i] - meanB)
    squaresA += (a[i] - meanA) ** 2
    squaresB += (b[i] - meanB) ** 2
  }
  return squaresA && squaresB ? product / Math.sqrt(squaresA * squaresB) : 0
}

/** The key that best fits the notes in `samples` (mono, at 11,025 Hz), or undefined if none fits. */
export function keyOfSamples(samples: Float32Array): string | undefined {
  const notes = chroma(samples)
  let best = { key: undefined as string | undefined, fit: minimumFit }
  for (let tonic = 0; tonic < 12; tonic++) {
    // The notes, counted up from this tonic, so they line up with the profiles.
    const fromTonic = notes.map((_, interval) => notes[(tonic + interval) % 12])
    for (const minor of [false, true]) {
      const fit = correlation(fromTonic, minor ? minorProfile : majorProfile)
      if (fit > best.fit) best = { key: keyName(tonic, minor), fit }
    }
  }
  return best.key
}

/**
 * The song's key (e.g. "Ebm" or "F#"): from its tags if they name one, otherwise detected from the audio. Undefined if
 * no key fits it (e.g. silence or drums only). Throws if the file is missing or can't be decoded.
 */
export async function detectKey(filePath: string): Promise<string | undefined> {
  const { common } = await parseFile(filePath, { duration: false, skipCovers: true, skipPostHeaders: true })
  const tagged = parseKey(common.key)
  if (tagged) return tagged
  return keyOfSamples(await decodeAudio(filePath, { sampleRate, maxSeconds }))
}
