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
- Run tests: `npm test` (or `npm run test:watch`)
- Build: `npm run build`
- Package an unpacked app: `npm run package`
- Create platform installers: `npm run make`

## Project structure

- `src/main/` — Electron main-process code and native capabilities
- `src/preload/` — typed, limited bridge between main and renderer
- `src/renderer/` — React interface and presentation
- `electron.vite.config.ts` — build configuration for the separate processes
- `.github/workflows/ci.yml` — GitHub Actions CI: typecheck, test and build on macOS and Windows for pushes to `main` and pull requests
- `.github/workflows/release.yml` — on a `v*` tag matching `package.json`'s version, runs CI, then builds unsigned macOS (x64 + arm64) and Windows installers and publishes them as a GitHub release
- `.claude/agents/product.md` — product agent: the source of truth for shipped behavior, backlog and product constraints

## Coding guidelines

- **Language and style:** TypeScript with `strict`, `noUnusedLocals` and `noUnusedParameters`. Prettier (`.prettierrc`: no semicolons, single quotes, 2-space indent, 120-char lines) formats files on save in VS Code via `.vscode/settings.json`. No linter is configured yet.
- **Naming conventions:** <!-- Add preferred naming patterns -->
- **UI conventions:** <!-- Add component, styling, and accessibility expectations -->
- **State/data handling:** The SQLite database (`sql.js`) lives only in the main process (`src/main/playlistDatabase.ts`) and is saved to `playlists.sqlite3` in Electron's `userData` folder after every write. Mutating IPC calls return the full, updated playlist list, and the renderer replaces its state with it. Song details (title, artist, album, track, duration) are read from file tags in the main process (`src/main/trackMetadata.ts`, via `music-metadata`) when songs are added, and at launch for any songs not yet read; new columns are added in `migrateSchema()` so older databases keep working.
- **Testing:** Vitest. Main-process tests (`src/main/*.test.ts`) run in Node against a real sql.js database in a temp folder, with Electron stubbed. Renderer tests (`src/renderer/src/*.test.tsx`) use jsdom and Testing Library against an in-memory desktop API (`src/renderer/src/test/`).
  - **Test behavior, not implementation.** Write each test as something a user (or the window, for main-process code) does and what they observe. Find elements by role and accessible name, use `userEvent`, and assert on what's shown, what's saved and what's playing (the `player()` helper reads the `<audio>` element). Never assert on component state, internal function calls, CSS classes or markup structure. A refactor that keeps behavior the same must not break a test.
  - Test names describe behavior in plain words ("stops after the last song finishes"), not functions ("advance returns false").
  - Cover the edge cases listed in the product agent: empty playlist, last song, shuffle on, removed or missing songs, switching playlists, duplicates.
  - Extend the shared helpers (`src/renderer/src/test/app.tsx`, `fakeDesktop.ts`) rather than reaching into the DOM in individual tests. Don't stub what you're testing; stub only what jsdom or Node can't provide (Electron, media playback, dialogs).

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
2. Every change that adds or alters behavior adds or updates tests in the same task, and every bug fix gets a test that fails without the fix. Run `npm test`, `npm run typecheck` and `npm run build` before considering code changes complete.
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
