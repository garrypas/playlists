import { app, BrowserWindow, dialog, ipcMain, session } from 'electron'
import { join } from 'node:path'
import type { CreatePlaylistInput } from '../shared/playlist'
import { handleAudioRequests, registerAudioScheme } from './audioProtocol'
import { openPlaylistDatabase, PlaylistDatabase } from './playlistDatabase'

registerAudioScheme()

let playlistDatabase: PlaylistDatabase

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#10100f',
    title: 'Playlists',
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

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}.`)
  return value
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
ipcMain.handle('playlists:create', (_event, input: unknown) => playlistDatabase.create(requireCreatePlaylistInput(input)))
ipcMain.handle('playlists:rename', (_event, id: unknown, title: unknown) =>
  playlistDatabase.rename(requireId(id, 'playlist'), requireString(title, 'playlist name')))
ipcMain.handle('playlists:remove', (_event, id: unknown) => playlistDatabase.remove(requireId(id, 'playlist')))
ipcMain.handle('playlists:remove-track', (_event, playlistId: unknown, trackId: unknown) =>
  playlistDatabase.removeTrack(requireId(playlistId, 'playlist'), requireId(trackId, 'track')))
ipcMain.handle('playlists:add-audio-files', async (_event, id: unknown) => {
  const playlistId = requireId(id, 'playlist')
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'wav', 'aiff', 'flac', 'ogg', 'opus'] }],
  })
  if (result.canceled || result.filePaths.length === 0) return playlistDatabase.list()
  return playlistDatabase.addAudioFiles(playlistId, result.filePaths)
})

// The app never needs popups, external navigation, or device permissions.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    if (url !== contents.getURL()) event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
})

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)

  try {
    playlistDatabase = await openPlaylistDatabase(app.getPath('userData'))
    handleAudioRequests((trackId) => playlistDatabase.getTrackFilePath(trackId))
    createWindow()

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
  playlistDatabase?.close()
})
