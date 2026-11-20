import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { DjDetails } from '../shared/djDetails'
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
    // Paths are read here from the dropped files themselves; a File the window made up has no path and is left out.
    addDroppedFiles: (id: number, files: File[]): Promise<Playlist[]> =>
      ipcRenderer.invoke(
        'playlists:add-dropped-files',
        id,
        files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
      ),
    addTrack: (playlistId: number, trackId: number): Promise<Playlist[]> =>
      ipcRenderer.invoke('playlists:add-track', playlistId, trackId),
    removeTrack: (playlistId: number, trackId: number): Promise<Playlist[]> =>
      ipcRenderer.invoke('playlists:remove-track', playlistId, trackId),
    moveTrack: (playlistId: number, trackId: number, toIndex: number): Promise<Playlist[]> =>
      ipcRenderer.invoke('playlists:move-track', playlistId, trackId, toIndex),
    setTrackTempo: (trackId: number, percent: number): Promise<Playlist[]> =>
      ipcRenderer.invoke('playlists:set-track-tempo', trackId, percent),
    djDetails: (trackId: number): Promise<DjDetails | null> => ipcRenderer.invoke('playlists:dj-details', trackId),
    move: (id: number, toIndex: number): Promise<Playlist[]> => ipcRenderer.invoke('playlists:move', id, toIndex),
    chooseImage: (id: number): Promise<Playlist[]> => ipcRenderer.invoke('playlists:choose-image', id),
    removeImage: (id: number): Promise<Playlist[]> => ipcRenderer.invoke('playlists:remove-image', id),
    onChanged: (listener: (playlists: Playlist[]) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, playlists: Playlist[]): void => listener(playlists)
      ipcRenderer.on('playlists:changed', handler)
      return () => ipcRenderer.removeListener('playlists:changed', handler)
    },
  } satisfies PlaylistApi,
}

contextBridge.exposeInMainWorld('desktop', desktopApi)

export type DesktopApi = typeof desktopApi
