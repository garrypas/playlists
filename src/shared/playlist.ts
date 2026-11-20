import type { DjDetails } from './djDetails'

export interface PlaylistTrack {
  id: number
  filePath: string
  title: string
  artist: string
  album: string
  /** The album's artist, from the tags; blank if the file doesn't say. Albums are grouped by this, else `artist`. */
  albumArtist: string
  trackNumber: number | null
  discNumber: number | null
  durationSeconds: number | null
  /** Beats per minute, detected from the audio after the song is added; null until then or with no steady beat. */
  bpm: number | null
  /**
   * The musical key, e.g. "Ebm" (E flat minor) or "F#" (F sharp major): from the file's tags, else detected from the
   * audio after the song is added. Null until then, or when no key fits it.
   */
  key: string | null
  /**
   * How much faster (positive) or slower (negative) than normal this song plays in this playlist, in percent, from
   * -MAX_TEMPO_CHANGE to MAX_TEMPO_CHANGE in steps of 0.1. Pitch moves with it, like a turntable. 0 until changed.
   */
  tempo: number
  position: number
}

/** The tempo control speeds a song up or slows it down by up to this many percent. */
export const MAX_TEMPO_CHANGE = 10

/** The audio file types songs can be added from (lower case, without the dot), by file picker or drag and drop. */
export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'aiff', 'flac', 'ogg', 'opus'] as const

/** Whether a file name ends in one of `AUDIO_EXTENSIONS` (any case). */
export function isAudioFileName(name: string): boolean {
  const extension = /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase()
  return (AUDIO_EXTENSIONS as readonly string[]).includes(extension ?? '')
}

export interface Playlist {
  id: number
  title: string
  description: string
  gradient: string
  icon: string
  /**
   * Changes whenever the user chooses a new image for the playlist's cover; null when it has none and shows its
   * gradient and symbol. The image itself is served at `playlist-audio://playlist-image/<id>?v=<imageVersion>`.
   */
  imageVersion: number | null
  tracks: PlaylistTrack[]
}

/** The image file types a playlist cover can be chosen from (lower case, without the dot). */
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png'] as const

export interface CreatePlaylistInput {
  title: string
  description?: string
}

export interface PlaylistApi {
  list(): Promise<Playlist[]>
  create(input: CreatePlaylistInput): Promise<Playlist[]>
  rename(id: number, title: string): Promise<Playlist[]>
  remove(id: number): Promise<Playlist[]>
  addAudioFiles(id: number): Promise<Playlist[]>
  /**
   * Adds audio files the user dragged in from Finder or Explorer to the end of a playlist, like `addAudioFiles`.
   * Takes the dropped `File` objects themselves (the preload finds their paths), so the window never handles a path.
   * Files that aren't supported audio, no longer exist, or are already in the playlist are skipped.
   */
  addDroppedFiles(id: number, files: File[]): Promise<Playlist[]>
  addTrack(playlistId: number, trackId: number): Promise<Playlist[]>
  removeTrack(playlistId: number, trackId: number): Promise<Playlist[]>
  moveTrack(playlistId: number, trackId: number, toIndex: number): Promise<Playlist[]>
  /** Saves how much faster or slower (in percent) a song plays in its playlist. */
  setTrackTempo(trackId: number, percent: number): Promise<Playlist[]>
  /**
   * What's known about a song's audio for mixing it (beat grid, phrases, sections, drops), or null until its
   * background analysis has run. Shared by every copy of the file.
   */
  djDetails(trackId: number): Promise<DjDetails | null>
  /** Moves a playlist to `toIndex` in the list of playlists. */
  move(id: number, toIndex: number): Promise<Playlist[]>
  /**
   * Lets the user pick an image (JPEG or PNG) in the system file dialog and makes it the playlist's cover. Cancelling
   * changes nothing. Rejects with a message when the file can't be read as an image.
   */
  chooseImage(id: number): Promise<Playlist[]>
  /** Removes the playlist's chosen image, so its cover shows its gradient and symbol again. */
  removeImage(id: number): Promise<Playlist[]>
  /**
   * Calls `listener` with the full playlist list whenever it changes in the background (e.g. a song's tempo or key is found).
   * Returns a function that stops listening.
   */
  onChanged(listener: (playlists: Playlist[]) => void): () => void
}
