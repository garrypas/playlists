import { parentPort, workerData } from 'node:worker_threads'
import { detectTempo } from './trackTempo'

// Worker-thread entry for `detectTempoInWorker`: detects one file's tempo and reports back.
detectTempo(workerData as string).then(
  (bpm) => parentPort?.postMessage({ bpm }),
  (error: unknown) => parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) }),
)
