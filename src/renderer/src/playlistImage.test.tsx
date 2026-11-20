import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { anyPlaylistImages, openPlaylist, playlistImages, renderApp } from './test/app'

const library = [{ title: 'Gym', songs: ['Pump'] }, { title: 'Chill' }]

describe('choosing a playlist image', () => {
  it('shows the picked image as the playlist’s cover in the sidebar, Home grid and heading', async () => {
    const { user, desktop } = await renderApp(library)
    expect(anyPlaylistImages()).toEqual([])
    desktop.pickFiles(['/pictures/gym.jpg'])
    await user.click(screen.getByRole('button', { name: 'Choose image for Gym' }))
    await waitFor(() => expect(playlistImages('Gym')).toHaveLength(3))
    expect(screen.getByRole('button', { name: 'Change image for Gym' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove image' })).toBeInTheDocument()
  })

  it('saves the image to the playlist', async () => {
    const { user, desktop } = await renderApp(library)
    desktop.pickFiles(['/pictures/gym.png'])
    await user.click(screen.getByRole('button', { name: 'Choose image for Gym' }))
    await waitFor(() => expect(playlistImages('Gym')).toHaveLength(3))
    expect(desktop.saved().find((playlist) => playlist.title === 'Gym')!.imageVersion).not.toBeNull()
    expect(desktop.saved().find((playlist) => playlist.title === 'Chill')!.imageVersion).toBeNull()
  })

  it('changes nothing when the user cancels the file dialog', async () => {
    const { user, desktop } = await renderApp(library)
    desktop.pickFiles([])
    await user.click(screen.getByRole('button', { name: 'Choose image for Gym' }))
    expect(anyPlaylistImages()).toEqual([])
    expect(screen.queryByRole('button', { name: 'Remove image' })).not.toBeInTheDocument()
  })

  it('explains when the picked file can’t be used as an image, and keeps the old cover', async () => {
    const { user, desktop } = await renderApp(library)
    desktop.pickFiles(['/pictures/notes.txt'])
    await user.click(screen.getByRole('button', { name: 'Choose image for Gym' }))
    expect(window.alert).toHaveBeenCalledWith(
      expect.stringContaining('That file couldn’t be opened as an image. Choose a JPEG or PNG.'),
    )
    expect(anyPlaylistImages()).toEqual([])
  })

  it('replaces an earlier image with the new one', async () => {
    const { user, desktop } = await renderApp(library)
    desktop.pickFiles(['/pictures/one.jpg'])
    await user.click(screen.getByRole('button', { name: 'Choose image for Gym' }))
    await waitFor(() => expect(playlistImages('Gym')).toHaveLength(3))
    const [first] = playlistImages('Gym')
    desktop.pickFiles(['/pictures/two.jpg'])
    await user.click(screen.getByRole('button', { name: 'Change image for Gym' }))
    await waitFor(() => expect(first).not.toBeInTheDocument())
    expect(playlistImages('Gym')).toHaveLength(3)
  })

  it('belongs to one playlist only', async () => {
    const { user, desktop } = await renderApp(library)
    desktop.pickFiles(['/pictures/gym.jpg'])
    await user.click(screen.getByRole('button', { name: 'Choose image for Gym' }))
    await waitFor(() => expect(playlistImages('Gym')).toHaveLength(3))
    await openPlaylist(user, 'Chill')
    expect(screen.getByRole('button', { name: 'Choose image for Chill' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove image' })).not.toBeInTheDocument()
    // Gym's cover still shows in the sidebar and Home grid.
    expect(playlistImages('Gym')).toHaveLength(2)
  })

  it('falls back to the original cover when the image can’t be loaded', async () => {
    const { user, desktop } = await renderApp(library)
    desktop.pickFiles(['/pictures/gym.jpg'])
    await user.click(screen.getByRole('button', { name: 'Choose image for Gym' }))
    await waitFor(() => expect(playlistImages('Gym')).toHaveLength(3))
    for (const image of playlistImages('Gym')) fireEvent.error(image)
    expect(anyPlaylistImages()).toEqual([])
  })

  it('can be chosen with the keyboard', async () => {
    const { user, desktop } = await renderApp(library)
    desktop.pickFiles(['/pictures/gym.jpg'])
    screen.getByRole('button', { name: 'Choose image for Gym' }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(playlistImages('Gym')).toHaveLength(3))
  })
})

describe('removing a playlist image', () => {
  it('goes back to the original cover', async () => {
    const { user, desktop } = await renderApp(library)
    desktop.pickFiles(['/pictures/gym.jpg'])
    await user.click(screen.getByRole('button', { name: 'Choose image for Gym' }))
    await user.click(await screen.findByRole('button', { name: 'Remove image' }))
    await waitFor(() => expect(anyPlaylistImages()).toEqual([]))
    expect(screen.getByRole('button', { name: 'Choose image for Gym' })).toBeInTheDocument()
    expect(desktop.saved()[0].imageVersion).toBeNull()
  })

  it('shows an alert and keeps the image when saving fails', async () => {
    const { user, desktop } = await renderApp(library)
    desktop.pickFiles(['/pictures/gym.jpg'])
    await user.click(screen.getByRole('button', { name: 'Choose image for Gym' }))
    await screen.findByRole('button', { name: 'Remove image' })
    desktop.failNext('playlists:remove-image', 'Disk is full.')
    await user.click(screen.getByRole('button', { name: 'Remove image' }))
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Disk is full.'))
    expect(playlistImages('Gym')).toHaveLength(3)
  })
})
