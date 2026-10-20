import { spawn } from 'node:child_process'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'

// The bundled ffmpeg can't run from inside the app's asar archive, so packaged apps unpack it next to it.
function ffmpegPath(): string {
  if (!ffmpegStatic) throw new Error('Audio analysis is not available on this platform.')
  return ffmpegStatic.replace(`app.asar${join('/')}`, `app.asar.unpacked${join('/')}`)
}

/**
 * Decodes the first `maxSeconds` of a song to mono samples at `sampleRate`, through the ffmpeg audio `filter` if
 * given. Throws if the file is missing or can't be decoded.
 */
export function decodeAudio(
  filePath: string,
  { sampleRate, maxSeconds, filter }: { sampleRate: number; maxSeconds: number; filter?: string },
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    // prettier-ignore
    const ffmpeg = spawn(ffmpegPath(), [
      '-nostdin', '-v', 'error',
      '-t', String(maxSeconds),
      '-i', filePath,
      '-vn', '-ac', '1', '-ar', String(sampleRate),
      ...(filter ? ['-af', filter] : []),
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
