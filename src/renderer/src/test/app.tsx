import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect } from 'vitest'
import App from '../App'
import { createFakeDesktop, type FakeDesktop, type SongSpec } from './fakeDesktop'

export interface AppHarness {
  desktop: FakeDesktop
  user: ReturnType<typeof userEvent.setup>
}

// Renders the app against an in-memory desktop API and waits for the first playlist to open.
export async function renderApp(playlists: { title: string, songs?: SongSpec[] }[]): Promise<AppHarness> {
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

function audio(): HTMLAudioElement {
  return document.querySelector('audio')!
}

/** What the speakers are playing: the loaded song's title, and whether it's playing or paused. */
export function player(): { song: string | undefined, playing: boolean, time: number } {
  const id = /^playlist-audio:\/\/track\/(\d+)$/.exec(audio().src)?.[1]
  return { song: id ? current.titleOf(Number(id)) : undefined, playing: !audio().paused, time: audio().currentTime }
}

export function expectPlaying(song: string): void {
  expect(player()).toMatchObject({ song, playing: true })
}

/** The browser finished loading the song and knows how long it is. */
export function songLoaded(durationSeconds: number): void {
  Object.defineProperty(audio(), 'duration', { configurable: true, value: durationSeconds })
  fireEvent.loadedMetadata(audio())
}

/** Playback has reached `seconds` into the song. */
export function playTo(seconds: number): void {
  audio().currentTime = seconds
  fireEvent.timeUpdate(audio())
}

export function songEnds(): void {
  act(() => { fireEvent.ended(audio()) })
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
  return screen.queryAllByRole('button', { name: /^Play / }).map((button) => button.getAttribute('aria-label')!.slice(5))
}

/** The song's artwork, which doubles as a mouse-only play/pause button (hidden from screen readers). */
export function artworkButton(title: string): HTMLElement {
  return screen.getAllByRole('button', { hidden: true }).find((button) =>
    button.getAttribute('aria-hidden') === 'true' && button.querySelector(`img[src="playlist-audio://artwork/${current.idOf(title)}"]`))!
}

export function playerButton(name: 'Play' | 'Pause' | 'Next' | 'Previous' | 'Shuffle'): HTMLElement {
  return screen.getByRole('button', { name })
}

export function openPlaylist(user: AppHarness['user'], title: string): Promise<void> {
  return user.click(screen.getAllByRole('button', { name: new RegExp(title) })[0])
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
