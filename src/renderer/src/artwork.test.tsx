import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { artworkButton, expectPlaying, player, playerButton, renderApp, songButton } from './test/app'

const library = [{ title: 'Mix', songs: ['One', 'Two', 'Three'] }]

function artworkImages(trackId: number): HTMLImageElement[] {
  return [...document.querySelectorAll<HTMLImageElement>(`img[src="playlist-audio://artwork/${trackId}"]`)]
}

describe('song artwork', () => {
  it("requests each song's embedded cover", async () => {
    const { desktop } = await renderApp(library)
    for (const song of ['One', 'Two', 'Three']) expect(artworkImages(desktop.idOf(song)).length).toBeGreaterThan(0)
  })

  it('keeps the cover once it loads', async () => {
    const { desktop } = await renderApp(library)
    const [image] = artworkImages(desktop.idOf('Two'))
    fireEvent.load(image)
    expect(image).toBeInTheDocument()
  })

  it('falls back to the placeholder, with no broken image, when a song has no cover', async () => {
    const { desktop } = await renderApp(library)
    const [image] = artworkImages(desktop.idOf('Two'))
    fireEvent.error(image)
    expect(image).not.toBeInTheDocument()
  })

  it('looks for the new song’s cover when the player moves on from a song without one', async () => {
    const { user, desktop } = await renderApp(library)
    for (const image of artworkImages(desktop.idOf('One'))) fireEvent.error(image)
    await user.click(playerButton('Next'))
    expect(artworkImages(desktop.idOf('Two')).length).toBe(2)
  })
})

describe('playing from the artwork', () => {
  it('plays the song when its artwork is clicked', async () => {
    const { user } = await renderApp(library)
    await user.click(artworkButton('Three'))
    expectPlaying('Three')
  })

  it('pauses and resumes the current song instead of restarting it', async () => {
    const { user } = await renderApp(library)
    await user.click(songButton('Two'))
    await user.click(artworkButton('Two'))
    expect(player()).toMatchObject({ song: 'Two', playing: false })
    await user.click(artworkButton('Two'))
    expectPlaying('Two')
  })

  it('stays out of the keyboard tab order, since the numbered play button does the same job', async () => {
    await renderApp(library)
    expect(artworkButton('One')).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('button', { name: 'Play One' })).not.toHaveAttribute('tabindex', '-1')
  })
})
