# Playlists

A cross-platform desktop playlist manager starter built with Electron, React, and TypeScript. The React renderer provides the UI; Electron's main process owns desktop capabilities, exposed through a small, typed preload API.

## Requirements

- Node.js 20.19+ or 22.12+
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

## Project layout

- `src/main/` — Electron main process and native window/IPC logic
- `src/preload/` — secure, typed bridge between the main process and renderer
- `src/renderer/` — React UI and presentation
- `electron.vite.config.ts` — separate Electron and renderer build targets
