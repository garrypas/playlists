// Each deck's level, bass and sweep filters for DJ mode: the deck's <audio> element feeds a low-shelf filter, a
// high-pass and a low-pass (for filter fades; wide open, they pass everything), and then a gain, in one AudioContext.
// A blend can cut one song's bass while the other's plays (two basslines together sound muddy), a filter fade sweeps
// a song away, and each deck's level glides smoothly between the mix's updates. The player's volume stays on the element
// itself, which Chromium applies before the audio reaches Web Audio.
//
// Routing an element into Web Audio is permanent, so it happens the first time DJ mode is on. The elements must load
// with crossOrigin="anonymous" and playlist-audio: must answer with CORS headers, or Web Audio hears silence.

/** Below this frequency (Hz) is "bass". */
const BASS_FREQUENCY = 200
/** How far the bass drops when it's cut (dB). */
const BASS_CUT_DB = -30
/** How quickly the bass moves to a new setting (seconds; a time constant, so ~3× this to settle). */
const BASS_SMOOTHING = 0.02
/**
 * How quickly a deck's level moves to a new setting (seconds, a time constant). The mix sets levels every 50 ms;
 * jumping straight to each one would step the volume 20 times a second, which buzzes ("zipper noise"). This settles
 * within one update while gliding between them.
 */
const LEVEL_SMOOTHING = 0.015
/** The sweep filters wide open (Hz): below and above anything audible. */
const HIGH_PASS_OPEN = 10
const LOW_PASS_OPEN = 20000
/** The sweep filters fully closed (Hz): the high-pass leaves only the top of the sound, the low-pass a muffled thump. */
const HIGH_PASS_CLOSED = 2000
const LOW_PASS_CLOSED = 200
/** Resonance at the cutoff (dB). Web Audio's default: enough not to sound dull, too little to colour normal playback. */
const SWEEP_RESONANCE = 1
/** How quickly the sweep filters move to a new setting (seconds, a time constant). */
const SWEEP_SMOOTHING = 0.02

export interface DeckEq {
  /** Sets how much of a deck's bass plays: 1 full, 0 cut. */
  setBass(element: HTMLAudioElement, amount: number): void
  /**
   * Sets how far a deck's high-pass and low-pass filters are closed, from 0 (open) to 1 (closed). The cutoff moves
   * evenly in octaves, the way a DJ turns a filter knob.
   */
  setFilters(element: HTMLAudioElement, highPass: number, lowPass: number): void
  /** Sets how loud a deck plays in the mix, from 0 to 1, on top of the player's volume. */
  setLevel(element: HTMLAudioElement, level: number): void
  /** Starts the audio again if the platform suspended it (it can only start after a click). */
  resume(): void
}

/**
 * Routes the decks through level, bass and sweep-filter controls. Returns null if the platform has no Web Audio or it fails, in
 * which case DJ mode mixes on the elements' volume alone.
 */
export function createDeckEq(elements: HTMLAudioElement[]): DeckEq | null {
  try {
    const context = new AudioContext()
    const decks = new Map<
      HTMLAudioElement,
      { filter: BiquadFilterNode; highPass: BiquadFilterNode; lowPass: BiquadFilterNode; gain: GainNode }
    >()
    const sweepTargets = new Map<HTMLAudioElement, string>()
    const bassTargets = new Map<HTMLAudioElement, number>()
    const levelTargets = new Map<HTMLAudioElement, number>()
    for (const element of elements) {
      const filter = context.createBiquadFilter()
      filter.type = 'lowshelf'
      filter.frequency.value = BASS_FREQUENCY
      filter.gain.value = 0
      const sweep = (type: BiquadFilterType, frequency: number): BiquadFilterNode => {
        const node = context.createBiquadFilter()
        node.type = type
        node.frequency.value = Math.min(frequency, context.sampleRate / 2)
        node.Q.value = SWEEP_RESONANCE
        return node
      }
      const highPass = sweep('highpass', HIGH_PASS_OPEN)
      const lowPass = sweep('lowpass', LOW_PASS_OPEN)
      const gain = context.createGain()
      gain.gain.value = 1
      context.createMediaElementSource(element).connect(filter)
      filter.connect(highPass)
      highPass.connect(lowPass)
      lowPass.connect(gain)
      gain.connect(context.destination)
      decks.set(element, { filter, highPass, lowPass, gain })
    }
    const resume = (): void => {
      if (context.state === 'suspended') void context.resume().catch(() => {})
    }
    resume()
    return {
      setBass(element, amount) {
        const deck = decks.get(element)
        if (!deck) return
        const gain = amount >= 1 ? 0 : amount <= 0 ? BASS_CUT_DB : Math.max(BASS_CUT_DB, 20 * Math.log10(amount))
        if ((bassTargets.get(element) ?? 0) === gain) return
        bassTargets.set(element, gain)
        deck.filter.gain.setTargetAtTime(gain, context.currentTime, BASS_SMOOTHING)
      },
      setFilters(element, highPass, lowPass) {
        const deck = decks.get(element)
        if (!deck) return
        const amount = (value: number): number => Math.min(1, Math.max(0, value))
        const target = `${amount(highPass)},${amount(lowPass)}`
        if ((sweepTargets.get(element) ?? '0,0') === target) return
        sweepTargets.set(element, target)
        const cutoff = (open: number, closed: number, value: number): number =>
          Math.min(open * (closed / open) ** amount(value), context.sampleRate / 2)
        const now = context.currentTime
        deck.highPass.frequency.setTargetAtTime(cutoff(HIGH_PASS_OPEN, HIGH_PASS_CLOSED, highPass), now, SWEEP_SMOOTHING)
        deck.lowPass.frequency.setTargetAtTime(cutoff(LOW_PASS_OPEN, LOW_PASS_CLOSED, lowPass), now, SWEEP_SMOOTHING)
      },
      setLevel(element, level) {
        const deck = decks.get(element)
        if (!deck) return
        const target = Math.min(1, Math.max(0, level))
        if ((levelTargets.get(element) ?? 1) === target) return
        levelTargets.set(element, target)
        deck.gain.gain.setTargetAtTime(target, context.currentTime, LEVEL_SMOOTHING)
      },
      resume,
    }
  } catch {
    return null
  }
}
