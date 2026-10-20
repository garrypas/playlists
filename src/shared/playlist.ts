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

export interface Playlist {
  id: number
  title: string
  description: string
  gradient: string
  icon: string
  tracks: PlaylistTrack[]
}

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
  addTrack(playlistId: number, trackId: number): Promise<Playlist[]>
  removeTrack(playlistId: number, trackId: number): Promise<Playlist[]>
  moveTrack(playlistId: number, trackId: number, toIndex: number): Promise<Playlist[]>
  /** Saves how much faster or slower (in percent) a song plays in its playlist. */
  setTrackTempo(trackId: number, percent: number): Promise<Playlist[]>
  /** Moves a playlist to `toIndex` in the list of playlists. */
  move(id: number, toIndex: number): Promise<Playlist[]>
  /**
   * Calls `listener` with the full playlist list whenever it changes in the background (e.g. a song's tempo or key is found).
   * Returns a function that stops listening.
   */
  onChanged(listener: (playlists: Playlist[]) => void): () => void
}
