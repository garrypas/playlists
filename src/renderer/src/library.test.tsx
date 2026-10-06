import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  expectPlaying,
  goHome,
  libraryCards,
  openAddToPlaylistMenu,
  openInLibrary,
  openLibrary,
  openPlaylist,
  player,
  playerButton,
  queueButton,
  queueContents,
  renderApp,
  songButton,
  songEnds,
  songList,
  within,
} from './test/app'

const outRun = (title: string, trackNumber: number, durationSeconds = 240) => ({
  title,
  artist: 'Kavinsky',
  album: 'OutRun',
  albumArtist: 'Kavinsky',
  trackNumber,
  durationSeconds,
})

const library = [
  {
    title: 'Drive',
    songs: [
      outRun('Nightcall', 3),
      outRun('Testarossa Autodrive', 1),
      { title: 'Wait', artist: 'M83', album: 'Hurry Up', trackNumber: 2 },
      { title: 'Midnight City', artist: 'M83', album: 'Hurry Up', trackNumber: 1 },
      { title: 'Demo', artist: 'M83' },
      'voice memo',
    ],
  },
  { title: 'Night', songs: [outRun('Nightcall', 3), outRun('Rampage', 2)] },
  { title: 'Empty' },
]

describe('your library', () => {
  it('opens from the sidebar and shows albums by artist, then title', async () => {
    const { user } = await renderApp(library)
    await openLibrary(user)
    expect(screen.getByRole('button', { name: 'Your library' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { level: 2, name: 'Your library' })).toBeInTheDocument()
    expect(screen.getByText('2 albums · 3 artists')).toBeInTheDocument()
    expect(libraryCards('Albums')).toEqual(['OutRun by Kavinsky, 3 songs', 'Hurry Up by M83, 2 songs'])
  })

  it('lists artists with how many songs and albums each has', async () => {
    const { user } = await renderApp(library)
    await openLibrary(user)
    await user.click(screen.getByRole('button', { name: 'Artists' }))
    expect(screen.getByRole('button', { name: 'Artists' })).toHaveAttribute('aria-pressed', 'true')
    expect(libraryCards('Artists')).toEqual([
      'Kavinsky, 3 songs, 1 album',
      'M83, 3 songs, 1 album',
      'Unknown artist, 1 song, 0 albums',
    ])
  })

  it('goes back Home to the open playlist', async () => {
    const { user } = await renderApp(library)
    await openLibrary(user)
    await goHome(user)
    expect(screen.getByRole('heading', { level: 2, name: 'Drive' })).toBeInTheDocument()
  })

  it('opens a playlist picked from the sidebar', async () => {
    const { user } = await renderApp(library)
    await openLibrary(user)
    await openPlaylist(user, 'Night')
    expect(screen.getByRole('heading', { level: 2, name: 'Night' })).toBeInTheDocument()
  })

  it('explains where albums come from when no songs have album tags', async () => {
    const { user } = await renderApp([{ title: 'Memos', songs: ['memo 1', 'memo 2'] }])
    await openLibrary(user)
    expect(
      screen.getByText('None of your songs have an album in their tags. Find them under Artists, or in Explore.'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Artists' }))
    expect(libraryCards('Artists')).toEqual(['Unknown artist, 2 songs, 0 albums'])
  })

  it('says how songs get here when there are none', async () => {
    const { user } = await renderApp([{ title: 'Empty' }])
    await openLibrary(user)
    expect(screen.getByText('No songs yet. Songs you add to any playlist show up here.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Artists' }))
    expect(screen.getByText('No songs yet. Songs you add to any playlist show up here.')).toBeInTheDocument()
  })
})

describe('grouping albums', () => {
  it('keeps a compilation together under its album artist', async () => {
    const { user } = await renderApp([
      {
        title: 'Mix',
        songs: [
          { title: 'A', artist: 'One', album: 'Hits', albumArtist: 'Various Artists' },
          { title: 'B', artist: 'Two', album: 'Hits', albumArtist: 'Various Artists' },
        ],
      },
    ])
    await openLibrary(user)
    expect(libraryCards('Albums')).toEqual(['Hits by Various Artists, 2 songs'])
  })

  it('treats albums of the same name by different artists as different albums', async () => {
    const { user } = await renderApp([
      {
        title: 'Mix',
        songs: [
          { title: 'A', artist: 'One', album: 'Greatest Hits' },
          { title: 'B', artist: 'Two', album: 'Greatest Hits' },
        ],
      },
    ])
    await openLibrary(user)
    expect(libraryCards('Albums')).toEqual(['Greatest Hits by One, 1 song', 'Greatest Hits by Two, 1 song'])
  })

  it('ignores differences in capitalisation', async () => {
    const { user } = await renderApp([
      {
        title: 'Mix',
        songs: [
          { title: 'A', artist: 'Kavinsky', album: 'OutRun' },
          { title: 'B', artist: 'kavinsky', album: 'Outrun' },
        ],
      },
    ])
    await openLibrary(user)
    expect(libraryCards('Albums')).toEqual(['OutRun by Kavinsky, 2 songs'])
  })
})

describe('an album', () => {
  it('lists its songs in track order, each once, with its artist, size and length', async () => {
    const { user } = await renderApp(library)
    await openInLibrary(user, 'Albums', 'OutRun')
    expect(screen.getByRole('heading', { level: 2, name: 'OutRun' })).toBeInTheDocument()
    expect(screen.getByText('Kavinsky · 3 songs · 12 min')).toBeInTheDocument()
    expect(songList()).toEqual(['Testarossa Autodrive', 'Rampage', 'Nightcall'])
  })

  it('puts discs in order, and songs without a track number last', async () => {
    const { user } = await renderApp([
      {
        title: 'Mix',
        songs: [
          { title: 'Untracked', artist: 'X', album: 'Double' },
          { title: 'Disc 2 opener', artist: 'X', album: 'Double', discNumber: 2, trackNumber: 1 },
          { title: 'Disc 1 closer', artist: 'X', album: 'Double', discNumber: 1, trackNumber: 9 },
        ],
      },
    ])
    await openInLibrary(user, 'Albums', 'Double')
    expect(songList()).toEqual(['Disc 1 closer', 'Disc 2 opener', 'Untracked'])
  })

  it('leaves out the length when no song length is known', async () => {
    const { user } = await renderApp(library)
    await openInLibrary(user, 'Albums', 'Hurry Up')
    expect(screen.getByText('M83 · 2 songs')).toBeInTheDocument()
  })

  it('goes back to the albums', async () => {
    const { user } = await renderApp(library)
    await openInLibrary(user, 'Albums', 'OutRun')
    await user.click(screen.getByRole('button', { name: 'Albums' }))
    expect(libraryCards('Albums')).toHaveLength(2)
  })

  it('plays from the first track with Play all, then through the album in order', async () => {
    const { user } = await renderApp(library)
    await openInLibrary(user, 'Albums', 'OutRun')
    await user.click(screen.getByRole('button', { name: 'Play all' }))
    expectPlaying('Testarossa Autodrive')
    songEnds()
    expectPlaying('Rampage')
    await user.click(playerButton('Next'))
    expectPlaying('Nightcall')
    songEnds()
    expect(player()).toMatchObject({ song: 'Nightcall', playing: false })
  })

  it('plays a picked song, then carries on through the album', async () => {
    const { user } = await renderApp(library)
    await openInLibrary(user, 'Albums', 'OutRun')
    await user.click(songButton('Rampage'))
    expectPlaying('Rampage')
    await user.click(queueButton())
    expect(queueContents()).toEqual(['NOW PLAYING', 'Rampage', 'NEXT FROM ALBUM', 'Nightcall'])
  })

  it('plays every album song once with shuffle on, and nothing else', async () => {
    const { user } = await renderApp(library)
    await user.click(playerButton('Shuffle'))
    await openInLibrary(user, 'Albums', 'OutRun')
    await user.click(screen.getByRole('button', { name: 'Play all' }))
    const heard = [player().song]
    for (let i = 0; i < 2; i++) {
      await user.click(playerButton('Next'))
      heard.push(player().song)
    }
    expect(heard.sort()).toEqual(['Nightcall', 'Rampage', 'Testarossa Autodrive'])
  })

  it("adds a song to a playlist from the album's song list", async () => {
    const { user, desktop } = await renderApp(library)
    await openInLibrary(user, 'Albums', 'OutRun')
    const menu = await openAddToPlaylistMenu(user, 'Rampage')
    await user.click(within(menu).getByRole('button', { name: /Empty/ }))
    expect(await screen.findByText('Added Rampage to Empty.')).toBeInTheDocument()
    expect(desktop.saved()[2].tracks.map((track) => track.title)).toEqual(['Rampage'])
  })
})

describe('an artist', () => {
  it('lists their songs album by album, with songs on no album last', async () => {
    const { user } = await renderApp(library)
    await openInLibrary(user, 'Artists', 'M83')
    expect(screen.getByRole('heading', { level: 2, name: 'M83' })).toBeInTheDocument()
    expect(screen.getByText('1 album · 3 songs')).toBeInTheDocument()
    expect(songList()).toEqual(['Midnight City', 'Wait', 'Demo'])
  })

  it('plays everything by them with Play all', async () => {
    const { user } = await renderApp(library)
    await openInLibrary(user, 'Artists', 'M83')
    await user.click(screen.getByRole('button', { name: 'Play all' }))
    expectPlaying('Midnight City')
    await user.click(queueButton())
    expect(queueContents()).toEqual(['NOW PLAYING', 'Midnight City', 'NEXT FROM ARTIST', 'Wait', 'Demo'])
  })
})

describe('playing from the library', () => {
  it('keeps playing when going back Home', async () => {
    const { user } = await renderApp(library)
    await openInLibrary(user, 'Albums', 'OutRun')
    await user.click(songButton('Rampage'))
    await goHome(user)
    expectPlaying('Rampage')
    songEnds()
    expectPlaying('Nightcall')
  })

  it('switches to the playlist, clearing the queue, when a playlist song is played', async () => {
    const { user } = await renderApp(library)
    await openInLibrary(user, 'Albums', 'OutRun')
    await user.click(songButton('Rampage'))
    await goHome(user)
    await user.click(screen.getByRole('button', { name: 'Add Wait to queue' }))
    await user.click(songButton('Wait'))
    expect(queueButton()).toHaveAccessibleName('Queue')
    songEnds()
    expectPlaying('Midnight City')
  })

  it('keeps the same song playing when another album song is removed from its playlist', async () => {
    const { user } = await renderApp(library)
    await openInLibrary(user, 'Albums', 'OutRun')
    await user.click(songButton('Nightcall'))
    await goHome(user)
    await user.click(screen.getByRole('button', { name: 'Remove Testarossa Autodrive from playlist' }))
    await waitFor(() => expect(songList()).not.toContain('Testarossa Autodrive'))
    expectPlaying('Nightcall')
  })

  it('stops when the playing song is removed from its last playlist', async () => {
    const { user } = await renderApp(library)
    await openInLibrary(user, 'Albums', 'OutRun')
    await user.click(songButton('Testarossa Autodrive'))
    await goHome(user)
    await user.click(screen.getByRole('button', { name: 'Remove Testarossa Autodrive from playlist' }))
    await waitFor(() => expect(player().playing).toBe(false))
  })
})
