import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import { expectPlaying, openPlaylist, player, renderApp, songButton, songList } from './test/app'
import { createFakeDesktop } from './test/fakeDesktop'

const library = [
  {
    title: 'Late night drive',
    songs: [
      { title: 'Nightcall', artist: 'Kavinsky', album: 'OutRun' },
      { title: 'Midnight City', artist: 'M83', album: 'Hurry Up' },
      'Tenderness',
    ],
  },
  { title: 'Soft focus', songs: ['Holocene'] },
  { title: 'Empty one' },
]

describe('opening the app', () => {
  it('shows the saved playlists and opens the first one', async () => {
    await renderApp(library)
    expect(screen.getByRole('heading', { level: 2, name: 'Late night drive' })).toBeInTheDocument()
    expect(songList()).toEqual(['Nightcall', 'Midnight City', 'Tenderness'])
    expect(screen.getByText(/3 songs/)).toBeInTheDocument()
    expect(screen.getByText(/1 song ·/)).toBeInTheDocument()
  })

  it('has no user account: no profile, name or sign-in', async () => {
    await renderApp(library)
    expect(screen.queryByText(/account|profile|sign in|log in/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Jamie Parker')).not.toBeInTheDocument()
  })

  it('offers no Settings button while there is no settings screen', async () => {
    await renderApp(library)
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('invites the user to create a playlist when there are none', async () => {
    await renderApp([])
    expect(screen.getByText('Create a playlist to start collecting your music.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add songs/ })).toBeDisabled()
  })

  it('tells the user when playlists cannot be loaded', async () => {
    const desktop = createFakeDesktop(library)
    desktop.failNext('playlists:list', 'Disk is unreadable.')
    window.desktop = desktop.api
    render(<App />)
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Disk is unreadable.')))
  })

  it('shows a message for an empty playlist', async () => {
    const { user } = await renderApp(library)
    await openPlaylist(user, 'Empty one')
    expect(
      screen.getByText('This playlist is empty. Add songs, or drag audio files here from your computer.'),
    ).toBeInTheDocument()
  })
})

describe('creating a playlist', () => {
  it('saves it and opens it', async () => {
    const { user, desktop } = await renderApp(library)
    await user.click(screen.getByRole('button', { name: /New playlist/ }))
    await user.type(screen.getByRole('textbox', { name: 'Playlist name' }), 'Road trip')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Road trip' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(desktop.saved().map((playlist) => playlist.title)).toContain('Road trip')
  })

  it('can be started from the sidebar too', async () => {
    const { user } = await renderApp(library)
    await user.click(screen.getByRole('button', { name: 'Create playlist' }))
    expect(screen.getByRole('dialog', { name: 'New playlist' })).toBeInTheDocument()
  })

  it.each(['', '   '])('asks for a name instead of saving %j', async (name) => {
    const { user, desktop } = await renderApp(library)
    await user.click(screen.getByRole('button', { name: /New playlist/ }))
    if (name) await user.type(screen.getByRole('textbox', { name: 'Playlist name' }), name)
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a name.')
    expect(desktop.calls).not.toContain('playlists:create')
  })

  it('clears the error once the user starts typing', async () => {
    const { user } = await renderApp(library)
    await user.click(screen.getByRole('button', { name: /New playlist/ }))
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await user.type(screen.getByRole('textbox', { name: 'Playlist name' }), 'R')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('limits names to 100 characters', async () => {
    const { user } = await renderApp(library)
    await user.click(screen.getByRole('button', { name: /New playlist/ }))
    const input = screen.getByRole('textbox', { name: 'Playlist name' })
    await user.click(input)
    await user.paste('x'.repeat(120))
    expect(input).toHaveValue('x'.repeat(100))
  })

  it('saves nothing when cancelled', async () => {
    const { user, desktop } = await renderApp(library)
    await user.click(screen.getByRole('button', { name: /New playlist/ }))
    await user.type(screen.getByRole('textbox', { name: 'Playlist name' }), 'Road trip')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(desktop.calls).not.toContain('playlists:create')
  })
})

describe('renaming a playlist', () => {
  it('starts from the current name and saves the new one', async () => {
    const { user, desktop } = await renderApp(library)
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Playlist name' })
    expect(input).toHaveValue('Late night drive')
    await user.clear(input)
    await user.type(input, 'Night moves')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Night moves' })).toBeInTheDocument()
    expect(desktop.saved()[0].title).toBe('Night moves')
  })

  it('does nothing when the name is unchanged', async () => {
    const { user, desktop } = await renderApp(library)
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(desktop.calls).not.toContain('playlists:rename')
  })

  it('shows a save error in the dialog, in plain words', async () => {
    const { user, desktop } = await renderApp(library)
    desktop.failNext('playlists:rename', 'Playlist not found.')
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    await user.type(screen.getByRole('textbox', { name: 'Playlist name' }), '!')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Playlist not found\.$/)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('deleting a playlist', () => {
  it('asks first, then deletes it and opens the next playlist', async () => {
    const { user, desktop } = await renderApp(library)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Late night drive'))
    expect(await screen.findByRole('heading', { level: 2, name: 'Soft focus' })).toBeInTheDocument()
    expect(desktop.saved().map((playlist) => playlist.title)).toEqual(['Soft focus', 'Empty one'])
  })

  it('keeps the playlist if the user says no', async () => {
    const { user, desktop } = await renderApp(library)
    vi.mocked(window.confirm).mockReturnValue(false)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(desktop.calls).not.toContain('playlists:remove')
    expect(screen.getByRole('heading', { level: 2, name: 'Late night drive' })).toBeInTheDocument()
  })

  it('stops the music when the playing playlist is deleted', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Nightcall'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await screen.findByRole('heading', { level: 2, name: 'Soft focus' })
    expect(player().playing).toBe(false)
  })

  it('tells the user if the delete fails', async () => {
    const { user, desktop } = await renderApp(library)
    desktop.failNext('playlists:remove', 'Disk full.')
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Disk full.')))
  })
})

describe('switching playlists', () => {
  it('shows the chosen playlist and stops the music', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Nightcall'))
    await openPlaylist(user, 'Soft focus')
    expect(screen.getByRole('heading', { level: 2, name: 'Soft focus' })).toBeInTheDocument()
    expect(songList()).toEqual(['Holocene'])
    expect(player().playing).toBe(false)
  })

  it('clears the search', async () => {
    const { user } = await renderApp(library)
    await user.type(screen.getByRole('textbox', { name: 'Find a song' }), 'night')
    await openPlaylist(user, 'Soft focus')
    expect(screen.getByRole('textbox', { name: 'Find a song' })).toHaveValue('')
  })
})

describe('finding a song', () => {
  it.each([
    ['title', 'midnight', ['Midnight City']],
    ['artist', 'KAVINSKY', ['Nightcall']],
    ['album', 'hurry', ['Midnight City']],
    ['part of several titles', 'night', ['Nightcall', 'Midnight City']],
  ])('filters the list by %s', async (_by, query, expected) => {
    const { user } = await renderApp(library)
    await user.type(screen.getByRole('textbox', { name: 'Find a song' }), query)
    expect(songList()).toEqual(expected)
  })

  it('says when nothing matches', async () => {
    const { user } = await renderApp(library)
    await user.type(screen.getByRole('textbox', { name: 'Find a song' }), 'polka')
    expect(songList()).toEqual([])
    expect(screen.getByText('No songs match “polka”.')).toBeInTheDocument()
  })

  it('plays the right song from a filtered list', async () => {
    const { user } = await renderApp(library)
    await user.type(screen.getByRole('textbox', { name: 'Find a song' }), 'tender')
    await user.click(songButton('Tenderness'))
    expectPlaying('Tenderness')
  })
})

describe('adding songs', () => {
  it('adds the files picked in the system dialog to the end of the playlist', async () => {
    const { user, desktop } = await renderApp(library)
    desktop.pickFiles(['/music/Genesis.mp3', '/music/Oblivion.flac'])
    await user.click(screen.getByRole('button', { name: /Add songs/ }))
    await waitFor(() => expect(songList()).toEqual(['Nightcall', 'Midnight City', 'Tenderness', 'Genesis', 'Oblivion']))
  })

  it('changes nothing when the dialog is cancelled', async () => {
    const { user } = await renderApp(library)
    await user.click(screen.getByRole('button', { name: /Add songs/ }))
    expect(songList()).toEqual(['Nightcall', 'Midnight City', 'Tenderness'])
  })

  it('tells the user if songs cannot be added', async () => {
    const { user, desktop } = await renderApp(library)
    desktop.failNext('playlists:add-audio-files', 'Disk full.')
    await user.click(screen.getByRole('button', { name: /Add songs/ }))
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Disk full.')))
  })
})

describe('removing songs', () => {
  it('removes the song from the playlist', async () => {
    const { user, desktop } = await renderApp(library)
    await user.click(screen.getByRole('button', { name: 'Remove Midnight City from playlist' }))
    await waitFor(() => expect(songList()).toEqual(['Nightcall', 'Tenderness']))
    expect(desktop.saved()[0].tracks.map((track) => track.title)).toEqual(['Nightcall', 'Tenderness'])
  })

  it('stops the music when the playing song is removed', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Midnight City'))
    await user.click(screen.getByRole('button', { name: 'Remove Midnight City from playlist' }))
    await waitFor(() => expect(player().playing).toBe(false))
  })

  it('keeps playing the current song when an earlier song is removed', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Tenderness'))
    await user.click(screen.getByRole('button', { name: 'Remove Nightcall from playlist' }))
    await waitFor(() => expect(songList()).toEqual(['Midnight City', 'Tenderness']))
    expectPlaying('Tenderness')
  })
})
