import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { CreatePlaylistInput, Playlist, PlaylistApi } from '../shared/playlist'

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform
}

const desktopApi = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:get-info'),
  playlists: {
    list: (): Promise<Playlist[]> => ipcRenderer.invoke('playlists:list'),
    create: (input: CreatePlaylistInput): Promise<Playlist[]> => ipcRenderer.invoke('playlists:create', input),
    rename: (id: number, title: string): Promise<Playlist[]> => ipcRenderer.invoke('playlists:rename', id, title),
    remove: (id: number): Promise<Playlist[]> => ipcRenderer.invoke('playlists:remove', id),
    addAudioFiles: (id: number): Promise<Playlist[]> => ipcRenderer.invoke('playlists:add-audio-files', id),
    addTrack: (playlistId: number, trackId: number): Promise<Playlist[]> =>
      ipcRenderer.invoke('playlists:add-track', playlistId, trackId),
    removeTrack: (playlistId: number, trackId: number): Promise<Playlist[]> =>
      ipcRenderer.invoke('playlists:remove-track', playlistId, trackId),
    moveTrack: (playlistId: number, trackId: number, toIndex: number): Promise<Playlist[]> =>
      ipcRenderer.invoke('playlists:move-track', playlistId, trackId, toIndex),
    move: (id: number, toIndex: number): Promise<Playlist[]> => ipcRenderer.invoke('playlists:move', id, toIndex),
    onChanged: (listener: (playlists: Playlist[]) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, playlists: Playlist[]): void => listener(playlists)
      ipcRenderer.on('playlists:changed', handler)
      return () => ipcRenderer.removeListener('playlists:changed', handler)
    },
  } satisfies PlaylistApi,
}

contextBridge.exposeInMainWorld('desktop', desktopApi)

export type DesktopApi = typeof desktopApi
