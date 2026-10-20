// Each key is spelled the way its key signature is (fewest sharps or flats), so B♭ minor is "Bbm" and not "A#m".
const majorKeys = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const minorKeys = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm']

/** The name of the key whose tonic is `tonic` semitones above C (any whole number, wrapping round the octave). */
export function keyName(tonic: number, minor: boolean): string {
  const pitchClass = ((tonic % 12) + 12) % 12
  return minor ? minorKeys[pitchClass] : majorKeys[pitchClass]
}

/** The key `semitones` higher (or lower, if negative) than `key`, or undefined if `key` isn't one of ours. */
export function transposeKey(key: string, semitones: number): string | undefined {
  for (const [names, minor] of [
    [majorKeys, false],
    [minorKeys, true],
  ] as const) {
    const tonic = names.indexOf(key)
    if (tonic >= 0) return keyName(tonic + semitones, minor)
  }
  return undefined
}
