import type { DesktopApi } from '../../../preload'
import type { Playlist, PlaylistTrack } from '../../../shared/playlist'

export type SongSpec =
  | string
  | {
      title: string
      artist?: string
      album?: string
      albumArtist?: string
      trackNumber?: number | null
      discNumber?: number | null
      durationSeconds?: number | null
    }

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
export function createFakeDesktop(playlists: { title: string; songs?: SongSpec[] }[]): FakeDesktop {
  let nextPlaylistId = 1
  let nextTrackId = 1
  const allTitles = new Map<number, string>()
  let picked: string[] = []
  let failure: { channel: string; message: string } | null = null
  const calls: string[] = []

  function track(spec: SongSpec, position: number, filePath?: string): PlaylistTrack {
    const {
      title,
      artist = 'Unknown artist',
      album = '',
      albumArtist = '',
      trackNumber = null,
      discNumber = null,
      durationSeconds = null,
    } = typeof spec === 'string' ? { title: spec } : spec
    const id = nextTrackId++
    allTitles.set(id, title)
    return {
      id,
      filePath: filePath ?? `/music/${title}.mp3`,
      title,
      artist,
      album,
      albumArtist,
      trackNumber,
      discNumber,
      durationSeconds,
      position,
    }
  }

  let store: Playlist[] = playlists.map(({ title, songs = [] }) => ({
    id: nextPlaylistId++,
    title,
    description: '',
    gradient: 'sage',
    icon: '♫',
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
      create: (input) =>
        call('playlists:create', () => {
          store.push({
            id: nextPlaylistId++,
            title: input.title,
            description: input.description ?? '',
            gradient: 'sage',
            icon: '♫',
            tracks: [],
          })
        }),
      rename: (id, title) =>
        call('playlists:rename', () => {
          find(id).title = title
        }),
      remove: (id) =>
        call('playlists:remove', () => {
          store = store.filter((playlist) => playlist.id !== id)
        }),
      addAudioFiles: (id) =>
        call('playlists:add-audio-files', () => {
          const playlist = find(id)
          for (const path of picked) {
            const title = path
              .split('/')
              .pop()!
              .replace(/\.[^.]+$/, '')
            playlist.tracks.push(track(title, playlist.tracks.length, path))
          }
          picked = []
        }),
      addTrack: (playlistId, trackId) =>
        call('playlists:add-track', () => {
          const playlist = find(playlistId)
          const song = store.flatMap((item) => item.tracks).find((item) => item.id === trackId)
          if (!song) throw new Error('Song not found.')
          if (playlist.tracks.some((item) => item.filePath === song.filePath)) return
          playlist.tracks.push(track(song, playlist.tracks.length, song.filePath))
        }),
      removeTrack: (playlistId, trackId) =>
        call('playlists:remove-track', () => {
          const playlist = find(playlistId)
          playlist.tracks = playlist.tracks.filter((item) => item.id !== trackId)
        }),
      moveTrack: (playlistId, trackId, toIndex) =>
        call('playlists:move-track', () => {
          const playlist = find(playlistId)
          const from = playlist.tracks.findIndex((item) => item.id === trackId)
          if (from < 0) throw new Error('Song not found.')
          const [moved] = playlist.tracks.splice(from, 1)
          playlist.tracks.splice(Math.min(toIndex, playlist.tracks.length), 0, moved)
          playlist.tracks.forEach((item, position) => {
            item.position = position
          })
        }),
    },
  }

  return {
    api,
    saved: () => structuredClone(store),
    idOf: (songTitle) => [...allTitles].find(([, title]) => title === songTitle)![0],
    titleOf: (songId) => allTitles.get(songId),
    pickFiles: (paths) => {
      picked = paths
    },
    failNext: (channel, message) => {
      failure = { channel, message }
    },
    calls,
  }
}
