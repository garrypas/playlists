import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { SongTable, type SongTableProps } from './SongTable'

type ExploreViewProps = Omit<SongTableProps, 'emptyMessage'>

// Every song on this device in one list, searchable and filterable by artist, with a way to add songs to playlists.
export function ExploreView({ songs, ...tableProps }: ExploreViewProps) {
  const [query, setQuery] = useState('')
  const [artistFilter, setArtistFilter] = useState<string | null>(null)

  const artists = useMemo(() => [...new Set(songs.map((song) => song.artist))], [songs])
  // An artist whose songs have all been removed stops filtering.
  const artist = artistFilter !== null && artists.includes(artistFilter) ? artistFilter : null
  const visibleSongs = songs.filter(
    (song) =>
      (artist === null || song.artist === artist) &&
      `${song.title} ${song.artist} ${song.album}`.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <section className="tracks-section explore-section">
      <div className="section-title-row track-heading">
        <div>
          <p className="eyebrow">EVERYTHING ON THIS DEVICE</p>
          <h2>Explore</h2>
          <p className="explore-summary">
            {songs.length} {songs.length === 1 ? 'song' : 'songs'} · {artists.length}{' '}
            {artists.length === 1 ? 'artist' : 'artists'}
          </p>
        </div>
        <label className="search-field">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search all songs"
            aria-label="Search all songs"
          />
        </label>
      </div>
      {artists.length > 1 && (
        <div className="explore-artists" role="group" aria-label="Filter by artist">
          {[null, ...artists].map((name) => (
            <button
              key={name ?? ''}
              className="artist-chip"
              aria-pressed={artist === name}
              onClick={() => setArtistFilter(name)}
            >
              {name ?? 'All artists'}
            </button>
          ))}
        </div>
      )}
      <SongTable
        {...tableProps}
        songs={visibleSongs}
        emptyMessage={
          songs.length === 0
            ? 'No songs yet. Songs you add to any playlist show up here.'
            : `No songs match “${query}”${artist === null ? '' : ` by ${artist}`}.`
        }
      />
    </section>
  )
}
