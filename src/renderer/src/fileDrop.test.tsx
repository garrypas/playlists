import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  announcements,
  dragFilesAway,
  dragFilesOver,
  dragSong,
  dropFiles,
  expectPlaying,
  openExplore,
  playlistSongsArea,
  renderApp,
  sidebarPlaylist,
  songButton,
  songList,
} from './test/app'

const library = [
  { title: 'Gym', songs: ['Stronger'] },
  { title: 'Chill', songs: ['Holocene'] },
]

describe('dropping audio files from Finder or Explorer', () => {
  it('adds songs dropped on the open playlist to the end, in the order dropped', async () => {
    const { desktop } = await renderApp(library)
    await dropFiles(playlistSongsArea('Gym'), ['Around the World.mp3', 'One More Time.flac'])

    expect(songList()).toEqual(['Stronger', 'Around the World', 'One More Time'])
    expect(desktop.saved()[0].tracks.map((track) => track.title)).toEqual([
      'Stronger',
      'Around the World',
      'One More Time',
    ])
    expect(announcements()).toContain('Added 2 songs to Gym.')
  })

  it('shows where the files will go while they are dragged over the song list', async () => {
    await renderApp(library)
    const area = playlistSongsArea('Gym')
    dragFilesOver(area, ['Around the World.mp3'])
    expect(screen.getByText('Drop to add to Gym')).toBeInTheDocument()

    dragFilesAway(area)
    expect(screen.queryByText('Drop to add to Gym')).not.toBeInTheDocument()
  })

  it('adds songs dropped on a playlist in the sidebar without opening it', async () => {
    const { desktop } = await renderApp(library)
    await dropFiles(sidebarPlaylist('Chill'), ['Teardrop.m4a'])

    expect(songList()).toEqual(['Stronger'])
    expect(desktop.saved()[1].tracks.map((track) => track.title)).toEqual(['Holocene', 'Teardrop'])
    expect(announcements()).toContain('Added 1 song to Chill.')
  })

  it('works on a sidebar playlist while Explore is open', async () => {
    const { user, desktop } = await renderApp(library)
    await openExplore(user)
    await dropFiles(sidebarPlaylist('Gym'), ['Teardrop.m4a'])

    expect(desktop.saved()[0].tracks.map((track) => track.title)).toEqual(['Stronger', 'Teardrop'])
    expect(await screen.findByRole('button', { name: 'Play Teardrop' })).toBeInTheDocument()
  })

  it('adds songs to an empty playlist', async () => {
    await renderApp([{ title: 'New' }])
    expect(screen.getByText('This playlist is empty. Add songs, or drag audio files here from your computer.'))
    await dropFiles(playlistSongsArea('New'), ['Teardrop.m4a'])
    expect(songList()).toEqual(['Teardrop'])
  })

  it('skips files that are not audio and says so', async () => {
    const { desktop } = await renderApp(library)
    await dropFiles(playlistSongsArea('Gym'), ['Teardrop.mp3', 'cover.jpg', 'notes.txt'])

    expect(songList()).toEqual(['Stronger', 'Teardrop'])
    expect(announcements()).toContain('Added 1 song to Gym. Skipped 2 files that aren’t audio.')
    expect(desktop.saved()[0].tracks).toHaveLength(2)
  })

  it('adds nothing when no dropped file is audio', async () => {
    const { desktop } = await renderApp(library)
    await dropFiles(playlistSongsArea('Gym'), ['cover.jpg', 'My folder'])

    expect(songList()).toEqual(['Stronger'])
    expect(desktop.calls).not.toContain('playlists:add-dropped-files')
    expect(announcements()).toContain('Only audio files can be added: MP3, M4A, AAC, WAV, AIFF, FLAC, OGG or Opus.')
  })

  it('ignores songs already in the playlist', async () => {
    await renderApp(library)
    await dropFiles(playlistSongsArea('Gym'), ['Teardrop.mp3'])
    await dropFiles(playlistSongsArea('Gym'), ['Teardrop.mp3'])

    expect(songList()).toEqual(['Stronger', 'Teardrop'])
    expect(announcements()).toContain('That song is already in Gym.')
  })

  it('keeps the playing song playing', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Stronger'))
    await dropFiles(playlistSongsArea('Gym'), ['Teardrop.mp3'])
    expectPlaying('Stronger')
  })

  it('shows an alert and changes nothing when saving fails', async () => {
    const { desktop } = await renderApp(library)
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    desktop.failNext('playlists:add-dropped-files', 'The disk is full.')
    await dropFiles(playlistSongsArea('Gym'), ['Teardrop.mp3'])

    expect(alert).toHaveBeenCalledWith(expect.stringContaining('The disk is full.'))
    expect(songList()).toEqual(['Stronger'])
    alert.mockRestore()
  })

  it('still reorders songs dragged within the list instead of adding them', async () => {
    const { desktop } = await renderApp([{ title: 'Gym', songs: ['One', 'Two'] }])
    await dragSong('One', { below: 'Two' })
    expect(songList()).toEqual(['Two', 'One'])
    expect(desktop.calls).not.toContain('playlists:add-dropped-files')
    expect(screen.queryByText('Drop to add to Gym')).not.toBeInTheDocument()
  })
})
