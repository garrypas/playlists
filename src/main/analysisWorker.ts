import { parentPort, workerData } from 'node:worker_threads'
import type { AnalysisKind } from './backgroundAnalysis'
import { detectKey } from './trackKey'
import { detectTempo } from './trackTempo'

// Worker-thread entry for `analyseInWorker`: analyses one file and reports back.
const { kind, filePath } = workerData as { kind: AnalysisKind; filePath: string }
const analyse = kind === 'key' ? detectKey : detectTempo
analyse(filePath).then(
  (value) => parentPort?.postMessage({ value }),
  (error: unknown) => parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) }),
)
