# Playlists

A cross-platform desktop playlist manager built with Electron, React, and TypeScript. The React renderer provides the UI; Electron's main process owns desktop capabilities, exposed through a small, typed preload API. Playlist data is stored in a local SQLite database using sql.js (SQLite compiled to WebAssembly), avoiding native module builds on macOS and Windows.

## Requirements

- Node.js 24 (see `.nvmrc`; run `nvm use`)
- npm

## Development

```sh
npm install
npm run dev
```

## Build and package

```sh
npm run typecheck
npm run build
npm run package
```

`npm run package` creates an unpacked app in `release/`. `npm run make` creates platform installers (DMG/ZIP on macOS, NSIS installer on Windows). Build each platform on its corresponding OS for the most reliable native packaging and signing workflow.

## Installing a release

Installers are on the GitHub releases page. They have no developer certificate, so the first open needs a confirmation:

- **macOS:** open the app once, then go to System Settings → Privacy & Security and choose **Open Anyway**.
- **Windows:** on the SmartScreen warning, choose **More info** → **Run anyway**.

## Local playlist storage

The app creates `playlists.sqlite3` in Electron's per-user application data directory. Playlists and their ordered song entries are saved there automatically. **Add songs** opens a native file picker and stores each selected audio file's path and display name; the audio files themselves are not copied or modified. Moving or deleting an original file will make its saved playlist entry unavailable. Removing a playlist or song only removes its database entry.

## Project layout

- `src/main/` — Electron main-process code and native capabilities
- `src/preload/` — secure, typed bridge between main and renderer
- `src/shared/` — shared playlist and IPC types
- `src/renderer/` — React UI and presentation
- `src/main/playlistDatabase.ts` — SQLite schema, persistence, and playlist operations
- `electron.vite.config.ts` — separate Electron and renderer build targets
