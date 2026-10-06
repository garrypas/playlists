import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  announcements,
  type AppHarness,
  dragPlaylist,
  expectPlaying,
  openExplore,
  renderApp,
  sidebarPlaylist,
  sidebarPlaylists,
  songButton,
  songList,
} from './test/app'

const library = [
  { title: 'Mix', songs: ['One', 'Two'] },
  { title: 'Chill', songs: ['Calm'] },
  { title: 'Road trip' },
  { title: 'Gym' },
]

function savedOrder(desktop: AppHarness['desktop']): string[] {
  return desktop.saved().map((playlist) => playlist.title)
}

describe('dragging playlists into a new order', () => {
  it('moves a playlist down and saves the new order once it is dropped', async () => {
    const { desktop } = await renderApp(library)
    await dragPlaylist('Mix', { below: 'Road trip' })
    expect(sidebarPlaylists()).toEqual(['Chill', 'Road trip', 'Mix', 'Gym'])
    expect(savedOrder(desktop)).toEqual(['Chill', 'Road trip', 'Mix', 'Gym'])
  })

  it('moves a playlist to the top or the bottom', async () => {
    const { desktop } = await renderApp(library)
    await dragPlaylist('Gym', { above: 'Mix' })
    expect(savedOrder(desktop)).toEqual(['Gym', 'Mix', 'Chill', 'Road trip'])
    await dragPlaylist('Mix', { below: 'Road trip' })
    expect(savedOrder(desktop)).toEqual(['Gym', 'Chill', 'Road trip', 'Mix'])
  })

  it('leaves the order alone when a playlist is dropped where it started', async () => {
    const { desktop } = await renderApp(library)
    await dragPlaylist('Chill', { above: 'Road trip' })
    await dragPlaylist('Chill', { below: 'Mix' })
    expect(sidebarPlaylists()).toEqual(['Mix', 'Chill', 'Road trip', 'Gym'])
    expect(desktop.calls).not.toContain('playlists:move')
  })

  it('shows the new order in the Home grid too', async () => {
    await renderApp(library)
    await dragPlaylist('Gym', { above: 'Mix' })
    const cards = screen.getAllByRole('button', { name: /songs? ·/ }).map((card) => card.textContent)
    expect(cards[0]).toContain('Gym')
    expect(cards[1]).toContain('Mix')
  })

  it('keeps the open playlist open and its music playing', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Two'))
    await dragPlaylist('Mix', { below: 'Gym' })
    expect(screen.getByRole('heading', { level: 2, name: 'Mix' })).toBeInTheDocument()
    expect(songList()).toEqual(['One', 'Two'])
    expectPlaying('Two')
  })

  it('works while Explore is playing, without interrupting it', async () => {
    const { user } = await renderApp(library)
    await openExplore(user)
    await user.click(songButton('Calm'))
    await dragPlaylist('Chill', { above: 'Mix' })
    expect(sidebarPlaylists()).toEqual(['Chill', 'Mix', 'Road trip', 'Gym'])
    expectPlaying('Calm')
  })

  it('keeps the old order and explains when the move cannot be saved', async () => {
    const { desktop } = await renderApp(library)
    desktop.failNext('playlists:move', 'Disk full.')
    await dragPlaylist('Mix', { below: 'Gym' })
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Disk full.'))
    expect(sidebarPlaylists()).toEqual(['Mix', 'Chill', 'Road trip', 'Gym'])
  })

  it('ignores a song dragged onto the sidebar', async () => {
    const { desktop } = await renderApp(library)
    fireEvent.dragStart(songButton('One').closest('[draggable]')!)
    fireEvent.dragOver(sidebarPlaylist('Gym'), { clientY: 5 })
    fireEvent.drop(sidebarPlaylist('Gym'), { clientY: 5 })
    expect(desktop.calls).not.toContain('playlists:move')
    expect(sidebarPlaylists()).toEqual(['Mix', 'Chill', 'Road trip', 'Gym'])
  })

  it('cannot reorder a single playlist', async () => {
    await renderApp([{ title: 'Only' }])
    expect(sidebarPlaylist('Only')).toHaveAttribute('draggable', 'false')
  })
})

describe('moving playlists with the keyboard', () => {
  it('moves the focused playlist one place with Alt+arrow keys and announces where it went', async () => {
    const { user, desktop } = await renderApp(library)
    sidebarPlaylist('Mix').focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(sidebarPlaylists()).toEqual(['Chill', 'Mix', 'Road trip', 'Gym'])
    expect(announcements()).toContain('Moved Mix to position 2 of 4.')
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}')
    expect(savedOrder(desktop)).toEqual(['Mix', 'Chill', 'Road trip', 'Gym'])
  })

  it('keeps focus on the moved playlist', async () => {
    const { user } = await renderApp(library)
    sidebarPlaylist('Mix').focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(sidebarPlaylist('Mix')).toHaveFocus()
  })

  it('does nothing past either end, or with plain arrow keys', async () => {
    const { user, desktop } = await renderApp(library)
    sidebarPlaylist('Mix').focus()
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}')
    await user.keyboard('{ArrowDown}')
    sidebarPlaylist('Gym').focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(desktop.calls).not.toContain('playlists:move')
  })
})
