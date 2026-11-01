---
name: audio-engine
description: How audio playback works in the Playlists app and how to change it safely. Use before any change to playing, pausing, seeking, volume, the tempo slider and playback speed, shuffle, the queue, next/previous, song endings, audio streaming, artwork serving, or a new audio feature (crossfade, gapless, repeat, equaliser, visualiser, output device, media keys, key lock). Tells you where playback lives and what the platform can and can't do, so you don't need to scan the code.
---

# Audio engine

Playlists plays audio with **one HTML `<audio>` element in the renderer**, fed by a custom `playlist-audio://` protocol in the main process. There is no Web Audio graph, no `AudioContext` and no playback library. BPM and key analysis decode audio separately in main with ffmpeg; that path is never used for playback. For detection, and for how BPM and key are shown at a changed tempo, load the `tempo-and-key` skill.

If the code and this file disagree, the code wins: say so, and fix this file in the same task.

## Rules
1. **Inspect before changing.** Read the parts of `src/renderer/src/App.tsx` named below and the relevant tests before editing. Check `package.json` for audio dependencies rather than assuming one.
2. **Know who owns what.** The renderer owns playback and all playback state. Main owns file access (streaming, artwork) and analysis. Don't move playback into main, and don't give the renderer file access.
3. **One engine.** Extend the existing `<audio>` element and its effects. Don't add a second playback path (another `<audio>`, an `AudioContext` playing files itself, Howler, Tone.js, the `audiorective` packages) unless the user agrees to replace the engine. The `audiorective` Claude Code plugin is enabled in `.claude/settings.json`, but its packages are not dependencies of this app.
4. **Keep audio behavior apart from presentation.** Put pure logic (play order, formatting, mapping) in plain functions, like `trackDisplay.ts` does, and keep the element control in the effects and handlers listed below. Don't spread `audioRef.current` access through JSX.
5. **Verify capabilities.** Don't assume the element, Chromium, Electron or the protocol supports something. Check "Platform facts" below. For anything not listed, prove it in `npm run dev` before building on it, and record what you found here.

## Files
| File | Role |
|---|---|
| `src/renderer/src/App.tsx` | The `<audio>` element (in the player footer), all playback state, the effects that drive the element, every playback action, and the player bar's seek, tempo and volume sliders |
| `src/renderer/src/trackDisplay.ts` | Pure helpers: `librarySongs`, `libraryAlbums`, `libraryArtists` (Explore/library play lists), `formatDuration`; BPM/key formatting is owned by `tempo-and-key` |
| `src/renderer/src/SongTable.tsx`, `ExploreView.tsx`, `LibraryView.tsx` | Song lists that call back into `App`'s play actions (`playFrom`, `playLibrary`); `LibrarySource` type |
| `src/renderer/src/TrackArt.tsx` | Artwork from `playlist-audio://artwork/<id>`, falling back to an icon |
| `src/renderer/src/styles.css`, `playlist.css` | Player bar layout (`.player-*`); the tempo control (`.player-tempo`, `.tempo-readout`, `.tempo-reset`, `.tempo-hit`, `.tempo-track`) |
| `src/main/audioProtocol.ts` | `registerAudioScheme()` (privileged: `standard`, `secure`, `stream`, `supportFetchAPI`) and `handleAudioRequests(getTrackFilePath)`: streams `track/<id>` with byte ranges and MIME types, and serves `artwork/<id>` |
| `src/main/index.ts` | Registers the scheme before ready and the handler after the database opens; the add-files dialog's extension filter; `playlists:set-track-tempo` |
| `electron.vite.config.ts` | CSP: `media-src 'self' playlist-audio:` and `img-src ... playlist-audio:` |
| `src/renderer/src/test/setup.ts` | jsdom's stand-in for media playback |
| `src/renderer/src/test/app.tsx`, `fakeDesktop.ts` | Player test helpers; the fake main process (`setTrackTempo` behaves like the real one) |

## Playback state (all in `App`)
| State | Meaning |
|---|---|
| `source: PlaySource` | What's playing from: `'playlist'` (the open playlist), `'explore'`, or a `LibrarySource` (`album:<key>` / `artist:<lowercased name>`) |
| `playingTracks` (derived) | `tracksFor(source)`: the open playlist's tracks, or `librarySourceTracks(source, songs)` |
| `activeTrack: number` | **Index** into `playingTracks`; `currentTrack = playingTracks[activeTrack]` |
| `playing: boolean` | Whether the user wants it playing; the element follows it |
| `shuffleOrder: number[] \| null` | Track IDs in shuffled order, or null when shuffle is off |
| `queue: number[]` | Queued track IDs (copies in the playing list); duplicates allowed |
| `resumeFrom: number \| null` | Index to return to after queued songs |
| `position`, `duration` | From `timeupdate` and `loadedmetadata`; `duration` is null until known |
| `volume` (0–1), `muted` | `volume` saved in `localStorage` under `volume`; muting isn't saved |
| `tempo` (derived) | `currentTrack?.tempo ?? 0`, read from `playlists` (saved values with `unsavedTempos` laid over them; see "Tempo control") |

Nothing else survives a restart: no last song, position, queue or shuffle. Tempo is saved to the database per playlist entry.

## How the element is driven
Effects, in this order (the order matters):
1. `[volume, muted]`: sets `audio.volume` and `audio.muted`.
2. `[tempo, currentTrack?.id]`: `preservesPitch = false`, `defaultPlaybackRate` and `playbackRate` = `1 + tempo / 100`. It must come before effect 4, because loading a new `src` resets the rate to `defaultPlaybackRate`.
3. `[volume]`: saves the volume to `localStorage`.
4. `[currentTrack?.id]`: resets `position`/`duration`, sets `src = playlist-audio://track/<id>`, or removes `src` and calls `load()` when there's no song.
5. `[playing, currentTrack?.id]`: `play()` or `pause()`. An `AbortError` from `play()` (source changed mid-load) is ignored; any other rejection sets `playing` false.

Element events: `onTimeUpdate` → `position`; `onLoadedMetadata` → `duration` (null if not finite); `onEnded` → `handleTrackEnded` (`advance(false)`, else stop); `onError` → `handlePlaybackError` (stop and alert "Couldn't play “<title>”…").

Actions:
- **Order:** `playOrder()` (indices in play order; drops removed songs from the shuffle and appends new ones), `trackIndexAfter(step, wrap)`, `toggleShuffle()` (`shuffledIds` keeps the current song first).
- **Moving:** `playTrackAt(index)` restarts instead of reloading when the index is already loaded. `advance(wrap)` plays the queue first, then the list. `playNext()` wraps. `playPrevious()` restarts if more than 3 s in, else returns to `resumeFrom`, else goes back one. `handleTrackEnded()` doesn't wrap.
- **Starting:** `playTrackNow(index)`, `playFrom(source, track)` (switching source clears the queue and reshuffles if shuffle is on), `playLibrary(source, song?)`, `playFromQueue(position)`, `addToQueue(track)` (queues the playing list's copy by `filePath`).
- **Controls:** `seekTo(seconds)` (clamped; needs `duration`), `seekToPointer`, `changeVolume` (rounds to 0.01 and unmutes), `toggleMute` (unmuting from 0 gives 0.5), `changeTempo` (see below), and the key handlers for the seek, volume and tempo sliders.
- **Data updates:** `applyPlaylists(updated)` replaces the saved playlists. When playing from Explore or the library, it re-maps `activeTrack`, `resumeFrom`, `queue` and `shuffleOrder` by `filePath`, and stops if the playing song is gone. Background updates arrive through `onChanged` → `applyPlaylistsRef.current`.

## Tempo control
A per-song, per-playlist speed change of ±`MAX_TEMPO_CHANGE` (10%), stored as `tempo_change` on the playlist entry and returned as `PlaylistTrack.tempo`.

**Changing it** (`changeTempo(percent)`):
1. Does nothing with no `currentTrack`. Clamps to ±10 and rounds to 0.1 (`|| 0` turns −0 into 0).
2. Puts the value in `unsavedTempos` (a `Map` keyed by track ID). `playlists` is a `useMemo` of `withTempos(savedPlaylists, unsavedTempos)`, so the change is heard and shown immediately, even if a background update replaces `savedPlaylists` mid-drag.
3. Restarts that track's timer in `tempoSaveTimers`; after `TEMPO_SAVE_DELAY_MS` (300 ms) it calls `setTrackTempo(trackId, value)`. The result goes through `applyPlaylistsRef.current`, then `forgetUnsavedTempo` drops the overlay only if no newer change is pending for that track.
4. If saving fails, the overlay is dropped (back to the saved value) and an alert shows.
5. On `pagehide` or unmount, every pending save is sent at once.

**The slider** (`role="slider"`, name "Tempo"): `aria-valuemin/max` ±10, `aria-valuenow` = tempo, `aria-disabled` with no current track. `aria-valuetext` joins `formatTempo(tempo)` (e.g. "+2.5%", "−1.0%", "0%"), the player BPM and `key <formatKey>`, leaving out unknown parts. Pointer: `tempoToPointer` maps the bar's width to −10…+10 with pointer capture for dragging. Keys (`handleTempoKey`): ←/↓ and →/↑ ±0.1, Page Down/Up ±1, Home −10, End +10. Double-click and the "Reset tempo" button (disabled at 0) go back to 0. The readout above it shows key, BPM and the change.

**Playback:** effect 2 above. Pitch moves with speed on purpose (see "Platform facts").

## Streaming (main)
- URL form: `playlist-audio://track/<trackId>` and `playlist-audio://artwork/<trackId>`. Anything else → 400. The ID is resolved through `getTrackFilePath`, so only files saved in the database are served; a path is never taken from the URL.
- Supports `Range: bytes=start-end`, `start-` and `-suffix` (206 with `Content-Range`), returns 416 past the end, 404 for an unknown ID or missing file, 200 with an empty body for an empty file. Seeking depends on range support.
- MIME types by extension: mp3 `audio/mpeg`, m4a `audio/mp4`, aac `audio/aac`, wav `audio/wav`, aiff `audio/aiff`, flac `audio/flac`, ogg and opus `audio/ogg`; anything else `application/octet-stream`.
- Artwork is read live with `music-metadata` (`readTrackArtwork`) and isn't stored; 404 means no artwork.

## Platform facts
Verified and in use (Electron 36 / Chromium):
- `HTMLMediaElement` `play`/`pause`, `currentTime`, `duration`, `volume`, `muted`, `playbackRate`, `defaultPlaybackRate`, `preservesPitch`, and the `ended`/`error`/`timeupdate`/`loadedmetadata` events.
- Setting `src` resets `playbackRate` to `defaultPlaybackRate`.
- `preservesPitch = true` makes music stutter in Chromium, so tempo moves pitch like a turntable (+10% is about 1.6 semitones). Key lock needs a real time-stretch library (e.g. SoundTouch) on a Web Audio path.

Not verified; check in `npm run dev` before relying on them:
- **Formats:** the dialog accepts mp3, m4a, aac, wav, aiff, flac, ogg and opus, but decoding is up to Chromium. AIFF in particular may not play; an unplayable file shows the error alert.
- **Web Audio on this scheme** (equaliser, visualiser, crossfade, key lock): `createMediaElementSource` outputs silence for a cross-origin source unless the response is CORS-enabled. `playlist-audio:` isn't registered with `corsEnabled`, and responses send no `Access-Control-Allow-Origin`. Expect to change `registerAudioScheme`, the response headers and `crossOrigin` on the element, and get the user's agreement first, since this changes the engine.
- **Gapless or crossfade** isn't possible with one element; it needs a second element or Web Audio, which is an engine decision for the user.
- **Output device choice** (`setSinkId`, listing outputs) may hit the permission handlers in `index.ts`, which deny all permission requests. Loosening them needs the user's sign-off (`.claude/agents/security.md`).
- **OS media keys / Now Playing** (`navigator.mediaSession`): not used yet. Check it works in Electron on macOS and Windows before building on it.
- Any new media source scheme (e.g. `blob:`) needs a CSP change in `electron.vite.config.ts`, production included only if truly required.

## Tests
- jsdom can't play media. `src/renderer/src/test/setup.ts` replaces `HTMLMediaElement` members: `play`/`pause` flip `paused`; `load` pauses and rewinds; setting `src` rewinds, clears `duration` and resets `playbackRate` to `defaultPlaybackRate`; `currentTime`, `duration`, `playbackRate`, `defaultPlaybackRate` and `preservesPitch` are stored. Any new element property or method you use must be added there, behaving like the real one.
- Helpers in `test/app.tsx`: `player()` → `{ song, playing, time, volume, speed, keepsPitch }` (read from the element; `speed` is a percentage, e.g. 110), `expectPlaying(title)`, `songLoaded(seconds)`, `playTo(seconds)`, `songEnds()`, `songFailsToLoad()`, `playerButton('Play' | 'Pause' | 'Next' | 'Previous' | 'Shuffle')`, `songButton(title)`, `songRow(title)`, `artworkButton(title)`, `volumeLeftAt(percent)`, `tempoSlider()`, `pressOnTempo(...keys)`, `queuePanel()`, `queueContents()`, `queueButton()`. Add to these rather than reaching into the DOM.
- The fake desktop takes `tempo` in song specs and implements `setTrackTempo` like main (a copied song starts at 0). Tempo saves are debounced, so assert on `desktop.saved()` inside `waitFor`, or fire `pagehide` to save at once.
- Renderer suites: `playback.test.tsx` (play/pause, next/previous, seeking, shuffle, volume), `queue.test.tsx`, `tempo.test.tsx` ("tempo control"), `explore.test.tsx` and `library.test.tsx` (playing from those sources), `artwork.test.tsx`. Main: `src/main/audioProtocol.test.ts` (streaming, ranges, artwork).
- Assert on what's heard and shown (`player()`, labels, text), never on component state. Cover the product edge cases: empty playlist, last song, shuffle on, removed or missing songs, switching playlists, duplicates in the queue.

## Pitfalls
- `activeTrack` and `resumeFrom` are **indices**; `queue` and `shuffleOrder` are **IDs**. Anything that changes the list must keep them pointing at the same songs.
- Explore and the library play the **earliest-added copy** of each file, so the ID playing (and the tempo used) may belong to a different playlist from the one on screen.
- Setting `src` to the same ID doesn't reload; `playTrackAt` and `playFrom` reset `currentTime` instead.
- Setting `src` resets `playbackRate`; that's why effect 2 also sets `defaultPlaybackRate` and runs before effect 4.
- Read `playlists` (with the tempo overlay), never `savedPlaylists`, when rendering or playing; anything that replaces `savedPlaylists` must leave `unsavedTempos` alone.
- Don't call `setTrackTempo` on every slider move; each save rewrites the database file. That's what the 300 ms debounce is for.
- Pending tempo-save timers are flushed on unmount. Without that they'd fire against the next test's fake desktop.
- `App.tsx` is about 1,400 lines. Moving playback into a `usePlayer` hook or module is fine if behavior and tests stay the same, but do it as its own change.

## Recipes
- **Repeat (one / all):** add state next to `shuffleOrder`; change `handleTrackEnded` (repeat one: `currentTime = 0` and play; repeat all: `advance(true)`). Add the button near Shuffle with `aria-pressed`, plus tests in `playback.test.tsx`.
- **Remember the last song and position:** store `source`, the track ID and `position` (IDs, not indices) in `localStorage`, like `volume`; restore after `list()` resolves, falling back silently if the song is gone.
- **Media keys / Now Playing:** set `navigator.mediaSession.metadata` in an effect on `currentTrack`, and register action handlers that call `setPlaying`, `playNext` and `playPrevious`. Verify on both platforms first.
- **A tempo per file instead of per playlist entry:** a product decision first (update `product.md`). Then `setTrackTempo` updates by `file_path`, `addAudioFiles` and `addTrack` copy `tempo_change` (see the `database-design` agent), and `withTempos` and the fake desktop apply the value to every copy.
- **Equaliser, visualiser, crossfade or key lock:** an engine change. Confirm with the user, enable CORS on `playlist-audio:` (see "Platform facts"), and build one `AudioContext` graph fed by the existing element (`createMediaElementSource`) rather than a parallel player.

## Keeping this file current
When a change alters playback state, effects, actions, the tempo control, streaming, the test stand-ins or helpers, or proves a platform fact, update this file in the same task. Move items from "Not verified" to "Verified" only after checking them in the running app.
