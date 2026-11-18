import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import initSqlJs from 'sql.js'
import type { Database as SqlDatabase, SqlValue } from 'sql.js'
import { MAX_TEMPO_CHANGE, type CreatePlaylistInput, type Playlist, type PlaylistTrack } from '../shared/playlist'
import type { DjDetails } from '../shared/djDetails'
import type { TrackTags } from './trackMetadata'
import type { RhythmAnalysis } from './trackRhythm'

const starterPlaylists = [
  { title: 'Late night drive', description: 'For the long way home.', gradient: 'sunset', icon: '◒' },
  { title: 'Soft focus', description: 'A little room to think.', gradient: 'sage', icon: '✳' },
  { title: 'Sunday, slowly', description: 'No plans, no rush.', gradient: 'blue', icon: '☼' },
  { title: 'On repeat', description: 'The ones that stayed.', gradient: 'rose', icon: '↗' },
]

export class PlaylistDatabase {
  private constructor(
    private readonly db: SqlDatabase,
    private readonly filePath: string,
  ) {}

  static async open(filePath: string): Promise<PlaylistDatabase> {
    const sqlJs = await initSqlJs({
      locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
    })
    const bytes = existsSync(filePath) ? readFileSync(filePath) : undefined
    const store = new PlaylistDatabase(new sqlJs.Database(bytes), filePath)
    store.db.run('PRAGMA foreign_keys = ON')
    store.initializeSchema()
    store.migrateSchema()
    store.retryMissingTempos()
    store.redetectRhythm()
    store.removeOrphanedTracks()
    store.seedStarterPlaylists()
    store.persist()
    return store
  }

  list(): Playlist[] {
    const playlists = this.query<Omit<Playlist, 'tracks'>>(
      'SELECT id, title, description, gradient, icon FROM playlists ORDER BY position, id',
    )
    return playlists.map((playlist) => ({
      ...playlist,
      tracks: this.query<PlaylistTrack>(
        `
        SELECT id, file_path AS filePath, title, artist, album, album_artist AS albumArtist,
          track_number AS trackNumber, disc_number AS discNumber, duration_seconds AS durationSeconds, bpm,
          musical_key AS key, tempo_change AS tempo, position
        FROM playlist_tracks WHERE playlist_id = ? ORDER BY position, id
      `,
        [playlist.id],
      ),
    }))
  }

  create(input: CreatePlaylistInput): Playlist[] {
    this.run(`INSERT INTO playlists (title, description, position) VALUES (?, ?, ${nextPlaylistPosition})`, [
      this.cleanTitle(input.title),
      this.cleanDescription(input.description),
    ])
    this.persist()
    return this.list()
  }

  rename(id: number, title: string): Playlist[] {
    this.run('UPDATE playlists SET title = ? WHERE id = ?', [this.cleanTitle(title), this.requirePlaylist(id)])
    this.persist()
    return this.list()
  }

  remove(id: number): Playlist[] {
    this.run('DELETE FROM playlists WHERE id = ?', [this.requirePlaylist(id)])
    this.persist()
    return this.list()
  }

  // Adds files to the end of a playlist, using their tags where `tags` has them and the file name otherwise.
  // A file already saved in another playlist keeps the tempo, key and DJ details found for it there.
  addAudioFiles(id: number, filePaths: string[], tags: Map<string, TrackTags> = new Map()): Playlist[] {
    const playlistId = this.requirePlaylist(id)
    this.db.run('BEGIN')
    try {
      for (const filePath of filePaths) {
        const song = songDetails(filePath, tags.get(filePath))
        this.run(
          `
          INSERT OR IGNORE INTO playlist_tracks (playlist_id, file_path, title, artist, album, album_artist,
            track_number, disc_number, duration_seconds, tags_read, bpm, tempo_read, musical_key, key_read, dj_details,
            dj_read, position)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            (SELECT bpm FROM playlist_tracks WHERE file_path = ? AND tempo_read = 1 LIMIT 1),
            EXISTS (SELECT 1 FROM playlist_tracks WHERE file_path = ? AND tempo_read = 1),
            (SELECT musical_key FROM playlist_tracks WHERE file_path = ? AND key_read = 1 LIMIT 1),
            EXISTS (SELECT 1 FROM playlist_tracks WHERE file_path = ? AND key_read = 1),
            (SELECT dj_details FROM playlist_tracks WHERE file_path = ? AND dj_read = 1 LIMIT 1),
            EXISTS (SELECT 1 FROM playlist_tracks WHERE file_path = ? AND dj_read = 1),
            (SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_tracks WHERE playlist_id = ?))
        `,
          [
            playlistId,
            filePath,
            ...song,
            tags.has(filePath) ? 1 : 0,
            ...[filePath, filePath, filePath, filePath, filePath, filePath],
            playlistId,
          ],
        )
      }
      this.db.run('COMMIT')
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
    this.persist()
    return this.list()
  }

  // Copies a saved song (by its ID, never a path from the window) to the end of another playlist.
  // A song already in that playlist isn't added twice.
  addTrack(playlistId: number, trackId: number): Playlist[] {
    this.requirePlaylist(playlistId)
    if (!Number.isSafeInteger(trackId) || trackId < 1) throw new Error('Invalid track ID.')
    if (this.getTrackFilePath(trackId) === undefined) throw new Error('Song not found.')
    this.run(
      `
      INSERT OR IGNORE INTO playlist_tracks (playlist_id, file_path, title, artist, album, album_artist,
        track_number, disc_number, duration_seconds, tags_read, bpm, tempo_read, musical_key, key_read, dj_details,
        dj_read, position)
      SELECT ?, file_path, title, artist, album, album_artist, track_number, disc_number, duration_seconds, tags_read,
        bpm, tempo_read, musical_key, key_read, dj_details, dj_read,
        (SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_tracks WHERE playlist_id = ?)
      FROM playlist_tracks WHERE id = ?
    `,
      [playlistId, playlistId, trackId],
    )
    this.persist()
    return this.list()
  }

  /** Saved files whose tags haven't been read yet (added before tags were read, or unreadable last time). */
  filesNeedingTags(): string[] {
    return this.query<{ filePath: string }>(
      'SELECT DISTINCT file_path AS filePath FROM playlist_tracks WHERE tags_read = 0 ORDER BY file_path',
    ).map((row) => row.filePath)
  }

  // Updates every copy of each file with what its tags say.
  saveTags(tags: Map<string, TrackTags>): void {
    if (tags.size === 0) return
    this.db.run('BEGIN')
    try {
      for (const [filePath, fileTags] of tags) {
        this.run(
          `
          UPDATE playlist_tracks SET title = ?, artist = ?, album = ?, album_artist = ?, track_number = ?,
            disc_number = ?, duration_seconds = ?, tags_read = 1
          WHERE file_path = ?
        `,
          [...songDetails(filePath, fileTags), filePath],
        )
      }
      this.db.run('COMMIT')
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
    this.persist()
  }

  /**
   * Saved files whose tempo or DJ details haven't been found yet (just added, saved by an older version, or unreadable
   * last time), each once however many playlists it's in.
   */
  filesNeedingRhythm(): string[] {
    return this.query<{ filePath: string }>(
      `SELECT file_path AS filePath FROM playlist_tracks WHERE tempo_read = 0 OR dj_read = 0
      GROUP BY file_path ORDER BY MIN(id)`,
    ).map((row) => row.filePath)
  }

  // Saves a file's tempo (undefined: it has no steady beat) and DJ details on every copy of it.
  saveRhythm(filePath: string, { bpm, dj }: RhythmAnalysis): void {
    this.run('UPDATE playlist_tracks SET bpm = ?, tempo_read = 1, dj_details = ?, dj_read = 1 WHERE file_path = ?', [
      bpm ?? null,
      JSON.stringify(dj),
      filePath,
    ])
    this.persist()
  }

  /** What a DJ needs to mix a saved song (shared by every copy of its file), or null until it's been found. */
  getDjDetails(trackId: number): DjDetails | null {
    const saved = this.query<{ details: string | null }>(
      'SELECT dj_details AS details FROM playlist_tracks WHERE id = ?',
      [trackId],
    )[0]?.details
    return saved ? (JSON.parse(saved) as DjDetails) : null
  }

  /** Saved files whose key hasn't been found yet (just added, or unreadable last time). */
  filesNeedingKey(): string[] {
    return this.query<{ filePath: string }>(
      'SELECT file_path AS filePath FROM playlist_tracks WHERE key_read = 0 GROUP BY file_path ORDER BY MIN(id)',
    ).map((row) => row.filePath)
  }

  // Saves a file's key (undefined: no key fits it) on every copy of it.
  saveKey(filePath: string, key: string | undefined): void {
    this.run('UPDATE playlist_tracks SET musical_key = ?, key_read = 1 WHERE file_path = ?', [key ?? null, filePath])
    this.persist()
  }

  // Sets how much faster or slower (in percent, to 0.1) one song plays in its playlist. Other copies keep theirs.
  setTrackTempo(trackId: number, percent: number): Playlist[] {
    if (!Number.isSafeInteger(trackId) || trackId < 1) throw new Error('Invalid track ID.')
    if (!Number.isFinite(percent) || Math.abs(percent) > MAX_TEMPO_CHANGE) throw new Error('Invalid tempo.')
    if (this.getTrackFilePath(trackId) === undefined) throw new Error('Song not found.')
    this.run('UPDATE playlist_tracks SET tempo_change = ? WHERE id = ?', [Math.round(percent * 10) / 10 || 0, trackId])
    this.persist()
    return this.list()
  }

  // Moves a playlist to `toIndex` in the list (clamped to the end) and renumbers every playlist's position.
  movePlaylist(id: number, toIndex: number): Playlist[] {
    const playlistId = this.requirePlaylist(id)
    if (!Number.isSafeInteger(toIndex) || toIndex < 0) throw new Error('Invalid playlist position.')
    const ids = this.query<{ id: number }>('SELECT id FROM playlists ORDER BY position, id').map((row) => row.id)
    ids.splice(ids.indexOf(playlistId), 1)
    ids.splice(Math.min(toIndex, ids.length), 0, playlistId)
    this.db.run('BEGIN')
    try {
      ids.forEach((item, position) => this.run('UPDATE playlists SET position = ? WHERE id = ?', [position, item]))
      this.db.run('COMMIT')
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
    this.persist()
    return this.list()
  }

  removeTrack(playlistId: number, trackId: number): Playlist[] {
    this.requirePlaylist(playlistId)
    if (!Number.isSafeInteger(trackId) || trackId < 1) throw new Error('Invalid track ID.')
    this.run('DELETE FROM playlist_tracks WHERE id = ? AND playlist_id = ?', [trackId, playlistId])
    this.persist()
    return this.list()
  }

  // Moves a song to `toIndex` in its playlist (clamped to the end) and renumbers every song's position.
  moveTrack(playlistId: number, trackId: number, toIndex: number): Playlist[] {
    this.requirePlaylist(playlistId)
    if (!Number.isSafeInteger(trackId) || trackId < 1) throw new Error('Invalid track ID.')
    if (!Number.isSafeInteger(toIndex) || toIndex < 0) throw new Error('Invalid song position.')
    const ids = this.query<{ id: number }>(
      'SELECT id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position, id',
      [playlistId],
    ).map((row) => row.id)
    const from = ids.indexOf(trackId)
    if (from < 0) throw new Error('Song not found.')
    ids.splice(from, 1)
    ids.splice(Math.min(toIndex, ids.length), 0, trackId)
    this.db.run('BEGIN')
    try {
      ids.forEach((id, position) => this.run('UPDATE playlist_tracks SET position = ? WHERE id = ?', [position, id]))
      this.db.run('COMMIT')
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
    this.persist()
    return this.list()
  }

  getTrackFilePath(trackId: number): string | undefined {
    return this.query<{ filePath: string }>('SELECT file_path AS filePath FROM playlist_tracks WHERE id = ?', [
      trackId,
    ])[0]?.filePath
  }

  close(): void {
    this.persist()
    this.db.close()
  }

  private initializeSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS playlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        gradient TEXT NOT NULL DEFAULT 'sage',
        icon TEXT NOT NULL DEFAULT '♫',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS playlist_tracks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL DEFAULT 'Unknown artist',
        album TEXT NOT NULL DEFAULT '',
        duration_seconds INTEGER,
        position INTEGER NOT NULL,
        added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (playlist_id, file_path)
      );
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
  }

  // Adds columns that newer versions need to databases created by older ones.
  private migrateSchema(): void {
    const columns = new Set(this.query<{ name: string }>('PRAGMA table_info(playlist_tracks)').map((row) => row.name))
    const added: Record<string, string> = {
      album_artist: "TEXT NOT NULL DEFAULT ''",
      track_number: 'INTEGER',
      disc_number: 'INTEGER',
      tags_read: 'INTEGER NOT NULL DEFAULT 0',
      bpm: 'REAL',
      tempo_read: 'INTEGER NOT NULL DEFAULT 0',
      musical_key: 'TEXT',
      key_read: 'INTEGER NOT NULL DEFAULT 0',
      tempo_change: 'REAL NOT NULL DEFAULT 0',
      dj_details: 'TEXT',
      dj_read: 'INTEGER NOT NULL DEFAULT 0',
    }
    for (const [name, definition] of Object.entries(added)) {
      if (!columns.has(name)) this.run(`ALTER TABLE playlist_tracks ADD COLUMN ${name} ${definition}`)
    }
    // Playlists were listed in creation order before they could be reordered, so that's their starting order.
    const playlistColumns = this.query<{ name: string }>('PRAGMA table_info(playlists)').map((row) => row.name)
    if (!playlistColumns.includes('position')) {
      this.run('ALTER TABLE playlists ADD COLUMN position INTEGER NOT NULL DEFAULT 0')
      this.run('UPDATE playlists SET position = id')
    }
  }

  private query<T>(sql: string, parameters: SqlValue[] = []): T[] {
    const statement = this.db.prepare(sql)
    try {
      statement.bind(parameters)
      const rows: T[] = []
      while (statement.step()) rows.push(statement.getAsObject() as T)
      return rows
    } finally {
      statement.free()
    }
  }

  private run(sql: string, parameters: SqlValue[] = []): void {
    this.db.run(sql, parameters)
  }

  private persist(): void {
    const temporaryPath = `${this.filePath}.tmp`
    writeFileSync(temporaryPath, this.db.export())
    renameSync(temporaryPath, this.filePath)
    // sql.js's export() turns foreign keys off, which would stop deletes cascading to songs.
    this.db.run('PRAGMA foreign_keys = ON')
  }

  // Older builds lost foreign keys after the first save, so deleted playlists could leave their songs behind.
  private removeOrphanedTracks(): void {
    this.run('DELETE FROM playlist_tracks WHERE playlist_id NOT IN (SELECT id FROM playlists)')
  }

  private requirePlaylist(id: number): number {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid playlist ID.')
    if (this.query('SELECT id FROM playlists WHERE id = ?', [id]).length === 0) {
      throw new Error('Playlist not found.')
    }
    return id
  }

  private cleanTitle(value: string): string {
    const title = value.trim()
    if (!title || title.length > 100) throw new Error('Playlist names must be 1–100 characters.')
    return title
  }

  private cleanDescription(value: string | undefined): string {
    const description = value?.trim() ?? ''
    if (description.length > 500) throw new Error('Playlist descriptions must be 500 characters or fewer.')
    return description
  }

  // When tempo detection improves, songs an older version found no tempo for are detected again, once per version.
  private retryMissingTempos(): void {
    const saved = this.query<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', ['tempo_detector'])[0]
    if (Number(saved?.value ?? 0) >= tempoDetectorVersion) return
    this.run('UPDATE playlist_tracks SET tempo_read = 0 WHERE tempo_read = 1 AND bpm IS NULL')
    this.run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', ['tempo_detector', String(tempoDetectorVersion)])
  }

  // When the beat grid or phrase detection improves, every file is analysed again, once per version. Its old tempo and
  // DJ details stay until the new ones arrive.
  private redetectRhythm(): void {
    const saved = this.query<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', ['rhythm_detector'])[0]
    if (Number(saved?.value ?? 1) >= rhythmDetectorVersion) return
    this.run('UPDATE playlist_tracks SET dj_read = 0 WHERE dj_read = 1')
    this.run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', ['rhythm_detector', String(rhythmDetectorVersion)])
  }

  private seedStarterPlaylists(): void {
    const seeded = this.query<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', [
      'starter_playlists_seeded',
    ])
    if (seeded.length > 0) return
    this.db.run('BEGIN')
    try {
      for (const playlist of starterPlaylists) {
        this.run(`INSERT INTO playlists (title, description, gradient, icon, position) VALUES (?, ?, ?, ?, ${nextPlaylistPosition})`, [
          playlist.title,
          playlist.description,
          playlist.gradient,
          playlist.icon,
        ])
      }
      this.run('INSERT INTO app_meta (key, value) VALUES (?, ?)', ['starter_playlists_seeded', '1'])
      this.db.run('COMMIT')
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }
}

// Raise this when tempo detection gets better at finding tempos, so songs it missed before are tried again.
// 2: finds beats that start after a long intro.
const tempoDetectorVersion = 2

// Raise this when the beat grid, phrase start or other DJ details are found differently, so every file is analysed
// again. 2: the tempo from the kicks across the whole song, kicks rather than an off-beat bassline, and bar lines from
// where the kick returns and the level changes. 3: where in the beat the kicks fall, chosen from every phase rather
// than the strongest line or the half beat after it.
const rhythmDetectorVersion = 3

const nextPlaylistPosition = '(SELECT COALESCE(MAX(position), -1) + 1 FROM playlists)'

// Title, artist, album, album artist, track, disc and duration, in that order, falling back to the file name.
function songDetails(filePath: string, tags: TrackTags = {}): SqlValue[] {
  return [
    tags.title ?? (basename(filePath, extname(filePath)).trim() || 'Untitled track'),
    tags.artist ?? 'Unknown artist',
    tags.album ?? '',
    tags.albumArtist ?? '',
    tags.trackNumber ?? null,
    tags.discNumber ?? null,
    tags.durationSeconds ?? null,
  ]
}

export async function openPlaylistDatabase(userDataPath: string): Promise<PlaylistDatabase> {
  return PlaylistDatabase.open(join(userDataPath, 'playlists.sqlite3'))
}
