import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  announcements,
  type AppHarness,
  dragSong,
  expectPlaying,
  playerButton,
  queueButton,
  queueContents,
  renderApp,
  songButton,
  songEnds,
  songList,
} from './test/app'

const library = [{ title: 'Mix', songs: ['One', 'Two', 'Three', 'Four', 'Five'] }]

function moveButton(song: string): HTMLElement {
  return screen.getByRole('button', { name: `Move ${song}` })
}

function savedOrder(desktop: AppHarness['desktop']): string[] {
  return desktop.saved()[0].tracks.map((track) => track.title)
}

describe('dragging songs into a new order', () => {
  it('moves a song down and saves the new order once it is dropped', async () => {
    const { desktop } = await renderApp(library)
    await dragSong('Two', { below: 'Four' })
    expect(songList()).toEqual(['One', 'Three', 'Four', 'Two', 'Five'])
    expect(savedOrder(desktop)).toEqual(['One', 'Three', 'Four', 'Two', 'Five'])
  })

  it('moves a song up to the top', async () => {
    const { desktop } = await renderApp(library)
    await dragSong('Four', { above: 'One' })
    expect(songList()).toEqual(['Four', 'One', 'Two', 'Three', 'Five'])
    expect(savedOrder(desktop)).toEqual(['Four', 'One', 'Two', 'Three', 'Five'])
  })

  it('moves a song to the bottom', async () => {
    const { desktop } = await renderApp(library)
    await dragSong('One', { below: 'Five' })
    expect(savedOrder(desktop)).toEqual(['Two', 'Three', 'Four', 'Five', 'One'])
  })

  it('leaves the order alone when a song is dropped where it started', async () => {
    const { desktop } = await renderApp(library)
    await dragSong('Two', { above: 'Three' })
    await dragSong('Three', { below: 'Two' })
    expect(songList()).toEqual(['One', 'Two', 'Three', 'Four', 'Five'])
    expect(savedOrder(desktop)).toEqual(['One', 'Two', 'Three', 'Four', 'Five'])
  })

  it('keeps the old order and explains when the move cannot be saved', async () => {
    const { desktop } = await renderApp(library)
    desktop.failNext('playlists:move-track', 'Disk full.')
    await dragSong('Two', { below: 'Four' })
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Disk full.'))
    expect(songList()).toEqual(['One', 'Two', 'Three', 'Four', 'Five'])
  })

  it('is turned off while the song list is filtered by a search', async () => {
    const { desktop, user } = await renderApp(library)
    await user.type(screen.getByRole('textbox', { name: 'Find a song' }), 'T')
    await dragSong('Two', { below: 'Three' })
    expect(savedOrder(desktop)).toEqual(['One', 'Two', 'Three', 'Four', 'Five'])
    expect(moveButton('Two')).toBeDisabled()
  })

  it('has nothing to reorder in a playlist with one song', async () => {
    await renderApp([{ title: 'Solo', songs: ['Only'] }])
    expect(moveButton('Only')).toBeDisabled()
  })
})

describe('moving songs with the keyboard', () => {
  it('moves a song one place with the arrow keys and announces where it went', async () => {
    const { desktop, user } = await renderApp(library)
    moveButton('Two').focus()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(savedOrder(desktop)).toEqual(['One', 'Three', 'Four', 'Two', 'Five'])
    expect(announcements()).toContain('Moved Two to position 4 of 5.')
    await user.keyboard('{ArrowUp}')
    expect(savedOrder(desktop)).toEqual(['One', 'Three', 'Two', 'Four', 'Five'])
  })

  it('cannot move the first song up or the last song down', async () => {
    const { desktop, user } = await renderApp(library)
    moveButton('One').focus()
    await user.keyboard('{ArrowUp}')
    moveButton('Five').focus()
    await user.keyboard('{ArrowDown}')
    expect(savedOrder(desktop)).toEqual(['One', 'Two', 'Three', 'Four', 'Five'])
  })
})

describe('reordering during playback', () => {
  it('keeps playing the current song after it is moved, and carries on from its new place', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Two'))
    await dragSong('Two', { below: 'Four' })
    expectPlaying('Two')
    songEnds()
    expectPlaying('Five')
  })

  it('plays the songs in their new order', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('One'))
    await dragSong('Four', { above: 'Two' })
    await user.click(playerButton('Next'))
    expectPlaying('Four')
    await user.click(queueButton())
    expect(queueContents()).toEqual(['NOW PLAYING', 'Four', 'NEXT FROM PLAYLIST', 'Two', 'Three', 'Five'])
  })

  it('returns to the right playlist song after a queued song, even when songs moved meanwhile', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('One'))
    await user.click(screen.getByRole('button', { name: 'Add Five to queue' }))
    await user.click(playerButton('Next'))
    expectPlaying('Five')
    await dragSong('Three', { above: 'One' })
    songEnds()
    expectPlaying('Two')
  })

  it('does not change the shuffled order', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('One'))
    await user.click(playerButton('Shuffle'))
    await user.click(queueButton())
    const before = queueContents()
    await dragSong('Five', { above: 'Two' })
    expect(queueContents()).toEqual(before)
    expectPlaying('One')
  })
})
