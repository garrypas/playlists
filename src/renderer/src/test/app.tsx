import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect } from 'vitest'
import type { DjDetails } from '../../../shared/djDetails'
import App from '../App'
import { createFakeDesktop, type FakeDesktop, type SongSpec } from './fakeDesktop'

export interface AppHarness {
  desktop: FakeDesktop
  user: ReturnType<typeof userEvent.setup>
}

// Renders the app against an in-memory desktop API and waits for the first playlist to open.
export async function renderApp(playlists: { title: string; songs?: SongSpec[] }[]): Promise<AppHarness> {
  const desktop = createFakeDesktop(playlists)
  window.desktop = desktop.api
  const user = userEvent.setup()
  render(<App />)
  if (playlists.length) await screen.findByRole('heading', { level: 2, name: playlists[0].title })
  else await screen.findByText('Create a playlist to start collecting your music.')
  // Loading playlists resolves outside React's act(), so let effects (like loading the first song) finish.
  await act(async () => {})
  current = desktop
  return { desktop, user }
}

let current: FakeDesktop

// The deck playing the current song (the other deck only plays during a DJ-mode mix).
function audio(): HTMLAudioElement {
  return document.querySelector<HTMLAudioElement>('audio[data-deck="live"]')!
}

function songOn(deck: HTMLAudioElement): string | undefined {
  const id = /^playlist-audio:\/\/track\/(\d+)$/.exec(deck.src)?.[1]
  return id ? current.titleOf(Number(id)) : undefined
}

/**
 * Every song you can hear right now, by title: how loud (0–100), how fast (percent of normal speed) and whether its
 * bass is in (DJ mode cuts one song's bass while two play). Songs playing silently aren't heard.
 */
export function heard(): Record<string, { volume: number; speed: number; bass: boolean }> {
  const songs: Record<string, { volume: number; speed: number; bass: boolean }> = {}
  for (const deck of document.querySelectorAll('audio')) {
    const volume = deck.muted ? 0 : Math.round(deck.volume * 100)
    const song = songOn(deck)
    if (deck.paused || volume === 0 || !song) continue
    const bassDb = globalThis.testBassFilters.get(deck)?.gain.value ?? 0
    songs[song] = { volume, speed: Math.round(deck.playbackRate * 1000) / 10, bass: bassDb > -6 }
  }
  return songs
}

export function djModeButton(): HTMLElement {
  return screen.getByRole('button', { name: 'DJ mode' })
}

/** What DJ mode says it's doing, e.g. "DJ: 16-bar blend into Two at 3:44"; undefined while it's off. */
export function djStatus(): string | undefined {
  return announcements().find((text) => text.startsWith('DJ:'))
}

/**
 * What background analysis finds in a steady dance track: `bars` bars of kicks at `bpm` from `firstBeat`, with
 * phrases from `phraseStart` and any drops (seconds).
 */
export function djTrack(
  bpm: number,
  { bars, firstBeat = 0, phraseStart = firstBeat, drops = [] }: { bars: number; firstBeat?: number; phraseStart?: number; drops?: number[] },
): DjDetails {
  const beat = 60 / bpm
  const lastBeat = firstBeat + (bars * 4 - 1) * beat
  return {
    soundStart: firstBeat,
    soundEnd: lastBeat + beat,
    loudness: -9,
    grid: { bpm, firstBeat, lastBeat, phraseStart, confidence: 0.95 },
    sections: [{ kind: 'beat', start: firstBeat, end: lastBeat + beat }],
    drops,
    analysedSeconds: lastBeat + beat + 5,
  }
}

/**
 * What the speakers are playing: the loaded song's title, whether it's playing or paused, how loud it is
 * (0–100, zero while muted), how fast it's playing (percent of normal speed, e.g. 102.5), and whether a speed change
 * keeps the pitch (false: pitch moves with speed, like a turntable).
 */
export function player(): {
  song: string | undefined
  playing: boolean
  time: number
  volume: number
  speed: number
  keepsPitch: boolean
} {
  return {
    song: songOn(audio()),
    playing: !audio().paused,
    time: audio().currentTime,
    volume: audio().muted ? 0 : Math.round(audio().volume * 100),
    speed: Math.round(audio().playbackRate * 1000) / 10,
    keepsPitch: audio().preservesPitch,
  }
}

/** The main process finished detecting a song's tempo in the background (`bpm` undefined: no steady beat). */
export function tempoDetected(title: string, bpm: number | undefined): void {
  act(() => current.tempoDetected(title, bpm))
}

/** The main process finished finding a song's key in the background (`key` undefined: no key fits it). */
export function keyDetected(title: string, key: string | undefined): void {
  act(() => current.keyDetected(title, key))
}

/** The player's tempo slider. */
export function tempoSlider(): HTMLElement {
  return screen.getByRole('slider', { name: 'Tempo' })
}

/** Presses keys on the tempo slider, e.g. "End" for +10% or "PageUp" for +1%. */
export function pressOnTempo(...keys: string[]): void {
  for (const key of keys) fireEvent.keyDown(tempoSlider(), { key })
}

/** Renders the app as if it had been closed last time with the volume at `percent`. */
export function volumeLeftAt(percent: number): void {
  localStorage.setItem('volume', String(percent / 100))
}

export function expectPlaying(song: string): void {
  expect(player()).toMatchObject({ song, playing: true })
}

/** The browser finished loading the song and knows how long it is. */
export function songLoaded(durationSeconds: number): void {
  Object.defineProperty(audio(), 'duration', { configurable: true, value: durationSeconds })
  fireEvent.loadedMetadata(audio())
}

/** Playback has reached `seconds` into the song. A song mixing in on the other deck moves on by the same real time. */
export function playTo(seconds: number): void {
  const live = audio()
  const realSeconds = (seconds - live.currentTime) / live.playbackRate
  for (const deck of document.querySelectorAll('audio')) {
    if (deck !== live && !deck.paused && realSeconds > 0) deck.currentTime += realSeconds * deck.playbackRate
  }
  live.currentTime = seconds
  fireEvent.timeUpdate(live)
}

export function songEnds(): void {
  act(() => {
    fireEvent.ended(audio())
  })
}

export function songFailsToLoad(): void {
  fireEvent.error(audio())
}

// Song list rows: each song has a numbered play button labelled "Play <title>".
export function songButton(title: string): HTMLElement {
  return screen.getByRole('button', { name: `Play ${title}` })
}

/** The visible song list, in order. */
export function songList(): string[] {
  return screen
    .queryAllByRole('button', { name: /^Play (?!all$)/ })
    .map((button) => button.getAttribute('aria-label')!.slice(5))
}

/**
 * Drags a song's row and drops it on the top or bottom half of another song's row, then waits for the move to save.
 * jsdom has no layout, so each row is treated as 50px tall.
 */
export async function dragSong(title: string, onto: { above: string } | { below: string }): Promise<void> {
  const row = (song: string): HTMLElement => songButton(song).closest<HTMLElement>('[draggable]')!
  const target = row('above' in onto ? onto.above : onto.below)
  target.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 800, height: 50 })
  const clientY = 'above' in onto ? 10 : 40
  // Each event gets its own render, as in a real drag; then the move saves.
  fireEvent.dragStart(row(title))
  fireEvent.dragOver(target, { clientY })
  fireEvent.drop(target, { clientY })
  fireEvent.dragEnd(row(title))
  await act(async () => {})
}

/** The playlists in the sidebar, top to bottom. */
export function sidebarPlaylists(): string[] {
  return within(screen.getByRole('list', { name: 'Playlists' }))
    .queryAllByRole('button')
    .map((button) => {
      // Read it as a screen reader would, without the decorative icon.
      const copy = button.cloneNode(true) as HTMLElement
      copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove())
      return copy.textContent ?? ''
    })
}

export function sidebarPlaylist(title: string): HTMLElement {
  return within(screen.getByRole('list', { name: 'Playlists' })).getByRole('button', { name: title })
}

/** Drags a playlist in the sidebar onto the top or bottom half of another, then waits for the move to save. */
export async function dragPlaylist(title: string, onto: { above: string } | { below: string }): Promise<void> {
  const target = sidebarPlaylist('above' in onto ? onto.above : onto.below)
  target.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 200, height: 40 })
  const clientY = 'above' in onto ? 5 : 35
  fireEvent.dragStart(sidebarPlaylist(title))
  fireEvent.dragOver(target, { clientY })
  fireEvent.drop(target, { clientY })
  fireEvent.dragEnd(sidebarPlaylist(title))
  await act(async () => {})
}

/** The song's artwork, which doubles as a mouse-only play/pause button (hidden from screen readers). */
export function artworkButton(title: string): HTMLElement {
  return screen
    .getAllByRole('button', { hidden: true })
    .find(
      (button) =>
        button.getAttribute('aria-hidden') === 'true' &&
        button.querySelector(`img[src="playlist-audio://artwork/${current.idOf(title)}"]`),
    )!
}

export function playerButton(name: 'Play' | 'Pause' | 'Next' | 'Previous' | 'Shuffle'): HTMLElement {
  return screen.getByRole('button', { name })
}

export function openPlaylist(user: AppHarness['user'], title: string): Promise<void> {
  return user.click(screen.getAllByRole('button', { name: new RegExp(title) })[0])
}

export function openExplore(user: AppHarness['user']): Promise<void> {
  return user.click(screen.getByRole('button', { name: 'Explore' }))
}

export function openLibrary(user: AppHarness['user']): Promise<void> {
  return user.click(screen.getByRole('button', { name: 'Your library' }))
}

/** The album or artist cards in Your library's grid, as screen readers announce them, in order. */
export function libraryCards(kind: 'Albums' | 'Artists'): string[] {
  return within(screen.getByRole('list', { name: kind }))
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? '')
}

/** Opens Your library, then an album or artist from its grid. */
export async function openInLibrary(user: AppHarness['user'], kind: 'Albums' | 'Artists', name: string): Promise<void> {
  if (!screen.queryByRole('group', { name: 'Browse by' })) await openLibrary(user)
  await user.click(within(screen.getByRole('group', { name: 'Browse by' })).getByRole('button', { name: kind }))
  const card = libraryCards(kind).find((label) => label.startsWith(`${name} by `) || label.startsWith(`${name}, `))
  if (!card) throw new Error(`No ${kind.toLowerCase()} card for ${name}`)
  await user.click(within(screen.getByRole('list', { name: kind })).getByRole('button', { name: card }))
}

export function goHome(user: AppHarness['user']): Promise<void> {
  return user.click(screen.getByRole('button', { name: 'Home' }))
}

/** A song's row in the visible song list, for reading what it shows or finding its buttons. */
export function songRow(title: string): HTMLElement {
  return songButton(title).parentElement!
}

/** Opens a song's "Add to playlist" menu in Explore and returns it. */
export async function openAddToPlaylistMenu(user: AppHarness['user'], title: string): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: `Add ${title} to a playlist` }))
  return screen.getByRole('group', { name: `Add ${title} to` })
}

/** What screen readers have been told, from every live status region on screen. */
export function announcements(): string[] {
  return screen
    .queryAllByRole('status')
    .map((region) => region.textContent ?? '')
    .filter(Boolean)
}

export function queuePanel(): HTMLElement | null {
  return screen.queryByRole('region', { name: 'Queue' })
}

/** The queue panel as the user reads it: section headings, song titles and empty-state notes, top to bottom. */
export function queueContents(): string[] {
  const panel = queuePanel()
  if (!panel) throw new Error('The queue panel is closed.')
  return [...panel.querySelectorAll('p, strong')].map((element) => element.textContent ?? '').filter(Boolean)
}

export function queueButton(): HTMLElement {
  return screen.getByRole('button', { name: /^Queue/ })
}

export { within }
