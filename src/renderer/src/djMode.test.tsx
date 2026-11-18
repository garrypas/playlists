import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  djModeButton,
  djStatus,
  djTrack,
  expectPlaying,
  heard,
  player,
  playerButton,
  playTo,
  pressOnTempo,
  queueButton,
  relaunch,
  renderApp,
  songEnds,
  songLoaded,
  tempoSlider,
  type AppHarness,
} from './test/app'
import type { SongSpec } from './test/fakeDesktop'

// "One" is 128 bars at 120 BPM (a bar every 2 s, a 16-bar phrase every 32 s), so its last phrase runs 224–256 s.
const one = { title: 'One', bpm: 120, key: 'Am', durationSeconds: 260, dj: djTrack(120, { bars: 128 }) }
// "Two" is at 122 BPM, a key that blends with Am (Em, a fifth away), with its first kick and phrase at 0.5 s.
const two = { title: 'Two', bpm: 122, key: 'Em', durationSeconds: 300, dj: djTrack(122, { bars: 140, firstBeat: 0.5 }) }
// One played at 98.4% of Two's speed: Two's file time per second of One's.
const twoPerOne = 120 / 122

async function startDj(songs: SongSpec[]): Promise<AppHarness> {
  const app = await renderApp([{ title: 'Set', songs }])
  await app.user.click(djModeButton())
  await app.user.click(playerButton('Play'))
  songLoaded(260)
  return app
}

describe('DJ mode', () => {
  it('is off until turned on', async () => {
    const { user } = await renderApp([{ title: 'Set', songs: [one, two] }])
    expect(djModeButton()).toHaveAttribute('aria-pressed', 'false')
    expect(djStatus()).toBeUndefined()
    await user.click(djModeButton())
    expect(djModeButton()).toHaveAttribute('aria-pressed', 'true')
    await user.click(djModeButton())
    expect(djModeButton()).toHaveAttribute('aria-pressed', 'false')
  })

  it('is still on, and still mixing, the next time the app opens', async () => {
    const set = [{ title: 'Set', songs: [one, two] }]
    const { user } = await renderApp(set)
    await user.click(djModeButton())
    const reopened = await relaunch(set)
    expect(djModeButton()).toHaveAttribute('aria-pressed', 'true')
    expect(tempoSlider()).toHaveAttribute('aria-disabled', 'true')
    await reopened.user.click(playerButton('Play'))
    songLoaded(260)
    await waitFor(() => expect(djStatus()).toBe('DJ: 16-bar blend into Two at 3:44'))
    playTo(224)
    await waitFor(() => expect(djStatus()).toBe('DJ: mixing into Two (16-bar blend)'))
    playTo(232)
    expect(heard()).toMatchObject({ One: { bass: true }, Two: { bass: false } })

    await reopened.user.click(djModeButton())
    await relaunch(set)
    expect(djModeButton()).toHaveAttribute('aria-pressed', 'false')
  })

  it('takes over the tempo control while it’s on, and gives it back after', async () => {
    const { user } = await renderApp([{ title: 'Set', songs: [{ ...one, tempo: 2 }, two] }])
    await user.click(djModeButton())
    expect(tempoSlider()).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Reset tempo' })).toBeDisabled()
    pressOnTempo('End')
    expect(player().speed).toBe(102)
    await user.click(djModeButton())
    expect(tempoSlider()).not.toHaveAttribute('aria-disabled')
    pressOnTempo('End')
    expect(player().speed).toBe(110)
  })

  it('blends the next song in over the last 16 bars, matched in tempo, with the bass swapped halfway', async () => {
    await startDj([one, two])
    await waitFor(() => expect(djStatus()).toBe('DJ: 16-bar blend into Two at 3:44'))

    playTo(200)
    expect(heard()).toEqual({ One: { volume: 100, speed: 100, bass: true } })

    // The blend starts on the last phrase: Two comes in from its first phrase, slowed to 120 BPM, without its bass.
    playTo(224)
    await waitFor(() => expect(djStatus()).toBe('DJ: mixing into Two (16-bar blend)'))
    playTo(232)
    expect(heard()).toEqual({
      One: { volume: 92, speed: 100, bass: true },
      Two: { volume: 38, speed: 98.4, bass: false },
    })

    // Halfway, Two takes over as the playing song and the basslines swap.
    playTo(240)
    await waitFor(() => expectPlaying('Two'))
    expect(player().time).toBeCloseTo(0.5 + 16 * twoPerOne, 6)
    expect(heard()).toMatchObject({ One: { bass: false }, Two: { bass: true, speed: 98.4 } })
    expect(screen.getByText('Two', { selector: '.now-playing strong' })).toBeInTheDocument()
    expect(tempoSlider()).toHaveAttribute('aria-valuetext', '−1.6%, 122.0 (120.0) BPM, key Em')

    // At the end of One's last phrase, it has faded out and stopped.
    playTo(0.5 + 32 * twoPerOne + 0.01)
    await waitFor(() => expect(heard()).toEqual({ Two: { volume: 100, speed: 98.4, bass: true } }))
  })

  it('matches the next song to the tempo the playing song already had', async () => {
    await startDj([{ ...one, tempo: 2 }, two])
    await waitFor(() => expect(djStatus()).toMatch(/^DJ: 16-bar blend into Two/))
    playTo(224)
    await waitFor(() => expect(djStatus()).toMatch(/^DJ: mixing into Two/))
    playTo(228)
    expect(heard().Two?.speed).toBe(100.3)
  })

  it('still blends when the keys clash, over the last 8 bars', async () => {
    const clashing = { ...two, bpm: 120, key: 'F#', dj: djTrack(120, { bars: 140 }) }
    await startDj([one, clashing])
    await waitFor(() => expect(djStatus()).toBe('DJ: 8-bar blend into Two at 4:00'))
    playTo(240)
    await waitFor(() => expect(djStatus()).toMatch(/^DJ: mixing into Two/))
    playTo(248)
    await waitFor(() => expectPlaying('Two'))
    expect(heard()).toMatchObject({ One: { bass: false }, Two: { bass: true } })
  })

  it('filters the song out over its last 4 bars when the tempos can’t be matched, then brings the next one in', async () => {
    const fast = { ...two, bpm: 150, dj: djTrack(150, { bars: 140 }) }
    await startDj([one, fast])
    await waitFor(() => expect(djStatus()).toBe('DJ: Filter fade into Two at 4:08'))
    playTo(247)
    expect(heard()).toEqual({ One: { volume: 100, speed: 100, bass: true } })
    // The high-pass sweeps up, taking One's bass and body away; Two's beat isn't heard yet.
    playTo(252)
    await waitFor(() => expect(heard()).toEqual({ One: { volume: 100, speed: 100, bass: true, filter: 'high-pass' } }))
    playTo(256)
    await waitFor(() => expect(heard()).toEqual({ Two: { volume: 100, speed: 100, bass: true } }))
    expectPlaying('Two')
  })

  it('fades a next song that opens without a beat in under the filtered-out song', async () => {
    const padIntro = { ...two, bpm: 150, dj: { ...djTrack(150, { bars: 140, firstBeat: 20 }), soundStart: 0 } }
    await startDj([one, padIntro])
    await waitFor(() => expect(djStatus()).toBe('DJ: Filter fade into Two at 4:08'))
    playTo(248)
    await waitFor(() => expect(djStatus()).toMatch(/^DJ: mixing into Two/))
    playTo(251)
    // Both play: One with its lows filtering away, Two muffled and opening up, together never louder than one song.
    const mixing = heard()
    expect(mixing).toMatchObject({ One: { filter: 'high-pass' }, Two: { filter: 'low-pass' } })
    expect(mixing.One.volume + mixing.Two.volume).toBeLessThanOrEqual(100)
    playTo(252)
    await waitFor(() => expectPlaying('Two'))
    // Two came in 8 s (4 bars) before One ended.
    playTo(8.1)
    await waitFor(() => expect(heard()).toEqual({ Two: { volume: 100, speed: 100, bass: true } }))
  })

  it('fades quickly into the next song when there’s no beat to match', async () => {
    const { user } = await renderApp([{ title: 'Set', songs: ['One', 'Two'] }])
    await user.click(djModeButton())
    await user.click(playerButton('Play'))
    songLoaded(200)
    await waitFor(() => expect(djStatus()).toBe('DJ: Quick fade into Two at 3:17'))
    // The songs aren't beatmatched, so together they're never louder than one alone, and only one bassline plays.
    playTo(197.75)
    await waitFor(() => expect(heard()).toMatchObject({ One: { volume: 85, bass: true }, Two: { volume: 15, bass: false } }))
    playTo(198.5)
    await waitFor(() => expectPlaying('Two'))
    expect(heard()).toMatchObject({ One: { volume: 50, bass: false }, Two: { volume: 50, bass: true } })
    playTo(3)
    await waitFor(() => expect(Object.keys(heard())).toEqual(['Two']))
  })

  it('mixes into what’s queued next', async () => {
    const three = { ...two, title: 'Three' }
    const { user } = await startDj([one, two, three])
    await user.click(screen.getByRole('button', { name: 'Add Three to queue' }))
    await waitFor(() => expect(djStatus()).toBe('DJ: 16-bar blend into Three at 3:44'))
    playTo(224)
    playTo(240)
    await waitFor(() => expectPlaying('Three'))
    expect(queueButton()).toHaveAccessibleName('Queue')
  })

  it('stops the incoming song when paused mid-mix, then plans a shorter mix from there', async () => {
    const { user } = await startDj([one, two])
    await waitFor(() => expect(djStatus()).toMatch(/^DJ: 16-bar blend/))
    playTo(224)
    await waitFor(() => expect(djStatus()).toMatch(/^DJ: mixing into Two/))
    playTo(228)
    expect(heard().Two).toBeDefined()
    playTo(230)
    await user.click(playerButton('Pause'))
    expect(heard()).toEqual({})
    await user.click(playerButton('Play'))
    expect(Object.keys(heard())).toEqual(['One'])
    await waitFor(() => expect(djStatus()).toBe('DJ: 8-bar blend into Two at 4:00'))
  })

  it('jumps straight to the next song when skipped mid-mix', async () => {
    const { user } = await startDj([one, two])
    await waitFor(() => expect(djStatus()).toMatch(/^DJ: 16-bar blend/))
    playTo(224)
    await waitFor(() => expect(djStatus()).toMatch(/^DJ: mixing into Two/))
    playTo(228)
    expect(heard().Two).toBeDefined()
    await user.click(playerButton('Next'))
    expect(player()).toMatchObject({ song: 'Two', playing: true, time: 0 })
    expect(Object.keys(heard())).toEqual(['Two'])
  })

  it('stops the mix and gives songs back their own tempo when turned off mid-mix', async () => {
    const { user } = await startDj([one, two])
    await waitFor(() => expect(djStatus()).toMatch(/^DJ: 16-bar blend/))
    playTo(240)
    await waitFor(() => expectPlaying('Two'))
    await user.click(djModeButton())
    expect(heard()).toEqual({ Two: { volume: 100, speed: 100, bass: true } })
  })

  it('plays the last song out with nothing to mix into', async () => {
    await startDj([one])
    expect(djStatus()).toBe('DJ: nothing to mix into after this song')
    songEnds()
    expect(player().playing).toBe(false)
  })

  it('waits for a song’s beat details if they’re still being found', async () => {
    const { desktop } = await startDj([one, { ...two, dj: undefined }])
    await waitFor(() => expect(djStatus()).toBe('DJ: Filter fade into Two at 4:08'))
    desktop.djDetailsFound('Two', two.dj)
    await waitFor(() => expect(djStatus()).toBe('DJ: 16-bar blend into Two at 3:44'))
  })
})
