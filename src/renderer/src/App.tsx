import { useMemo, useState } from 'react'
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
} from 'lucide-react'

type Track = { title: string; artist: string; album: string; duration: string; color: string }
type Playlist = { title: string; description: string; count: number; gradient: string; icon: string }

const playlists: Playlist[] = [
  { title: 'Late night drive', description: 'For the long way home.', count: 28, gradient: 'sunset', icon: '◒' },
  { title: 'Soft focus', description: 'A little room to think.', count: 34, gradient: 'sage', icon: '✳' },
  { title: 'Sunday, slowly', description: 'No plans, no rush.', count: 19, gradient: 'blue', icon: '☼' },
  { title: 'On repeat', description: 'The ones that stayed.', count: 42, gradient: 'rose', icon: '↗' },
]

const tracks: Track[] = [
  { title: 'Space Song', artist: 'Beach House', album: 'Depression Cherry', duration: '5:20', color: 'plum' },
  { title: 'My Love Mine All Mine', artist: 'Mitski', album: 'The Land Is Inhospitable and So Are We', duration: '2:17', color: 'amber' },
  { title: 'Sweet Disposition', artist: 'The Temper Trap', album: 'Conditions', duration: '3:54', color: 'sky' },
  { title: 'Fade Into You', artist: 'Mazzy Star', album: 'So Tonight That I Might See', duration: '4:55', color: 'rose' },
  { title: 'Nothing’s Gonna Hurt You Baby', artist: 'Cigarettes After Sex', album: 'I.', duration: '4:46', color: 'mint' },
]

function App() {
  const [selectedPlaylist, setSelectedPlaylist] = useState(playlists[0].title)
  const [query, setQuery] = useState('')
  const [playing, setPlaying] = useState(false)
  const [activeTrack, setActiveTrack] = useState(0)
  const [liked, setLiked] = useState(false)
  const [tab, setTab] = useState('Made for you')

  const visibleTracks = useMemo(() => tracks.filter((track) =>
    `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query.toLowerCase()),
  ), [query])

  const currentTrack = tracks[activeTrack]

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
          <div className="section-heading"><p className="eyebrow">PLAYLISTS</p><button className="icon-button subtle" aria-label="Create playlist"><Plus size={17} /></button></div>
          {playlists.map((playlist) => (
            <button key={playlist.title} onClick={() => setSelectedPlaylist(playlist.title)} className={`playlist-nav ${selectedPlaylist === playlist.title ? 'chosen' : ''}`}>
              <span className={`mini-cover ${playlist.gradient}`}>{playlist.icon}</span><span>{playlist.title}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom"><div className="profile-avatar">J</div><div><strong>Jamie Parker</strong><span>Free account</span></div><MoreHorizontal size={18} className="profile-more" /></div>
      </aside>

      <section className="main-panel">
        <header className="topbar"><div className="breadcrumbs"><span>Home</span><span className="crumb-divider">/</span><strong>{selectedPlaylist}</strong></div><div className="topbar-actions"><button className="icon-button"><SlidersHorizontal size={17} /></button><div className="avatar-small">J</div></div></header>
        <div className="content-scroll">
          <section className="welcome-row"><div><p className="eyebrow welcome-label">SUNDAY, OCTOBER 4</p><h1>A little music<br />for the moment.</h1><p className="welcome-copy">Your day, with a better soundtrack.</p></div><div className="welcome-art" aria-hidden="true"><span className="sun-disc" /><span className="art-hill hill-back" /><span className="art-hill hill-front" /><span className="art-grain" /></div></section>

          <section className="playlist-section">
            <div className="section-title-row"><div><p className="eyebrow">A GOOD PLACE TO START</p><h2>Made for your moods</h2></div><button className="text-button">See all <span>↗</span></button></div>
            <div className="playlist-grid">
              {playlists.map((playlist, index) => <button key={playlist.title} className={`playlist-card ${selectedPlaylist === playlist.title ? 'selected-card' : ''}`} onClick={() => setSelectedPlaylist(playlist.title)}>
                <span className={`playlist-art ${playlist.gradient}`}><span className="art-symbol">{playlist.icon}</span><span className="art-number">0{index + 1}</span></span>
                <span className="card-copy"><strong>{playlist.title}</strong><span>{playlist.description}</span></span>
              </button>)}
            </div>
          </section>

          <section className="tracks-section">
            <div className="section-title-row track-heading"><div><p className="eyebrow">PICK UP WHERE YOU LEFT OFF</p><h2>Recently played</h2></div><label className="search-field"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a song" aria-label="Find a song" /></label></div>
            <div className="track-tabs">{['Made for you', 'Your rotation', 'New finds'].map((name) => <button key={name} onClick={() => setTab(name)} className={tab === name ? 'tab-active' : ''}>{name}</button>)}</div>
            <div className="track-table"><div className="track-row table-head"><span>#</span><span>TITLE</span><span>ALBUM</span><span>TIME</span><span /></div>
              {visibleTracks.map((track) => {
                const index = tracks.indexOf(track)
                return <button className={`track-row ${activeTrack === index ? 'track-current' : ''}`} key={track.title} onClick={() => { setActiveTrack(index); setPlaying(true) }}>
                  <span className="track-index">{activeTrack === index && playing ? <AudioLines size={15} /> : String(index + 1).padStart(2, '0')}</span>
                  <span className="track-title-cell"><span className={`album-thumb ${track.color}`}><Disc3 size={19} /></span><span className="track-meta"><strong>{track.title}</strong><span>{track.artist}</span></span></span>
                  <span className="album-name">{track.album}</span><span className="track-duration">{track.duration}</span><span className="track-more"><MoreHorizontal size={17} /></span>
                </button>
              })}
              {visibleTracks.length === 0 && <p className="empty-state">No songs match “{query}”.</p>}
            </div>
          </section>
          <footer className="page-footer"><span>Made for listening, not scrolling.</span><span>GOODSONGS ®</span></footer>
        </div>
      </section>

      <footer className="player-bar"><div className="now-playing"><span className={`album-thumb player-thumb ${currentTrack.color}`}><Disc3 size={20} /></span><span className="track-meta"><strong>{currentTrack.title}</strong><span>{currentTrack.artist}</span></span><button className={`icon-button like-button ${liked ? 'liked' : ''}`} onClick={() => setLiked(!liked)} aria-label={liked ? 'Unlike song' : 'Like song'}><Heart size={17} fill={liked ? 'currentColor' : 'none'} /></button></div>
        <div className="player-controls"><div className="control-buttons"><button className="icon-button control-muted" aria-label="Shuffle"><Shuffle size={16} /></button><button className="icon-button control-muted" aria-label="Previous"><SkipBack size={18} fill="currentColor" /></button><button className="play-button" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><button className="icon-button control-muted" aria-label="Next" onClick={() => setActiveTrack((activeTrack + 1) % tracks.length)}><SkipForward size={18} fill="currentColor" /></button><button className="icon-button control-muted" aria-label="Queue"><ListMusic size={16} /></button></div><div className="progress-row"><span>1:24</span><div className="progress-track"><span /></div><span>{currentTrack.duration}</span></div></div>
        <div className="player-volume"><button className="icon-button control-muted" aria-label="Volume"><Volume2 size={18} /></button><div className="volume-track"><span /></div></div>
      </footer>
    </main>
  )
}

export default App
