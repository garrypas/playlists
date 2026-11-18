import type { DesktopApi } from '../../../preload'
import type { DjDetails } from '../../../shared/djDetails'
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
      bpm?: number | null
      key?: string | null
      /** How much faster or slower (percent) it plays in this playlist. */
      tempo?: number
      /** What background analysis found for mixing it; unknown (null) if left out. */
      dj?: DjDetails
    }

export interface FakeDesktop {
  api: DesktopApi
  /** The playlists as saved on "disk". */
  saved: () => Playlist[]
  idOf: (songTitle: string) => number
  titleOf: (songId: number) => string | undefined
  /** Files the system file dialog will return next; empty means the user cancels. */
  pickFiles: (paths: string[]) => void
  /** The main process finished detecting a song's tempo and tells the window (`bpm` undefined: no steady beat). */
  tempoDetected: (songTitle: string, bpm: number | undefined) => void
  /** The main process finished finding a song's key and tells the window (`key` undefined: no key fits it). */
  keyDetected: (songTitle: string, key: string | undefined) => void
  /** The main process finished finding a song's DJ details (beat grid, phrases, drops) and tells the window. */
  djDetailsFound: (songTitle: string, details: DjDetails) => void
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
  const changeListeners = new Set<(playlists: Playlist[]) => void>()
  // DJ details belong to the file, like the main process keeps them.
  const djDetails = new Map<string, DjDetails>()

  function track(spec: SongSpec, position: number, filePath?: string): PlaylistTrack {
    const {
      title,
      artist = 'Unknown artist',
      album = '',
      albumArtist = '',
      trackNumber = null,
      discNumber = null,
      durationSeconds = null,
      bpm = null,
      key = null,
      tempo = 0,
      dj,
    } = typeof spec === 'string' ? { title: spec } : spec
    const id = nextTrackId++
    if (dj) djDetails.set(filePath ?? `/music/${title}.mp3`, dj)
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
      bpm,
      key,
      tempo,
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
          // A copy starts at normal speed, like the main process.
          playlist.tracks.push(track({ ...song, tempo: 0 }, playlist.tracks.length, song.filePath))
        }),
      removeTrack: (playlistId, trackId) =>
        call('playlists:remove-track', () => {
          const playlist = find(playlistId)
          playlist.tracks = playlist.tracks.filter((item) => item.id !== trackId)
        }),
      setTrackTempo: (trackId, percent) =>
        call('playlists:set-track-tempo', () => {
          if (!Number.isFinite(percent) || Math.abs(percent) > 10) throw new Error('Invalid tempo.')
          const song = store.flatMap((item) => item.tracks).find((item) => item.id === trackId)
          if (!song) throw new Error('Song not found.')
          song.tempo = Math.round(percent * 10) / 10 || 0
        }),
      djDetails: async (trackId) => {
        calls.push('playlists:dj-details')
        const song = store.flatMap((item) => item.tracks).find((item) => item.id === trackId)
        return song ? structuredClone(djDetails.get(song.filePath) ?? null) : null
      },
      move: (id, toIndex) =>
        call('playlists:move', () => {
          const [moved] = store.splice(store.indexOf(find(id)), 1)
          store.splice(Math.min(toIndex, store.length), 0, moved)
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
      onChanged: (listener) => {
        changeListeners.add(listener)
        return () => changeListeners.delete(listener)
      },
    },
  }

  // Saves what was found about a song on every copy of its file, and tells the window, like the main process does.
  function detected(songTitle: string, details: Partial<PlaylistTrack>): void {
    const tracks = store.flatMap((playlist) => playlist.tracks)
    const filePath = tracks.find((item) => item.title === songTitle)!.filePath
    for (const item of tracks) if (item.filePath === filePath) Object.assign(item, details)
    for (const listener of changeListeners) listener(structuredClone(store))
  }

  return {
    api,
    saved: () => structuredClone(store),
    idOf: (songTitle) => [...allTitles].find(([, title]) => title === songTitle)![0],
    titleOf: (songId) => allTitles.get(songId),
    tempoDetected: (songTitle, bpm) => detected(songTitle, { bpm: bpm ?? null }),
    keyDetected: (songTitle, key) => detected(songTitle, { key: key ?? null }),
    djDetailsFound: (songTitle, details) => {
      const song = store.flatMap((playlist) => playlist.tracks).find((item) => item.title === songTitle)!
      djDetails.set(song.filePath, details)
      detected(songTitle, {})
    },
    pickFiles: (paths) => {
      picked = paths
    },
    failNext: (channel, message) => {
      failure = { channel, message }
    },
    calls,
  }
}
