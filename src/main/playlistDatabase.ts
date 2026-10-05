import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import initSqlJs from 'sql.js'
import type { Database as SqlDatabase, SqlValue } from 'sql.js'
import type { CreatePlaylistInput, Playlist, PlaylistTrack } from '../shared/playlist'

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
    const SQL = await initSqlJs({
      locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
    })
    const bytes = existsSync(filePath) ? readFileSync(filePath) : undefined
    const store = new PlaylistDatabase(new SQL.Database(bytes), filePath)
    store.db.run('PRAGMA foreign_keys = ON')
    store.initializeSchema()
    store.seedStarterPlaylists()
    store.persist()
    return store
  }

  list(): Playlist[] {
    const playlists = this.query<Omit<Playlist, 'tracks'>>(
      'SELECT id, title, description, gradient, icon FROM playlists ORDER BY id',
    )
    return playlists.map((playlist) => ({
      ...playlist,
      tracks: this.query<PlaylistTrack>(`
        SELECT id, file_path AS filePath, title, artist, album,
          duration_seconds AS durationSeconds, position
        FROM playlist_tracks WHERE playlist_id = ? ORDER BY position, id
      `, [playlist.id]),
    }))
  }

  create(input: CreatePlaylistInput): Playlist[] {
    this.run('INSERT INTO playlists (title, description) VALUES (?, ?)', [
      this.cleanTitle(input.title),
      input.description?.trim() ?? '',
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

  addAudioFiles(id: number, filePaths: string[]): Playlist[] {
    const playlistId = this.requirePlaylist(id)
    this.db.run('BEGIN')
    try {
      for (const filePath of filePaths) {
        const title = basename(filePath, extname(filePath)).trim() || 'Untitled track'
        this.run(`
          INSERT OR IGNORE INTO playlist_tracks (playlist_id, file_path, title, position)
          VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_tracks WHERE playlist_id = ?))
        `, [playlistId, filePath, title, playlistId])
      }
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

  private seedStarterPlaylists(): void {
    const seeded = this.query<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', ['starter_playlists_seeded'])
    if (seeded.length > 0) return
    this.db.run('BEGIN')
    try {
      for (const playlist of starterPlaylists) {
        this.run('INSERT INTO playlists (title, description, gradient, icon) VALUES (?, ?, ?, ?)', [
          playlist.title, playlist.description, playlist.gradient, playlist.icon,
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

export async function openPlaylistDatabase(userDataPath: string): Promise<PlaylistDatabase> {
  return PlaylistDatabase.open(join(userDataPath, 'playlists.sqlite3'))
}

