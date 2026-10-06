import type { Playlist, PlaylistTrack } from '../../shared/playlist'

export const coverColors = ['plum', 'amber', 'sky', 'rose', 'mint']

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—:—'
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** A song as Explore shows it: one entry per file, however many playlists it's in. */
export interface LibrarySong extends PlaylistTrack {
  playlistIds: number[]
}

const compareText = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: 'base' })

// Every song across all playlists, once per file, sorted by artist, album, then title. Each song uses the ID of its
// earliest-added copy, so moving songs within playlists doesn't change which copy stands in for it.
export function librarySongs(playlists: Playlist[]): LibrarySong[] {
  const byFile = new Map<string, LibrarySong>()
  for (const playlist of playlists) {
    for (const track of playlist.tracks) {
      const song = byFile.get(track.filePath)
      const playlistIds = [...(song?.playlistIds ?? []), playlist.id]
      byFile.set(track.filePath, !song || track.id < song.id ? { ...track, playlistIds } : { ...song, playlistIds })
    }
  }
  return [...byFile.values()].sort(
    (a, b) =>
      compareText(a.artist, b.artist) || compareText(a.album, b.album) || compareText(a.title, b.title) || a.id - b.id,
  )
}
