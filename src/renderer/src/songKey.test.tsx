import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  expectPlaying,
  keyDetected,
  openExplore,
  openInLibrary,
  openPlaylist,
  playerButton,
  pressOnTempo,
  renderApp,
  songButton,
  songRow,
  tempoSlider,
  within,
} from './test/app'

const library = [
  {
    title: 'Mix',
    songs: [
      { title: 'One', artist: 'Bicep', album: 'Isles', bpm: 120, key: 'Ebm' },
      { title: 'Two', artist: 'Bicep', album: 'Isles', key: 'F#' },
      { title: 'Three', artist: 'Bonobo', album: 'Migration', bpm: 98 },
    ],
  },
  { title: 'Also has Three', songs: [{ title: 'Three', artist: 'Bonobo', album: 'Migration', bpm: 98 }] },
]

describe('song key', () => {
  it('shows each song’s key in the playlist, with a dash until it’s known', async () => {
    await renderApp(library)
    expect(screen.getAllByText('KEY')).not.toHaveLength(0)
    expect(within(songRow('One')).getByText('Ebm')).toBeInTheDocument()
    expect(within(songRow('Two')).getByText('F#')).toBeInTheDocument()
    expect(within(songRow('Three')).getByText('98')).toBeInTheDocument()
    expect(within(songRow('Three')).getByText('—')).toBeInTheDocument()
  })

  it('fills in a song’s key when it’s found in the background, in every playlist it’s in', async () => {
    const { user } = await renderApp(library)
    keyDetected('Three', 'Am')
    expect(within(songRow('Three')).getByText('Am')).toBeInTheDocument()
    await openPlaylist(user, 'Also has Three')
    expect(within(songRow('Three')).getByText('Am')).toBeInTheDocument()
  })

  it('keeps the same song playing when another song’s key is found', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Two'))
    keyDetected('Three', 'Am')
    expectPlaying('Two')
  })

  it('shows keys in Explore and on album pages', async () => {
    const { user } = await renderApp(library)
    await openExplore(user)
    expect(within(songRow('Two')).getByText('F#')).toBeInTheDocument()
    keyDetected('Three', 'G#m')
    expect(within(songRow('Three')).getByText('G#m')).toBeInTheDocument()
    await openInLibrary(user, 'Albums', 'Isles')
    expect(within(songRow('One')).getByText('Ebm')).toBeInTheDocument()
  })

  it('keeps showing a dash for a song no key fits', async () => {
    await renderApp(library)
    keyDetected('Three', undefined)
    expect(within(songRow('Three')).getByText('—')).toBeInTheDocument()
  })
})

describe('song key at a changed tempo', () => {
  it('shows the key a song moves to when its tempo changes its pitch, leaving the others as they are', async () => {
    const { user } = await renderApp(library)
    pressOnTempo('End')
    expect(within(songRow('One')).getByText('Ebm (Fm)')).toBeInTheDocument()
    expect(within(songRow('Two')).getByText('F#')).toBeInTheDocument()
    await user.click(songButton('Two'))
    pressOnTempo('End')
    expect(within(songRow('Two')).getByText('F# (Ab)')).toBeInTheDocument()
    await user.click(songButton('One'))
    pressOnTempo('Home')
    expect(within(songRow('One')).getByText('Ebm (C#m)')).toBeInTheDocument()
  })

  it('shows just the key until the pitch moves at least half a semitone, about 3%', async () => {
    await renderApp(library)
    pressOnTempo('PageUp', 'PageUp')
    expect(within(songRow('One')).getByText('Ebm')).toBeInTheDocument()
    pressOnTempo('PageUp')
    expect(within(songRow('One')).getByText('Ebm (Em)')).toBeInTheDocument()
  })

  it('goes back to just the key when the tempo is reset', async () => {
    const { user } = await renderApp(library)
    pressOnTempo('End')
    await user.click(screen.getByRole('button', { name: 'Reset tempo' }))
    expect(within(songRow('One')).getByText('Ebm')).toBeInTheDocument()
  })

  it('shows the moved key in Explore and on album pages', async () => {
    const { user } = await renderApp(library)
    pressOnTempo('End')
    await openExplore(user)
    expect(within(songRow('One')).getByText('Ebm (Fm)')).toBeInTheDocument()
    expect(within(songRow('Two')).getByText('F#')).toBeInTheDocument()
    await openInLibrary(user, 'Albums', 'Isles')
    expect(within(songRow('One')).getByText('Ebm (Fm)')).toBeInTheDocument()
  })

  it('tells the player and screen readers the playing song’s key at the current tempo', async () => {
    const { user } = await renderApp(library)
    await user.click(playerButton('Play'))
    expect(tempoSlider()).toHaveAttribute('aria-valuetext', '0%, 120.0 BPM, key Ebm')
    pressOnTempo('PageUp', 'PageUp', 'PageUp', 'PageUp', 'PageUp')
    expect(tempoSlider()).toHaveAttribute('aria-valuetext', '+5.0%, 120.0 (126.0) BPM, key Ebm (Em)')
    expect(screen.getAllByText('Ebm (Em)')).toHaveLength(2)
  })

  it('shows a newly found key at its song’s tempo', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Three'))
    pressOnTempo('End')
    keyDetected('Three', 'Am')
    expect(within(songRow('Three')).getByText('Am (Bm)')).toBeInTheDocument()
  })
})
