import type { DesktopApi } from '../../../preload'
import type { Playlist, PlaylistTrack } from '../../../shared/playlist'

export type SongSpec = string | { title: string, artist?: string, album?: string }

export interface FakeDesktop {
  api: DesktopApi
  /** The playlists as saved on "disk". */
  saved: () => Playlist[]
  idOf: (songTitle: string) => number
  titleOf: (songId: number) => string | undefined
  /** Files the system file dialog will return next; empty means the user cancels. */
  pickFiles: (paths: string[]) => void
  /** Makes the next call to the main process fail, the way Electron reports it. */
  failNext: (channel: string, message: string) => void
  calls: string[]
}

// An in-memory stand-in for the main process, following the same contract: every change returns the full list.
export function createFakeDesktop(playlists: { title: string, songs?: SongSpec[] }[]): FakeDesktop {
  let nextPlaylistId = 1
  let nextTrackId = 1
  const allTitles = new Map<number, string>()
  let picked: string[] = []
  let failure: { channel: string, message: string } | null = null
  const calls: string[] = []

  function track(spec: SongSpec, position: number, filePath?: string): PlaylistTrack {
    const { title, artist = 'Unknown artist', album = '' } = typeof spec === 'string' ? { title: spec } : spec
    const id = nextTrackId++
    allTitles.set(id, title)
    return { id, filePath: filePath ?? `/music/${title}.mp3`, title, artist, album, durationSeconds: null, position }
  }

  let store: Playlist[] = playlists.map(({ title, songs = [] }) => ({
    id: nextPlaylistId++, title, description: '', gradient: 'sage', icon: '♫',
    tracks: songs.map((song, position) => track(song, position)),
  }))

  async function call(channel: string, change: () => void = () => {}): Promise<Playlist[]> {
    calls.push(channel)
    if (failure?.channel === channel) {
      const { message } = failure
      failure = null
      throw new Error(`Error invoking remote method '${channel}': Error: ${message}`)
    }
    change()
    return structuredClone(store)
  }

  function find(id: number): Playlist {
    const playlist = store.find((item) => item.id === id)
    if (!playlist) throw new Error('Playlist not found.')
    return playlist
  }

  const api: DesktopApi = {
    getAppInfo: async () => ({ name: 'Playlists', version: '1.0.0', platform: 'darwin' }),
    playlists: {
      list: () => call('playlists:list'),
      create: (input) => call('playlists:create', () => {
        store.push({ id: nextPlaylistId++, title: input.title, description: input.description ?? '', gradient: 'sage', icon: '♫', tracks: [] })
      }),
      rename: (id, title) => call('playlists:rename', () => { find(id).title = title }),
      remove: (id) => call('playlists:remove', () => { store = store.filter((playlist) => playlist.id !== id) }),
      addAudioFiles: (id) => call('playlists:add-audio-files', () => {
        const playlist = find(id)
        for (const path of picked) {
          const title = path.split('/').pop()!.replace(/\.[^.]+$/, '')
          playlist.tracks.push(track(title, playlist.tracks.length, path))
        }
        picked = []
      }),
      removeTrack: (playlistId, trackId) => call('playlists:remove-track', () => {
        const playlist = find(playlistId)
        playlist.tracks = playlist.tracks.filter((item) => item.id !== trackId)
      }),
    },
  }

  return {
    api,
    saved: () => structuredClone(store),
    idOf: (songTitle) => [...allTitles].find(([, title]) => title === songTitle)![0],
    titleOf: (songId) => allTitles.get(songId),
    pickFiles: (paths) => { picked = paths },
    failNext: (channel, message) => { failure = { channel, message } },
    calls,
  }
}
