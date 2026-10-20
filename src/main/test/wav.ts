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
