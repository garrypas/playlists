import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Playlist } from '../shared/playlist'

type Handler = (...args: unknown[]) => unknown

// A stand-in for Electron that records what the app registers, so tests can drive it like the real runtime would.
const electron = vi.hoisted(() => ({
  userData: '',
  ipcHandlers: new Map<string, Handler>(),
  appListeners: new Map<string, Handler>(),
  windows: [] as { options: { webPreferences: Record<string, unknown> } }[],
  permissionRequestHandler: undefined as Handler | undefined,
  permissionCheckHandler: undefined as Handler | undefined,
  openDialogResult: { canceled: true, filePaths: [] as string[] },
}))

vi.mock('electron', () => {
  class BrowserWindow {
    static getAllWindows = () => electron.windows
    constructor(public options: { webPreferences: Record<string, unknown> }) {
      electron.windows.push(this)
    }
    loadURL = vi.fn(async () => {})
    loadFile = vi.fn(async () => {})
  }
  return {
    app: {
      getName: () => 'Playlists',
      getVersion: () => '1.0.0',
      getPath: () => electron.userData,
      whenReady: () => Promise.resolve(),
      on: (event: string, listener: Handler) => electron.appListeners.set(event, listener),
      quit: vi.fn(),
    },
    BrowserWindow,
    dialog: {
      showOpenDialog: vi.fn(async () => electron.openDialogResult),
      showErrorBox: vi.fn(),
    },
    ipcMain: { handle: (channel: string, handler: Handler) => electron.ipcHandlers.set(channel, handler) },
    protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
    session: {
      defaultSession: {
        setPermissionRequestHandler: (handler: Handler) => {
          electron.permissionRequestHandler = handler
        },
        setPermissionCheckHandler: (handler: Handler) => {
          electron.permissionCheckHandler = handler
        },
      },
    },
  }
})

function invoke<T = Playlist[]>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = electron.ipcHandlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  return Promise.resolve().then(() => handler({}, ...args) as T)
}

beforeAll(async () => {
  electron.userData = mkdtempSync(join(tmpdir(), 'playlists-main-'))
  await import('./index')
  await vi.waitFor(() => expect(electron.windows).toHaveLength(1))
})

afterAll(() => {
  electron.appListeners.get('before-quit')?.()
  rmSync(electron.userData, { recursive: true, force: true })
})

beforeEach(() => {
  electron.openDialogResult = { canceled: true, filePaths: [] }
})

describe('window security', () => {
  it('opens the app window isolated from Node and sandboxed', () => {
    expect(electron.windows[0].options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    })
  })

  function fakeWebContents(url: string) {
    const listeners = new Map<string, Handler>()
    let windowOpenHandler: Handler = () => ({ action: 'allow' })
    const contents = {
      getURL: () => url,
      on: (event: string, listener: Handler) => listeners.set(event, listener),
      setWindowOpenHandler: (handler: Handler) => {
        windowOpenHandler = handler
      },
    }
    electron.appListeners.get('web-contents-created')?.({}, contents)
    return { listeners, openWindow: (target: string) => windowOpenHandler({ url: target }) }
  }

  it('blocks pop-up windows', () => {
    expect(fakeWebContents('app://index.html').openWindow('https://example.com')).toEqual({ action: 'deny' })
  })

  it('blocks navigating away from the app, but allows reloading it', () => {
    const { listeners } = fakeWebContents('app://index.html')
    const away = { preventDefault: vi.fn() }
    const reload = { preventDefault: vi.fn() }
    listeners.get('will-navigate')?.(away, 'https://example.com')
    listeners.get('will-navigate')?.(reload, 'app://index.html')
    expect(away.preventDefault).toHaveBeenCalled()
    expect(reload.preventDefault).not.toHaveBeenCalled()
  })

  it('blocks embedded webviews', () => {
    const event = { preventDefault: vi.fn() }
    fakeWebContents('app://index.html').listeners.get('will-attach-webview')?.(event)
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('refuses every permission request, such as camera or microphone', () => {
    const callback = vi.fn()
    electron.permissionRequestHandler?.({}, 'media', callback)
    expect(callback).toHaveBeenCalledWith(false)
    expect(electron.permissionCheckHandler?.({}, 'geolocation')).toBe(false)
  })
})

describe('playlist requests from the window', () => {
  it('lists the saved playlists', async () => {
    expect((await invoke('playlists:list')).map((playlist) => playlist.title)).toContain('Late night drive')
  })

  it('creates, renames and deletes playlists, returning the updated list each time', async () => {
    const created = (await invoke('playlists:create', { title: 'Road trip' })).at(-1)!
    expect(created.title).toBe('Road trip')
    expect((await invoke('playlists:rename', created.id, 'Long way round')).at(-1)?.title).toBe('Long way round')
    expect((await invoke('playlists:remove', created.id)).map((playlist) => playlist.id)).not.toContain(created.id)
  })

  it.each([
    [null, 'Invalid playlist details.'],
    ['Road trip', 'Invalid playlist details.'],
    [{ title: 42 }, 'Invalid playlist name.'],
    [{ title: 'Road trip', description: 42 }, 'Invalid playlist description.'],
  ])('rejects malformed playlist details %j', async (input, message) => {
    await expect(invoke('playlists:create', input)).rejects.toThrow(message)
  })

  it.each(['1', 1.5, 0, -1, null, Number.MAX_SAFE_INTEGER + 1])('rejects the playlist ID %j', async (id) => {
    await expect(invoke('playlists:rename', id, 'Name')).rejects.toThrow('Invalid playlist ID.')
    await expect(invoke('playlists:remove', id)).rejects.toThrow('Invalid playlist ID.')
    await expect(invoke('playlists:add-audio-files', id)).rejects.toThrow('Invalid playlist ID.')
  })

  it('rejects a malformed song ID when removing a song', async () => {
    const playlist = (await invoke('playlists:list'))[0]
    await expect(invoke('playlists:remove-track', playlist.id, '7')).rejects.toThrow('Invalid track ID.')
  })

  it('adds a saved song to another playlist', async () => {
    const [first, second] = await invoke('playlists:list')
    electron.openDialogResult = { canceled: false, filePaths: ['/music/Shared.mp3'] }
    const song = (await invoke('playlists:add-audio-files', first.id))[0].tracks.find(
      (track) => track.title === 'Shared',
    )!
    const updated = await invoke('playlists:add-track', second.id, song.id)
    expect(updated[1].tracks.map((track) => track.filePath)).toContain('/music/Shared.mp3')
  })

  it.each([
    ['/music/a.mp3', 1, 'Invalid playlist ID.'],
    [1, '/music/a.mp3', 'Invalid track ID.'],
    [1, 0, 'Invalid track ID.'],
  ])('rejects adding to playlist %j the song %j', async (playlistId, trackId, message) => {
    await expect(invoke('playlists:add-track', playlistId, trackId)).rejects.toThrow(message)
  })

  it('moves a song within its playlist', async () => {
    const playlist = (await invoke('playlists:list'))[0]
    electron.openDialogResult = { canceled: false, filePaths: ['/music/Move A.mp3', '/music/Move B.mp3'] }
    const songA = (await invoke('playlists:add-audio-files', playlist.id))[0].tracks.find(
      (track) => track.title === 'Move A',
    )!
    const tracks = (await invoke('playlists:move-track', playlist.id, songA.id, 99))[0].tracks
    expect(tracks.at(-1)?.title).toBe('Move A')
  })

  it.each(['1', 1.5, -1, null, Number.MAX_SAFE_INTEGER + 1])(
    'rejects the song position %j when moving a song',
    async (position) => {
      const playlist = (await invoke('playlists:list'))[0]
      await expect(invoke('playlists:move-track', playlist.id, 1, position)).rejects.toThrow('Invalid song position.')
    },
  )

  it('rejects a name that is not text when renaming', async () => {
    const playlist = (await invoke('playlists:list'))[0]
    await expect(invoke('playlists:rename', playlist.id, { name: 'x' })).rejects.toThrow('Invalid playlist name.')
  })
})

describe('adding songs', () => {
  it('adds the files the user picks in the system file dialog', async () => {
    const playlist = (await invoke('playlists:list'))[0]
    electron.openDialogResult = { canceled: false, filePaths: ['/music/Picked.mp3'] }
    const updated = await invoke('playlists:add-audio-files', playlist.id)
    expect(updated[0].tracks.map((track) => track.filePath)).toContain('/music/Picked.mp3')
  })

  it('changes nothing when the user cancels the dialog', async () => {
    const before = await invoke('playlists:list')
    expect(await invoke('playlists:add-audio-files', before[0].id)).toEqual(before)
  })

  it('ignores file paths sent by the window itself', async () => {
    const playlist = (await invoke('playlists:list'))[1]
    const updated = await invoke('playlists:add-audio-files', playlist.id, ['/etc/passwd'])
    expect(updated[1].tracks).toEqual(playlist.tracks)
  })
})
