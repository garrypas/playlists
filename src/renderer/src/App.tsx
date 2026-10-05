import { useEffect, useMemo, useState } from 'react'
import {
  AudioLines,
  Disc3,
  Heart,
  Home,
  Library,
  ListMusic,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Search,
  SkipBack,
  SkipForward,
  Shuffle,
  SlidersHorizontal,
  Volume2,
  X,
} from 'lucide-react'
import type { Playlist } from '../../shared/playlist'

const coverColors = ['plum', 'amber', 'sky', 'rose', 'mint']

function App() {
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [playing, setPlaying] = useState(false)
  const [activeTrack, setActiveTrack] = useState(0)
  const [liked, setLiked] = useState(false)
  const [tab, setTab] = useState('Made for you')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void window.desktop.playlists.list().then((items) => {
      setPlaylists(items)
      setSelectedPlaylistId(items[0]?.id ?? null)
    }).catch((error: unknown) => {
      window.alert(error instanceof Error ? error.message : 'Could not load playlists.')
    }).finally(() => setLoading(false))
  }, [])

  const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId)
  const visibleTracks = useMemo(() => (selectedPlaylist?.tracks ?? []).filter((track) =>
    `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query.toLowerCase()),
  ), [query, selectedPlaylist])
  const currentTrack = selectedPlaylist?.tracks[activeTrack]

  async function createPlaylist(): Promise<void> {
    const title = window.prompt('Name your playlist')?.trim()
    if (!title) return
    try {
      const updated = await window.desktop.playlists.create({ title })
      setPlaylists(updated)
      setSelectedPlaylistId(updated[updated.length - 1]?.id ?? null)
      setActiveTrack(0)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not create playlist.')
    }
  }

  async function renamePlaylist(): Promise<void> {
    if (!selectedPlaylist) return
    const title = window.prompt('Rename playlist', selectedPlaylist.title)?.trim()
    if (!title || title === selectedPlaylist.title) return
    try {
      setPlaylists(await window.desktop.playlists.rename(selectedPlaylist.id, title))
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not rename playlist.')
    }
  }

  async function deletePlaylist(): Promise<void> {
    if (!selectedPlaylist || !window.confirm(`Delete “${selectedPlaylist.title}” and its saved songs?`)) return
    try {
      const updated = await window.desktop.playlists.remove(selectedPlaylist.id)
      setPlaylists(updated)
      setSelectedPlaylistId(updated[0]?.id ?? null)
      setActiveTrack(0)
      setPlaying(false)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not delete playlist.')
    }
  }

  async function addAudioFiles(): Promise<void> {
    if (!selectedPlaylist) return
    try {
      const updated = await window.desktop.playlists.addAudioFiles(selectedPlaylist.id)
      setPlaylists(updated)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not add audio files.')
    }
  }

  async function removeTrack(trackId: number): Promise<void> {
    if (!selectedPlaylist) return
    try {
      const removedIndex = selectedPlaylist.tracks.findIndex((track) => track.id === trackId)
      setPlaylists(await window.desktop.playlists.removeTrack(selectedPlaylist.id, trackId))
      if (currentTrack?.id === trackId) {
        setActiveTrack(0)
        setPlaying(false)
      } else if (removedIndex >= 0 && removedIndex < activeTrack) {
        setActiveTrack(activeTrack - 1)
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not remove song.')
    }
  }

  function selectPlaylist(playlist: Playlist): void {
    setSelectedPlaylistId(playlist.id)
    setActiveTrack(0)
    setPlaying(false)
    setQuery('')
  }

  function formatDuration(seconds: number | null): string {
    if (seconds === null) return '—:—'
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><AudioLines size={19} /></span><span>good<span className="brand-light">songs</span></span></div>
        <div className="sidebar-section">
          <p className="eyebrow">YOUR SPACE</p>
          <button className="nav-item active"><Home size={17} /> Home</button>
          <button className="nav-item"><Search size={17} /> Explore</button>
          <button className="nav-item"><Library size={17} /> Your library</button>
        </div>
        <div className="sidebar-section collection-section">
          <div className="section-heading"><p className="eyebrow">PLAYLISTS</p><button className="icon-button subtle" aria-label="Create playlist" onClick={() => void createPlaylist()}><Plus size={17} /></button></div>
          {playlists.map((playlist) => (
            <button key={playlist.id} onClick={() => selectPlaylist(playlist)} className={`playlist-nav ${selectedPlaylist?.id === playlist.id ? 'chosen' : ''}`}>
              <span className={`mini-cover ${playlist.gradient}`}>{playlist.icon}</span><span>{playlist.title}</span>
            </button>
          ))}
          {!loading && playlists.length === 0 && <p className="sidebar-empty">Create a playlist to get started.</p>}
        </div>
        <div className="sidebar-bottom"><div className="profile-avatar">J</div><div><strong>Jamie Parker</strong><span>Free account</span></div><MoreHorizontal size={18} className="profile-more" /></div>
      </aside>

      <section className="main-panel">
        <header className="topbar"><div className="breadcrumbs"><span>Home</span><span className="crumb-divider">/</span><strong>{selectedPlaylist?.title ?? 'Your playlists'}</strong></div><div className="topbar-actions"><button className="icon-button"><SlidersHorizontal size={17} /></button><div className="avatar-small">J</div></div></header>
        <div className="content-scroll">
          <section className="welcome-row"><div><p className="eyebrow welcome-label">YOUR MUSIC, YOUR WAY</p><h1>A little music<br />for the moment.</h1><p className="welcome-copy">Your playlists stay saved on this device.</p></div><div className="welcome-art" aria-hidden="true"><span className="sun-disc" /><span className="art-hill hill-back" /><span className="art-hill hill-front" /><span className="art-grain" /></div></section>

          <section className="playlist-section">
            <div className="section-title-row"><div><p className="eyebrow">A GOOD PLACE TO START</p><h2>Your playlists</h2></div><button className="text-button" onClick={() => void createPlaylist()}><Plus size={13} /> New playlist</button></div>
            <div className="playlist-grid">
              {playlists.map((playlist, index) => <button key={playlist.id} className={`playlist-card ${selectedPlaylist?.id === playlist.id ? 'selected-card' : ''}`} onClick={() => selectPlaylist(playlist)}>
                <span className={`playlist-art ${playlist.gradient}`}><span className="art-symbol">{playlist.icon}</span><span className="art-number">{String(index + 1).padStart(2, '0')}</span></span>
                <span className="card-copy"><strong>{playlist.title}</strong><span>{playlist.tracks.length} {playlist.tracks.length === 1 ? 'song' : 'songs'} · {playlist.description}</span></span>
              </button>)}
              {!loading && playlists.length === 0 && <p className="empty-state">Create a playlist to start collecting your music.</p>}
            </div>
          </section>

          <section className="tracks-section">
            <div className="section-title-row track-heading"><div><p className="eyebrow">SAVED ON THIS DEVICE</p><h2>{selectedPlaylist ? selectedPlaylist.title : 'Choose a playlist'}</h2></div><div className="playlist-actions">
              <label className="search-field"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a song" aria-label="Find a song" /></label>
              <button className="small-action" onClick={() => void addAudioFiles()} disabled={!selectedPlaylist}><Plus size={13} /> Add songs</button>
              <button className="small-action icon-action" onClick={() => void renamePlaylist()} disabled={!selectedPlaylist}>Rename</button>
              <button className="small-action icon-action danger-action" onClick={() => void deletePlaylist()} disabled={!selectedPlaylist}>Delete</button>
            </div></div>
            <div className="track-tabs">{['Made for you', 'Your rotation', 'New finds'].map((name) => <button key={name} onClick={() => setTab(name)} className={tab === name ? 'tab-active' : ''}>{name}</button>)}</div>
            <div className="track-table"><div className="track-row table-head"><span>#</span><span>TITLE</span><span>LOCATION</span><span>TIME</span><span /></div>
              {visibleTracks.map((track, index) => <div className={`track-row ${currentTrack?.id === track.id ? 'track-current' : ''}`} key={track.id}>
                <button className="track-index track-play" aria-label={`Play ${track.title}`} onClick={() => { setActiveTrack(selectedPlaylist?.tracks.findIndex((item) => item.id === track.id) ?? index); setPlaying(true) }}>{currentTrack?.id === track.id && playing ? <AudioLines size={15} /> : String(index + 1).padStart(2, '0')}</button>
                <span className="track-title-cell"><span className={`album-thumb ${coverColors[index % coverColors.length]}`}><Disc3 size={19} /></span><span className="track-meta"><strong>{track.title}</strong><span>{track.artist}</span></span></span>
                <span className="album-name">{track.album || 'Local audio file'}</span><span className="track-duration">{formatDuration(track.durationSeconds)}</span><button className="track-remove" aria-label={`Remove ${track.title} from playlist`} onClick={() => void removeTrack(track.id)}><X size={15} /></button>
              </div>)}
              {visibleTracks.length === 0 && <p className="empty-state">{query ? `No songs match “${query}”.` : selectedPlaylist ? 'This playlist is empty. Add songs from your music library to get started.' : 'Create a playlist to get started.'}</p>}
            </div>
          </section>
          <footer className="page-footer"><span>Playlist data is stored locally on this device.</span><span>GOODSONGS ®</span></footer>
        </div>
      </section>

      <footer className="player-bar"><div className="now-playing"><span className={`album-thumb player-thumb ${coverColors[activeTrack % coverColors.length]}`}><Disc3 size={20} /></span><span className="track-meta"><strong>{currentTrack?.title ?? 'Nothing playing yet'}</strong><span>{currentTrack?.artist ?? 'Choose a song in your playlist'}</span></span><button className={`icon-button like-button ${liked ? 'liked' : ''}`} onClick={() => setLiked(!liked)} aria-label={liked ? 'Unlike song' : 'Like song'}><Heart size={17} fill={liked ? 'currentColor' : 'none'} /></button></div>
        <div className="player-controls"><div className="control-buttons"><button className="icon-button control-muted" aria-label="Shuffle"><Shuffle size={16} /></button><button className="icon-button control-muted" aria-label="Previous"><SkipBack size={18} fill="currentColor" /></button><button className="play-button" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'} disabled={!currentTrack}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><button className="icon-button control-muted" aria-label="Next" onClick={() => { if (selectedPlaylist?.tracks.length) setActiveTrack((activeTrack + 1) % selectedPlaylist.tracks.length) }}><SkipForward size={18} fill="currentColor" /></button><button className="icon-button control-muted" aria-label="Queue"><ListMusic size={16} /></button></div><div className="progress-row"><span>0:00</span><div className="progress-track"><span /></div><span>{formatDuration(currentTrack?.durationSeconds ?? null)}</span></div></div>
        <div className="player-volume"><button className="icon-button control-muted" aria-label="Volume"><Volume2 size={18} /></button><div className="volume-track"><span /></div></div>
      </footer>
    </main>
  )
}

export default App
