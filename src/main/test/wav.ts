/** A mono 16-bit WAV file of the given samples (-1 to 1) at 44.1 kHz. */
function wav(samples: Float32Array): Buffer {
  const rate = 44100
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((sample, index) => {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), index * 2)
  })
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

/**
 * A steady kick-drum beat at `bpm` beats per minute, lasting `seconds`. With `introSeconds`, it starts with that long
 * a beatless bass pad first, like many dance tracks.
 */
export function beat(bpm: number, seconds = 30, { introSeconds = 0 } = {}): Buffer {
  const rate = 44100
  const samples = new Float32Array(rate * (introSeconds + seconds))
  const interval = 60 / bpm
  for (let i = 0; i < samples.length; i++) {
    const time = i / rate
    const sinceBeat = (time - introSeconds) % interval
    samples[i] =
      time < introSeconds
        ? Math.sin(2 * Math.PI * 55 * time) * 0.4
        : Math.sin(2 * Math.PI * 70 * sinceBeat) * Math.exp(-25 * sinceBeat) * 0.8
  }
  return wav(samples)
}

/** A part of a `song`: how many bars (of 4 beats) it lasts, whether it has a kick on every beat and a bass pad. */
export interface SongPart {
  bars: number
  kick?: boolean
  pad?: boolean
  /** How loud the part is, from 0 to 1 (full). */
  level?: number
  /** The beat of the part (from 0) on which the kick comes in. */
  kickFromBeat?: number
  /**
   * A bass note on every off-beat, cut on the beat (as a sidechained trance bassline is). It starts from near silence,
   * so it rises more sharply than the kick, which hits while the bass is still sounding; but the kick is louder.
   */
  offbeatBass?: boolean
}

/** A dance track at `bpm` made of `parts` one after another, after `silenceSeconds` of silence. */
export function song(bpm: number, parts: SongPart[], { silenceSeconds = 0 } = {}): Buffer {
  const rate = 44100
  const beatSeconds = 60 / bpm
  const seconds = silenceSeconds + parts.reduce((total, part) => total + part.bars * 4 * beatSeconds, 0)
  const samples = new Float32Array(Math.round(rate * seconds))
  let partStart = silenceSeconds
  for (const { bars, kick = false, pad = false, level = 1, kickFromBeat = 0, offbeatBass = false } of parts) {
    const partEnd = partStart + bars * 4 * beatSeconds
    for (let i = Math.round(partStart * rate); i < Math.min(samples.length, Math.round(partEnd * rate)); i++) {
      const time = i / rate
      const sinceBeat = (time - partStart) % beatSeconds
      const kickOn = kick && Math.floor((time - partStart) / beatSeconds) >= kickFromBeat
      const kickSample = kickOn ? Math.sin(2 * Math.PI * 70 * sinceBeat) * Math.exp(-25 * sinceBeat) * 0.6 : 0
      const padSample = pad ? Math.sin(2 * Math.PI * 55 * time) * 0.3 : 0
      const sinceOffbeat = sinceBeat - beatSeconds / 2
      const bassSample = offbeatBass && sinceOffbeat >= 0 ? Math.sin(2 * Math.PI * 45 * sinceOffbeat) * 0.15 : 0
      samples[i] = (kickSample + padSample + bassSample) * level
    }
    partStart = partEnd
  }
  return wav(samples)
}

/** `seconds` of silence. */
export function silence(seconds = 10): Buffer {
  return wav(new Float32Array(44100 * seconds))
}

/**
 * Chords played one after another, each for `secondsPerChord`, looping for `seconds`. Each chord is a list of MIDI note
 * numbers (60 is middle C), played as tones with a few overtones like a real instrument.
 */
export function chords(progression: number[][], { seconds = 20, secondsPerChord = 1 } = {}): Buffer {
  const rate = 44100
  const samples = new Float32Array(rate * seconds)
  for (let i = 0; i < samples.length; i++) {
    const time = i / rate
    const chord = progression[Math.floor(time / secondsPerChord) % progression.length]
    let sample = 0
    for (const note of chord) {
      const hz = 440 * 2 ** ((note - 69) / 12)
      for (let overtone = 1; overtone <= 4; overtone++) sample += Math.sin(2 * Math.PI * hz * overtone * time) / overtone
    }
    samples[i] = (sample / chord.length) * 0.3
  }
  return wav(samples)
}
