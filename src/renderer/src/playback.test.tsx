import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  expectPlaying,
  openPlaylist,
  player,
  playerButton,
  playTo,
  renderApp,
  songButton,
  songEnds,
  songFailsToLoad,
  songLoaded,
} from './test/app'

const songs = ['One', 'Two', 'Three', 'Four', 'Five']
const library = [{ title: 'Mix', songs }, { title: 'Empty' }]

describe('play and pause', () => {
  it('starts with the first song ready but silent', async () => {
    await renderApp(library)
    expect(player()).toMatchObject({ song: 'One', playing: false })
    expect(screen.getByText('One', { selector: '.now-playing strong' })).toBeInTheDocument()
  })

  it('plays and pauses the current song', async () => {
    const { user } = await renderApp(library)
    await user.click(playerButton('Play'))
    expectPlaying('One')
    await user.click(playerButton('Pause'))
    expect(player()).toMatchObject({ song: 'One', playing: false })
  })

  it('cannot play anything from an empty playlist', async () => {
    const { user } = await renderApp(library)
    await openPlaylist(user, 'Empty')
    expect(playerButton('Play')).toBeDisabled()
    expect(playerButton('Next')).toBeDisabled()
    expect(playerButton('Previous')).toBeDisabled()
    expect(playerButton('Shuffle')).toBeDisabled()
    expect(screen.getByText('Nothing playing yet')).toBeInTheDocument()
  })

  it('plays a song picked from the list', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Three'))
    expectPlaying('Three')
  })

  it('restarts a song picked again while it plays', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Three'))
    playTo(40)
    await user.click(songButton('Three'))
    expect(player()).toMatchObject({ song: 'Three', playing: true, time: 0 })
  })

  it('tells the user when a song cannot be played, and stops', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Two'))
    songFailsToLoad()
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining("Couldn't play “Two”"))
    expect(player().playing).toBe(false)
  })
})

describe('next and previous', () => {
  it('moves through the playlist in order and wraps from the last song to the first', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Four'))
    await user.click(playerButton('Next'))
    expectPlaying('Five')
    await user.click(playerButton('Next'))
    expectPlaying('One')
  })

  it('goes back a song early in the current one, wrapping from the first to the last', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Two'))
    playTo(2)
    await user.click(playerButton('Previous'))
    expectPlaying('One')
    await user.click(playerButton('Previous'))
    expectPlaying('Five')
  })

  it('restarts the current song when more than 3 seconds in', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Two'))
    playTo(3.5)
    await user.click(playerButton('Previous'))
    expect(player()).toMatchObject({ song: 'Two', playing: true, time: 0 })
  })

  it('plays the next song when one finishes', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Two'))
    songEnds()
    expectPlaying('Three')
  })

  it('stops after the last song finishes instead of wrapping', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Five'))
    songEnds()
    expect(player()).toMatchObject({ song: 'Five', playing: false })
  })

  it('changes song without starting playback while paused', async () => {
    const { user } = await renderApp(library)
    await user.click(playerButton('Next'))
    expect(player()).toMatchObject({ song: 'Two', playing: false })
  })

  it('restarts a one-song playlist on Next', async () => {
    const { user } = await renderApp([{ title: 'Solo', songs: ['Only'] }])
    await user.click(songButton('Only'))
    playTo(30)
    await user.click(playerButton('Next'))
    expect(player()).toMatchObject({ song: 'Only', playing: true, time: 0 })
  })
})

describe('seeking', () => {
  function seekBar(): HTMLElement {
    return screen.getByRole('slider', { name: 'Seek' })
  }

  it('is unavailable until the song has loaded', async () => {
    await renderApp(library)
    expect(seekBar()).toHaveAttribute('aria-disabled', 'true')
  })

  it('shows the elapsed and total time', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('One'))
    songLoaded(200)
    playTo(65)
    expect(seekBar()).toHaveAttribute('aria-valuetext', '1:05')
    expect(screen.getByText('3:20')).toBeInTheDocument()
  })

  it.each([
    ['ArrowRight', 105],
    ['ArrowLeft', 95],
    ['Home', 0],
    ['End', 200],
  ])('moves the playhead with %s', async (key, expected) => {
    const { user } = await renderApp(library)
    await user.click(songButton('One'))
    songLoaded(200)
    playTo(100)
    fireEvent.keyDown(seekBar(), { key })
    expect(player().time).toBe(expected)
  })

  it('does not seek past either end', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('One'))
    songLoaded(200)
    playTo(2)
    fireEvent.keyDown(seekBar(), { key: 'ArrowLeft' })
    expect(player().time).toBe(0)
    playTo(198)
    fireEvent.keyDown(seekBar(), { key: 'ArrowRight' })
    expect(player().time).toBe(200)
  })

  it('jumps to the point clicked on the bar', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('One'))
    songLoaded(200)
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 400 } as DOMRect)
    fireEvent.pointerDown(seekBar(), { clientX: 200, pointerId: 1 })
    expect(player().time).toBe(50)
  })
})

describe('shuffle', () => {
  async function collectPlayOrder(user: Awaited<ReturnType<typeof renderApp>>['user']): Promise<string[]> {
    const order = [player().song!]
    for (let i = 1; i < songs.length; i++) {
      await user.click(playerButton('Next'))
      order.push(player().song!)
    }
    return order
  }

  it('plays every song once, starting from the current one', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Three'))
    await user.click(playerButton('Shuffle'))
    expect(playerButton('Shuffle')).toHaveAttribute('aria-pressed', 'true')
    const order = await collectPlayOrder(user)
    expect(order[0]).toBe('Three')
    expect([...order].sort()).toEqual([...songs].sort())
  })

  it('goes back through the same shuffled order', async () => {
    const { user } = await renderApp(library)
    await user.click(playerButton('Shuffle'))
    const order = await collectPlayOrder(user)
    await user.click(playerButton('Previous'))
    expect(player().song).toBe(order[order.length - 2])
  })

  it('returns to playlist order from the current song when turned off', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Two'))
    await user.click(playerButton('Shuffle'))
    await user.click(playerButton('Shuffle'))
    expect(playerButton('Shuffle')).toHaveAttribute('aria-pressed', 'false')
    await user.click(playerButton('Next'))
    expectPlaying('Three')
  })

  it('plays songs added while shuffled after the shuffled ones', async () => {
    const { user, desktop } = await renderApp(library)
    await user.click(playerButton('Shuffle'))
    desktop.pickFiles(['/music/Six.mp3'])
    await user.click(screen.getByRole('button', { name: /Add songs/ }))
    await screen.findByRole('button', { name: 'Play Six' })
    const order = await collectPlayOrder(user)
    await user.click(playerButton('Next'))
    expect(order).not.toContain('Six')
    expect(player().song).toBe('Six')
  })

  it('stays on, reshuffled, when switching playlists', async () => {
    const { user } = await renderApp([
      { title: 'Mix', songs },
      { title: 'Other', songs: ['A', 'B', 'C'] },
    ])
    await user.click(playerButton('Shuffle'))
    await openPlaylist(user, 'Other')
    expect(playerButton('Shuffle')).toHaveAttribute('aria-pressed', 'true')
    expect(player().song).toBe('A')
  })
})
