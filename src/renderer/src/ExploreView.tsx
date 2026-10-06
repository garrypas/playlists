import { useEffect, useMemo, useRef, useState } from 'react'
import { AudioLines, Check, Pause, Play, Plus, Search } from 'lucide-react'
import type { Playlist } from '../../shared/playlist'
import { TrackArt } from './TrackArt'
import { coverColors, formatDuration, type LibrarySong } from './trackDisplay'

interface ExploreViewProps {
  songs: LibrarySong[]
  playlists: Playlist[]
  currentFilePath: string | undefined
  playing: boolean
  onPlay: (song: LibrarySong) => void
  onTogglePlaying: () => void
  /** Saves the song to the playlist; resolves false if that failed (the app reports the error). */
  onAddToPlaylist: (song: LibrarySong, playlistId: number) => Promise<boolean>
}

// Every song on this device in one list, searchable and filterable by artist, with a way to add songs to playlists.
export function ExploreView({
  songs,
  playlists,
  currentFilePath,
  playing,
  onPlay,
  onTogglePlaying,
  onAddToPlaylist,
}: ExploreViewProps) {
  const [query, setQuery] = useState('')
  const [artistFilter, setArtistFilter] = useState<string | null>(null)
  // The song whose "Add to playlist" menu is open.
  const [menuSongId, setMenuSongId] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  const artists = useMemo(() => [...new Set(songs.map((song) => song.artist))], [songs])
  // An artist whose songs have all been removed stops filtering.
  const artist = artistFilter !== null && artists.includes(artistFilter) ? artistFilter : null
  const visibleSongs = songs.filter(
    (song) =>
      (artist === null || song.artist === artist) &&
      `${song.title} ${song.artist} ${song.album}`.toLowerCase().includes(query.toLowerCase()),
  )
  const playlistTitle = (id: number): string => playlists.find((playlist) => playlist.id === id)?.title ?? ''

  // Close the menu on Escape (returning focus to its button) or a click outside it.
  useEffect(() => {
    if (menuSongId === null) return
    menuRef.current?.querySelector<HTMLButtonElement>('button:enabled')?.focus()
    function handleKey(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      setMenuSongId(null)
      menuButtonRef.current?.focus()
    }
    function handlePointer(event: PointerEvent): void {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !menuButtonRef.current?.contains(target)) setMenuSongId(null)
    }
    window.addEventListener('keydown', handleKey)
    window.addEventListener('pointerdown', handlePointer)
    return () => {
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('pointerdown', handlePointer)
    }
  }, [menuSongId])

  async function addToPlaylist(song: LibrarySong, playlist: Playlist): Promise<void> {
    setMenuSongId(null)
    menuButtonRef.current?.focus()
    if (await onAddToPlaylist(song, playlist.id)) setStatus(`Added ${song.title} to ${playlist.title}.`)
  }

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
      <p className="explore-status" role="status">
        {status}
      </p>
      <div className="track-table">
        <div className="track-row explore-row table-head">
          <span>#</span>
          <span>TITLE</span>
          <span>ALBUM</span>
          <span>IN PLAYLISTS</span>
          <span>TIME</span>
          <span />
        </div>
        {visibleSongs.map((song, index) => {
          const isCurrent = song.filePath === currentFilePath
          return (
            <div className={`track-row explore-row ${isCurrent ? 'track-current' : ''}`} key={song.filePath}>
              <button
                className="track-index track-play"
                aria-label={`Play ${song.title}`}
                title={`Play ${song.title}`}
                onClick={() => onPlay(song)}
              >
                {isCurrent && playing ? <AudioLines size={15} /> : String(index + 1).padStart(2, '0')}
              </button>
              <span className="track-title-cell">
                <button
                  className="track-art-button"
                  tabIndex={-1}
                  aria-hidden="true"
                  title={isCurrent && playing ? 'Pause' : `Play ${song.title}`}
                  onClick={() => (isCurrent ? onTogglePlaying() : onPlay(song))}
                >
                  <TrackArt trackId={song.id} color={coverColors[index % coverColors.length]} iconSize={19} />
                  <span className="track-art-overlay">
                    {isCurrent && playing ? (
                      <Pause size={15} fill="currentColor" />
                    ) : (
                      <Play size={15} fill="currentColor" />
                    )}
                  </span>
                </button>
                <span className="track-meta">
                  <strong>{song.title}</strong>
                  <span>{song.artist}</span>
                </span>
              </span>
              <span className="album-name">{song.album || 'Local audio file'}</span>
              <span className="album-name">{song.playlistIds.map(playlistTitle).join(', ')}</span>
              <span className="track-duration">{formatDuration(song.durationSeconds)}</span>
              <span className="track-actions explore-actions">
                <button
                  ref={menuSongId === song.id ? menuButtonRef : undefined}
                  className="track-queue"
                  aria-label={`Add ${song.title} to a playlist`}
                  title="Add to playlist"
                  aria-haspopup="true"
                  aria-expanded={menuSongId === song.id}
                  onClick={() => setMenuSongId(menuSongId === song.id ? null : song.id)}
                >
                  <Plus size={15} />
                </button>
                {menuSongId === song.id && (
                  <div ref={menuRef} className="playlist-menu" role="group" aria-label={`Add ${song.title} to`}>
                    {playlists.map((playlist) => {
                      const added = song.playlistIds.includes(playlist.id)
                      return (
                        <button
                          key={playlist.id}
                          disabled={added}
                          title={added ? `Already in ${playlist.title}` : undefined}
                          onClick={() => void addToPlaylist(song, playlist)}
                        >
                          <span className={`mini-cover ${playlist.gradient}`} aria-hidden="true">
                            {playlist.icon}
                          </span>
                          <span className="playlist-menu-title">{playlist.title}</span>
                          {added && (
                            <>
                              <Check size={13} aria-hidden="true" />
                              <span className="visually-hidden"> (already added)</span>
                            </>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </span>
            </div>
          )
        })}
        {visibleSongs.length === 0 && (
          <p className="empty-state">
            {songs.length === 0
              ? 'No songs yet. Songs you add to any playlist show up here.'
              : `No songs match “${query}”${artist === null ? '' : ` by ${artist}`}.`}
          </p>
        )}
      </div>
    </section>
  )
}
