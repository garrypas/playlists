declare module 'music-tempo' {
  export default class MusicTempo {
    constructor(
      audioData: Float32Array | number[],
      params?: {
        sampleRate?: number
        bufferSize?: number
        hopSize?: number
        timeStep?: number
        initPeriod?: number
        expiryTime?: number
      },
    )
    /** Beats per minute, formatted to three decimal places. */
    tempo: string
    /** Beat times in seconds. */
    beats: number[]
  }
}
