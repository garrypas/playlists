import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openPlaylistDatabase, type PlaylistDatabase } from './playlistDatabase'

let userData: string
let db: PlaylistDatabase

beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'playlists-test-'))
  db = await openPlaylistDatabase(userData)
})

afterEach(() => {
  db.close()
  rmSync(userData, { recursive: true, force: true })
})

function titles(): string[] {
  return db.list().map((playlist) => playlist.title)
}

async function reopen(): Promise<void> {
  db.close()
  db = await openPlaylistDatabase(userData)
}

describe('starter playlists', () => {
  it('gives a new user four empty starter playlists', () => {
    expect(titles()).toEqual(['Late night drive', 'Soft focus', 'Sunday, slowly', 'On repeat'])
    expect(db.list().every((playlist) => playlist.tracks.length === 0)).toBe(true)
  })

  it('does not bring starter playlists back after the user deletes them', async () => {
    for (const playlist of db.list()) db.remove(playlist.id)
    await reopen()
    expect(titles()).toEqual([])
  })
})

describe('creating playlists', () => {
  it('adds the playlist to the end of the list and returns the full list', () => {
    const updated = db.create({ title: 'Road trip', description: 'Windows down' })
    expect(updated.at(-1)).toMatchObject({ title: 'Road trip', description: 'Windows down', tracks: [] })
    expect(updated).toEqual(db.list())
  })

  it('trims the name and description', () => {
    const created = db.create({ title: '  Road trip  ', description: '  Windows down  ' }).at(-1)
    expect(created).toMatchObject({ title: 'Road trip', description: 'Windows down' })
  })

  it.each(['', '   ', 'x'.repeat(101)])('rejects the name %j', (title) => {
    expect(() => db.create({ title })).toThrow('Playlist names must be 1–100 characters.')
    expect(titles()).toHaveLength(4)
  })

  it('accepts a 100-character name', () => {
    expect(db.create({ title: 'x'.repeat(100) }).at(-1)?.title).toBe('x'.repeat(100))
  })

  it('rejects descriptions over 500 characters', () => {
    expect(() => db.create({ title: 'Long', description: 'x'.repeat(501) })).toThrow('500 characters or fewer')
  })
})

describe('renaming playlists', () => {
  it('changes only that playlist', () => {
    const [first, second] = db.list()
    const updated = db.rename(first.id, 'Night moves')
    expect(updated.find((playlist) => playlist.id === first.id)?.title).toBe('Night moves')
    expect(updated.find((playlist) => playlist.id === second.id)?.title).toBe(second.title)
  })

  it('applies the same name rules as creating', () => {
    expect(() => db.rename(db.list()[0].id, ' ')).toThrow('Playlist names must be 1–100 characters.')
  })

  it('reports a playlist that no longer exists', () => {
    expect(() => db.rename(9999, 'Ghost')).toThrow('Playlist not found.')
  })
})

describe('deleting playlists', () => {
  it('removes the playlist and its songs', () => {
    const playlist = db.list()[0]
    db.addAudioFiles(playlist.id, ['/music/a.mp3'])
    const trackId = db.list()[0].tracks[0].id
    const updated = db.remove(playlist.id)
    expect(updated.map((item) => item.id)).not.toContain(playlist.id)
    expect(db.getTrackFilePath(trackId)).toBeUndefined()
  })
})

describe('songs', () => {
  it('adds songs in the order chosen, named after their files', () => {
    const playlist = db.list()[0]
    const tracks = db.addAudioFiles(playlist.id, ['/music/First Song.mp3', '/music/second.flac'])[0].tracks
    expect(tracks.map((track) => track.title)).toEqual(['First Song', 'second'])
    expect(tracks[0]).toMatchObject({ filePath: '/music/First Song.mp3', artist: 'Unknown artist', album: '', durationSeconds: null })
  })

  it('adds new songs after the existing ones', () => {
    const playlist = db.list()[0]
    db.addAudioFiles(playlist.id, ['/music/a.mp3'])
    const tracks = db.addAudioFiles(playlist.id, ['/music/b.mp3'])[0].tracks
    expect(tracks.map((track) => track.title)).toEqual(['a', 'b'])
  })

  it('ignores a file that is already in the playlist', () => {
    const playlist = db.list()[0]
    db.addAudioFiles(playlist.id, ['/music/a.mp3'])
    expect(db.addAudioFiles(playlist.id, ['/music/a.mp3'])[0].tracks).toHaveLength(1)
  })

  it('allows the same file in different playlists', () => {
    const [first, second] = db.list()
    db.addAudioFiles(first.id, ['/music/a.mp3'])
    const updated = db.addAudioFiles(second.id, ['/music/a.mp3'])
    expect(updated[0].tracks).toHaveLength(1)
    expect(updated[1].tracks).toHaveLength(1)
  })

  it('names a file with a blank name "Untitled track"', () => {
    const playlist = db.list()[0]
    expect(db.addAudioFiles(playlist.id, ['/music/ .mp3'])[0].tracks[0].title).toBe('Untitled track')
  })

  it('removes a song from its playlist only', () => {
    const [first, second] = db.list()
    db.addAudioFiles(first.id, ['/music/a.mp3', '/music/b.mp3'])
    db.addAudioFiles(second.id, ['/music/a.mp3'])
    const songA = db.list()[0].tracks[0]
    const updated = db.removeTrack(first.id, songA.id)
    expect(updated[0].tracks.map((track) => track.title)).toEqual(['b'])
    expect(updated[1].tracks.map((track) => track.title)).toEqual(['a'])
  })

  it('does not remove a song through a different playlist', () => {
    const [first, second] = db.list()
    db.addAudioFiles(first.id, ['/music/a.mp3'])
    const song = db.list()[0].tracks[0]
    expect(db.removeTrack(second.id, song.id)[0].tracks).toHaveLength(1)
  })

  it('looks up the file for a saved song, and nothing for unknown songs', () => {
    const playlist = db.list()[0]
    const song = db.addAudioFiles(playlist.id, ['/music/a.mp3'])[0].tracks[0]
    expect(db.getTrackFilePath(song.id)).toBe('/music/a.mp3')
    expect(db.getTrackFilePath(9999)).toBeUndefined()
  })

  it('rejects songs for a playlist that does not exist', () => {
    expect(() => db.addAudioFiles(9999, ['/music/a.mp3'])).toThrow('Playlist not found.')
  })
})

describe('saving', () => {
  it('keeps every change after the app restarts', async () => {
    const [first, second] = db.list()
    db.create({ title: 'Road trip' })
    db.rename(first.id, 'Night moves')
    db.remove(second.id)
    db.addAudioFiles(first.id, ['/music/a.mp3'])
    const before = db.list()
    await reopen()
    expect(db.list()).toEqual(before)
  })
})
