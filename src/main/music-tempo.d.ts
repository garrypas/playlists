declare module 'music-tempo' {
  export default class MusicTempo {
    constructor(audioData: Float32Array | number[], params?: { sampleRate?: number; initPeriod?: number })
    /** Beats per minute, formatted to three decimal places. */
    tempo: string
    /** Beat times in seconds. */
    beats: number[]
  }
}
