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
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  SkipBack,
  SkipForward,
  Shuffle,
  SlidersHorizontal,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { MAX_TEMPO_CHANGE as MAX_TEMPO, type Playlist, type PlaylistTrack } from '../../shared/playlist'
import { ExploreView } from './ExploreView'
import { LibraryView, type LibrarySource } from './LibraryView'
import { NameDialog } from './NameDialog'
import { TrackArt } from './TrackArt'
import {
  coverColors,
  formatBpm,
  formatKey,
  formatPlayerBpm,
  formatDuration,
  libraryAlbums,
  libraryArtists,
  librarySongs,
  type LibrarySong,
} from './trackDisplay'

/** Where playback is playing from: the open playlist, every song (Explore), or an album or artist (Your library). */
type PlaySource = 'playlist' | 'explore' | LibrarySource

// The songs a non-playlist source plays through, in order, from the library's songs.
function librarySourceTracks(source: Exclude<PlaySource, 'playlist'>, songs: LibrarySong[]): LibrarySong[] {
  if (source === 'explore') return songs
  if (source.startsWith('album:')) return libraryAlbums(songs).find((album) => `album:${album.key}` === source)?.songs ?? []
  return libraryArtists(songs).find((artist) => `artist:${artist.name.toLocaleLowerCase()}` === source)?.songs ?? []
}

const sourceLabels: Record<string, string> = { playlist: 'PLAYLIST', explore: 'EXPLORE', album: 'ALBUM', artist: 'ARTIST' }

// The drop-line class for the item at `index` while something is dragged to gap `slot` (0 = before the first item)
// from `from`. No line shows where dropping wouldn't move anything.
function dropLine(slot: number | null, from: number, index: number, count: number): string {
  if (slot === null || from < 0 || slot === from || slot === from + 1) return ''
  if (slot === index) return 'drop-before'
  return slot === index + 1 && index === count - 1 ? 'drop-after' : ''
}

// Returns track ids in random order, with `firstId` (if given) kept at the front.
function shuffledIds(tracks: PlaylistTrack[], firstId?: number): number[] {
  const ids = tracks.map((track) => track.id).filter((id) => id !== firstId)
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
  }
  return firstId === undefined ? ids : [firstId, ...ids]
}

const VOLUME_KEY = 'volume'

// How long the tempo control waits for the user to stop adjusting before saving, so a drag isn't saved at every step.
const TEMPO_SAVE_DELAY_MS = 300

// A tempo change as shown to the user, e.g. "+2.5%", "−1.0%" or "0%".
function formatTempo(percent: number): string {
  if (percent === 0) return '0%'
  return `${percent > 0 ? '+' : '−'}${Math.abs(percent).toFixed(1)}%`
}

// The playlists with the given tempos (percent, by track id) in place of the saved ones.
function withTempos(playlists: Playlist[], tempos: ReadonlyMap<number, number>): Playlist[] {
  if (tempos.size === 0) return playlists
  return playlists.map((playlist) => ({
    ...playlist,
    tracks: playlist.tracks.map((track) => (tempos.has(track.id) ? { ...track, tempo: tempos.get(track.id)! } : track)),
  }))
}

// The volume from last time (0–1), or full volume if it was never set or can't be read.
function savedVolume(): number {
  try {
    const value = Number(localStorage.getItem(VOLUME_KEY) ?? 1)
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1
  } catch {
    return 1
  }
}

function App() {
  const [savedPlaylists, setPlaylists] = useState<Playlist[]>([])
  // Tempo changes (percent, by track id) not saved yet. They're shown straight away, even over background updates.
  const [unsavedTempos, setUnsavedTempos] = useState<ReadonlyMap<number, number>>(new Map())
  // Saves waiting for the user to stop adjusting a song's tempo, by track id.
  const tempoSaveTimers = useRef(new Map<number, { timer: ReturnType<typeof setTimeout>; save: () => void }>())
  const playlists = useMemo(() => withTempos(savedPlaylists, unsavedTempos), [savedPlaylists, unsavedTempos])
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
  const [volume, setVolume] = useState(savedVolume)
  const [muted, setMuted] = useState(false)
  const volumeTrackRef = useRef<HTMLDivElement>(null)
  const tempoTrackRef = useRef<HTMLDivElement>(null)
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
  // Announces song and playlist moves to screen readers.
  const [moveStatus, setMoveStatus] = useState('')
  // The same, for dragging playlists in the sidebar.
  const [draggedPlaylistId, setDraggedPlaylistId] = useState<number | null>(null)
  const [playlistDropSlot, setPlaylistDropSlot] = useState<number | null>(null)
  const queueButtonRef = useRef<HTMLButtonElement>(null)
  const [view, setView] = useState<'home' | 'explore' | 'library'>('home')
  const [source, setSource] = useState<PlaySource>('playlist')

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
  const songs = useMemo(() => librarySongs(playlists), [playlists])
  // The songs playback moves through, in playlist order (`activeTrack` and the queue panel index into these).
  const tracksFor = (from: PlaySource): PlaylistTrack[] =>
    from === 'playlist' ? (selectedPlaylist?.tracks ?? []) : librarySourceTracks(from, songs)
  const playingTracks = tracksFor(source)
  const currentTrack: PlaylistTrack | undefined = playingTracks[activeTrack]
  // The volume as heard (0–100): zero while muted.
  const audibleLevel = muted ? 0 : Math.round(volume * 100)
  const audible = audibleLevel > 0
  // How much faster (positive) or slower (negative) than normal the playing song plays, in percent.
  const tempo = currentTrack?.tempo ?? 0
  // The playing song's BPM, and its BPM at the current speed (e.g. "120.0 (123.0) BPM"), if it's known.
  const currentBpm = currentTrack?.bpm == null ? null : formatPlayerBpm(currentTrack.bpm, tempo)
  // The playing song's key, and the key the tempo moves it to (e.g. "Ebm (Em)"), if it's known.
  const currentKey = currentTrack?.key == null ? null : formatKey(currentTrack.key, tempo)
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
    audio.volume = volume
    audio.muted = muted
  }, [volume, muted])

  // Loading a new song resets the speed to the default, so both are set to the playing song's tempo.
  // Pitch moves with the speed, like a turntable: Chromium's pitch-keeping time-stretch makes music stutter.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.preservesPitch = false
    audio.defaultPlaybackRate = 1 + tempo / 100
    audio.playbackRate = 1 + tempo / 100
  }, [tempo, currentTrack?.id])

  useEffect(() => {
    try {
      localStorage.setItem(VOLUME_KEY, String(volume))
    } catch {
      // Not remembering the volume is fine.
    }
  }, [volume])

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
    const tracks = playingTracks
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
    const tracks = playingTracks
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
    const tracks = playingTracks
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

  // Queues the playing list's copy of the song (a playlist row can be queued while Explore is playing).
  function addToQueue(track: PlaylistTrack): void {
    const queued = playingTracks.find((item) => item.filePath === track.filePath)
    if (queued) setQueue([...queue, queued.id])
  }

  // Plays a queued song now, dropping it and anything queued ahead of it.
  function playFromQueue(position: number): void {
    const index = playingTracks.findIndex((track) => track.id === queue[position])
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

  // Plays a song picked from a (possibly filtered) song list: the open playlist's, Explore's, or an album's or artist's.
  // Switching between them clears the queue. With shuffle on, it reshuffles starting from that song.
  function playFrom(from: PlaySource, track: PlaylistTrack): void {
    const tracks = tracksFor(from)
    const index = tracks.findIndex((item) => item.id === track.id)
    if (from === source) {
      playTrackNow(index)
    } else {
      setSource(from)
      setQueue([])
      setResumeFrom(null)
      setActiveTrack(index)
      setPlaying(true)
      // The same copy of the song is already loaded, so it won't reload; restart it instead.
      if (track.id === currentTrack?.id && audioRef.current) audioRef.current.currentTime = 0
    }
    if (shuffleOrder) setShuffleOrder(shuffledIds(tracks, track.id))
  }

  // Plays an album or artist from the start, or from a random song with shuffle on.
  function playLibrary(from: LibrarySource, song?: LibrarySong): void {
    const tracks = tracksFor(from)
    const first = song ?? tracks[shuffleOrder ? Math.floor(Math.random() * tracks.length) : 0]
    if (first) playFrom(from, first)
  }

  // Saves a changed playlist list. While playing from the library (Explore, an album or an artist), its songs re-sort,
  // so playback, the queue and the shuffle order follow their songs to their new places; if the playing song is gone,
  // playback stops.
  function applyPlaylists(updated: Playlist[]): void {
    setPlaylists(updated)
    if (source === 'playlist') return
    const next = librarySourceTracks(source, librarySongs(updated))
    const indexOf = (index: number): number =>
      next.findIndex((song) => song.filePath === playingTracks[index]?.filePath)
    const sameSong = (id: number): number[] => {
      const filePath = playingTracks.find((song) => song.id === id)?.filePath
      return next.filter((song) => song.filePath === filePath).map((song) => song.id)
    }
    const playingIndex = indexOf(activeTrack)
    setActiveTrack(Math.max(0, playingIndex))
    if (playingIndex < 0) setPlaying(false)
    if (resumeFrom !== null) setResumeFrom(playingIndex >= 0 && indexOf(resumeFrom) >= 0 ? indexOf(resumeFrom) : null)
    setQueue(queue.flatMap(sameSong))
    if (shuffleOrder) setShuffleOrder(shuffleOrder.flatMap(sameSong))
  }

  // Tempo changes still waiting to be saved are saved straight away if the window closes.
  useEffect(() => {
    const timers = tempoSaveTimers.current
    function saveNow(): void {
      for (const { timer, save } of [...timers.values()]) {
        clearTimeout(timer)
        save()
      }
    }
    window.addEventListener('pagehide', saveNow)
    return () => {
      window.removeEventListener('pagehide', saveNow)
      saveNow()
    }
  }, [])

  // Background changes from the main process (a song's BPM or key was found) are applied like any other change.
  const applyPlaylistsRef = useRef(applyPlaylists)
  applyPlaylistsRef.current = applyPlaylists
  useEffect(() => window.desktop.playlists.onChanged((updated) => applyPlaylistsRef.current(updated)), [])

  async function addToPlaylist(song: LibrarySong, playlistId: number): Promise<boolean> {
    try {
      applyPlaylists(await window.desktop.playlists.addTrack(playlistId, song.id))
      return true
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not add the song to the playlist.')
      return false
    }
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

  // Changing the volume also unmutes, like most players.
  function changeVolume(level: number): void {
    setVolume(Math.round(Math.min(1, Math.max(0, level)) * 100) / 100)
    setMuted(false)
  }

  function volumeToPointer(clientX: number): void {
    const bar = volumeTrackRef.current
    if (!bar) return
    const { left, width } = bar.getBoundingClientRect()
    changeVolume((clientX - left) / width)
  }

  function handleVolumeKey(event: React.KeyboardEvent): void {
    const level = muted ? 0 : volume
    const target = {
      ArrowLeft: level - 0.05,
      ArrowDown: level - 0.05,
      ArrowRight: level + 0.05,
      ArrowUp: level + 0.05,
      Home: 0,
      End: 1,
    }[event.key]
    if (target === undefined) return
    event.preventDefault()
    changeVolume(target)
  }

  function toggleMute(): void {
    // Unmuting at zero volume would still be silent, so bring it back to half.
    if (muted || volume === 0) changeVolume(volume || 0.5)
    else setMuted(true)
  }

  // Changes the playing song's tempo straight away, and saves it once the user stops adjusting it.
  function changeTempo(percent: number): void {
    if (!currentTrack) return
    const trackId = currentTrack.id
    const value = Math.round(Math.min(MAX_TEMPO, Math.max(-MAX_TEMPO, percent)) * 10) / 10 || 0
    setUnsavedTempos((pending) => new Map(pending).set(trackId, value))
    clearTimeout(tempoSaveTimers.current.get(trackId)?.timer)
    const save = (): void => {
      tempoSaveTimers.current.delete(trackId)
      void window.desktop.playlists.setTrackTempo(trackId, value).then(
        (updated) => {
          applyPlaylistsRef.current(updated)
          forgetUnsavedTempo(trackId, value)
        },
        (error: unknown) => {
          forgetUnsavedTempo(trackId, value)
          window.alert(error instanceof Error ? error.message : 'Could not save the tempo.')
        },
      )
    }
    tempoSaveTimers.current.set(trackId, { timer: setTimeout(save, TEMPO_SAVE_DELAY_MS), save })
  }

  // Drops an unsaved tempo once it's saved (or failed), unless the user has changed it again since.
  function forgetUnsavedTempo(trackId: number, value: number): void {
    setUnsavedTempos((pending) => {
      if (pending.get(trackId) !== value || tempoSaveTimers.current.has(trackId)) return pending
      const next = new Map(pending)
      next.delete(trackId)
      return next
    })
  }

  function tempoToPointer(clientX: number): void {
    const bar = tempoTrackRef.current
    if (!bar) return
    const { left, width } = bar.getBoundingClientRect()
    changeTempo(((clientX - left) / width) * 2 * MAX_TEMPO - MAX_TEMPO)
  }

  // Arrow keys fine-tune by 0.1%, Page Up/Down move 1%, and Home/End go to the slowest and fastest.
  function handleTempoKey(event: React.KeyboardEvent): void {
    const target = {
      ArrowLeft: tempo - 0.1,
      ArrowDown: tempo - 0.1,
      ArrowRight: tempo + 0.1,
      ArrowUp: tempo + 0.1,
      PageDown: tempo - 1,
      PageUp: tempo + 1,
      Home: -MAX_TEMPO,
      End: MAX_TEMPO,
    }[event.key]
    if (target === undefined) return
    event.preventDefault()
    changeTempo(target)
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
    if (source === 'playlist') setActiveTrack(0)
    setView('home')
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
      setSelectedPlaylistId(updated[0]?.id ?? null)
      // Playback from Explore carries on unless its song was only in the deleted playlist.
      if (source !== 'playlist') return applyPlaylists(updated)
      setPlaylists(updated)
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
      applyPlaylists(await window.desktop.playlists.addAudioFiles(selectedPlaylist.id))
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not add audio files.')
    }
  }

  async function removeTrack(trackId: number): Promise<void> {
    if (!selectedPlaylist) return
    try {
      const removedIndex = selectedPlaylist.tracks.findIndex((track) => track.id === trackId)
      const updated = await window.desktop.playlists.removeTrack(selectedPlaylist.id, trackId)
      if (source !== 'playlist') return applyPlaylists(updated)
      setPlaylists(updated)
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
    const resumeId = resumeFrom === null ? undefined : playingTracks[resumeFrom]?.id
    try {
      const updated = await window.desktop.playlists.moveTrack(selectedPlaylist.id, trackId, toIndex)
      const reordered = updated.find((playlist) => playlist.id === selectedPlaylist.id)?.tracks ?? []
      const indexOf = (id: number | undefined): number => reordered.findIndex((item) => item.id === id)
      if (source !== 'playlist') {
        applyPlaylists(updated)
      } else {
        setPlaylists(updated)
        if (currentTrack) setActiveTrack(Math.max(0, indexOf(currentTrack.id)))
        if (resumeId !== undefined) setResumeFrom(indexOf(resumeId) >= 0 ? indexOf(resumeId) : null)
      }
      setMoveStatus(`Moved ${track.title} to position ${indexOf(trackId) + 1} of ${reordered.length}.`)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not move song.')
    }
  }

  // The gap a song or playlist would drop into when dragged over the item at `index`: above it in its top half, else
  // below it.
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

  function dropLineClass(index: number): string {
    if (draggedTrackId === null) return ''
    const from = selectedPlaylist?.tracks.findIndex((track) => track.id === draggedTrackId) ?? -1
    return dropLine(dropSlot, from, index, trackCount)
  }

  // Moves a playlist to `toIndex` in the sidebar and saves the new order. Nothing else changes.
  async function movePlaylist(playlistId: number, toIndex: number): Promise<void> {
    const playlist = playlists.find((item) => item.id === playlistId)
    if (!playlist || playlists.indexOf(playlist) === toIndex) return
    try {
      const updated = await window.desktop.playlists.move(playlistId, toIndex)
      applyPlaylists(updated)
      const position = updated.findIndex((item) => item.id === playlistId) + 1
      setMoveStatus(`Moved ${playlist.title} to position ${position} of ${updated.length}.`)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not move playlist.')
    }
  }

  function dropDraggedPlaylist(slot: number): void {
    const from = playlists.findIndex((playlist) => playlist.id === draggedPlaylistId)
    if (draggedPlaylistId !== null && from >= 0) void movePlaylist(draggedPlaylistId, slot > from ? slot - 1 : slot)
    endPlaylistDrag()
  }

  function endPlaylistDrag(): void {
    setDraggedPlaylistId(null)
    setPlaylistDropSlot(null)
  }

  // Alt+↑/↓ moves the focused playlist one place, since plain arrow keys shouldn't rearrange navigation.
  function handlePlaylistMoveKey(event: React.KeyboardEvent, playlistId: number, index: number): void {
    const step = ({ ArrowUp: -1, ArrowDown: 1 } as Record<string, number | undefined>)[event.key]
    if (step === undefined || !event.altKey) return
    event.preventDefault()
    const to = index + step
    if (to >= 0 && to < playlists.length) void movePlaylist(playlistId, to)
  }

  function selectPlaylist(playlist: Playlist): void {
    setSelectedPlaylistId(playlist.id)
    setSource('playlist')
    setView('home')
    setActiveTrack(0)
    setQueue([])
    setResumeFrom(null)
    if (shuffleOrder) setShuffleOrder(shuffledIds(playlist.tracks, playlist.tracks[0]?.id))
    setPlaying(false)
    setQuery('')
  }

  const upNext = (() => {
    const order = playOrder()
    return order.slice(order.indexOf(resumeFrom ?? activeTrack) + 1)
  })()

  // `position` is the song's place in the user queue, which can hold the same song more than once.
  function queueItem(index: number, kind: 'current' | 'queued' | 'playlist', position = 0): React.ReactNode {
    const track = playingTracks[index]
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
            Play<span className="brand-light">lists</span>
          </span>
        </div>
        <div className="sidebar-section">
          <p className="eyebrow">YOUR SPACE</p>
          <button
            className={`nav-item ${view === 'home' ? 'active' : ''}`}
            aria-current={view === 'home' ? 'page' : undefined}
            onClick={() => setView('home')}
          >
            <Home size={17} /> Home
          </button>
          <button
            className={`nav-item ${view === 'explore' ? 'active' : ''}`}
            aria-current={view === 'explore' ? 'page' : undefined}
            onClick={() => setView('explore')}
          >
            <Search size={17} /> Explore
          </button>
          <button
            className={`nav-item ${view === 'library' ? 'active' : ''}`}
            aria-current={view === 'library' ? 'page' : undefined}
            onClick={() => setView('library')}
          >
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
          <ul className="playlist-nav-list" aria-label="Playlists">
            {playlists.map((playlist, index) => (
              <li key={playlist.id}>
                <button
                  onClick={() => selectPlaylist(playlist)}
                  className={`playlist-nav ${view === 'home' && selectedPlaylist?.id === playlist.id ? 'chosen' : ''} ${draggedPlaylistId === playlist.id ? 'playlist-dragging' : ''} ${draggedPlaylistId === null ? '' : dropLine(playlistDropSlot, playlists.findIndex((item) => item.id === draggedPlaylistId), index, playlists.length)}`}
                  title={playlists.length > 1 ? 'Drag, or press Alt+↑/↓, to reorder' : undefined}
                  aria-keyshortcuts={playlists.length > 1 ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
                  draggable={playlists.length > 1}
                  onKeyDown={(event) => handlePlaylistMoveKey(event, playlist.id, index)}
                  onDragStart={(event) => {
                    setDraggedPlaylistId(playlist.id)
                    if (event.dataTransfer) {
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', playlist.title)
                    }
                  }}
                  onDragOver={(event) => {
                    if (draggedPlaylistId === null) return
                    event.preventDefault()
                    setPlaylistDropSlot(dropSlotAt(event, index))
                  }}
                  onDrop={(event) => {
                    if (draggedPlaylistId === null) return
                    event.preventDefault()
                    dropDraggedPlaylist(dropSlotAt(event, index))
                  }}
                  onDragEnd={endPlaylistDrag}
                >
                  <span className={`mini-cover ${playlist.gradient}`} aria-hidden="true">
                    {playlist.icon}
                  </span>
                  <span>{playlist.title}</span>
                </button>
              </li>
            ))}
          </ul>

          {!loading && playlists.length === 0 && <p className="sidebar-empty">Create a playlist to get started.</p>}
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>{{ home: 'Home', explore: 'Explore', library: 'Your library' }[view]}</span>
            <span className="crumb-divider">/</span>
            <strong>
              {{ home: selectedPlaylist?.title ?? 'Your playlists', explore: 'All songs', library: 'Albums & artists' }[view]}
            </strong>
          </div>
          <div className="topbar-actions">
            {/* Hidden until there's a settings screen for it to open. */}
            <button className="icon-button" aria-label="Settings" title="Settings" hidden>
              <SlidersHorizontal size={17} />
            </button>
          </div>
        </header>
        <div className="content-scroll">
          {view === 'library' ? (
            <LibraryView
              songs={songs}
              playlists={playlists}
              currentFilePath={currentTrack?.filePath}
              playing={playing}
              onPlay={playLibrary}
              onTogglePlaying={() => setPlaying(!playing)}
              onAddToPlaylist={addToPlaylist}
            />
          ) : view === 'explore' ? (
            <ExploreView
              songs={songs}
              playlists={playlists}
              currentFilePath={currentTrack?.filePath}
              playing={playing}
              onPlay={(song) => playFrom('explore', song)}
              onTogglePlaying={() => setPlaying(!playing)}
              onAddToPlaylist={addToPlaylist}
            />
          ) : (
            <>
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
                  <span>BPM</span>
                  <span>KEY</span>
                  <span>TIME</span>
                  <span />
                </div>
                {visibleTracks.map((track, index) => (
                  <div
                    className={`track-row ${currentTrack?.filePath === track.filePath ? 'track-current' : ''} ${draggedTrackId === track.id ? 'track-dragging' : ''} ${dropLineClass(index)}`}
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
                      onClick={() => playFrom('playlist', track)}
                    >
                      {currentTrack?.filePath === track.filePath && playing ? (
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
                        title={currentTrack?.filePath === track.filePath && playing ? 'Pause' : `Play ${track.title}`}
                        onClick={() =>
                          currentTrack?.filePath === track.filePath ? setPlaying(!playing) : playFrom('playlist', track)
                        }
                      >
                        <TrackArt trackId={track.id} color={coverColors[index % coverColors.length]} iconSize={19} />
                        <span className="track-art-overlay">
                          {currentTrack?.filePath === track.filePath && playing ? (
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
                    <span className="track-bpm">{formatBpm(track.bpm, track.tempo)}</span>
                    <span className="track-key">{formatKey(track.key, track.tempo)}</span>
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
                        onClick={() => addToQueue(track)}
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
            </>
          )}
          <footer className="page-footer">
            <span>Playlist data is stored locally on this device.</span>
            <span>PLAYLISTS</span>
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
              disabled={!playingTracks.length}
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
        <div className="player-side">
          <div className="player-tempo">
            <span className="tempo-readout" aria-hidden="true">
              {currentKey !== null && <span>{currentKey}</span>}
              {currentBpm !== null && <span>{currentBpm}</span>}
              <span className={tempo === 0 ? '' : 'tempo-changed'}>{formatTempo(tempo)}</span>
            </span>
            <button
              className="icon-button control-muted tempo-reset"
              aria-label="Reset tempo"
              title="Back to normal speed"
              disabled={tempo === 0}
              onClick={() => changeTempo(0)}
            >
              <RotateCcw size={12} />
            </button>
            <div
              className="tempo-hit"
              role="slider"
              tabIndex={0}
              aria-label="Tempo"
              aria-valuemin={-MAX_TEMPO}
              aria-valuemax={MAX_TEMPO}
              aria-valuenow={tempo}
              aria-disabled={currentTrack ? undefined : true}
              aria-valuetext={[
                formatTempo(tempo),
                currentBpm,
                currentKey === null ? null : `key ${currentKey}`,
              ]
                .filter((part) => part !== null)
                .join(', ')}
              title="Tempo for this song: drag, or use the arrow keys (Page Up/Down for 1%); double-click to reset"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                tempoToPointer(event.clientX)
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) tempoToPointer(event.clientX)
              }}
              onDoubleClick={() => changeTempo(0)}
              onKeyDown={handleTempoKey}
            >
              <div ref={tempoTrackRef} className="tempo-track">
                <span
                  style={{
                    left: `${50 + (Math.min(0, tempo) / MAX_TEMPO) * 50}%`,
                    width: `${(Math.abs(tempo) / MAX_TEMPO) * 50}%`,
                  }}
                />
              </div>
            </div>
          </div>
          <div className="player-volume">
            <button
              className="icon-button control-muted"
              aria-label={audible ? 'Mute' : 'Unmute'}
              title={audible ? 'Mute' : 'Unmute'}
              onClick={toggleMute}
            >
              {!audible ? <VolumeX size={18} /> : volume < 0.5 ? <Volume1 size={18} /> : <Volume2 size={18} />}
            </button>
            <div
              className="volume-hit"
              role="slider"
              tabIndex={0}
              aria-label="Volume"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={audibleLevel}
              aria-valuetext={muted ? 'Muted' : `${audibleLevel}%`}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                volumeToPointer(event.clientX)
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) volumeToPointer(event.clientX)
              }}
              onKeyDown={handleVolumeKey}
            >
              <div ref={volumeTrackRef} className="volume-track">
                <span style={{ width: `${audibleLevel}%` }} />
              </div>
            </div>
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
      <p className="visually-hidden" role="status">
        {moveStatus}
      </p>
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
                  queueItem(playingTracks.findIndex((track) => track.id === trackId), 'queued', position),
                )}
              </>
            )}
            <p className="eyebrow">
              NEXT FROM {sourceLabels[source.split(':')[0]]}
              {shuffleOrder ? ' · SHUFFLED' : ''}
            </p>
            {upNext.length ? (
              upNext.map((index) => queueItem(index, 'playlist'))
            ) : (
              <p className="queue-empty">
                {!playingTracks.length
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
