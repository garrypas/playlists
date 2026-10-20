import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
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
    expect(tracks[0]).toMatchObject({
      filePath: '/music/First Song.mp3',
      artist: 'Unknown artist',
      album: '',
      durationSeconds: null,
    })
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

describe('adding a saved song to another playlist', () => {
  it('copies the song to the end of the other playlist and keeps it in the first', async () => {
    const [first, second] = db.list()
    db.addAudioFiles(first.id, ['/music/a.mp3'])
    db.addAudioFiles(second.id, ['/music/b.mp3'])
    const song = db.list()[0].tracks[0]
    db.addTrack(second.id, song.id)
    await reopen()
    const [savedFirst, savedSecond] = db.list()
    expect(savedFirst.tracks.map((track) => track.title)).toEqual(['a'])
    expect(savedSecond.tracks.map((track) => track.title)).toEqual(['b', 'a'])
    expect(savedSecond.tracks[1].filePath).toBe('/music/a.mp3')
  })

  it('does not add the song twice to a playlist that already has it', () => {
    const [first, second] = db.list()
    db.addAudioFiles(first.id, ['/music/a.mp3'])
    db.addAudioFiles(second.id, ['/music/a.mp3'])
    const song = db.list()[0].tracks[0]
    expect(db.addTrack(second.id, song.id)[1].tracks).toHaveLength(1)
  })

  it('rejects a song that does not exist', () => {
    const playlist = db.list()[0]
    expect(() => db.addTrack(playlist.id, 9999)).toThrow('Song not found.')
    expect(db.list()[0].tracks).toHaveLength(0)
  })

  it('rejects a playlist that does not exist', () => {
    const playlist = db.list()[0]
    const song = db.addAudioFiles(playlist.id, ['/music/a.mp3'])[0].tracks[0]
    expect(() => db.addTrack(9999, song.id)).toThrow('Playlist not found.')
  })
})

describe('reordering songs', () => {
  function songTitles(playlistIndex = 0): string[] {
    return db.list()[playlistIndex].tracks.map((track) => track.title)
  }

  function addSongs(): { playlistId: number; idOf: (title: string) => number } {
    const playlist = db.list()[0]
    const tracks = db.addAudioFiles(playlist.id, ['/music/a.mp3', '/music/b.mp3', '/music/c.mp3', '/music/d.mp3'])[0]
      .tracks
    return { playlistId: playlist.id, idOf: (title) => tracks.find((track) => track.title === title)!.id }
  }

  it('moves a song down, returning the full list in the new order', () => {
    const { playlistId, idOf } = addSongs()
    const updated = db.moveTrack(playlistId, idOf('a'), 2)
    expect(updated[0].tracks.map((track) => track.title)).toEqual(['b', 'c', 'a', 'd'])
    expect(updated).toEqual(db.list())
  })

  it('moves a song up', () => {
    const { playlistId, idOf } = addSongs()
    db.moveTrack(playlistId, idOf('d'), 0)
    expect(songTitles()).toEqual(['d', 'a', 'b', 'c'])
  })

  it('moves a song asked to go past the end to the end', () => {
    const { playlistId, idOf } = addSongs()
    db.moveTrack(playlistId, idOf('b'), 99)
    expect(songTitles()).toEqual(['a', 'c', 'd', 'b'])
  })

  it('keeps the new order after the app restarts', async () => {
    const { playlistId, idOf } = addSongs()
    db.moveTrack(playlistId, idOf('c'), 0)
    await reopen()
    expect(songTitles()).toEqual(['c', 'a', 'b', 'd'])
  })

  it('still adds new songs at the end after a reorder', () => {
    const { playlistId, idOf } = addSongs()
    db.moveTrack(playlistId, idOf('d'), 0)
    db.addAudioFiles(playlistId, ['/music/e.mp3'])
    expect(songTitles()).toEqual(['d', 'a', 'b', 'c', 'e'])
  })

  it('does not move a song through a different playlist', () => {
    const { idOf } = addSongs()
    const other = db.list()[1]
    db.addAudioFiles(other.id, ['/music/x.mp3'])
    expect(() => db.moveTrack(other.id, idOf('a'), 0)).toThrow('Song not found.')
    expect(songTitles()).toEqual(['a', 'b', 'c', 'd'])
    expect(songTitles(1)).toEqual(['x'])
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

describe('song details from tags', () => {
  const tags = new Map([
    [
      '/music/a.mp3',
      { title: 'Nightcall', artist: 'Kavinsky', album: 'OutRun', albumArtist: 'Kavinsky', trackNumber: 3, discNumber: 1, durationSeconds: 258 },
    ],
  ])

  it('saves what the tags say, and falls back to the file name for the rest', () => {
    const playlist = db.list()[0]
    const [tagged, plain] = db.addAudioFiles(playlist.id, ['/music/a.mp3', '/music/b.mp3'], tags)[0].tracks
    expect(tagged).toMatchObject({
      title: 'Nightcall',
      artist: 'Kavinsky',
      album: 'OutRun',
      albumArtist: 'Kavinsky',
      trackNumber: 3,
      discNumber: 1,
      durationSeconds: 258,
    })
    expect(plain).toMatchObject({ title: 'b', artist: 'Unknown artist', album: '', albumArtist: '', trackNumber: null })
  })

  it('copies the details when a song is added to another playlist', () => {
    const [first, second] = db.list()
    const song = db.addAudioFiles(first.id, ['/music/a.mp3'], tags)[0].tracks[0]
    const copy = db.addTrack(second.id, song.id)[1].tracks[0]
    expect(copy).toMatchObject({ title: 'Nightcall', album: 'OutRun', trackNumber: 3, durationSeconds: 258 })
  })

  it('updates every copy of a file once its tags are read, and stops asking for them', () => {
    const [first, second] = db.list()
    db.addAudioFiles(first.id, ['/music/a.mp3', '/music/b.mp3'])
    db.addAudioFiles(second.id, ['/music/a.mp3'])
    expect(db.filesNeedingTags()).toEqual(['/music/a.mp3', '/music/b.mp3'])
    db.saveTags(tags)
    const updated = db.list()
    expect(updated[0].tracks[0].title).toBe('Nightcall')
    expect(updated[1].tracks[0].title).toBe('Nightcall')
    expect(db.filesNeedingTags()).toEqual(['/music/b.mp3'])
  })

  it('upgrades a database saved by an older version, keeping its songs', async () => {
    db.close()
    rmSync(userData, { recursive: true, force: true })
    userData = mkdtempSync(join(tmpdir(), 'playlists-test-'))
    const SQL = await initSqlJs()
    const old = new SQL.Database()
    old.run(`
      CREATE TABLE playlists (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '', gradient TEXT NOT NULL DEFAULT 'sage', icon TEXT NOT NULL DEFAULT '♫',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE playlist_tracks (id INTEGER PRIMARY KEY AUTOINCREMENT,
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE, file_path TEXT NOT NULL,
        title TEXT NOT NULL, artist TEXT NOT NULL DEFAULT 'Unknown artist', album TEXT NOT NULL DEFAULT '',
        duration_seconds INTEGER, position INTEGER NOT NULL, added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (playlist_id, file_path));
      CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO app_meta VALUES ('starter_playlists_seeded', '1');
      INSERT INTO playlists (title) VALUES ('Old favourites');
      INSERT INTO playlist_tracks (playlist_id, file_path, title, position) VALUES (1, '/music/old.mp3', 'old', 0);
    `)
    writeFileSync(join(userData, 'playlists.sqlite3'), old.export())
    db = await openPlaylistDatabase(userData)
    expect(db.list()[0]).toMatchObject({ title: 'Old favourites' })
    expect(db.list()[0].tracks[0]).toMatchObject({ title: 'old', albumArtist: '', trackNumber: null, discNumber: null })
    expect(db.filesNeedingTags()).toEqual(['/music/old.mp3'])
    expect(db.list()[0].tracks[0].bpm).toBeNull()
    expect(db.filesNeedingTempo()).toEqual(['/music/old.mp3'])
    expect(db.list()[0].tracks[0].key).toBeNull()
    expect(db.filesNeedingKey()).toEqual(['/music/old.mp3'])
    // Playlists keep their creation order, and new ones go after them.
    db.create({ title: 'Newer' })
    expect(titles()).toEqual(['Old favourites', 'Newer'])
  })
})

describe('song tempo', () => {
  it('has no tempo until one is detected, then saves it on every copy of the file', async () => {
    const [first, second] = db.list()
    db.addAudioFiles(first.id, ['/music/a.mp3', '/music/b.mp3'])
    db.addAudioFiles(second.id, ['/music/a.mp3'])
    expect(db.list()[0].tracks.map((track) => track.bpm)).toEqual([null, null])
    expect(db.filesNeedingTempo()).toEqual(['/music/a.mp3', '/music/b.mp3'])
    db.saveTempo('/music/a.mp3', 124.5)
    await reopen()
    expect(db.list()[0].tracks.map((track) => track.bpm)).toEqual([124.5, null])
    expect(db.list()[1].tracks[0].bpm).toBe(124.5)
    expect(db.filesNeedingTempo()).toEqual(['/music/b.mp3'])
  })

  it('stops asking for the tempo of a song with no steady beat', () => {
    const playlist = db.list()[0]
    db.addAudioFiles(playlist.id, ['/music/ambient.mp3'])
    db.saveTempo('/music/ambient.mp3', undefined)
    expect(db.list()[0].tracks[0].bpm).toBeNull()
    expect(db.filesNeedingTempo()).toEqual([])
  })

  it('tries again, once, for songs an older version found no tempo for', async () => {
    db.close()
    const SQL = await initSqlJs()
    const old = new SQL.Database(readFileSync(join(userData, 'playlists.sqlite3')))
    old.run(`
      INSERT INTO playlist_tracks (playlist_id, file_path, title, position, bpm, tempo_read)
        VALUES (1, '/music/long-intro.mp3', 'long intro', 0, NULL, 1), (1, '/music/found.mp3', 'found', 1, 128, 1);
      DELETE FROM app_meta WHERE key = 'tempo_detector';
    `)
    writeFileSync(join(userData, 'playlists.sqlite3'), old.export())
    db = await openPlaylistDatabase(userData)
    expect(db.filesNeedingTempo()).toEqual(['/music/long-intro.mp3'])
    db.saveTempo('/music/long-intro.mp3', undefined)
    await reopen()
    expect(db.filesNeedingTempo()).toEqual([])
    expect(db.list()[0].tracks.map((track) => track.bpm)).toEqual([null, 128])
  })

  it('keeps the tempo when a song is added to another playlist, without detecting it again', () => {
    const [first, second, third] = db.list()
    const song = db.addAudioFiles(first.id, ['/music/a.mp3'])[0].tracks[0]
    db.saveTempo('/music/a.mp3', 128)
    expect(db.addTrack(second.id, song.id)[1].tracks[0].bpm).toBe(128)
    expect(db.addAudioFiles(third.id, ['/music/a.mp3'])[2].tracks[0].bpm).toBe(128)
    expect(db.filesNeedingTempo()).toEqual([])
  })
})

describe('song tempo change', () => {
  it('starts every song at normal speed, and keeps a change to one song after a restart', async () => {
    const playlist = db.list()[0]
    db.addAudioFiles(playlist.id, ['/music/a.mp3', '/music/b.mp3'])
    expect(db.list()[0].tracks.map((track) => track.tempo)).toEqual([0, 0])
    db.setTrackTempo(db.list()[0].tracks[0].id, 2.5)
    await reopen()
    expect(db.list()[0].tracks.map((track) => track.tempo)).toEqual([2.5, 0])
  })

  it('keeps each playlist’s tempo for a song separate, and starts a copied song at normal speed', () => {
    const [first, second, third] = db.list()
    const song = db.addAudioFiles(first.id, ['/music/a.mp3'])[0].tracks[0]
    db.setTrackTempo(song.id, -4)
    expect(db.addTrack(second.id, song.id)[1].tracks[0].tempo).toBe(0)
    expect(db.addAudioFiles(third.id, ['/music/a.mp3'])[2].tracks[0].tempo).toBe(0)
    expect(db.list()[0].tracks[0].tempo).toBe(-4)
  })

  it('rounds to 0.1% and goes back to normal speed', () => {
    const song = db.addAudioFiles(db.list()[0].id, ['/music/a.mp3'])[0].tracks[0]
    expect(db.setTrackTempo(song.id, 1.2345)[0].tracks[0].tempo).toBe(1.2)
    expect(db.setTrackTempo(song.id, 0)[0].tracks[0].tempo).toBe(0)
  })

  it('refuses tempos beyond ±10% and songs that don’t exist', () => {
    const song = db.addAudioFiles(db.list()[0].id, ['/music/a.mp3'])[0].tracks[0]
    expect(() => db.setTrackTempo(song.id, 10.1)).toThrow('Invalid tempo.')
    expect(() => db.setTrackTempo(song.id, Number.NaN)).toThrow('Invalid tempo.')
    expect(() => db.setTrackTempo(9999, 1)).toThrow('Song not found.')
    expect(db.list()[0].tracks[0].tempo).toBe(0)
  })
})

describe('song key', () => {
  it('has no key until one is found, then saves it on every copy of the file', async () => {
    const [first, second] = db.list()
    db.addAudioFiles(first.id, ['/music/a.mp3', '/music/b.mp3'])
    db.addAudioFiles(second.id, ['/music/a.mp3'])
    expect(db.list()[0].tracks.map((track) => track.key)).toEqual([null, null])
    expect(db.filesNeedingKey()).toEqual(['/music/a.mp3', '/music/b.mp3'])
    db.saveKey('/music/a.mp3', 'Ebm')
    await reopen()
    expect(db.list()[0].tracks.map((track) => track.key)).toEqual(['Ebm', null])
    expect(db.list()[1].tracks[0].key).toBe('Ebm')
    expect(db.filesNeedingKey()).toEqual(['/music/b.mp3'])
  })

  it('stops asking for the key of a song no key fits', () => {
    const playlist = db.list()[0]
    db.addAudioFiles(playlist.id, ['/music/drums.mp3'])
    db.saveKey('/music/drums.mp3', undefined)
    expect(db.list()[0].tracks[0].key).toBeNull()
    expect(db.filesNeedingKey()).toEqual([])
  })

  it('keeps the key when a song is added to another playlist, without finding it again', () => {
    const [first, second, third] = db.list()
    const song = db.addAudioFiles(first.id, ['/music/a.mp3'])[0].tracks[0]
    db.saveKey('/music/a.mp3', 'F#')
    expect(db.addTrack(second.id, song.id)[1].tracks[0].key).toBe('F#')
    expect(db.addAudioFiles(third.id, ['/music/a.mp3'])[2].tracks[0].key).toBe('F#')
    expect(db.filesNeedingKey()).toEqual([])
  })

  it('finds tempo and key separately', () => {
    const playlist = db.list()[0]
    db.addAudioFiles(playlist.id, ['/music/a.mp3'])
    db.saveTempo('/music/a.mp3', 120)
    expect(db.filesNeedingKey()).toEqual(['/music/a.mp3'])
    expect(db.list()[0].tracks[0]).toMatchObject({ bpm: 120, key: null })
  })
})

describe('ordering playlists', () => {
  it('moves a playlist down, up, and to either end, and keeps the order after a restart', async () => {
    const id = (title: string): number => db.list().find((playlist) => playlist.title === title)!.id
    db.movePlaylist(id('Late night drive'), 2)
    expect(titles()).toEqual(['Soft focus', 'Sunday, slowly', 'Late night drive', 'On repeat'])
    db.movePlaylist(id('On repeat'), 0)
    expect(titles()).toEqual(['On repeat', 'Soft focus', 'Sunday, slowly', 'Late night drive'])
    db.movePlaylist(id('Soft focus'), 99)
    expect(titles()).toEqual(['On repeat', 'Sunday, slowly', 'Late night drive', 'Soft focus'])
    await reopen()
    expect(titles()).toEqual(['On repeat', 'Sunday, slowly', 'Late night drive', 'Soft focus'])
  })

  it('adds new playlists at the end of the current order', () => {
    db.movePlaylist(db.list()[3].id, 0)
    expect(db.create({ title: 'Road trip' }).at(-1)?.title).toBe('Road trip')
  })

  it('keeps the order when a playlist is deleted', () => {
    db.movePlaylist(db.list()[3].id, 0)
    db.remove(db.list()[1].id)
    expect(titles()).toEqual(['On repeat', 'Soft focus', 'Sunday, slowly'])
  })

  it('reports a playlist that no longer exists, or a bad position', () => {
    expect(() => db.movePlaylist(9999, 0)).toThrow('Playlist not found.')
    expect(() => db.movePlaylist(db.list()[0].id, -1)).toThrow('Invalid playlist position.')
  })
})
