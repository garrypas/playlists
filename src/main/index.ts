import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import type { CreatePlaylistInput } from '../shared/playlist'
import { openPlaylistDatabase, PlaylistDatabase } from './playlistDatabase'

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

ipcMain.handle('playlists:list', () => playlistDatabase.list())
ipcMain.handle('playlists:create', (_event, input: CreatePlaylistInput) => {
  if (!input || typeof input.title !== 'string' || typeof input.description !== 'undefined' && typeof input.description !== 'string') {
    throw new Error('Invalid playlist details.')
  }
  return playlistDatabase.create(input)
})
ipcMain.handle('playlists:rename', (_event, id: number, title: string) => {
  if (typeof title !== 'string') throw new Error('Invalid playlist name.')
  return playlistDatabase.rename(id, title)
})
ipcMain.handle('playlists:remove', (_event, id: number) => playlistDatabase.remove(id))
ipcMain.handle('playlists:remove-track', (_event, playlistId: number, trackId: number) => playlistDatabase.removeTrack(playlistId, trackId))
ipcMain.handle('playlists:add-audio-files', async (_event, id: number) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'wav', 'aiff', 'flac', 'ogg', 'opus'] }],
  })
  if (result.canceled || result.filePaths.length === 0) return playlistDatabase.list()
  return playlistDatabase.addAudioFiles(id, result.filePaths)
})

app.whenReady().then(async () => {
  try {
    playlistDatabase = await openPlaylistDatabase(app.getPath('userData'))
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
