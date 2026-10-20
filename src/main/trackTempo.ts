import MusicTempo from 'music-tempo'
import { decodeAudio } from './audioDecoding'

const sampleRate = 44100
// Long mixes would need gigabytes of samples, so only the first ten minutes are analysed.
const maxSeconds = 600
// music-tempo only starts following beats that begin within this many seconds, and gives up if there are none. Its
// default of 5 misses songs with a beatless intro (common in dance music), and a longer window costs nothing.
const beatSearchSeconds = 60

/**
 * The song's tempo in beats per minute (to one decimal place), or undefined if it has no steady beat.
 * Throws if the file is missing or can't be decoded.
 */
export async function detectTempo(filePath: string): Promise<number | undefined> {
  // Only the low end (where the beat is) is kept, at an even loudness.
  const samples = await decodeAudio(filePath, {
    sampleRate,
    maxSeconds,
    filter: 'loudnorm, highpass=f=20, lowpass=f=500',
  })
  try {
    const bpm = Number(new MusicTempo(samples, { sampleRate, initPeriod: beatSearchSeconds }).tempo)
    return Number.isFinite(bpm) && bpm >= 40 && bpm <= 250 ? Math.round(bpm * 10) / 10 : undefined
  } catch {
    // music-tempo throws when it can't find any beats (e.g. silence).
    return undefined
  }
}
