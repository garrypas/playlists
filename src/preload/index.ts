import { contextBridge, ipcRenderer } from 'electron'

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform
}

const desktopApi = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:get-info'),
}

contextBridge.exposeInMainWorld('desktop', desktopApi)

export type DesktopApi = typeof desktopApi
