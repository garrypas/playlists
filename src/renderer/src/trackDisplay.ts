import type { Playlist, PlaylistTrack } from '../../shared/playlist'

export const coverColors = ['plum', 'amber', 'sky', 'rose', 'mint']

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—:—'
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

// A song's tempo as shown in song lists: whole beats per minute, or a dash until it's known.
export function formatBpm(bpm: number | null): string {
  return bpm === null ? '—' : String(Math.round(bpm))
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

/** An album in the library: songs that share an album name and album artist (or artist, when there's no album artist). */
export interface LibraryAlbum {
  key: string
  title: string
  artist: string
  songs: LibrarySong[]
}

/** An artist in the library, with their songs and the albums those songs are on. */
export interface LibraryArtist {
  name: string
  songs: LibrarySong[]
  albumCount: number
}

const albumArtistOf = (song: PlaylistTrack): string => song.albumArtist || song.artist
const nullsLast = (value: number | null): number => value ?? Number.MAX_SAFE_INTEGER

// Album order: disc, then track number, then title (songs without numbers go last).
function compareInAlbum(a: PlaylistTrack, b: PlaylistTrack): number {
  return (
    nullsLast(a.discNumber) - nullsLast(b.discNumber) ||
    nullsLast(a.trackNumber) - nullsLast(b.trackNumber) ||
    compareText(a.title, b.title) ||
    a.id - b.id
  )
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item])
  return groups
}

// Every album with at least one song, sorted by artist then title, songs in album order. Songs with no album aren't
// on one. Names are matched ignoring case, so "OutRun" and "Outrun" are one album.
export function libraryAlbums(songs: LibrarySong[]): LibraryAlbum[] {
  const groups = groupBy(
    songs.filter((song) => song.album),
    (song) => `${albumArtistOf(song).toLocaleLowerCase()}\u0000${song.album.toLocaleLowerCase()}`,
  )
  return [...groups]
    .map(([key, albumSongs]) => ({
      key,
      title: albumSongs[0].album,
      artist: albumArtistOf(albumSongs[0]),
      songs: [...albumSongs].sort(compareInAlbum),
    }))
    .sort((a, b) => compareText(a.artist, b.artist) || compareText(a.title, b.title))
}

// Every artist with at least one song, sorted by name. Their songs run album by album, in album order, with songs
// that have no album last.
export function libraryArtists(songs: LibrarySong[]): LibraryArtist[] {
  const groups = groupBy(songs, (song) => song.artist.toLocaleLowerCase())
  return [...groups.values()]
    .map((artistSongs) => ({
      name: artistSongs[0].artist,
      songs: [...artistSongs].sort(
        (a, b) => Number(!a.album) - Number(!b.album) || compareText(a.album, b.album) || compareInAlbum(a, b),
      ),
      albumCount: new Set(artistSongs.filter((song) => song.album).map((song) => song.album.toLocaleLowerCase()))
        .size,
    }))
    .sort((a, b) => compareText(a.name, b.name))
}

/** Total length of songs whose length is known, as "1 hr 5 min" or "42 min"; null if none are known. */
export function formatTotalDuration(songs: PlaylistTrack[]): string | null {
  const known = songs.filter((song) => song.durationSeconds !== null)
  if (!known.length) return null
  const minutes = Math.round(known.reduce((total, song) => total + (song.durationSeconds ?? 0), 0) / 60)
  return minutes >= 60 ? `${Math.floor(minutes / 60)} hr ${minutes % 60} min` : `${minutes} min`
}
