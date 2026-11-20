import { app, BrowserWindow, dialog, ipcMain, session } from 'electron'
import { stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, isAudioFileName, MAX_TEMPO_CHANGE, type CreatePlaylistInput } from '../shared/playlist'
import { handleAudioRequests, registerAudioScheme } from './audioProtocol'
import { openPlaylistDatabase, PlaylistDatabase } from './playlistDatabase'
import { readTagsForFiles } from './trackMetadata'
import { preparePlaylistImage } from './playlistImage'
import { analyseInWorker, createBackgroundScanner } from './backgroundAnalysis'

registerAudioScheme()

let playlistDatabase: PlaylistDatabase

function sendPlaylistsToWindows(): void {
  const playlists = playlistDatabase.list()
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('playlists:changed', playlists)
}

// Finds new songs' tempos and DJ details (one pass over the audio) and keys in the background, once per file, and sends
// the window the updated playlists after each one.
const analysisWorkerPath = join(__dirname, 'analysisWorker.js')
const rhythmScanner = createBackgroundScanner(
  (filePath) => analyseInWorker(analysisWorkerPath, 'rhythm', filePath),
  (filePath, rhythm) => {
    playlistDatabase.saveRhythm(filePath, rhythm)
    sendPlaylistsToWindows()
  },
)
const keyScanner = createBackgroundScanner(
  (filePath) => analyseInWorker(analysisWorkerPath, 'key', filePath),
  (filePath, key) => {
    playlistDatabase.saveKey(filePath, key)
    sendPlaylistsToWindows()
  },
)

function scanForMissingDetails(): void {
  rhythmScanner.scan(playlistDatabase.filesNeedingRhythm())
  keyScanner.scan(playlistDatabase.filesNeedingKey())
}

// Packaged apps get their icon from the bundle; in dev the app runs inside the stock Electron binary, so use ours.
const devIcon = app.isPackaged ? undefined : join(__dirname, '../../build/icon.png')

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#10100f',
    title: 'Playlists',
    icon: devIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('app:get-info', () => ({
  name: app.getName(),
  version: app.getVersion(),
  platform: process.platform,
}))

function requireId(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${label} ID.`)
  return value
}

function requireIndex(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label} position.`)
  return value
}

function requireTempo(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_TEMPO_CHANGE) {
    throw new Error('Invalid tempo.')
  }
  return value
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}.`)
  return value
}

// The most files one drop can add, so a runaway call can't make main stat and tag-read without end.
const MAX_DROPPED_FILES = 5000

// Paths of files dropped on the window. The preload gets them from the dropped File objects (webUtils), which only
// carry a path when the user dragged a real file in, but main still trusts nothing: anything that isn't an absolute
// path to an existing regular file with an audio extension is skipped.
async function requireDroppedAudioPaths(value: unknown): Promise<string[]> {
  if (!Array.isArray(value) || value.length > MAX_DROPPED_FILES || value.some((item) => typeof item !== 'string')) {
    throw new Error('Invalid dropped files.')
  }
  const candidates = [...new Set(value as string[])].filter((path) => isAbsolute(path) && isAudioFileName(path))
  const isFile = await Promise.all(
    candidates.map((path) =>
      stat(path).then(
        (stats) => stats.isFile(),
        () => false,
      ),
    ),
  )
  return candidates.filter((_path, index) => isFile[index])
}

function requireCreatePlaylistInput(value: unknown): CreatePlaylistInput {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid playlist details.')
  const { title, description } = value as Record<string, unknown>
  return {
    title: requireString(title, 'playlist name'),
    description: description === undefined ? undefined : requireString(description, 'playlist description'),
  }
}

ipcMain.handle('playlists:list', () => playlistDatabase.list())
ipcMain.handle('playlists:create', (_event, input: unknown) =>
  playlistDatabase.create(requireCreatePlaylistInput(input)),
)
ipcMain.handle('playlists:rename', (_event, id: unknown, title: unknown) =>
  playlistDatabase.rename(requireId(id, 'playlist'), requireString(title, 'playlist name')),
)
ipcMain.handle('playlists:remove', (_event, id: unknown) => playlistDatabase.remove(requireId(id, 'playlist')))
ipcMain.handle('playlists:add-track', (_event, playlistId: unknown, trackId: unknown) =>
  playlistDatabase.addTrack(requireId(playlistId, 'playlist'), requireId(trackId, 'track')),
)
ipcMain.handle('playlists:remove-track', (_event, playlistId: unknown, trackId: unknown) =>
  playlistDatabase.removeTrack(requireId(playlistId, 'playlist'), requireId(trackId, 'track')),
)
ipcMain.handle('playlists:move-track', (_event, playlistId: unknown, trackId: unknown, toIndex: unknown) =>
  playlistDatabase.moveTrack(requireId(playlistId, 'playlist'), requireId(trackId, 'track'), requireIndex(toIndex, 'song')),
)
ipcMain.handle('playlists:set-track-tempo', (_event, trackId: unknown, percent: unknown) =>
  playlistDatabase.setTrackTempo(requireId(trackId, 'track'), requireTempo(percent)),
)
ipcMain.handle('playlists:dj-details', (_event, trackId: unknown) =>
  playlistDatabase.getDjDetails(requireId(trackId, 'track')),
)
ipcMain.handle('playlists:move', (_event, id: unknown, toIndex: unknown) =>
  playlistDatabase.movePlaylist(requireId(id, 'playlist'), requireIndex(toIndex, 'playlist')),
)
ipcMain.handle('playlists:add-audio-files', async (_event, id: unknown) => {
  const playlistId = requireId(id, 'playlist')
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: [...AUDIO_EXTENSIONS] }],
  })
  if (result.canceled || result.filePaths.length === 0) return playlistDatabase.list()
  const tags = await readTagsForFiles(result.filePaths)
  const playlists = playlistDatabase.addAudioFiles(playlistId, result.filePaths, tags)
  scanForMissingDetails()
  return playlists
})

ipcMain.handle('playlists:add-dropped-files', async (_event, id: unknown, paths: unknown) => {
  const playlistId = requireId(id, 'playlist')
  const filePaths = await requireDroppedAudioPaths(paths)
  if (filePaths.length === 0) return playlistDatabase.list()
  const tags = await readTagsForFiles(filePaths)
  const playlists = playlistDatabase.addAudioFiles(playlistId, filePaths, tags)
  scanForMissingDetails()
  return playlists
})

ipcMain.handle('playlists:choose-image', async (_event, id: unknown) => {
  const playlistId = requireId(id, 'playlist')
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: [...IMAGE_EXTENSIONS] }],
  })
  if (result.canceled || result.filePaths.length === 0) return playlistDatabase.list()
  return playlistDatabase.setPlaylistImage(playlistId, await preparePlaylistImage(result.filePaths[0]))
})
ipcMain.handle('playlists:remove-image', (_event, id: unknown) =>
  playlistDatabase.removePlaylistImage(requireId(id, 'playlist')),
)

// The app never needs popups, external navigation, or device permissions.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    if (url !== contents.getURL()) event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
})

app.whenReady().then(async () => {
  if (devIcon && process.platform === 'darwin') app.dock?.setIcon(devIcon)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)

  try {
    playlistDatabase = await openPlaylistDatabase(app.getPath('userData'))
    // Songs added before tags were read (or whose files were unreadable last time) get their tags now.
    playlistDatabase.saveTags(await readTagsForFiles(playlistDatabase.filesNeedingTags()))
    handleAudioRequests(
      (trackId) => playlistDatabase.getTrackFilePath(trackId),
      (playlistId) => playlistDatabase.getPlaylistImage(playlistId),
    )
    createWindow()
    // Songs whose tempo, DJ details or key weren't found last time (added just before quitting, saved by an older
    // version, or unreadable) are scanned again.
    scanForMissingDetails()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  } catch (error) {
    dialog.showErrorBox('Database could not be opened', error instanceof Error ? error.message : String(error))
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  rhythmScanner.stop()
  keyScanner.stop()
  playlistDatabase?.close()
})
