import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  announcements,
  expectPlaying,
  goHome,
  openAddToPlaylistMenu,
  openExplore,
  openPlaylist,
  player,
  playerButton,
  queueButton,
  queueContents,
  renderApp,
  songButton,
  songEnds,
  songList,
  songRow,
  within,
} from './test/app'

const library = [
  {
    title: 'Mix',
    songs: [
      { title: 'Nightcall', artist: 'Kavinsky', album: 'OutRun' },
      { title: 'Midnight City', artist: 'M83', album: 'Hurry Up' },
      'Holocene',
    ],
  },
  {
    title: 'Other',
    songs: [
      { title: 'Nightcall', artist: 'Kavinsky', album: 'OutRun' },
      { title: 'Wait', artist: 'M83', album: 'Hurry Up' },
    ],
  },
]

describe('browsing all songs', () => {
  it('lists every song once, by artist, album and title, with the playlists it is in', async () => {
    const { user } = await renderApp(library)
    await openExplore(user)
    expect(screen.getByRole('heading', { level: 2, name: 'Explore' })).toBeInTheDocument()
    expect(songList()).toEqual(['Nightcall', 'Midnight City', 'Wait', 'Holocene'])
    expect(within(songRow('Nightcall')).getByText('Mix, Other')).toBeInTheDocument()
    expect(within(songRow('Wait')).getByText('Other')).toBeInTheDocument()
    expect(screen.getByText('4 songs · 3 artists')).toBeInTheDocument()
  })

  it('marks Explore as the current page, and Home goes back to the open playlist', async () => {
    const { user } = await renderApp(library)
    await openExplore(user)
    expect(screen.getByRole('button', { name: 'Explore' })).toHaveAttribute('aria-current', 'page')
    await goHome(user)
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { level: 2, name: 'Mix' })).toBeInTheDocument()
    expect(songList()).toEqual(['Nightcall', 'Midnight City', 'Holocene'])
  })

  it('opens a playlist picked from the sidebar', async () => {
    const { user } = await renderApp(library)
    await openExplore(user)
    await openPlaylist(user, 'Other')
    expect(screen.getByRole('heading', { level: 2, name: 'Other' })).toBeInTheDocument()
  })

  it('searches titles, artists and albums across all playlists', async () => {
    const { user } = await renderApp(library)
    await openExplore(user)
    await user.type(screen.getByRole('textbox', { name: 'Search all songs' }), 'hurry')
    expect(songList()).toEqual(['Midnight City', 'Wait'])
    await user.clear(screen.getByRole('textbox', { name: 'Search all songs' }))
    await user.type(screen.getByRole('textbox', { name: 'Search all songs' }), 'zzz')
    expect(songList()).toEqual([])
    expect(screen.getByText('No songs match “zzz”.')).toBeInTheDocument()
  })

  it('filters by artist', async () => {
    const { user } = await renderApp(library)
    await openExplore(user)
    const artists = screen.getByRole('group', { name: 'Filter by artist' })
    await user.click(within(artists).getByRole('button', { name: 'M83' }))
    expect(within(artists).getByRole('button', { name: 'M83' })).toHaveAttribute('aria-pressed', 'true')
    expect(songList()).toEqual(['Midnight City', 'Wait'])
    await user.click(within(artists).getByRole('button', { name: 'All artists' }))
    expect(songList()).toHaveLength(4)
  })

  it('explains where songs come from when no playlist has any', async () => {
    const { user } = await renderApp([{ title: 'Empty' }])
    await openExplore(user)
    expect(screen.getByText('No songs yet. Songs you add to any playlist show up here.')).toBeInTheDocument()
    expect(screen.getByText('0 songs · 0 artists')).toBeInTheDocument()
  })
})

describe('playing from Explore', () => {
  it('plays through every song in Explore order, across playlists, and stops after the last', async () => {
    const { user } = await renderApp(library)
    await openExplore(user)
    await user.click(songButton('Midnight City'))
    expectPlaying('Midnight City')
    await user.click(playerButton('Next'))
    expectPlaying('Wait')
    songEnds()
    expectPlaying('Holocene')
    songEnds()
    expect(player()).toMatchObject({ song: 'Holocene', playing: false })
  })

  it('keeps playing when going back Home, and the queue shows it is playing from Explore', async () => {
    const { user } = await renderApp(library)
    await openExplore(user)
    await user.click(songButton('Wait'))
    await goHome(user)
    expectPlaying('Wait')
    await user.click(queueButton())
    expect(queueContents()).toEqual(['NOW PLAYING', 'Wait', 'NEXT FROM EXPLORE', 'Holocene'])
  })

  it('goes back to playing the playlist when a playlist song is picked', async () => {
    const { user } = await renderApp(library)
    await openExplore(user)
    await user.click(songButton('Nightcall'))
    await goHome(user)
    await user.click(songButton('Midnight City'))
    await user.click(playerButton('Next'))
    expectPlaying('Holocene')
  })

  it('restarts a song picked in its playlist after it was playing from Explore', async () => {
    const { user } = await renderApp(library)
    await openExplore(user)
    await user.click(songButton('Nightcall'))
    await goHome(user)
    await user.click(songButton('Nightcall'))
    expect(player()).toMatchObject({ song: 'Nightcall', playing: true, time: 0 })
    await user.click(playerButton('Next'))
    expectPlaying('Midnight City')
  })

  it('shuffles every song in Explore, starting from the picked one', async () => {
    const { user } = await renderApp(library)
    await user.click(playerButton('Shuffle'))
    await openExplore(user)
    await user.click(songButton('Wait'))
    expectPlaying('Wait')
    await user.click(queueButton())
    const contents = queueContents()
    expect(contents.slice(0, 3)).toEqual(['NOW PLAYING', 'Wait', 'NEXT FROM EXPLORE · SHUFFLED'])
    expect(contents.slice(3).sort()).toEqual(['Holocene', 'Midnight City', 'Nightcall'])
  })

  it('plays songs queued from the open playlist next, then carries on through Explore', async () => {
    const { user } = await renderApp(library)
    await openExplore(user)
    await user.click(songButton('Nightcall'))
    await goHome(user)
    await user.click(screen.getByRole('button', { name: 'Add Holocene to queue' }))
    await user.click(playerButton('Next'))
    expectPlaying('Holocene')
    await user.click(playerButton('Next'))
    expectPlaying('Midnight City')
  })

  it('stops when the playing song is removed from its only playlist', async () => {
    const { user } = await renderApp(library)
    await openExplore(user)
    await user.click(songButton('Holocene'))
    await goHome(user)
    await user.click(screen.getByRole('button', { name: 'Remove Holocene from playlist' }))
    expect(player().playing).toBe(false)
  })

  it('keeps playing the same song when an earlier song is removed', async () => {
    const { user } = await renderApp(library)
    await openExplore(user)
    await user.click(songButton('Wait'))
    await goHome(user)
    await user.click(screen.getByRole('button', { name: 'Remove Midnight City from playlist' }))
    expectPlaying('Wait')
    await user.click(playerButton('Next'))
    expectPlaying('Holocene')
  })

  it('keeps playing the same song when a newly added song moves it down the list', async () => {
    const { user, desktop } = await renderApp(library)
    await openExplore(user)
    await user.click(songButton('Holocene'))
    await goHome(user)
    desktop.pickFiles(['/music/Aria.mp3'])
    await user.click(screen.getByRole('button', { name: /Add songs/ }))
    expectPlaying('Holocene')
    await user.click(playerButton('Previous'))
    expectPlaying('Aria')
  })

  it('keeps playing when the playlist with one of the song’s copies is deleted', async () => {
    const { user } = await renderApp(library)
    await openExplore(user)
    await user.click(songButton('Nightcall'))
    await goHome(user)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expectPlaying('Nightcall')
    await user.click(playerButton('Next'))
    expectPlaying('Wait')
  })
})

describe('adding a song to another playlist', () => {
  it('saves it to the end of the chosen playlist', async () => {
    const { user, desktop } = await renderApp(library)
    await openExplore(user)
    const menu = await openAddToPlaylistMenu(user, 'Holocene')
    expect(within(menu).getByRole('button', { name: 'Mix (already added)' })).toBeDisabled()
    await user.click(within(menu).getByRole('button', { name: 'Other' }))
    expect(announcements()).toContain('Added Holocene to Other.')
    expect(within(songRow('Holocene')).getByText('Mix, Other')).toBeInTheDocument()
    expect(desktop.saved()[1].tracks.map((track) => track.title)).toEqual(['Nightcall', 'Wait', 'Holocene'])
    await openPlaylist(user, 'Other')
    expect(songList()).toEqual(['Nightcall', 'Wait', 'Holocene'])
  })

  it('closes the menu with Escape and returns focus to its button', async () => {
    const { user } = await renderApp(library)
    await openExplore(user)
    const menu = await openAddToPlaylistMenu(user, 'Holocene')
    expect(within(menu).getByRole('button', { name: 'Other' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: 'Add Holocene to' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Holocene to a playlist' })).toHaveFocus()
  })

  it('closes the menu on a click outside it', async () => {
    const { user } = await renderApp(library)
    await openExplore(user)
    await openAddToPlaylistMenu(user, 'Holocene')
    await user.click(screen.getByRole('heading', { level: 2, name: 'Explore' }))
    expect(screen.queryByRole('group', { name: 'Add Holocene to' })).not.toBeInTheDocument()
  })

  it('tells the user when the song cannot be saved', async () => {
    const { user, desktop } = await renderApp(library)
    await openExplore(user)
    desktop.failNext('playlists:add-track', 'Disk is full.')
    const menu = await openAddToPlaylistMenu(user, 'Holocene')
    await user.click(within(menu).getByRole('button', { name: 'Other' }))
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Disk is full.'))
    expect(announcements()).toEqual([])
    expect(desktop.saved()[1].tracks).toHaveLength(2)
  })
})
