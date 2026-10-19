import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import ffmpegStatic from 'ffmpeg-static'
import MusicTempo from 'music-tempo'

const sampleRate = 44100
// Long mixes would need gigabytes of samples, so only the first ten minutes are analysed.
const maxSeconds = 600
// music-tempo only starts following beats that begin within this many seconds, and gives up if there are none. Its
// default of 5 misses songs with a beatless intro (common in dance music), and a longer window costs nothing.
const beatSearchSeconds = 60

// The bundled ffmpeg can't run from inside the app's asar archive, so packaged apps unpack it next to it.
function ffmpegPath(): string {
  if (!ffmpegStatic) throw new Error('Tempo detection is not available on this platform.')
  return ffmpegStatic.replace(`app.asar${join('/')}`, `app.asar.unpacked${join('/')}`)
}

// Decodes a song to mono samples, keeping only the low end (where the beat is) at an even loudness.
function decodeForTempo(filePath: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    // prettier-ignore
    const ffmpeg = spawn(ffmpegPath(), [
      '-nostdin', '-v', 'error',
      '-t', String(maxSeconds),
      '-i', filePath,
      '-vn', '-ac', '1', '-ar', String(sampleRate),
      '-af', 'loudnorm, highpass=f=20, lowpass=f=500',
      '-f', 'f32le', '-',
    ])
    const chunks: Buffer[] = []
    let errors = ''
    ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      errors = (errors + chunk.toString()).slice(-500)
    })
    ffmpeg.on('error', reject)
    ffmpeg.on('close', (code) => {
      if (code !== 0) return reject(new Error(errors.trim() || `ffmpeg exited with code ${code}.`))
      const bytes = Buffer.concat(chunks)
      const samples = new Float32Array(bytes.length / 4)
      new Uint8Array(samples.buffer).set(bytes.subarray(0, samples.length * 4))
      resolve(samples)
    })
  })
}

/**
 * The song's tempo in beats per minute (to one decimal place), or undefined if it has no steady beat.
 * Throws if the file is missing or can't be decoded.
 */
export async function detectTempo(filePath: string): Promise<number | undefined> {
  const samples = await decodeForTempo(filePath)
  try {
    const bpm = Number(new MusicTempo(samples, { sampleRate, initPeriod: beatSearchSeconds }).tempo)
    return Number.isFinite(bpm) && bpm >= 40 && bpm <= 250 ? Math.round(bpm * 10) / 10 : undefined
  } catch {
    // music-tempo throws when it can't find any beats (e.g. silence).
    return undefined
  }
}

/**
 * Runs `detectTempo` on a worker thread from the built `tempoWorker.js` at `workerPath`, because the analysis blocks
 * for about a second per song.
 */
export function detectTempoInWorker(workerPath: string, filePath: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: filePath })
    worker.once('message', (result: { bpm?: number; error?: string }) => {
      if (result.error !== undefined) reject(new Error(result.error))
      else resolve(result.bpm)
    })
    worker.once('error', reject)
    worker.once('exit', () => reject(new Error('Tempo detection stopped unexpectedly.')))
  })
}

/**
 * Detects songs' tempos in the background, one at a time, calling `onDetected` with each result. Files that can't be
 * read are skipped (they're retried the next time they're scanned). A file already waiting isn't queued twice.
 */
export function createTempoScanner(
  detect: (filePath: string) => Promise<number | undefined>,
  onDetected: (filePath: string, bpm: number | undefined) => void,
): { scan: (filePaths: string[]) => void; stop: () => void } {
  const pending: string[] = []
  let running = false
  let stopped = false

  async function run(): Promise<void> {
    running = true
    for (let filePath = pending[0]; filePath !== undefined && !stopped; filePath = pending[0]) {
      try {
        const bpm = await detect(filePath)
        if (!stopped) onDetected(filePath, bpm)
      } catch {
        // Missing or undecodable files are left for the next scan.
      }
      pending.shift()
    }
    running = false
  }

  return {
    scan(filePaths) {
      for (const filePath of filePaths) if (!pending.includes(filePath)) pending.push(filePath)
      if (!running && !stopped) void run()
    },
    stop() {
      stopped = true
      pending.length = 0
    },
  }
}
