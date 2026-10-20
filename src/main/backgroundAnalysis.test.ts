import { describe, expect, it } from 'vitest'
import { createBackgroundScanner } from './backgroundAnalysis'

describe('scanning songs in the background', () => {
  it('reports each song once, in the order they were added, skipping files it cannot read', async () => {
    const found: [string, number | undefined][] = []
    const tempos: Record<string, number | undefined> = { a: 120, b: undefined, d: 90 }
    const scanner = createBackgroundScanner(
      async (filePath) => {
        if (!(filePath in tempos)) throw new Error('Unreadable')
        return tempos[filePath]
      },
      (filePath, bpm) => found.push([filePath, bpm]),
    )
    scanner.scan(['a', 'b'])
    scanner.scan(['b', 'c', 'd'])
    await expect.poll(() => found).toHaveLength(3)
    expect(found).toEqual([
      ['a', 120],
      ['b', undefined],
      ['d', 90],
    ])
  })

  it('reports nothing once stopped', async () => {
    const found: string[] = []
    const scanner = createBackgroundScanner(
      async () => 120,
      (filePath) => found.push(filePath),
    )
    scanner.scan(['a'])
    scanner.stop()
    scanner.scan(['b'])
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(found).toEqual([])
  })
})
