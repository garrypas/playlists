import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  expectPlaying,
  openExplore,
  openInLibrary,
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
    expect(tempoSlider()).toHaveAttribute('aria-valuetext', '−10.0%, 108.0 BPM')
  })

  it('fine-tunes in steps of 0.1% with the arrow keys, and 1% with Page Up and Page Down', async () => {
    await renderApp(library)
    pressOnTempo('ArrowRight', 'ArrowRight', 'ArrowUp')
    expect(player().speed).toBe(100.3)
    pressOnTempo('PageUp')
    expect(player().speed).toBe(101.3)
    pressOnTempo('PageDown', 'PageDown', 'ArrowLeft')
    expect(player().speed).toBe(99.2)
    expect(tempoSlider()).toHaveAttribute('aria-valuetext', '−0.8%, 119.0 BPM')
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

  it('moves the pitch with the speed, like a turntable, on every song', async () => {
    const { user } = await renderApp(library)
    await user.click(playerButton('Play'))
    pressOnTempo('PageUp')
    expect(player()).toMatchObject({ speed: 101, keepsPitch: false })
    await user.click(playerButton('Next'))
    expect(player()).toMatchObject({ song: 'Two', speed: 101, keepsPitch: false })
  })

  it('keeps the tempo for the songs that follow', async () => {
    const { user } = await renderApp(library)
    await user.click(playerButton('Play'))
    pressOnTempo('PageUp', 'PageUp', 'PageUp')
    songEnds()
    expect(player()).toMatchObject({ song: 'Two', playing: true, speed: 103 })
    await user.click(songButton('Three'))
    expect(player()).toMatchObject({ song: 'Three', playing: true, speed: 103 })
  })

  it('shows the playing song’s BPM at the current tempo, or just the change when its BPM is unknown', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Two'))
    pressOnTempo('PageUp', 'PageUp')
    expect(tempoSlider()).toHaveAttribute('aria-valuetext', '+2.0%, 131.0 BPM')
    await user.click(songButton('Three'))
    expect(tempoSlider()).toHaveAttribute('aria-valuetext', '+2.0%, key Am')
  })

  it('works with nothing to play', async () => {
    await renderApp([{ title: 'Empty' }])
    pressOnTempo('End')
    expect(tempoSlider()).toHaveAttribute('aria-valuetext', '+10.0%')
    expect(player().speed).toBe(110)
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

  it('keeps showing a dash for a song with no steady beat', async () => {
    await renderApp(library)
    tempoDetected('Three', undefined)
    expect(within(songRow('Three')).getByText('—')).toBeInTheDocument()
  })
})
