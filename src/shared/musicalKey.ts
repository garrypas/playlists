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

/**
 * The key's place on the Camelot wheel DJs use, e.g. "8B" for C and "8A" for Am: minor keys are A and major keys B,
 * and each step round the wheel is a fifth. Undefined if `key` isn't one of ours.
 */
export function camelotCode(key: string): string | undefined {
  const major = majorKeys.indexOf(key)
  const minor = minorKeys.indexOf(key)
  if (major < 0 && minor < 0) return undefined
  // A minor key sits at the same number as its relative major, three semitones above its tonic.
  const tonic = major >= 0 ? major : (minor + 3) % 12
  return `${((tonic * 7 + 7) % 12) + 1}${major >= 0 ? 'B' : 'A'}`
}
