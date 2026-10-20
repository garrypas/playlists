import { Worker } from 'node:worker_threads'

/** What `analysisWorker` can find out about a song, and what each kind of analysis reports. */
export interface AnalysisResults {
  tempo: number | undefined
  key: string | undefined
}
export type AnalysisKind = keyof AnalysisResults

/**
 * Runs one kind of analysis of a song on a worker thread from the built `analysisWorker.js` at `workerPath`, because
 * analysing audio blocks for about a second per song.
 */
export function analyseInWorker<K extends AnalysisKind>(
  workerPath: string,
  kind: K,
  filePath: string,
): Promise<AnalysisResults[K]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: { kind, filePath } })
    worker.once('message', (result: { value?: AnalysisResults[K]; error?: string }) => {
      if (result.error !== undefined) reject(new Error(result.error))
      else resolve(result.value as AnalysisResults[K])
    })
    worker.once('error', reject)
    worker.once('exit', () => reject(new Error('Audio analysis stopped unexpectedly.')))
  })
}

/**
 * Analyses songs in the background, one at a time, calling `onDetected` with each result. Files that can't be read
 * are skipped (they're retried the next time they're scanned). A file already waiting isn't queued twice.
 */
export function createBackgroundScanner<T>(
  detect: (filePath: string) => Promise<T>,
  onDetected: (filePath: string, result: T) => void,
): { scan: (filePaths: string[]) => void; stop: () => void } {
  const pending: string[] = []
  let running = false
  let stopped = false

  async function run(): Promise<void> {
    running = true
    for (let filePath = pending[0]; filePath !== undefined && !stopped; filePath = pending[0]) {
      try {
        const result = await detect(filePath)
        if (!stopped) onDetected(filePath, result)
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
