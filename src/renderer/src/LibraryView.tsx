import { useState } from 'react'
import { ArrowLeft, Play } from 'lucide-react'
import { SongTable, type SongTableProps } from './SongTable'
import { TrackArt } from './TrackArt'
import {
  coverColors,
  formatTotalDuration,
  libraryAlbums,
  libraryArtists,
  type LibraryAlbum,
  type LibraryArtist,
  type LibrarySong,
} from './trackDisplay'

/** What playback plays through when started from the library. */
export type LibrarySource = `album:${string}` | `artist:${string}`

interface LibraryViewProps extends Omit<SongTableProps, 'emptyMessage' | 'onPlay'> {
  /** Plays `song` (or the first song, or a random one with shuffle on, when it's undefined) from an album or artist. */
  onPlay: (source: LibrarySource, song?: LibrarySong) => void
}

const noSongs = 'No songs yet. Songs you add to any playlist show up here.'

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// Your music grouped into albums (with their cover art) and artists. Opening one lists its songs, ready to play.
export function LibraryView({ songs, onPlay, ...tableProps }: LibraryViewProps) {
  const [tab, setTab] = useState<'albums' | 'artists'>('albums')
  const [opened, setOpened] = useState<LibrarySource | null>(null)
  const albums = libraryAlbums(songs)
  const artists = libraryArtists(songs)
  // If everything in the open album or artist is removed, go back to the list.
  const openAlbum = albums.find((album) => opened === `album:${album.key}`)
  const openArtist = artists.find((artist) => opened === `artist:${artist.name.toLocaleLowerCase()}`)

  if (openAlbum || openArtist) {
    const source = opened!
    const detail = openAlbum
      ? { kind: 'Album', title: openAlbum.title, byline: openAlbum.artist, songs: openAlbum.songs }
      : { kind: 'Artist', title: openArtist!.name, byline: count(openArtist!.albumCount, 'album'), songs: openArtist!.songs }
    const total = formatTotalDuration(detail.songs)
    return (
      <section className="tracks-section library-section">
        <button className="text-button library-back" onClick={() => setOpened(null)}>
          <ArrowLeft size={13} /> {openAlbum ? 'Albums' : 'Artists'}
        </button>
        <div className="library-detail-header">
          {openAlbum ? (
            <TrackArt trackId={openAlbum.songs[0].id} color="plum" iconSize={40} className="library-detail-art" />
          ) : (
            <span className="library-avatar library-detail-art" aria-hidden="true">
              {openArtist!.name.charAt(0).toUpperCase()}
            </span>
          )}
          <div>
            <p className="eyebrow">{detail.kind.toUpperCase()}</p>
            <h2>{detail.title}</h2>
            <p className="explore-summary">
              {[detail.byline, count(detail.songs.length, 'song'), total].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button className="small-action primary-action library-play" onClick={() => onPlay(source)}>
            <Play size={13} fill="currentColor" /> Play all
          </button>
        </div>
        <SongTable {...tableProps} songs={detail.songs} onPlay={(song) => onPlay(source, song)} emptyMessage={noSongs} />
      </section>
    )
  }

  return (
    <section className="tracks-section library-section">
      <div className="section-title-row track-heading">
        <div>
          <p className="eyebrow">YOUR COLLECTION</p>
          <h2>Your library</h2>
          <p className="explore-summary">
            {count(albums.length, 'album')} · {count(artists.length, 'artist')}
          </p>
        </div>
      </div>
      <div className="explore-artists" role="group" aria-label="Browse by">
        {(['albums', 'artists'] as const).map((name) => (
          <button key={name} className="artist-chip" aria-pressed={tab === name} onClick={() => setTab(name)}>
            {name === 'albums' ? 'Albums' : 'Artists'}
          </button>
        ))}
      </div>
      {tab === 'albums' ? (
        <AlbumGrid albums={albums} hasSongs={songs.length > 0} onOpen={(album) => setOpened(`album:${album.key}`)} />
      ) : (
        <ArtistGrid artists={artists} onOpen={(artist) => setOpened(`artist:${artist.name.toLocaleLowerCase()}`)} />
      )}
    </section>
  )
}

function AlbumGrid({
  albums,
  hasSongs,
  onOpen,
}: {
  albums: LibraryAlbum[]
  hasSongs: boolean
  onOpen: (album: LibraryAlbum) => void
}) {
  if (!albums.length) {
    return (
      <p className="empty-state">
        {hasSongs ? 'None of your songs have an album in their tags. Find them under Artists, or in Explore.' : noSongs}
      </p>
    )
  }
  return (
    <ul className="library-grid" aria-label="Albums">
      {albums.map((album, index) => (
        <li key={album.key}>
          <button
            className="library-card"
            aria-label={`${album.title} by ${album.artist}, ${count(album.songs.length, 'song')}`}
            onClick={() => onOpen(album)}
          >
            <TrackArt
              trackId={album.songs[0].id}
              color={coverColors[index % coverColors.length]}
              iconSize={34}
              className="library-card-art"
            />
            <span className="card-copy">
              <strong>{album.title}</strong>
              <span>{album.artist}</span>
              <span>{count(album.songs.length, 'song')}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function ArtistGrid({ artists, onOpen }: { artists: LibraryArtist[]; onOpen: (artist: LibraryArtist) => void }) {
  if (!artists.length) return <p className="empty-state">{noSongs}</p>
  return (
    <ul className="library-grid" aria-label="Artists">
      {artists.map((artist, index) => (
        <li key={artist.name}>
          <button
            className="library-card"
            aria-label={`${artist.name}, ${count(artist.songs.length, 'song')}, ${count(artist.albumCount, 'album')}`}
            onClick={() => onOpen(artist)}
          >
            <span className={`library-avatar ${coverColors[index % coverColors.length]}`} aria-hidden="true">
              {artist.name.charAt(0).toUpperCase()}
            </span>
            <span className="card-copy">
              <strong>{artist.name}</strong>
              <span>
                {count(artist.songs.length, 'song')} · {count(artist.albumCount, 'album')}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
