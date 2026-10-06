export interface PlaylistTrack {
  id: number
  filePath: string
  title: string
  artist: string
  album: string
  durationSeconds: number | null
  position: number
}

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
  removeTrack(playlistId: number, trackId: number): Promise<Playlist[]>
  moveTrack(playlistId: number, trackId: number, toIndex: number): Promise<Playlist[]>
}
