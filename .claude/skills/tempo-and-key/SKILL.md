---
name: tempo-and-key
description: How BPM detection and musical key detection work in the Playlists app, and how a song's tempo change alters the BPM and key it shows. Use before answering how detection works, planning, making or reviewing a change to it (accuracy, new tag formats, a new detected detail, re-detection), or diagnosing wrong or missing BPM/key values. Tells you the files, flow, algorithms, tests and pitfalls so you don't need to scan the code.
---

# Tempo and key

Playlists finds each song's **BPM** from its audio and its **key** from the file's key tag or else the audio, both in the background in the main process. It shows how a song's tempo change (±10%, pitch moving with speed) shifts both, e.g. "120 (123)" and "Ebm (Em)".

Not covered here:
- The tempo slider, saving a tempo change and applying it to playback: the `audio-engine` skill.
- Tables, columns and migrations: the `dba` agent. IPC calls and validation: the `data-api` agent. Secrets, SQL safety, hardening: the `security` agent.
- What users should see and product decisions: the `product` agent (BPM, Key and Tempo bullets).

If the code and this file disagree, the code wins: say so, and fix this file in the same task.

## How to work
- **Questions:** answer from this file first, with file paths and function names. Open code only for detail it doesn't give, and only the files named here.
- **Plans and changes:** work through the layers in the order of "End-to-end flow": the schema change and migration if any, whether old results need retrying ("Retrying"), the tests to add, and the pitfalls that apply. Anything that changes what's shown is a product decision for the user.
- **Reviews:** check the diff against "End-to-end flow", "Pitfalls" and `AGENTS.md` (IPC validated in main, no paths from the renderer, full list returned, tests assert behavior). Report problems with file:line, the consequence, and the fix, most serious first; say plainly when there are none.
- **Diagnosis** (a song shows "—" or a wrong value): work through the flow in order: was the file queued (`*_read` flag), did the worker fail (flag stays 0, retried next launch), did the detector return undefined (flag 1, value NULL), or is it a display issue (`trackDisplay.ts`)? Name the likely cause and how to confirm it.

## Files
| File | Role |
|---|---|
| `src/shared/playlist.ts` | `PlaylistTrack.bpm` (number or null), `.key` (string or null), `.tempo` (percent); `MAX_TEMPO_CHANGE = 10`; `PlaylistApi.onChanged` |
| `src/shared/musicalKey.ts` | Key spellings, `keyName(tonic, minor)`, `transposeKey(key, semitones)`, `camelotCode(key)` (used by DJ mode's harmonic matching). Shared by main and renderer |
| `src/main/audioDecoding.ts` | `decodeAudio(filePath, { sampleRate, maxSeconds, filter? })`: spawns the bundled `ffmpeg-static` and returns mono `Float32Array` samples. Rewrites `app.asar` to `app.asar.unpacked` in the binary path |
| `src/main/trackRhythm.ts` | `detectRhythm(filePath)` → `RhythmAnalysis` `{ bpm, dj }`: BPM and the DJ details in one pass over the audio. The DJ-detail algorithms belong to the `dj` skill |
| `src/main/music-tempo.d.ts` | Types for `music-tempo`, including the parameters passed to it |
| `src/main/trackKey.ts` | `parseKey(tag)`, `keyOfSamples(samples)`, `detectKey(filePath)`: tag first, then the audio |
| `src/main/backgroundAnalysis.ts` | `analyseInWorker(workerPath, kind, filePath)`, `createBackgroundScanner(detect, onDetected)`, `AnalysisResults` type (`rhythm`, `key`) |
| `src/main/analysisWorker.ts` | Worker-thread entry. Gets `{ kind, filePath }` and posts back `{ value }` or `{ error }` |
| `src/main/index.ts` | `rhythmScanner` and `keyScanner`, `scanForMissingDetails()` (after add-audio-files and at launch), `sendPlaylistsToWindows()` (on `playlists:changed`), stopping both scanners on `before-quit` |
| `src/main/playlistDatabase.ts` | `saveRhythm` / `filesNeedingRhythm` (BPM with DJ details), `saveKey` / `filesNeedingKey`, copying bpm, key and DJ details into new copies of a file, `retryMissingTempos` |
| `electron.vite.config.ts` | Main build inputs `index` and `analysisWorker` (the latter becomes `out/main/analysisWorker.js`) |
| `src/renderer/src/trackDisplay.ts` | `formatBpm(bpm, tempo)`, `formatPlayerBpm(bpm, tempo)`, `formatKey(key, tempo)`, `semitoneShift(tempo)` |
| `src/renderer/src/SongTable.tsx` | BPM and KEY columns for Explore and the album and artist pages (uses each song's own `tempo`) |
| `src/renderer/src/App.tsx` | BPM and KEY columns in the playlist table (each song's saved tempo); the player's `currentBpm` / `currentKey` readout, at the playing tempo. In DJ mode that's the DJ's unsaved matched tempo (see the `dj` skill), so the readout can differ from the song's row |
| `package.json` (build.asarUnpack), `.github/workflows/release.yml` | ffmpeg is unpacked from the asar; release packages each architecture separately with its own ffmpeg binary |

## End-to-end flow
**Adding songs:**
1. `playlists:add-audio-files` shows the native dialog, reads the tags, and calls `addAudioFiles`.
2. New rows copy `bpm`/`tempo_read`, `musical_key`/`key_read` and `dj_details`/`dj_read` from any existing row for the same `file_path` whose flag is 1, so the same file isn't analysed twice.
3. `scanForMissingDetails()` queues each file once: the rhythm scanner gets those with `tempo_read = 0 OR dj_read = 0`, the key scanner those with `key_read = 0`.

**At launch:** after tags are read and the window is created, `scanForMissingDetails()` runs again. That picks up songs added just before quitting, unreadable files, and databases from older versions.

**Scanning:**
- Each scanner works through its own queue, one file at a time, in order of `MIN(id)`. The two run at the same time, so at most two worker threads are busy.
- Each job is a new `Worker`, created by `analyseInWorker`.
- On a result, the scanner calls `saveRhythm` (`bpm`, `dj_details` and both flags) or `saveKey`, which updates **every row with that file_path** and sets the flags to 1, even when the BPM or key is undefined. It then sends the full list on `playlists:changed`. DJ details aren't in that list; see the `dj` skill.
- A rhythm job takes about 1 s for a 6-minute song and a key job about 1.5–2 s; they run side by side.
- A failure (missing or undecodable file) leaves the flag at 0, so the file is retried at the next launch.
- A file already waiting in a queue isn't queued twice.

**In the renderer:** `onChanged` → `applyPlaylists`, the same path as any other update. The BPM and KEY columns and the player readout re-render from the new list.

## Data
| Column (`playlist_tracks`) | Meaning |
|---|---|
| `bpm REAL` | Detected BPM to 0.1, or NULL |
| `tempo_read INTEGER` | 1 once detection ran (even with no result) |
| `dj_details TEXT`, `dj_read INTEGER` | The DJ details found in the same pass (JSON), and their flag; see the `dj` skill |
| `musical_key TEXT` | E.g. `Ebm`, `F#`, or NULL; selected `AS key` (`key` is reserved in SQL) |
| `key_read INTEGER` | 1 once found or tried successfully |
| `tempo_change REAL` | The user's speed change for this playlist entry (selected `AS tempo`); written by the tempo control, read here for the shifted display |

BPM and key belong to the **file** (every copy shares them); tempo belongs to the **playlist entry**. Explore and the library show the earliest-added copy, so their brackets use that copy's tempo. Full schema: `dba` agent.

**Retrying:** `retryMissingTempos()` with `tempoDetectorVersion` (in `app_meta` as `tempo_detector`, currently 2). When detection improves, raise the version so rows with `tempo_read = 1 AND bpm IS NULL` are retried once. Rows saved before DJ details existed have `dj_read = 0`, so every such file is analysed once more and its `bpm` is rewritten from the beat grid (it can move by a fraction of a BPM). `redetectRhythm()` with `rhythmDetectorVersion` (`app_meta.rhythm_detector`, currently 4) re-runs the whole rhythm pass (BPM and DJ details) on every file once when raised. Raise it when the grid changes, since the BPM comes from the grid. Keys have no equivalent yet; add a `keyDetectorVersion` the same way if key detection improves.

## Algorithms
**BPM** (`trackRhythm.ts`, in the same pass as the DJ details):
- Decodes once at 11,025 Hz mono, first 1200 s, with **no ffmpeg filter**. ffmpeg's `loudnorm` (used before) took about 8 s for a 6-minute song on its own; the whole pass now takes about 1 s.
- Filters to the low end in JS (a two-pole low-pass at 500 Hz) and runs `new MusicTempo(samples, { sampleRate, bufferSize: 512, hopSize: 110, timeStep: 110 / 11025, initPeriod: 60, expiryTime: 90 })`:
  - `bufferSize` and `hopSize` match its 44.1 kHz defaults at this rate.
  - `timeStep` must be the real hop length: it assumes 10 ms, which made every tempo 0.23% slow.
  - `initPeriod: 60` lets beats start up to a minute in (long intros).
  - `expiryTime: 90` keeps it following the beat through breakdowns. Its default of 10 s lost the beat in a 30 s breakdown and reported no tempo, or half-time.
- When a beat grid is found, the BPM is the grid's exact BPM rounded to 0.1 (see the `dj` skill). Otherwise it's `music-tempo`'s tempo. Accepts 40–250 BPM, else undefined. `music-tempo` throwing (e.g. on silence) gives undefined.
- The grid's tempo comes from searching ±4% around `music-tempo`'s for the tempo that lines up the most kicks across the whole song. A line through `music-tempo`'s own beats was 0.1–1.3% slow on two-thirds of real tracks.
- Checked against rekordbox's grids on 200 real tracks: within 0.02 BPM on 180, against 65 before the search (see the `dj` skill, "Accuracy").
- Type declarations are in `src/main/music-tempo.d.ts`.

**Key** (`trackKey.ts`):
- **Tag first.** `parseFile` reads `common.key` (ID3 `TKEY` / initial key). `parseKey` accepts:
  - note names, case-insensitive, with ♯/♭/#/b and m/min/minor/maj/major
  - Camelot `1–12A/B` (8B = C, 8A = Am, each step a fifth)
  - Open Key `1–12d/m` (1d = C, 1m = Am)
  - Anything else ("o", "Off key", "13A") gives undefined, and the audio is used instead.
- **Audio.** Decodes at 11,025 Hz mono, first 600 s, unfiltered.
  - Hann-windowed 8192-point FFT frames, hop 4096, with a hand-written radix-2 `fft`.
  - Magnitudes of bins between 65 and 2100 Hz are summed into 12 pitch classes (bin → nearest MIDI note mod 12), giving a chromagram of the whole song.
  - The chromagram is correlated (Pearson) with the Krumhansl–Kessler major and minor profiles, rotated to all 24 keys. The best fit wins if it's above `minimumFit = 0.5`, else undefined (drums only, silence).
  - Assumes A = 440 Hz. It can confuse a key with its relative major/minor or with the key a fifth away.
- **Spelling** follows the key signature (`musicalKey.ts`): majors `C Db D Eb E F F# G Ab A Bb B`, minors `Cm C#m Dm Ebm Em Fm F#m Gm G#m Am Bbm Bm`. Every key from parsing, detection or transposition goes through `keyName`.

**Shifted display** (`trackDisplay.ts`):
- `semitoneShift(t) = round(12·log2(1 + t/100))`: 0 below about ±2.9%, ±2 at ±10%.
- `formatKey(key, t)`: `"Ebm"`, or `"Ebm (Em)"` once the shifted key differs.
- `formatBpm(bpm, t)` (lists): whole BPM, with a bracket only when the rounded value changes, e.g. `"120 (123)"`.
- `formatPlayerBpm(bpm, t)` (player): one decimal, with a bracket whenever t ≠ 0, e.g. `"120.0 (123.0) BPM"`.
- Unknown values show "—" in lists and are left out of the player readout.

## Tests
- `src/main/trackRhythm.test.ts` ("detecting a song’s tempo"; the DJ details are in "finding what a DJ needs to mix a song") and `trackKey.test.ts`: real ffmpeg decoding of generated WAVs. `src/main/test/wav.ts` provides `beat(bpm, seconds, { introSeconds })`, `song(bpm, parts, { silenceSeconds })` (parts in bars, with or without kick, bass pad, off-beat bassline and off-beat hi-hats, at a level), `chords(progression)` (MIDI notes with overtones) and `silence()`. `src/main/test/mp3.ts` has `mp3({ ..., key })` for a `TKEY` tag. `parseKey` is checked with a table of tag strings.
- `src/main/backgroundAnalysis.test.ts`: the scanner's order, de-duplication, skipping failures, and stopping.
- `src/main/playlistDatabase.test.ts`: "song tempo", "DJ details" and "song key" (migration, copies, retries). `rhythm(bpm)` builds a scan result.
- `src/main/index.test.ts`: the real handlers, with `./backgroundAnalysis` mocked so `analyseInWorker` runs `detectRhythm` and `detectKey` on the test thread (the built worker file only exists after `npm run build`). Covers launch-time scanning of rows saved by an "older version". Background tests wait up to 10 s, so `vitest.config.ts` sets a 20 s `testTimeout` for all tests (CI runners are slow, and the first test also waits for songs queued at launch).
- Renderer: `tempo.test.tsx` ("song BPM") and `songKey.test.tsx`. The fake desktop takes `bpm` and `key` in song specs and offers `tempoDetected(title, bpm)` / `keyDetected(title, key)` to simulate background results. Fixture rows show "—" for both an unknown BPM and an unknown key, so give fixture songs a known value for the column you're *not* testing, so `getByText('—')` matches one element.

## Pitfalls
- **The worker path.** `analysisWorker.js` must stay a separate build entry. `music-metadata` is ESM-only, so it's bundled (`externalizeDepsPlugin({ exclude: ['music-metadata'] })`) into `out/main/chunks/`, which the main process and the worker share. `music-tempo` and `ffmpeg-static` stay external `require`s.
- **ffmpeg in packaged apps.** It must stay in `asarUnpack`, and release builds install the right binary per architecture. It's GPL-licensed and adds tens of MB per platform.
- **Long files.** Key scans decode the first 10 minutes (about 26 MB of samples). Rhythm scans decode the first 20 minutes (about 53 MB, filtered in place), since DJ details need the end of the song.
- **No ffmpeg filters for speed.** Filters like `loudnorm` cost far more than the analysis. Filter in JS on the decoded samples instead.
- **Undefined is a result.** A detector returning undefined sets the flag to 1 and is never retried, unless a detector version is raised. Throwing leaves the flag at 0 and retries every launch. Choose deliberately.
- **Analysis isn't playback.** The ffmpeg decode is for detection only; don't reuse it to play or process audio (see the `audio-engine` skill).

## Recipes
- **Another detected detail** (e.g. loudness): add it to `AnalysisResults` and the switch in `analysisWorker.ts`. Add a `detectX` module using `decodeAudio`, columns `x` and `x_read` in the migration, `filesNeedingX` and `saveX`, the copy-from-existing-file subqueries in `addAudioFiles` and `addTrack`, a scanner in `index.ts` added to `scanForMissingDetails` and `before-quit`, the field on `PlaylistTrack`, and the fake desktop field plus an `xDetected` helper.
- **Better key detection:** change `keyOfSamples`. Add a key detector version mirroring `retryMissingTempos` so old "no key" rows are retried. Extend `chords()` fixtures for any new case.
- **Better BPM detection:** change `trackRhythm.ts`, raise `tempoDetectorVersion` (or reset `dj_read` once, guarded by an `app_meta` key, to re-run everything), and add `beat()` or `song()` fixtures for the new case.
- **Camelot display:** `camelotCode` in `musicalKey.ts` already maps keys; add an option in `formatKey`. Keep the stored key as the note name.

## Keeping this file current
Any change to the files in the table above that alters how detection or the shifted display works must update this file in the same task, as `AGENTS.md` requires. That includes files added, moved or renamed, schema changes, constants, flows and tests. Changes to the slider, saving or playback go in the `audio-engine` skill instead. Keep it a reference: facts, file names and reasons, not a change log.

The first column of the Files table is also what `.claude/hooks/check-agent-docs.mjs` watches. When Claude finishes a turn having changed a listed file without changing this one, the hook sends Claude back once to update it, or to say why the change doesn't affect it. Keep backticked paths in that column only for real files or folders (a folder ends in `/`).
