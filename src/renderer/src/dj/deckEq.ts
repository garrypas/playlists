// Each deck's bass control for DJ mode: the deck's <audio> element feeds a low-shelf filter in one AudioContext, so
// a blend can cut one song's bass while the other's plays (two basslines together sound muddy). Volume stays on the
// element itself, which Chromium applies before the audio reaches Web Audio.
//
// Routing an element into Web Audio is permanent, so it happens the first time DJ mode is turned on (a click, which
// also lets the context start). The elements must load with crossOrigin="anonymous" and playlist-audio: must answer
// with CORS headers, or Web Audio hears silence.

/** Below this frequency (Hz) is "bass". */
const BASS_FREQUENCY = 200
/** How far the bass drops when it's cut (dB). */
const BASS_CUT_DB = -30
/** How quickly the bass moves to a new setting (seconds; a time constant, so ~3× this to settle). */
const BASS_SMOOTHING = 0.02

export interface DeckEq {
  /** Sets how much of a deck's bass plays: 1 full, 0 cut. */
  setBass(element: HTMLAudioElement, amount: number): void
}

/**
 * Routes the decks through bass filters. Returns null if the platform has no Web Audio or it fails, in which case DJ
 * mode mixes on volume alone.
 */
export function createDeckEq(elements: HTMLAudioElement[]): DeckEq | null {
  try {
    const context = new AudioContext()
    const filters = new Map<HTMLAudioElement, BiquadFilterNode>()
    const targets = new Map<HTMLAudioElement, number>()
    for (const element of elements) {
      const filter = context.createBiquadFilter()
      filter.type = 'lowshelf'
      filter.frequency.value = BASS_FREQUENCY
      filter.gain.value = 0
      context.createMediaElementSource(element).connect(filter)
      filter.connect(context.destination)
      filters.set(element, filter)
    }
    void context.resume().catch(() => {})
    return {
      setBass(element, amount) {
        const filter = filters.get(element)
        if (!filter) return
        const gain = amount >= 1 ? 0 : amount <= 0 ? BASS_CUT_DB : Math.max(BASS_CUT_DB, 20 * Math.log10(amount))
        if ((targets.get(element) ?? 0) === gain) return
        targets.set(element, gain)
        filter.gain.setTargetAtTime(gain, context.currentTime, BASS_SMOOTHING)
      },
    }
  } catch {
    return null
  }
}
