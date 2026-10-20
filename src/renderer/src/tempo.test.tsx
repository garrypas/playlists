import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  expectPlaying,
  openExplore,
  openInLibrary,
  openPlaylist,
  player,
  pressOnTempo,
  playerButton,
  renderApp,
  songButton,
  songEnds,
  songRow,
  tempoDetected,
  tempoSlider,
  within,
} from './test/app'

const library = [
  {
    title: 'Mix',
    songs: [
      { title: 'One', artist: 'Bicep', album: 'Isles', bpm: 120 },
      { title: 'Two', artist: 'Bicep', album: 'Isles', bpm: 128.4 },
      // Its key is known, so the only dash in its row is for BPM.
      { title: 'Three', artist: 'Bonobo', album: 'Migration', key: 'Am' },
    ],
  },
  { title: 'Empty' },
]

describe('tempo control', () => {
  it('plays songs at normal speed to begin with', async () => {
    await renderApp(library)
    expect(player().speed).toBe(100)
    expect(tempoSlider()).toHaveAttribute('aria-valuetext', '0%, 120.0 BPM')
    expect(screen.getByRole('button', { name: 'Reset tempo' })).toBeDisabled()
  })

  it('speeds up or slows down the playing song by up to 10%', async () => {
    const { user } = await renderApp(library)
    await user.click(playerButton('Play'))
    pressOnTempo('End')
    expect(player()).toMatchObject({ song: 'One', playing: true, speed: 110 })
    pressOnTempo('ArrowUp')
    expect(player().speed).toBe(110)
    pressOnTempo('Home')
    expect(player().speed).toBe(90)
    pressOnTempo('ArrowDown')
    expect(player().speed).toBe(90)
    expect(tempoSlider()).toHaveAttribute('aria-valuetext', '−10.0%, 120.0 (108.0) BPM')
  })

  it('fine-tunes in steps of 0.1% with the arrow keys, and 1% with Page Up and Page Down', async () => {
    await renderApp(library)
    pressOnTempo('ArrowRight', 'ArrowRight', 'ArrowUp')
    expect(player().speed).toBe(100.3)
    pressOnTempo('PageUp')
    expect(player().speed).toBe(101.3)
    pressOnTempo('PageDown', 'PageDown', 'ArrowLeft')
    expect(player().speed).toBe(99.2)
    expect(tempoSlider()).toHaveAttribute('aria-valuetext', '−0.8%, 120.0 (119.0) BPM')
  })

  it('sets the tempo from where the bar is clicked, with the middle as normal speed', async () => {
    await renderApp(library)
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 80 } as DOMRect)
    fireEvent.pointerDown(tempoSlider(), { clientX: 170, pointerId: 1 })
    expect(player().speed).toBe(107.5)
    fireEvent.pointerDown(tempoSlider(), { clientX: 140, pointerId: 1 })
    expect(player().speed).toBe(100)
    fireEvent.pointerDown(tempoSlider(), { clientX: 60, pointerId: 1 })
    expect(player().speed).toBe(90)
  })

  it('goes back to normal speed with the reset button or a double-click', async () => {
    const { user } = await renderApp(library)
    pressOnTempo('PageUp', 'PageUp')
    await user.click(screen.getByRole('button', { name: 'Reset tempo' }))
    expect(player().speed).toBe(100)
    expect(screen.getByRole('button', { name: 'Reset tempo' })).toBeDisabled()
    pressOnTempo('PageDown')
    await user.dblClick(tempoSlider())
    expect(player().speed).toBe(100)
  })

  it('moves the pitch with the speed, like a turntable', async () => {
    const { user } = await renderApp(library)
    await user.click(playerButton('Play'))
    pressOnTempo('PageUp')
    expect(player()).toMatchObject({ speed: 101, keepsPitch: false })
    await user.click(playerButton('Next'))
    expect(player()).toMatchObject({ song: 'Two', speed: 100, keepsPitch: false })
  })

  it('plays each song at its own tempo, and the next song at normal speed until it’s changed', async () => {
    const { user } = await renderApp(library)
    await user.click(playerButton('Play'))
    pressOnTempo('PageUp', 'PageUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp')
    songEnds()
    expect(player()).toMatchObject({ song: 'Two', playing: true, speed: 100 })
    expect(tempoSlider()).toHaveAttribute('aria-valuenow', '0')
    pressOnTempo('PageDown')
    await user.click(songButton('One'))
    expect(player()).toMatchObject({ song: 'One', playing: true, speed: 102.5 })
    expect(tempoSlider()).toHaveAttribute('aria-valuetext', '+2.5%, 120.0 (123.0) BPM')
    await user.click(songButton('Two'))
    expect(player()).toMatchObject({ song: 'Two', speed: 99 })
  })

  it('saves each song’s tempo, so it’s the same next time the app opens', async () => {
    const { desktop, user } = await renderApp(library)
    await user.click(songButton('Two'))
    pressOnTempo('PageUp', 'PageUp', 'PageUp')
    await waitFor(() => expect(desktop.saved()[0].tracks.map((track) => track.tempo)).toEqual([0, 3, 0]))
  })

  it('saves a tempo change straight away if the window closes before it’s saved', async () => {
    const { desktop, user } = await renderApp(library)
    await user.click(songButton('Two'))
    pressOnTempo('End')
    fireEvent(window, new Event('pagehide'))
    expect(desktop.saved()[0].tracks[1].tempo).toBe(10)
  })

  it('starts a song at the tempo saved for it', async () => {
    const { user } = await renderApp([{ title: 'Mix', songs: ['One', { title: 'Two', bpm: 100, tempo: -4.5 }] }])
    await user.click(songButton('Two'))
    expect(player()).toMatchObject({ song: 'Two', speed: 95.5 })
    expect(tempoSlider()).toHaveAttribute('aria-valuetext', '−4.5%, 100.0 (95.5) BPM')
    expect(screen.getByRole('button', { name: 'Reset tempo' })).toBeEnabled()
  })

  it('keeps a song’s tempo to the playlist it was changed in', async () => {
    const { user } = await renderApp([
      { title: 'Mix', songs: [{ title: 'One', bpm: 120 }] },
      { title: 'Also has One', songs: [{ title: 'One', bpm: 120 }] },
    ])
    await user.click(songButton('One'))
    pressOnTempo('End')
    await openPlaylist(user, 'Also has One')
    expect(within(songRow('One')).getByText('120')).toBeInTheDocument()
    await user.click(songButton('One'))
    expect(player().speed).toBe(100)
  })

  it('goes back to the saved tempo if saving fails', async () => {
    const { desktop, user } = await renderApp(library)
    await user.click(songButton('Two'))
    desktop.failNext('playlists:set-track-tempo', 'Disk is full.')
    pressOnTempo('End')
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Disk is full.')))
    expect(player().speed).toBe(100)
  })

  it('shows the playing song’s BPM at its tempo, or just the change when its BPM is unknown', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Two'))
    pressOnTempo('PageUp', 'PageUp')
    expect(tempoSlider()).toHaveAttribute('aria-valuetext', '+2.0%, 128.4 (131.0) BPM')
    await user.click(songButton('Three'))
    pressOnTempo('PageUp')
    expect(tempoSlider()).toHaveAttribute('aria-valuetext', '+1.0%, key Am')
  })

  it('can’t be changed with nothing to play', async () => {
    await renderApp([{ title: 'Empty' }])
    expect(tempoSlider()).toHaveAttribute('aria-disabled', 'true')
    pressOnTempo('End')
    expect(tempoSlider()).toHaveAttribute('aria-valuetext', '0%')
    expect(player().speed).toBe(100)
  })
})

describe('song BPM', () => {
  it('shows each song’s BPM in the playlist, with a dash until it’s known', async () => {
    await renderApp(library)
    expect(songRow('One')).toHaveTextContent('120')
    expect(songRow('Two')).toHaveTextContent('128')
    expect(within(songRow('Three')).getByText('—')).toBeInTheDocument()
  })

  it('fills in a song’s BPM when it’s detected in the background', async () => {
    await renderApp(library)
    tempoDetected('Three', 97.6)
    expect(songRow('Three')).toHaveTextContent('98')
  })

  it('updates the player when the playing song’s BPM is detected, without interrupting it', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Three'))
    tempoDetected('Three', 100)
    expectPlaying('Three')
    expect(tempoSlider()).toHaveAttribute('aria-valuetext', '0%, 100.0 BPM, key Am')
  })

  it('keeps the same song playing from Explore when another song’s BPM is detected', async () => {
    const { user } = await renderApp(library)
    await openExplore(user)
    await user.click(songButton('Two'))
    tempoDetected('Three', 100)
    expectPlaying('Two')
    expect(songRow('Three')).toHaveTextContent('100')
  })

  it('shows BPM in Explore and on album pages', async () => {
    const { user } = await renderApp(library)
    await openExplore(user)
    expect(songRow('Two')).toHaveTextContent('128')
    await openInLibrary(user, 'Albums', 'Isles')
    expect(songRow('One')).toHaveTextContent('120')
  })

  it('shows a changed song’s BPM at its tempo in brackets, leaving the others as they are', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('One'))
    pressOnTempo('PageUp', 'PageUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp')
    expect(within(songRow('One')).getByText('120 (123)')).toBeInTheDocument()
    expect(within(songRow('Two')).getByText('128')).toBeInTheDocument()
    await openExplore(user)
    expect(within(songRow('One')).getByText('120 (123)')).toBeInTheDocument()
  })

  it('leaves out the brackets when the tempo change doesn’t change the whole BPM', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('One'))
    pressOnTempo('ArrowUp')
    expect(within(songRow('One')).getByText('120')).toBeInTheDocument()
  })

  it('keeps showing a dash for a song with no steady beat', async () => {
    await renderApp(library)
    tempoDetected('Three', undefined)
    expect(within(songRow('Three')).getByText('—')).toBeInTheDocument()
  })
})
