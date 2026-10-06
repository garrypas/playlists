# Project guide for Claude

This is a playlist app. It should allow users to create and modify playlists of music files from their local machine. The playlists should be persisted in a local database.

## Project overview

- **App:** Cross-platform desktop playlist manager
- **Stack:** Electron, TypeScript, React, Vite (`electron-vite`), SQL light database that can run locally
- **Targets:** macOS and Windows
- **Architecture:** React renderer for UI; Electron main process for desktop logic; preload bridge for narrowly scoped IPC. This is a desktop app, not a browser-deployed website.

## Commands

- Install dependencies: `npm install`
- Run the desktop app: `npm run dev`
- Check TypeScript: `npm run typecheck`
- Build: `npm run build`
- Package an unpacked app: `npm run package`
- Create platform installers: `npm run make`

## Project structure

- `src/main/` — Electron main-process code and native capabilities
- `src/preload/` — typed, limited bridge between main and renderer
- `src/renderer/` — React interface and presentation
- `electron.vite.config.ts` — build configuration for the separate processes
- `.claude/agents/product.md` — product agent: the source of truth for shipped behavior, backlog and product constraints

## Coding guidelines

- **Language and style:** TypeScript with `strict`, `noUnusedLocals` and `noUnusedParameters`. No linter or formatter is configured yet; match the surrounding code (no semicolons, single quotes, 2-space indent).
- **Naming conventions:** <!-- Add preferred naming patterns -->
- **UI conventions:** <!-- Add component, styling, and accessibility expectations -->
- **State/data handling:** The SQLite database (`sql.js`) lives only in the main process (`src/main/playlistDatabase.ts`) and is saved to `playlists.sqlite3` in Electron's `userData` folder after every write. Mutating IPC calls return the full, updated playlist list, and the renderer replaces its state with it.
- **Testing:** No test framework yet. Until one is added, `npm run typecheck` and `npm run build` are the only automated checks.

## Architecture and security rules

- Keep UI/presentation in the renderer and desktop/native behavior in the main process.
- Expose only explicit, minimal APIs from preload; add typed IPC methods rather than exposing Electron objects.
- Preserve `contextIsolation: true`, `nodeIntegration: false`, and renderer sandboxing.
- Validate IPC inputs in the main process before using them.
- File paths reach the database only from native dialogs in the main process (`dialog.showOpenDialog`), never from the renderer.
- The renderer's Content Security Policy is set in `electron.vite.config.ts`. Loosen it only for a specific need, and never in production builds just to make dev mode work.
- Windows may not open new windows, navigate away from the app, or receive permission grants (camera, mic, etc.). These are denied in `src/main/index.ts`.

## Workflow for changes

1. <!-- Add any required planning or review steps -->
2. Run `npm run typecheck` and `npm run build` before considering code changes complete.
3. For UI changes, run `npm run dev` and check the change in the app.
4. Keep the product agent (`.claude/agents/product.md`) current. When a change adds, alters or removes user-visible behavior, or the user states a new requirement or product decision, update it in the same task:
   - Move shipped items from "Not built" to "Current behavior", describing behavior and edge cases, not implementation.
   - Add new gaps or deferred ideas to "Not built".
   - Add new constraints to "Constraints that shape product scope".
   - Keep it concise: one bullet per feature, and edit existing bullets rather than appending duplicates.

## Product decisions and domain terms

<!-- Record decisions Claude should preserve: playlist behavior, terminology, persistence, platform differences, and UX constraints. -->

## Do not

- Modify any files outside of this project
