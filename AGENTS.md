# Project guide for coding agents

The shared guide for every coding agent and human contributor. Tool-specific extras live in their own small files that point here and must not contradict it (`CLAUDE.md` for Claude Code); don't copy these rules into them.

## Project overview

- **App:** a desktop playlist manager for music files on the user's machine, with playlists saved in a local SQLite database (`sql.js`). Not a website.
- **Stack:** Electron, TypeScript, React, Vite (`electron-vite`). Targets macOS and Windows.
- **Architecture:** React renderer for UI, Electron main process for desktop logic, and a preload bridge for narrowly scoped IPC.

## Commands

Use Node 24 (`.nvmrc`; run `nvm use` first; `engines` and CI both rely on it).

- `npm install`, `npm run dev` (run the app)
- `npm run typecheck`, `npm test` (or `npm run test:watch`), `npm run build`
- `npm run package` (unpacked app), `npm run make` (installers)
- A Husky pre-commit hook runs tests and blocks the commit if it fails

## Project structure

- `src/main/` — main process and native capabilities; `src/preload/` — the typed bridge; `src/renderer/` — React UI
- `electron.vite.config.ts` — build config for the processes, and the renderer's CSP
- `build/` — app icon (`icon.svg` source, `icon.png` for electron-builder and dev)
- `.github/workflows/ci.yml` — typecheck, test and build on macOS and Windows for pushes to `main` and PRs
- `.github/workflows/release.yml` — on a `v*` tag: set the version, run CI, build macOS (x64, arm64; ad-hoc signed, no certificate) and unsigned Windows installers, publish a GitHub release. Each architecture is packaged separately so it bundles its own ffmpeg (`asarUnpack`)
- `.github/dependabot.yml` — Dependabot raises PRs for vulnerable npm packages and GitHub Actions (security updates only, no routine version bumps)
- `.claude/` — Claude Code config. Hooks and settings only work in Claude Code; the docs below are plain Markdown for any agent.

### Reference docs

These hold the detail this guide leaves out. Skip each file's frontmatter and read the body before working in its area (in Claude Code they also run as subagents or skills).

- `.claude/agents/product.md` — source of truth for shipped behavior, backlog and product constraints
- `.claude/agents/dba.md` — every table and column (per file or per entry), persistence, migrations. Before any database task
- `.claude/agents/data-api.md` — `PlaylistDatabase` methods, `playlists:*` IPC and validation, preload, the `PlaylistApi` contract, the fake desktop. Before adding or changing a window–database call
- `.claude/skills/tempo-and-key/SKILL.md` — BPM and key detection and the shifted values shown after a tempo change
- `.claude/skills/audio-engine/SKILL.md` — playback (two `<audio>` decks in the renderer, the second used only by DJ mode, streamed by `playlist-audio://`), the tempo slider, platform limits, test stand-ins. Before any playback work
- `.claude/skills/dj/SKILL.md` — DJ technique (beatmatching, 16-bar phrase matching, fade lengths, drop mixing, harmonic mixing), the per-file DJ details, and DJ mode (the automix: planning, the two-deck runner, tests). Before any DJ-mode or transition work
- `.claude/skills/frontend-design/SKILL.md` — visual design. Before building or reshaping UI
- `.claude/agents/security.md` — secrets, SQL safety, logging and Electron/IPC hardening. Check changes to credentials, workflows, the schema, IPC or renderer privileges against it

## Coding guidelines

- **Style:** TypeScript `strict` with `noUnusedLocals` and `noUnusedParameters`. Prettier (`.prettierrc`: no semicolons, single quotes, 2-space indent, 120 chars) formats on save in VS Code. No linter yet.
- **Scripts:** write every script (hooks, build and release helpers, one-offs) as a Node ES module (`.mjs`) using built-in modules — not Python or shell. One-line commands in config (`package.json`, workflow steps, hook `command` fields) are fine.
- **Naming:**
  - `camelCase` for functions, variables, parameters and properties, including library module objects (`const sqlJs = await initSqlJs()`)
  - `PascalCase` for React components, types, interfaces, classes and enums
  - `UPPER_SNAKE_CASE` only for fixed module-level constants (`MAX_TEMPO_CHANGE`)
  - Files: components after the component (`SongTable.tsx`), everything else `camelCase` (`playlistDatabase.ts`, `queue.test.tsx`)
  - `snake_case` only for SQL names (`playlist_tracks`), mapped to `camelCase` in TypeScript
- **UI:** refine within the established Spotify-like dark look rather than restyling.
- **Data flow:** the database lives only in the main process (`src/main/playlistDatabase.ts`) and is saved to `userData/playlists.sqlite3` after every write. Mutating IPC calls return the full playlist list and the renderer replaces its state with it. Tags are read in main when songs are added; BPM, DJ details (beat grid, phrases, sections) and key are found in the background on worker threads, once per file, and each result is pushed as the full list on `playlists:changed`. New columns go in `migrateSchema()` so older databases keep working. Tempo changes show immediately and save after a short pause. Details are in the reference docs.
- **Testing:** Vitest. Main-process tests (`src/main/*.test.ts`) use a real sql.js database in a temp folder with Electron stubbed; renderer tests (`src/renderer/src/*.test.tsx`) use jsdom and Testing Library against an in-memory desktop (`src/renderer/src/test/`).
  - Test behavior, not implementation: what a user (or the window) does and observes. Query by role and accessible name, use `userEvent`, assert on what's shown, saved and playing (`player()` reads the `<audio>`). Never assert on state, internal calls, CSS classes or markup; a behavior-preserving refactor must not break a test.
  - Name tests by behavior ("stops after the last song finishes"), not function.
  - Cover the product doc's edge cases: empty playlist, last song, shuffle, removed or missing songs, switching playlists, duplicates.
  - Extend the shared helpers (`test/app.tsx`, `fakeDesktop.ts`) instead of reaching into the DOM. Stub only what jsdom or Node can't provide (Electron, media playback, dialogs).

## Architecture and security rules

- Follow `.claude/agents/security.md`: no credentials anywhere in the repo or package; parameterised SQL with allowlisted identifiers; never drop tables or wipe user data as a shortcut; don't log user data. Report any secret found and recommend rotating it, since deleting it leaves it in git history.
- UI in the renderer, desktop/native behavior in main.
- Preload exposes only explicit typed methods, never Electron objects. Main validates every IPC input.
- Keep `contextIsolation: true`, `nodeIntegration: false` and renderer sandboxing.
- File paths reach the database only from `dialog.showOpenDialog` in main, or from files the user dropped on the window (the preload reads them from the dropped `File` objects with `webUtils.getPathForFile`, and main checks them again). Never as path strings from the renderer.
- Loosen the CSP only for a specific need, and never in production builds to make dev work.
- New windows, navigation away and permission grants stay denied (`src/main/index.ts`).
- Never modify files outside this project; ask before writing outside the repo or running commands outside your tool's sandbox.

## Workflow for changes

1. Work in a loop: small change, run the checks, read failures, fix, repeat until all pass. For multi-step tasks, write the done criteria first (tests added and passing, typecheck and build clean, docs updated) and report done only when all are true. If stuck, write down the blocker, what was tried and what's next. Ask the user about scope, permissions or network access instead of looping.
2. Every behavior change adds or updates tests; every bug fix gets a test that fails without it. Run `npm test`, `npm run typecheck` and `npm run build` before calling code done.
3. For UI changes, check the result in `npm run dev`.
4. Keep `.claude/agents/product.md` current whenever user-visible behavior changes or the user states a requirement or decision: move shipped items from "Not built" to "Current behavior" (behavior and edge cases, not implementation), add gaps to "Not built" and constraints to "Constraints that shape product scope". One bullet per feature; edit, don't duplicate.
5. Keep the technical docs in `.claude/agents/` and `.claude/skills/` current. Each lists its files in the first column of its "## Files" table (backticked paths; a trailing `/` covers a folder), which a Claude Code hook reads, so keep it accurate when files move. When a change to those files alters flow, schema, constants, algorithms, file names, tests or pitfalls, update the doc in the same task. A substantial new feature area gets its own doc in the same format (frontmatter, files table, end-to-end flow, data, algorithms, tests, pitfalls, recipes, "Keeping this file current").

## Product decisions and domain terms

Preserve these without asking; the product doc has the detail.

- **Scope:** local, offline, single-user. No accounts, streaming or network features; web access, arbitrary paths or new permissions need the user's sign-off.
- **Song vs file:** a _song_ is one playlist entry (a `playlist_tracks` row with its own ID); a _file_ is the audio on disk. A file can be in many playlists but once per playlist (re-adding is silently ignored).
- **Per file vs per entry:** tags, BPM, key and DJ details belong to the file and are shared. Position and tempo change belong to the entry; a copy starts at 0%.
- **Explore / Your library:** every song across all playlists, once per file (earliest-added copy). No folder scanning.
- **Tempo:** ±10% per song per playlist; pitch moves with it like a turntable (no key lock: Chromium's time-stretch stutters). Shifted values show in brackets: "120 (123)", "Ebm (Em)".
- **DJ mode:** an automix, off by default. While it's on, the DJ sets the tempo: the slider is disabled, each song is matched to the one before, and nothing is saved.
- **Key spelling:** by key signature ("Ebm", "F#", "G#m", "Bb"), never mixed. Unknown BPM or key shows "—".
- **Queue:** songs added with "Add to queue" play before the rest of the list, then the list resumes. Switching playlists clears it.
- **UX:** Spotify-like and dark, in-app dialogs (no `window.prompt` in Electron), inline errors where possible. A failed save shows an alert and changes nothing. Fully usable by keyboard and screen reader.
- **Releases:** macOS and Windows installers on GitHub releases with no developer certificate (macOS is ad-hoc signed); no auto-updates.
