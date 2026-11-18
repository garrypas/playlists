/**
 * What a DJ needs to know about a song's audio, to beatmatch it and choose where to mix in and out. Times are seconds
 * into the file, at normal speed (divide by the playback rate for real time).
 */
export interface DjDetails {
  /** Where sound starts and stops, skipping leading and trailing silence; null if the song is silent throughout. */
  soundStart: number | null
  soundEnd: number | null
  /** Average level of the song's louder parts, in dB below full scale (e.g. -9.5), for matching levels between songs. */
  loudness: number | null
  /** Where the kicks fall; null with no steady beat (ambient, live drums that drift, tempo changes). */
  grid: BeatGrid | null
  /** The whole analysed audio, in order and without gaps, split where it changes (on bar lines when there's a grid). */
  sections: DjSection[]
  /** Where the beat comes back in after a breakdown (a beatless or quiet stretch of 8 bars or more), on a bar line. */
  drops: number[]
  /** How much of the file was analysed (the first 20 minutes at most); nothing is known after this. */
  analysedSeconds: number
}

/** A steady beat: beat n (counting from the first kick) falls at `firstBeat + n × 60 / bpm`. */
export interface BeatGrid {
  /** The beat's exact tempo, unrounded, for beatmatching (the song's `bpm` is this to 0.1). */
  bpm: number
  /** The first and last beats with a kick on them. */
  firstBeat: number
  lastBeat: number
  /**
   * The first beat at or after `firstBeat` that starts a 16-bar phrase (a downbeat). Phrases repeat every 64 beats
   * from here, before it as well as after; bars every 4 beats.
   */
  phraseStart: number
  /** 0–1: the share of beats with a kick, in the bars that have a beat (breakdowns aren't counted against it). */
  confidence: number
  /**
   * How loud each bar is: how much energy each part of the song has. Missing from details found by older versions.
   */
  barLevels?: BarLevels
}

/** The level of every whole bar of a song's grid, in order. */
export interface BarLevels {
  /** Where the first bar starts: the first bar line at or after the start of the file. */
  from: number
  /** Each bar's level, in dB below full scale, to the end of what was analysed: the whole sound. */
  db: number[]
  /** The same for the low end (below 150 Hz): the kick and bassline. */
  lowDb: number[]
}

/**
 * `beat`: kicks on most beats. `beatless`: sound but no beat (an intro pad, a breakdown). `quiet`: well below the song's
 * usual level (a fade, a soft intro or ending). `silent`: no sound.
 */
export type DjSectionKind = 'beat' | 'beatless' | 'quiet' | 'silent'

export interface DjSection {
  kind: DjSectionKind
  start: number
  end: number
}

