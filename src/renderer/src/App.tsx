import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AudioLines,
  Disc3,
  GripVertical,
  Heart,
  Home,
  Library,
  ListMusic,
  ListPlus,
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
import type { Playlist, PlaylistTrack } from '../../shared/playlist'
import { NameDialog } from './NameDialog'
import { TrackArt } from './TrackArt'

const coverColors = ['plum', 'amber', 'sky', 'rose', 'mint']

// Returns track ids in random order, with `firstId` (if given) kept at the front.
function shuffledIds(tracks: PlaylistTrack[], firstId?: number): number[] {
  const ids = tracks.map((track) => track.id).filter((id) => id !== firstId)
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
  }
  return firstId === undefined ? ids : [firstId, ...ids]
}

function App() {
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [playing, setPlaying] = useState(false)
  const [activeTrack, setActiveTrack] = useState(0)
  const [liked, setLiked] = useState(false)
  const [tab, setTab] = useState('Made for you')
  const [loading, setLoading] = useState(true)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const progressTrackRef = useRef<HTMLDivElement>(null)
  const [nameDialog, setNameDialog] = useState<'create' | 'rename' | null>(null)
  // Track ids in play order while shuffle is on; null when it's off.
  const [shuffleOrder, setShuffleOrder] = useState<number[] | null>(null)
  const [queueOpen, setQueueOpen] = useState(false)
  // Track ids the user queued; they play before the rest of the playlist.
  const [queue, setQueue] = useState<number[]>([])
  // While a queued song plays, the playlist track to carry on from afterwards.
  const [resumeFrom, setResumeFrom] = useState<number | null>(null)
  const queuePanelRef = useRef<HTMLElement>(null)
  // The song being dragged to a new place, and the gap (0 = before the first song) it would drop into.
  const [draggedTrackId, setDraggedTrackId] = useState<number | null>(null)
  const [dropSlot, setDropSlot] = useState<number | null>(null)
  // Announces reorders to screen readers.
  const [moveStatus, setMoveStatus] = useState('')
  const queueButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    void window.desktop.playlists
      .list()
      .then((items) => {
        setPlaylists(items)
        setSelectedPlaylistId(items[0]?.id ?? null)
      })
      .catch((error: unknown) => {
        window.alert(error instanceof Error ? error.message : 'Could not load playlists.')
      })
      .finally(() => setLoading(false))
  }, [])

  const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId)
  const visibleTracks = useMemo(
    () =>
      (selectedPlaylist?.tracks ?? []).filter((track) =>
        `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [query, selectedPlaylist],
  )
  const currentTrack = selectedPlaylist?.tracks[activeTrack]
  const trackCount = selectedPlaylist?.tracks.length ?? 0
  // A drop position in a filtered list would be ambiguous, so reordering waits until the search is cleared.
  const canReorder = !query && trackCount > 1

  // Close the queue on Escape or a click outside it (the queue button toggles it itself).
  useEffect(() => {
    if (!queueOpen) return
    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setQueueOpen(false)
    }
    function handlePointer(event: PointerEvent): void {
      const target = event.target as Node
      if (!queuePanelRef.current?.contains(target) && !queueButtonRef.current?.contains(target)) setQueueOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    window.addEventListener('pointerdown', handlePointer)
    return () => {
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('pointerdown', handlePointer)
    }
  }, [queueOpen])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    setPosition(0)
    setDuration(null)
    if (currentTrack) {
      audio.src = `playlist-audio://track/${currentTrack.id}`
    } else {
      audio.removeAttribute('src')
      audio.load()
    }
  }, [currentTrack?.id])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !currentTrack) return
    if (playing) {
      // AbortError just means the source changed mid-load; the next play() call takes over.
      audio.play().catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setPlaying(false)
      })
    } else {
      audio.pause()
    }
  }, [playing, currentTrack?.id])

  // Track indices in the order they play: playlist order, or the shuffle order while shuffle is on.
  function playOrder(): number[] {
    const tracks = selectedPlaylist?.tracks ?? []
    if (!shuffleOrder) return tracks.map((_, index) => index)
    // Drop removed songs and put songs added since shuffling at the end.
    const ids = shuffleOrder.filter((id) => tracks.some((track) => track.id === id))
    const order = [...ids, ...tracks.filter((track) => !ids.includes(track.id)).map((track) => track.id)]
    return order.map((id) => tracks.findIndex((track) => track.id === id))
  }

  // Index of the track `step` places away from the current one in play order, or null past either end.
  function trackIndexAfter(step: 1 | -1, wrap: boolean): number | null {
    const order = playOrder()
    if (!order.length) return null
    let next = order.indexOf(resumeFrom ?? activeTrack) + step
    if (next < 0 || next >= order.length) {
      if (!wrap) return null
      next = (next + order.length) % order.length
    }
    return order[next]
  }

  function toggleShuffle(): void {
    const tracks = selectedPlaylist?.tracks ?? []
    setShuffleOrder(shuffleOrder ? null : shuffledIds(tracks, tracks[resumeFrom ?? activeTrack]?.id))
  }

  // Switching to the track that's already loaded doesn't reload the audio, so restart it instead.
  function playTrackAt(index: number): void {
    const audio = audioRef.current
    if (index !== activeTrack || !audio) return setActiveTrack(index)
    audio.currentTime = 0
    if (playing) void audio.play().catch(() => setPlaying(false))
  }

  // Moves to the next queued song, or else the next song in the playlist. Returns false if there's nothing left.
  function advance(wrap: boolean): boolean {
    const tracks = selectedPlaylist?.tracks ?? []
    const queuedIndex = queue.length ? tracks.findIndex((track) => track.id === queue[0]) : -1
    if (queuedIndex >= 0) {
      setQueue(queue.slice(1))
      if (resumeFrom === null) setResumeFrom(activeTrack)
      playTrackAt(queuedIndex)
      return true
    }
    const next = trackIndexAfter(1, wrap)
    if (next === null) return false
    setResumeFrom(null)
    playTrackAt(next)
    return true
  }

  function playNext(): void {
    advance(true)
  }

  function playPrevious(): void {
    const audio = audioRef.current
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0
    } else if (resumeFrom !== null) {
      // Leaving a queued song goes back to where the playlist was.
      setResumeFrom(null)
      playTrackAt(resumeFrom)
    } else {
      const previous = trackIndexAfter(-1, true)
      if (previous !== null) playTrackAt(previous)
    }
  }

  function addToQueue(trackId: number): void {
    setQueue([...queue, trackId])
  }

  // Plays a queued song now, dropping it and anything queued ahead of it.
  function playFromQueue(position: number): void {
    const index = selectedPlaylist?.tracks.findIndex((track) => track.id === queue[position]) ?? -1
    if (index < 0) return
    setQueue(queue.slice(position + 1))
    if (resumeFrom === null) setResumeFrom(activeTrack)
    playTrackAt(index)
    setPlaying(true)
  }

  // Plays a playlist song directly, which moves the playlist's place to it.
  function playTrackNow(index: number): void {
    setResumeFrom(null)
    playTrackAt(index)
    setPlaying(true)
  }

  // Plays a song picked from the (possibly filtered) song list. With shuffle on, it reshuffles starting from that song.
  function playFromList(track: PlaylistTrack, listIndex: number): void {
    playTrackNow(selectedPlaylist?.tracks.findIndex((item) => item.id === track.id) ?? listIndex)
    if (shuffleOrder) setShuffleOrder(shuffledIds(selectedPlaylist?.tracks ?? [], track.id))
  }

  function seekTo(seconds: number): void {
    const audio = audioRef.current
    if (!audio || !duration) return
    audio.currentTime = Math.min(duration, Math.max(0, seconds))
    setPosition(audio.currentTime)
  }

  function seekToPointer(clientX: number): void {
    const bar = progressTrackRef.current
    if (!bar || !duration) return
    const { left, width } = bar.getBoundingClientRect()
    seekTo(((clientX - left) / width) * duration)
  }

  function handleSeekKey(event: React.KeyboardEvent): void {
    const target = { ArrowLeft: position - 5, ArrowRight: position + 5, Home: 0, End: duration ?? 0 }[event.key]
    if (target === undefined) return
    event.preventDefault()
    seekTo(target)
  }

  function handleTrackEnded(): void {
    if (!advance(false)) setPlaying(false)
  }

  function handlePlaybackError(): void {
    if (!currentTrack) return
    setPlaying(false)
    window.alert(
      `Couldn't play “${currentTrack.title}”. The file may have been moved, deleted, or be in an unsupported format.`,
    )
  }

  async function createPlaylist(title: string): Promise<void> {
    const updated = await window.desktop.playlists.create({ title })
    setPlaylists(updated)
    setSelectedPlaylistId(updated[updated.length - 1]?.id ?? null)
    setActiveTrack(0)
    setNameDialog(null)
  }

  async function renamePlaylist(title: string): Promise<void> {
    if (selectedPlaylist && title !== selectedPlaylist.title) {
      setPlaylists(await window.desktop.playlists.rename(selectedPlaylist.id, title))
    }
    setNameDialog(null)
  }

  async function deletePlaylist(): Promise<void> {
    if (!selectedPlaylist || !window.confirm(`Delete “${selectedPlaylist.title}” and its saved songs?`)) return
    try {
      const updated = await window.desktop.playlists.remove(selectedPlaylist.id)
      setPlaylists(updated)
      setSelectedPlaylistId(updated[0]?.id ?? null)
      setActiveTrack(0)
      setQueue([])
      setResumeFrom(null)
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
      setQueue(queue.filter((id) => id !== trackId))
      if (resumeFrom !== null) {
        if (removedIndex === resumeFrom) setResumeFrom(null)
        else if (removedIndex >= 0 && removedIndex < resumeFrom) setResumeFrom(resumeFrom - 1)
      }
      if (currentTrack?.id === trackId) {
        setActiveTrack(0)
        setResumeFrom(null)
        setPlaying(false)
      } else if (removedIndex >= 0 && removedIndex < activeTrack) {
        setActiveTrack(activeTrack - 1)
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not remove song.')
    }
  }

  // Moves a song to `toIndex` and saves the new order. Playback stays on the same songs, wherever they end up.
  async function moveTrack(trackId: number, toIndex: number): Promise<void> {
    if (!selectedPlaylist) return
    const { tracks } = selectedPlaylist
    const track = tracks.find((item) => item.id === trackId)
    if (!track || tracks.indexOf(track) === toIndex) return
    const resumeId = resumeFrom === null ? undefined : tracks[resumeFrom]?.id
    try {
      const updated = await window.desktop.playlists.moveTrack(selectedPlaylist.id, trackId, toIndex)
      const reordered = updated.find((playlist) => playlist.id === selectedPlaylist.id)?.tracks ?? []
      const indexOf = (id: number | undefined): number => reordered.findIndex((item) => item.id === id)
      setPlaylists(updated)
      if (currentTrack) setActiveTrack(Math.max(0, indexOf(currentTrack.id)))
      if (resumeId !== undefined) setResumeFrom(indexOf(resumeId) >= 0 ? indexOf(resumeId) : null)
      setMoveStatus(`Moved ${track.title} to position ${indexOf(trackId) + 1} of ${reordered.length}.`)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not move song.')
    }
  }

  // The gap a song would drop into when dragged over the row at `index`: above it in its top half, else below it.
  function dropSlotAt(event: React.DragEvent, index: number): number {
    const { top, height } = event.currentTarget.getBoundingClientRect()
    return event.clientY < top + height / 2 ? index : index + 1
  }

  function dropDraggedTrack(slot: number): void {
    const from = selectedPlaylist?.tracks.findIndex((track) => track.id === draggedTrackId) ?? -1
    if (draggedTrackId !== null && from >= 0) void moveTrack(draggedTrackId, slot > from ? slot - 1 : slot)
    endDrag()
  }

  function endDrag(): void {
    setDraggedTrackId(null)
    setDropSlot(null)
  }

  function handleMoveKey(event: React.KeyboardEvent, trackId: number, index: number): void {
    const step = ({ ArrowUp: -1, ArrowDown: 1 } as Record<string, number | undefined>)[event.key]
    if (step === undefined) return
    event.preventDefault()
    const to = index + step
    if (to >= 0 && to < trackCount) void moveTrack(trackId, to)
  }

  // Shows the drop line only where dropping would actually move the song.
  function dropLineClass(index: number): string {
    if (dropSlot === null || draggedTrackId === null) return ''
    const from = selectedPlaylist?.tracks.findIndex((track) => track.id === draggedTrackId) ?? -1
    if (dropSlot === from || dropSlot === from + 1) return ''
    if (dropSlot === index) return 'drop-before'
    return dropSlot === index + 1 && index === trackCount - 1 ? 'drop-after' : ''
  }

  function selectPlaylist(playlist: Playlist): void {
    setSelectedPlaylistId(playlist.id)
    setActiveTrack(0)
    setQueue([])
    setResumeFrom(null)
    if (shuffleOrder) setShuffleOrder(shuffledIds(playlist.tracks, playlist.tracks[0]?.id))
    setPlaying(false)
    setQuery('')
  }

  function formatDuration(seconds: number | null): string {
    if (seconds === null) return '—:—'
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  }

  const upNext = (() => {
    const order = playOrder()
    return order.slice(order.indexOf(resumeFrom ?? activeTrack) + 1)
  })()

  // `position` is the song's place in the user queue, which can hold the same song more than once.
  function queueItem(index: number, kind: 'current' | 'queued' | 'playlist', position = 0): React.ReactNode {
    const track = selectedPlaylist?.tracks[index]
    if (!track) return null
    const meta = (
      <>
        <TrackArt trackId={track.id} color={coverColors[index % coverColors.length]} iconSize={17} />
        <span className="track-meta">
          <strong>{track.title}</strong>
          <span>{track.artist}</span>
        </span>
        <span className="track-duration">{formatDuration(track.durationSeconds)}</span>
      </>
    )
    if (kind === 'current')
      return (
        <div key="current" className="queue-item queue-current">
          {meta}
        </div>
      )
    if (kind === 'playlist')
      return (
        <button key={track.id} className="queue-item" title={`Play ${track.title}`} onClick={() => playTrackNow(index)}>
          {meta}
        </button>
      )
    return (
      <div key={`queued-${position}`} className="queue-row">
        <button className="queue-item" title={`Play ${track.title}`} onClick={() => playFromQueue(position)}>
          {meta}
        </button>
        <button
          className="icon-button control-muted"
          aria-label={`Remove ${track.title} from queue`}
          title="Remove from queue"
          onClick={() => setQueue(queue.filter((_, i) => i !== position))}
        >
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <AudioLines size={19} />
          </span>
          <span>
            good<span className="brand-light">songs</span>
          </span>
        </div>
        <div className="sidebar-section">
          <p className="eyebrow">YOUR SPACE</p>
          <button className="nav-item active">
            <Home size={17} /> Home
          </button>
          <button className="nav-item">
            <Search size={17} /> Explore
          </button>
          <button className="nav-item">
            <Library size={17} /> Your library
          </button>
        </div>
        <div className="sidebar-section collection-section">
          <div className="section-heading">
            <p className="eyebrow">PLAYLISTS</p>
            <button
              className="icon-button subtle"
              aria-label="Create playlist"
              title="Create a new playlist"
              onClick={() => setNameDialog('create')}
            >
              <Plus size={17} />
            </button>
          </div>
          {playlists.map((playlist) => (
            <button
              key={playlist.id}
              onClick={() => selectPlaylist(playlist)}
              className={`playlist-nav ${selectedPlaylist?.id === playlist.id ? 'chosen' : ''}`}
            >
              <span className={`mini-cover ${playlist.gradient}`}>{playlist.icon}</span>
              <span>{playlist.title}</span>
            </button>
          ))}
          {!loading && playlists.length === 0 && <p className="sidebar-empty">Create a playlist to get started.</p>}
        </div>
        <div className="sidebar-bottom">
          <div className="profile-avatar">J</div>
          <div>
            <strong>Jamie Parker</strong>
            <span>Free account</span>
          </div>
          <MoreHorizontal size={18} className="profile-more" />
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Home</span>
            <span className="crumb-divider">/</span>
            <strong>{selectedPlaylist?.title ?? 'Your playlists'}</strong>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" aria-label="Settings" title="Settings">
              <SlidersHorizontal size={17} />
            </button>
            <div className="avatar-small">J</div>
          </div>
        </header>
        <div className="content-scroll">
          <section className="welcome-row">
            <div>
              <p className="eyebrow welcome-label">YOUR MUSIC, YOUR WAY</p>
              <h1>
                A little music
                <br />
                for the moment.
              </h1>
              <p className="welcome-copy">Your playlists stay saved on this device.</p>
            </div>
            <div className="welcome-art" aria-hidden="true">
              <span className="sun-disc" />
              <span className="art-hill hill-back" />
              <span className="art-hill hill-front" />
              <span className="art-grain" />
            </div>
          </section>

          <section className="playlist-section">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">A GOOD PLACE TO START</p>
                <h2>Your playlists</h2>
              </div>
              <button className="text-button" title="Create a new playlist" onClick={() => setNameDialog('create')}>
                <Plus size={13} /> New playlist
              </button>
            </div>
            <div className="playlist-grid">
              {playlists.map((playlist, index) => (
                <button
                  key={playlist.id}
                  className={`playlist-card ${selectedPlaylist?.id === playlist.id ? 'selected-card' : ''}`}
                  onClick={() => selectPlaylist(playlist)}
                >
                  <span className={`playlist-art ${playlist.gradient}`}>
                    <span className="art-symbol">{playlist.icon}</span>
                    <span className="art-number">{String(index + 1).padStart(2, '0')}</span>
                  </span>
                  <span className="card-copy">
                    <strong>{playlist.title}</strong>
                    <span>
                      {playlist.tracks.length} {playlist.tracks.length === 1 ? 'song' : 'songs'} ·{' '}
                      {playlist.description}
                    </span>
                  </span>
                </button>
              ))}
              {!loading && playlists.length === 0 && (
                <p className="empty-state">Create a playlist to start collecting your music.</p>
              )}
            </div>
          </section>

          <section className="tracks-section">
            <div className="section-title-row track-heading">
              <div>
                <p className="eyebrow">SAVED ON THIS DEVICE</p>
                <h2>{selectedPlaylist ? selectedPlaylist.title : 'Choose a playlist'}</h2>
              </div>
              <div className="playlist-actions">
                <label className="search-field">
                  <Search size={15} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Find a song"
                    aria-label="Find a song"
                  />
                </label>
                <button
                  className="small-action"
                  title="Add audio files from this computer to the playlist"
                  onClick={() => void addAudioFiles()}
                  disabled={!selectedPlaylist}
                >
                  <Plus size={13} /> Add songs
                </button>
                <button
                  className="small-action icon-action"
                  title="Rename this playlist"
                  onClick={() => setNameDialog('rename')}
                  disabled={!selectedPlaylist}
                >
                  Rename
                </button>
                <button
                  className="small-action icon-action danger-action"
                  title="Delete this playlist"
                  onClick={() => void deletePlaylist()}
                  disabled={!selectedPlaylist}
                >
                  Delete
                </button>
              </div>
            </div>
            <div className="track-tabs">
              {['Made for you', 'Your rotation', 'New finds'].map((name) => (
                <button key={name} onClick={() => setTab(name)} className={tab === name ? 'tab-active' : ''}>
                  {name}
                </button>
              ))}
            </div>
            <div className="track-table">
              <div className="track-row table-head">
                <span>#</span>
                <span>TITLE</span>
                <span>LOCATION</span>
                <span>TIME</span>
                <span />
              </div>
              {visibleTracks.map((track, index) => (
                <div
                  className={`track-row ${currentTrack?.id === track.id ? 'track-current' : ''} ${draggedTrackId === track.id ? 'track-dragging' : ''} ${dropLineClass(index)}`}
                  key={track.id}
                  draggable={canReorder}
                  onDragStart={(event) => {
                    if (!canReorder) return
                    setDraggedTrackId(track.id)
                    if (event.dataTransfer) {
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', track.title)
                    }
                  }}
                  onDragOver={(event) => {
                    if (draggedTrackId === null) return
                    event.preventDefault()
                    setDropSlot(dropSlotAt(event, index))
                  }}
                  onDrop={(event) => {
                    if (draggedTrackId === null) return
                    event.preventDefault()
                    dropDraggedTrack(dropSlotAt(event, index))
                  }}
                  onDragEnd={endDrag}
                >
                  <button
                    className="track-index track-play"
                    aria-label={`Play ${track.title}`}
                    title={`Play ${track.title}`}
                    onClick={() => playFromList(track, index)}
                  >
                    {currentTrack?.id === track.id && playing ? (
                      <AudioLines size={15} />
                    ) : (
                      String(index + 1).padStart(2, '0')
                    )}
                  </button>
                  <span className="track-title-cell">
                    <button
                      className="track-art-button"
                      tabIndex={-1}
                      aria-hidden="true"
                      title={currentTrack?.id === track.id && playing ? 'Pause' : `Play ${track.title}`}
                      onClick={() =>
                        currentTrack?.id === track.id ? setPlaying(!playing) : playFromList(track, index)
                      }
                    >
                      <TrackArt trackId={track.id} color={coverColors[index % coverColors.length]} iconSize={19} />
                      <span className="track-art-overlay">
                        {currentTrack?.id === track.id && playing ? (
                          <Pause size={15} fill="currentColor" />
                        ) : (
                          <Play size={15} fill="currentColor" />
                        )}
                      </span>
                    </button>
                    <span className="track-meta">
                      <strong>{track.title}</strong>
                      <span>{track.artist}</span>
                    </span>
                  </span>
                  <span className="album-name">{track.album || 'Local audio file'}</span>
                  <span className="track-duration">{formatDuration(track.durationSeconds)}</span>
                  <span className="track-actions">
                    <button
                      className="track-move"
                      aria-label={`Move ${track.title}`}
                      title={query ? 'Clear the search to reorder songs' : 'Drag to reorder, or use the ↑ and ↓ keys'}
                      disabled={!canReorder}
                      onKeyDown={(event) => handleMoveKey(event, track.id, index)}
                    >
                      <GripVertical size={15} />
                    </button>
                    <button
                      className="track-queue"
                      aria-label={`Add ${track.title} to queue`}
                      title="Add to queue"
                      onClick={() => addToQueue(track.id)}
                    >
                      <ListPlus size={15} />
                    </button>
                    <button
                      className="track-remove"
                      aria-label={`Remove ${track.title} from playlist`}
                      title="Remove from playlist"
                      onClick={() => void removeTrack(track.id)}
                    >
                      <X size={15} />
                    </button>
                  </span>
                </div>
              ))}
              <p className="visually-hidden" role="status">
                {moveStatus}
              </p>
              {visibleTracks.length === 0 && (
                <p className="empty-state">
                  {query
                    ? `No songs match “${query}”.`
                    : selectedPlaylist
                      ? 'This playlist is empty. Add songs from your music library to get started.'
                      : 'Create a playlist to get started.'}
                </p>
              )}
            </div>
          </section>
          <footer className="page-footer">
            <span>Playlist data is stored locally on this device.</span>
            <span>GOODSONGS ®</span>
          </footer>
        </div>
      </section>

      <footer className="player-bar">
        <div className="now-playing">
          {currentTrack ? (
            <TrackArt
              trackId={currentTrack.id}
              color={coverColors[activeTrack % coverColors.length]}
              iconSize={20}
              className="player-thumb"
            />
          ) : (
            <span className={`album-thumb player-thumb ${coverColors[activeTrack % coverColors.length]}`}>
              <Disc3 size={20} />
            </span>
          )}
          <span className="track-meta">
            <strong>{currentTrack?.title ?? 'Nothing playing yet'}</strong>
            <span>{currentTrack?.artist ?? 'Choose a song in your playlist'}</span>
          </span>
          <button
            className={`icon-button like-button ${liked ? 'liked' : ''}`}
            onClick={() => setLiked(!liked)}
            aria-label={liked ? 'Unlike song' : 'Like song'}
            title={liked ? 'Unlike song' : 'Like song'}
          >
            <Heart size={17} fill={liked ? 'currentColor' : 'none'} />
          </button>
        </div>
        <div className="player-controls">
          <div className="control-buttons">
            <button
              className={`icon-button control-muted ${shuffleOrder ? 'control-active' : ''}`}
              aria-label="Shuffle"
              title={shuffleOrder ? 'Turn shuffle off' : 'Turn shuffle on'}
              aria-pressed={shuffleOrder !== null}
              onClick={toggleShuffle}
              disabled={!trackCount}
            >
              <Shuffle size={16} />
            </button>
            <button
              className="icon-button control-muted"
              aria-label="Previous"
              title="Previous song (restarts the current song if more than 3 seconds in)"
              onClick={playPrevious}
              disabled={!currentTrack}
            >
              <SkipBack size={18} fill="currentColor" />
            </button>
            <button
              className="play-button"
              onClick={() => setPlaying(!playing)}
              aria-label={playing ? 'Pause' : 'Play'}
              title={playing ? 'Pause' : 'Play'}
              disabled={!currentTrack}
            >
              {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
            </button>
            <button
              className="icon-button control-muted"
              aria-label="Next"
              title="Next song"
              onClick={playNext}
              disabled={!currentTrack}
            >
              <SkipForward size={18} fill="currentColor" />
            </button>
            <button
              ref={queueButtonRef}
              className={`icon-button control-muted queue-button ${queueOpen ? 'control-active' : ''}`}
              aria-label={queue.length ? `Queue, ${queue.length} queued` : 'Queue'}
              title={queueOpen ? 'Hide queue' : 'Show queue'}
              aria-expanded={queueOpen}
              aria-controls="queue-panel"
              onClick={() => setQueueOpen(!queueOpen)}
            >
              <ListMusic size={16} />
              {queue.length > 0 && (
                <span className="queue-count" aria-hidden="true">
                  {queue.length}
                </span>
              )}
            </button>
          </div>
          <div className="progress-row">
            <span>{formatDuration(Math.floor(position))}</span>
            <div
              className="progress-hit"
              role="slider"
              tabIndex={duration ? 0 : -1}
              aria-label="Seek"
              aria-disabled={!duration}
              aria-valuemin={0}
              aria-valuemax={Math.floor(duration ?? 0)}
              aria-valuenow={Math.floor(position)}
              aria-valuetext={formatDuration(Math.floor(position))}
              onPointerDown={(event) => {
                if (!duration) return
                event.currentTarget.setPointerCapture(event.pointerId)
                seekToPointer(event.clientX)
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) seekToPointer(event.clientX)
              }}
              onKeyDown={handleSeekKey}
            >
              <div ref={progressTrackRef} className="progress-track">
                <span style={{ width: duration ? `${(position / duration) * 100}%` : '0%' }} />
              </div>
            </div>
            <span>
              {formatDuration(duration === null ? (currentTrack?.durationSeconds ?? null) : Math.floor(duration))}
            </span>
          </div>
        </div>
        <div className="player-volume">
          <button className="icon-button control-muted" aria-label="Volume" title="Volume">
            <Volume2 size={18} />
          </button>
          <div className="volume-track">
            <span />
          </div>
        </div>
        <audio
          ref={audioRef}
          onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) =>
            setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null)
          }
          onEnded={handleTrackEnded}
          onError={handlePlaybackError}
        />
      </footer>
      {queueOpen && (
        <section ref={queuePanelRef} id="queue-panel" className="queue-panel" aria-label="Queue">
          <div className="queue-header">
            <h2>Queue</h2>
            <button
              className="icon-button control-muted"
              aria-label="Close queue"
              title="Close queue"
              onClick={() => setQueueOpen(false)}
            >
              <X size={15} />
            </button>
          </div>
          <div className="queue-scroll">
            <p className="eyebrow">NOW PLAYING</p>
            {currentTrack ? queueItem(activeTrack, 'current') : <p className="queue-empty">Nothing playing yet.</p>}
            {queue.length > 0 && (
              <>
                <div className="queue-section-heading">
                  <p className="eyebrow">NEXT IN QUEUE</p>
                  <button className="queue-clear" onClick={() => setQueue([])}>
                    Clear
                  </button>
                </div>
                {queue.map((trackId, position) =>
                  queueItem(
                    selectedPlaylist?.tracks.findIndex((track) => track.id === trackId) ?? -1,
                    'queued',
                    position,
                  ),
                )}
              </>
            )}
            <p className="eyebrow">NEXT FROM PLAYLIST{shuffleOrder ? ' · SHUFFLED' : ''}</p>
            {upNext.length ? (
              upNext.map((index) => queueItem(index, 'playlist'))
            ) : (
              <p className="queue-empty">
                {!trackCount
                  ? 'Add songs to this playlist to fill the queue.'
                  : queue.length
                    ? 'Playback stops after the queued songs.'
                    : 'Playback stops after this song.'}
              </p>
            )}
          </div>
        </section>
      )}
      {nameDialog === 'create' && (
        <NameDialog
          heading="New playlist"
          submitLabel="Create"
          initialValue=""
          onSubmit={createPlaylist}
          onClose={() => setNameDialog(null)}
        />
      )}
      {nameDialog === 'rename' && selectedPlaylist && (
        <NameDialog
          heading="Rename playlist"
          submitLabel="Save"
          initialValue={selectedPlaylist.title}
          onSubmit={renamePlaylist}
          onClose={() => setNameDialog(null)}
        />
      )}
    </main>
  )
}

export default App
