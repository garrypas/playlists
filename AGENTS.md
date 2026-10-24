# Project guide for coding agents

This is a playlist app. It should allow users to create and modify playlists of music files from their local machine. The playlists should be persisted in a local database.

This file is the shared guide for any coding agent (Claude Code, Codex, Cursor, Copilot, Gemini and others) and for human contributors. Tool-specific extras live in their own files and must not contradict this one: `CLAUDE.md` holds the Claude Code extras. To support another tool, add its own small file that points here, not a copy of these rules.

## Project overview

- **App:** Cross-platform desktop playlist manager
- **Stack:** Electron, TypeScript, React, Vite (`electron-vite`), SQL light database that can run locally
- **Targets:** macOS and Windows
- **Architecture:** React renderer for UI; Electron main process for desktop logic; preload bridge for narrowly scoped IPC. This is a desktop app, not a browser-deployed website.

## Commands

- Use Node 24 (`.nvmrc`; run `nvm use` first). `package.json` `engines` requires it, and CI reads the version from `.nvmrc`
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
- `build/` — app icon (`icon.svg` source, `icon.png` used by electron-builder and in dev)
- `.github/workflows/ci.yml` — GitHub Actions CI: typecheck, test and build on macOS and Windows for pushes to `main` and pull requests
- `.github/workflows/release.yml` — on a `v*` tag, sets the app version from the tag, runs CI, then builds unsigned macOS (x64 + arm64) and Windows installers and publishes them as a GitHub release. Each architecture is packaged separately so it bundles its own ffmpeg binary (unpacked from the asar via `asarUnpack`)
- `.claude/` — Claude Code configuration (settings, hooks, subagents, skills). The hooks and settings only take effect in Claude Code, but the docs below are plain Markdown that any agent should read.

### Reference docs

These hold the detail this guide leaves out. Each is a Markdown file with a short frontmatter header; skip the header and read the body. In Claude Code they also run as subagents or skills; other agents should open the file directly before working in that area.

- `.claude/agents/product.md` — product: the source of truth for shipped behavior, backlog and product constraints
- `.claude/agents/tempo-and-key.md` — BPM and key detection and how a tempo change shifts the BPM and key shown: files, data flow, algorithms, tests, pitfalls. The tempo slider and playback speed are in the audio-engine doc
- `.claude/agents/database-design.md` — the SQLite database: engine and persistence, every table and column (and whether it belongs to the file or the playlist entry), migrations, tests, pitfalls. Read it before any database task
- `.claude/agents/data-api.md` — the data API: `PlaylistDatabase` methods, `playlists:*` IPC channels and their validation, the preload bridge, the `PlaylistApi` contract and the renderer tests' fake desktop. Read it before adding or changing a call between the window and the database
- `.claude/skills/audio-engine/SKILL.md` — audio playback: who owns it (one `<audio>` element in the renderer, streamed by `playlist-audio://` from main), playback state and effects, what the platform can and can't do, test stand-ins and recipes. Read it before any playback or new audio feature
- `.claude/skills/frontend-design/SKILL.md` — visual design guidance. Read it before building or reshaping UI
- `.claude/agents/security.md` — security: rules for secrets and credentials, SQL and database safety, user-data logging and Electron/IPC hardening, plus the checks for a full review. Check any change that touches credentials, workflows, the schema, IPC or the renderer's privileges against it

## Coding guidelines

- **Language and style:** TypeScript with `strict`, `noUnusedLocals` and `noUnusedParameters`. Prettier (`.prettierrc`: no semicolons, single quotes, 2-space indent, 120-char lines) formats files on save in VS Code via `.vscode/settings.json`. No linter is configured yet.
- **Scripts and tooling:** write every script in JavaScript for Node — agent hooks, build and release helpers, and one-off scripts alike. Use ES modules (`.mjs`) and Node's built-in modules, not Python, shell or other languages. One-line commands inside config (`package.json` scripts, workflow steps, hook `command` fields) are fine.
- **Naming conventions:** follow standard TypeScript casing.
  - `camelCase` for functions, methods, variables, parameters and properties, including module objects returned by a library (`const sqlJs = await initSqlJs()`).
  - `PascalCase` for React components (JSX needs it to tell components from HTML elements), types, interfaces, classes and enums.
  - `UPPER_SNAKE_CASE` only for module-level constants with a fixed value (`MAX_TEMPO_CHANGE`, `TEMPO_SAVE_DELAY_MS`), not for every `const`.
  - Files: a component's file is named after it (`SongTable.tsx`); other modules and tests are `camelCase` (`playlistDatabase.ts`, `queue.test.tsx`).
  - `snake_case` only for SQL table and column names (`playlist_tracks`, `tempo_change`); map them to `camelCase` in TypeScript.
- **UI conventions:** read the frontend-design doc before building or reshaping UI. This app's established look is Spotify-like and dark (see "Product decisions"), so refine within that direction rather than restyling the app.
- **State/data handling:** The SQLite database (`sql.js`) lives only in the main process (`src/main/playlistDatabase.ts`) and is saved to `playlists.sqlite3` in Electron's `userData` folder after every write. Mutating IPC calls return the full, updated playlist list, and the renderer replaces its state with it. Song details (title, artist, album, track, duration) are read from file tags in the main process (`src/main/trackMetadata.ts`, via `music-metadata`) when songs are added, and at launch for any songs not yet read; new columns are added in `migrateSchema()` so older databases keep working. Song BPM and key are found in the background after songs are added (and at launch for any not yet found), each by its own queue (`src/main/backgroundAnalysis.ts`) on a worker thread (`src/main/analysisWorker.ts`, a separate build entry). The bundled `ffmpeg-static` binary decodes the audio (`src/main/audioDecoding.ts`); `src/main/trackTempo.ts` finds BPM with `music-tempo`, and `src/main/trackKey.ts` uses the file's key tag if it has one, else matches a chromagram against Krumhansl–Kessler key profiles. Each song's tempo change is stored per playlist entry (`tempo_change`); the renderer shows a change immediately and saves it with `setTrackTempo` after a short pause (or on `pagehide`). Each background result is saved and the full list is pushed to the window on `playlists:changed` (`onChanged` in preload), which the renderer applies like any other update.
- **Testing:** Vitest. Main-process tests (`src/main/*.test.ts`) run in Node against a real sql.js database in a temp folder, with Electron stubbed. Renderer tests (`src/renderer/src/*.test.tsx`) use jsdom and Testing Library against an in-memory desktop API (`src/renderer/src/test/`).
  - **Test behavior, not implementation.** Write each test as something a user (or the window, for main-process code) does and what they observe. Find elements by role and accessible name, use `userEvent`, and assert on what's shown, what's saved and what's playing (the `player()` helper reads the `<audio>` element). Never assert on component state, internal function calls, CSS classes or markup structure. A refactor that keeps behavior the same must not break a test.
  - Test names describe behavior in plain words ("stops after the last song finishes"), not functions ("advance returns false").
  - Cover the edge cases listed in the product doc: empty playlist, last song, shuffle on, removed or missing songs, switching playlists, duplicates.
  - Extend the shared helpers (`src/renderer/src/test/app.tsx`, `fakeDesktop.ts`) rather than reaching into the DOM in individual tests. Don't stub what you're testing; stub only what jsdom or Node can't provide (Electron, media playback, dialogs).

## Architecture and security rules

- Follow the secrets, database-safety and logging rules in `.claude/agents/security.md` for every change. In short: no credentials in source, tests, docs, renderer code or packaged assets; parameterised SQL with allowlisted identifiers; never drop tables or wipe user data as a shortcut; don't log user data. A secret found in the repo is reported with a recommendation to rotate it, because deleting it doesn't remove it from git history.

- Keep UI/presentation in the renderer and desktop/native behavior in the main process.
- Expose only explicit, minimal APIs from preload; add typed IPC methods rather than exposing Electron objects.
- Preserve `contextIsolation: true`, `nodeIntegration: false`, and renderer sandboxing.
- Validate IPC inputs in the main process before using them.
- File paths reach the database only from native dialogs in the main process (`dialog.showOpenDialog`), never from the renderer.
- The renderer's Content Security Policy is set in `electron.vite.config.ts`. Loosen it only for a specific need, and never in production builds just to make dev mode work.
- Windows may not open new windows, navigate away from the app, or receive permission grants (camera, mic, etc.). These are denied in `src/main/index.ts`.

## Workflow for changes

1. Work in a loop: make a small change, run the checks in step 2, read the failures, fix, and repeat until everything passes, rather than stopping at the first attempt. For a multi-step task, write down the done criteria first: tests added and passing, `npm run typecheck` and `npm run build` clean, product and technical docs updated. Report the task done only when all of that is true. If stuck, write down what's blocking, what was tried and what to try next. Don't loop on decisions that need the user (product scope, new permissions, network access); ask instead.
2. Every change that adds or alters behavior adds or updates tests in the same task, and every bug fix gets a test that fails without the fix. Run `npm test`, `npm run typecheck` and `npm run build` before considering code changes complete.
3. For UI changes, run `npm run dev` and check the change in the app.
4. Keep the product doc (`.claude/agents/product.md`) current. When a change adds, alters or removes user-visible behavior, or the user states a new requirement or product decision, update it in the same task:
   - Move shipped items from "Not built" to "Current behavior", describing behavior and edge cases, not implementation.
   - Add new gaps or deferred ideas to "Not built".
   - Add new constraints to "Constraints that shape product scope".
   - Keep it concise: one bullet per feature, and edit existing bullets rather than appending duplicates.
5. Keep the technical docs in `.claude/agents/` current. Each one lists the files it covers in the first column of its "## Files" table (backticked paths; a path ending in `/` covers a folder). A Claude Code hook reads that table to check this, so keep it accurate when files are added, moved or renamed. When a change touches those files and alters how the feature works (flow, schema, constants, algorithms, file names, tests or pitfalls), update that doc in the same task, so it can still be trusted without reading the code. When adding a substantial new feature area, add a technical doc for it in the same format (frontmatter, files table, end-to-end flow, data, algorithms, tests, pitfalls, recipes, "Keeping this file current").

## Product decisions and domain terms

The product doc (`.claude/agents/product.md`) has the full detail; these are the decisions to preserve without asking.

- **Scope:** a local, offline, single-user desktop app. No accounts, streaming or network features; anything needing web access, arbitrary paths or new permissions needs the user's sign-off.
- **Song vs file:** a *song* is an entry in one playlist (a `playlist_tracks` row, its own ID); a *file* is the audio on disk. The same file can be in many playlists but only once per playlist (adding it again is ignored, not an error).
- **Per file vs per entry:** tags, BPM and key belong to the file and are shared by every copy. Position and tempo change belong to the entry; a copy starts at 0%.
- **Explore / Your library:** every song across all playlists, shown once per file using the earliest-added copy. Songs-in-playlists only; there's no folder scanning.
- **Tempo:** ±10% per song per playlist, and pitch moves with it like a turntable (no key lock, because Chromium's time-stretch stutters). BPM and key show their shifted values in brackets, e.g. "120 (123)", "Ebm (Em)".
- **Key spelling:** by key signature ("Ebm", "F#", "G#m", "Bb"), never mixed sharps and flats. Unknown BPM or key shows "—".
- **Queue:** the songs the user added with "Add to queue". They play before the rest of the list, then the list resumes. Switching playlists clears it.
- **UX:** Spotify-like and dark, with in-app dialogs (Electron has no `window.prompt`) and inline errors where possible. A failed save shows an alert and leaves things as they were. Everything works by keyboard and screen reader.
- **Releases:** unsigned macOS and Windows installers on GitHub releases, with no automatic updates.

## Do not

- Modify any files outside of this project. Ask before writing outside the repo or running shell commands outside your tool's sandbox.
