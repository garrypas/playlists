import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  type AppHarness, expectPlaying, openPlaylist, player, playerButton, queueButton, queueContents, queuePanel, renderApp, songButton, songEnds,
} from './test/app'

const library = [{ title: 'Mix', songs: ['One', 'Two', 'Three', 'Four', 'Five'] }, { title: 'Other', songs: ['A', 'B'] }]

function addToQueue(user: AppHarness['user'], song: string): Promise<void> {
  return user.click(screen.getByRole('button', { name: `Add ${song} to queue` }))
}

async function openQueue(user: AppHarness['user']): Promise<HTMLElement> {
  if (!queuePanel()) await user.click(queueButton())
  return queuePanel()!
}

describe('queue panel', () => {
  it('opens from the queue button and shows what plays next', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Three'))
    await user.click(queueButton())
    expect(queueButton()).toHaveAttribute('aria-expanded', 'true')
    expect(queueContents()).toEqual(['NOW PLAYING', 'Three', 'NEXT FROM PLAYLIST', 'Four', 'Five'])
  })

  it('says playback stops when on the last song', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Five'))
    await openQueue(user)
    expect(queueContents()).toContain('Playback stops after this song.')
  })

  it('says when the playlist is empty', async () => {
    const { user } = await renderApp([{ title: 'Empty' }])
    await openQueue(user)
    expect(queueContents()).toEqual(['NOW PLAYING', 'Nothing playing yet.', 'NEXT FROM PLAYLIST', 'Add songs to this playlist to fill the queue.'])
  })

  it('labels the upcoming songs as shuffled while shuffle is on', async () => {
    const { user } = await renderApp(library)
    await user.click(playerButton('Shuffle'))
    await openQueue(user)
    expect(queueContents()).toContain('NEXT FROM PLAYLIST · SHUFFLED')
  })

  it.each([
    ['the close button', async (user: AppHarness['user']) => user.click(screen.getByRole('button', { name: 'Close queue' }))],
    ['Escape', async (user: AppHarness['user']) => user.keyboard('{Escape}')],
    ['clicking elsewhere', async (user: AppHarness['user']) => user.click(screen.getByRole('heading', { level: 2, name: 'Mix' }))],
    ['the queue button again', async (user: AppHarness['user']) => user.click(queueButton())],
  ])('closes with %s', async (_how, close) => {
    const { user } = await renderApp(library)
    await openQueue(user)
    await close(user)
    expect(queuePanel()).not.toBeInTheDocument()
  })

  it('stays open while the user clicks inside it', async () => {
    const { user } = await renderApp(library)
    const panel = await openQueue(user)
    await user.click(within(panel).getByRole('heading', { name: 'Queue' }))
    expect(queuePanel()).toBeInTheDocument()
  })

  it('plays a song from the upcoming list', async () => {
    const { user } = await renderApp(library)
    const panel = await openQueue(user)
    await user.click(within(panel).getByRole('button', { name: /^Four/ }))
    expectPlaying('Four')
  })
})

describe('adding to the queue', () => {
  it('counts queued songs on the queue button', async () => {
    const { user } = await renderApp(library)
    expect(queueButton()).toHaveAccessibleName('Queue')
    await addToQueue(user, 'Four')
    await addToQueue(user, 'Two')
    expect(queueButton()).toHaveAccessibleName('Queue, 2 queued')
  })

  it('plays queued songs next, then carries on from where the playlist was', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('One'))
    await addToQueue(user, 'Four')
    await addToQueue(user, 'Three')
    songEnds()
    expectPlaying('Four')
    await user.click(playerButton('Next'))
    expectPlaying('Three')
    songEnds()
    expectPlaying('Two')
  })

  it('shows queued songs ahead of the rest of the playlist', async () => {
    const { user } = await renderApp(library)
    await addToQueue(user, 'Four')
    await openQueue(user)
    expect(queueContents()).toEqual(['NOW PLAYING', 'One', 'NEXT IN QUEUE', 'Four', 'NEXT FROM PLAYLIST', 'Two', 'Three', 'Four', 'Five'])
  })

  it('can queue the same song twice', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('One'))
    await addToQueue(user, 'Five')
    await addToQueue(user, 'Five')
    songEnds()
    expectPlaying('Five')
    songEnds()
    expect(player()).toMatchObject({ song: 'Five', playing: true, time: 0 })
    songEnds()
    expectPlaying('Two')
  })

  it('plays queued songs even after the last playlist song', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Five'))
    await addToQueue(user, 'Two')
    await openQueue(user)
    expect(queueContents()).toContain('Playback stops after the queued songs.')
    songEnds()
    expectPlaying('Two')
    songEnds()
    expect(player()).toMatchObject({ song: 'Two', playing: false })
  })

  it('goes back to the playlist song with Previous', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Two'))
    await addToQueue(user, 'Five')
    await user.click(playerButton('Next'))
    expectPlaying('Five')
    await user.click(playerButton('Previous'))
    expectPlaying('Two')
  })

  it('carries on from the same place in a shuffled playlist', async () => {
    const { user } = await renderApp(library)
    await user.click(playerButton('Shuffle'))
    const panel = await openQueue(user)
    const nextShuffled = within(panel).getAllByRole('button', { name: /^(One|Two|Three|Four|Five)/ })[0].textContent!
    await addToQueue(user, 'Two')
    await user.click(playerButton('Next'))
    await user.click(playerButton('Next'))
    expect(nextShuffled.startsWith(player().song!)).toBe(true)
  })
})

describe('managing the queue', () => {
  it('plays a queued song when clicked, skipping the songs queued ahead of it', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('One'))
    await addToQueue(user, 'Two')
    await addToQueue(user, 'Three')
    await addToQueue(user, 'Four')
    const panel = await openQueue(user)
    const queued = within(panel).getAllByRole('button', { name: /^Three/ })[0]
    await user.click(queued)
    expectPlaying('Three')
    expect(queueButton()).toHaveAccessibleName('Queue, 1 queued')
    songEnds()
    expectPlaying('Four')
  })

  it('removes a single queued song', async () => {
    const { user } = await renderApp(library)
    await addToQueue(user, 'Two')
    await addToQueue(user, 'Four')
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Remove Two from queue' }))
    expect(queueContents()).toEqual(['NOW PLAYING', 'One', 'NEXT IN QUEUE', 'Four', 'NEXT FROM PLAYLIST', 'Two', 'Three', 'Four', 'Five'])
  })

  it('clears the whole queue', async () => {
    const { user } = await renderApp(library)
    await addToQueue(user, 'Two')
    await addToQueue(user, 'Four')
    const panel = await openQueue(user)
    await user.click(within(panel).getByRole('button', { name: 'Clear' }))
    expect(queueContents()).not.toContain('NEXT IN QUEUE')
    expect(queueButton()).toHaveAccessibleName('Queue')
  })

  it('empties when switching playlists', async () => {
    const { user } = await renderApp(library)
    await addToQueue(user, 'Two')
    await openPlaylist(user, 'Other')
    expect(queueButton()).toHaveAccessibleName('Queue')
  })

  it('drops a song that is removed from the playlist', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('One'))
    await addToQueue(user, 'Four')
    await addToQueue(user, 'Three')
    await user.click(screen.getByRole('button', { name: 'Remove Four from playlist' }))
    await waitFor(() => expect(queueButton()).toHaveAccessibleName('Queue, 1 queued'))
    songEnds()
    expectPlaying('Three')
  })
})
