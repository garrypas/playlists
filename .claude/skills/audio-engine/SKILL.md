---
name: audio-engine
description: How audio playback works in the Playlists app and how to change it safely. Use before any change to playing, pausing, seeking, volume, the tempo slider and playback speed, shuffle, the queue, next/previous, song endings, audio streaming, artwork serving, or a new audio feature (crossfade, gapless, repeat, equaliser, visualiser, output device, media keys, key lock). Tells you where playback lives and what the platform can and can't do, so you don't need to scan the code.
---

# Audio engine

Playlists plays audio with **two HTML `<audio>` elements ("decks") in the renderer**, fed by a custom `playlist-audio://` protocol in the main process.
- The **live deck** plays the current song. The other deck is used only by DJ mode, to play the next song into the current one.
- Without DJ mode, only deck 0 is ever live.
- There's no playback library.
- The first time DJ mode is on (a click, or at launch if it was left on), both decks are routed, permanently, through a small Web Audio graph: per deck, a bass filter, high-pass and low-pass sweep filters (wide open except in a filter fade) and a mix-level gain (`dj/deckEq.ts`). Elements still do the playing.
- Mixing logic lives in the `dj` skill. BPM and key analysis decode audio separately in main with ffmpeg; that path is never used for playback. For detection, and for how BPM and key are shown at a changed tempo, load the `tempo-and-key` skill.

If the code and this file disagree, the code wins: say so, and fix this file in the same task.

## Rules
1. **Inspect before changing.** Read the parts of `src/renderer/src/App.tsx` named below and the relevant tests before editing. Check `package.json` for audio dependencies rather than assuming one.
2. **Know who owns what.** The renderer owns playback and all playback state. Main owns file access (streaming, artwork) and analysis. Don't move playback into main, and don't give the renderer file access.
3. **One engine.** Extend the existing two decks and their effects. Don't add another playback path (a third `<audio>`, an `AudioContext` playing decoded files itself, Howler, Tone.js, the `audiorective` packages) unless the user agrees to replace the engine. The user agreed to the second deck and the bass-filter graph for DJ mode. The `audiorective` Claude Code plugin is enabled in `.claude/settings.json`, but its packages are not dependencies of this app.
4. **Keep audio behavior apart from presentation.** Put pure logic (play order, formatting, mapping) in plain functions, like `trackDisplay.ts` does, and keep the element control in the effects and handlers listed below. Reach the decks through `liveAudio()` and `otherAudio()`, never through `deckA`/`deckB` directly, and don't spread deck access through JSX.
5. **Verify capabilities.** Don't assume the element, Chromium, Electron or the protocol supports something. Check "Platform facts" below. For anything not listed, prove it in `npm run dev` before building on it, and record what you found here.

## Files
| File | Role |
|---|---|
| `src/renderer/src/App.tsx` | The two `<audio>` decks (in the player footer; `crossOrigin="anonymous"`, `data-deck="live"` on the live one), all playback state, the effects that drive the live deck, every playback action, DJ mode's runner (see the `dj` skill), and the player bar's DJ-mode button, seek, tempo and volume sliders |
| `src/renderer/src/dj/deckEq.ts` | `createDeckEq(elements)`: routes each deck through a lowshelf, a highpass (10 Hz open) and a lowpass (20 kHz open) `BiquadFilterNode`, then a `GainNode`, in one `AudioContext`. `setBass(element, 0–1)`, `setFilters(element, highPass 0–1, lowPass 0–1)` (high-pass up to 2 kHz, low-pass down to 200 Hz, evenly in octaves), `setLevel(element, 0–1)` (glides with a 0.015 s time constant, so 50 ms updates don't zipper) and `resume()`. Null without Web Audio |
| `src/renderer/src/trackDisplay.ts` | Pure helpers: `librarySongs`, `libraryAlbums`, `libraryArtists` (Explore/library play lists), `formatDuration`; BPM/key formatting is owned by `tempo-and-key` |
| `src/renderer/src/SongTable.tsx`, `ExploreView.tsx`, `LibraryView.tsx` | Song lists that call back into `App`'s play actions (`playFrom`, `playLibrary`); `LibrarySource` type |
| `src/renderer/src/TrackArt.tsx` | Artwork from `playlist-audio://artwork/<id>`, falling back to an icon |
| `src/renderer/src/styles.css`, `playlist.css` | Player bar layout (`.player-*`); the tempo control (`.player-tempo`, `.tempo-readout`, `.tempo-reset`, `.tempo-hit`, `.tempo-track`) |
| `src/main/audioProtocol.ts` | `registerAudioScheme()` (privileged: `standard`, `secure`, `stream`, `supportFetchAPI`, `corsEnabled`; every track response sends `Access-Control-Allow-Origin: *`) and `handleAudioRequests(getTrackFilePath)`: streams `track/<id>` with byte ranges and MIME types, and serves `artwork/<id>` |
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
| `tempo` (derived) | In DJ mode, `djTempo.percent` when it's for `currentTrack` (unrounded, so beats stay matched); otherwise `currentTrack?.tempo ?? 0`, read from `playlists` (saved values with `unsavedTempos` laid over them; see "Tempo control") |
| `liveDeck: 0 \| 1` (+ `liveDeckRef`) | Which deck plays the current song; it changes only at a DJ-mode swap. `deckTrackIds` (ref) holds the track ID loaded on each deck |
| `djMode`, `djTempo`, `mix`, `djDetails` | DJ mode (saved in `localStorage` under `djMode` as `'on'`/`'off'`; off the first time), its unsaved tempo, the planned or running transition, and fetched DJ details by file path (see the `dj` skill) |

Nothing else survives a restart: no last song, position, queue or shuffle. The `[djMode]` effect saves DJ mode and, while it's on, creates the deck graph the first time. Tempo is saved to the database per playlist entry.

## How the decks are driven
Effects act on the **live deck** (`liveAudio()`), in this order (the order matters):
1. `[volume, muted]`: sets `muted` on both decks. The live deck's `volume` is set here, unless a mix is running, in which case the DJ runner sets both decks' levels through `setDeckLevel`: the mix level on the deck's gain and the volume on the element, or both on the element without Web Audio.
2. `[tempo, currentTrack?.id, liveDeck]`: `preservesPitch = false`, `defaultPlaybackRate` and `playbackRate` = `1 + tempo / 100`. It must come before effect 4, because loading a new `src` resets the rate to `defaultPlaybackRate`.
3. `[volume]`: saves the volume to `localStorage`.
4. `[currentTrack?.id, liveDeck]`:
   - If the live deck already holds that track (a DJ swap), it takes `position` and `duration` from that deck.
   - Otherwise it resets them and sets `src = playlist-audio://track/<id>`, or removes `src` and calls `load()` when there's no song.
5. `[playing, currentTrack?.id]`: `play()` or `pause()`. An `AbortError` from `play()` (source changed mid-load) is ignored; any other rejection sets `playing` false.

**Deck events:**
- Only the live deck's events do the usual work: `onTimeUpdate` → `position`; `onLoadedMetadata` → `duration` (null if not finite); `onEnded` → `handleTrackEnded`; `onError` → `handlePlaybackError` (stop and alert "Couldn't play “<title>”…").
- `handleTrackEnded`:
  - swaps decks if a mix is mid-way;
  - otherwise it ends any mix, then `advance(false)`, or stops.
- On the other deck, `ended` and `error` end the mix.
- Every `timeupdate` also runs DJ mode's tick.

Actions:
- **Order:** `playOrder()` (indices in play order; drops removed songs from the shuffle and appends new ones), `trackIndexAfter(step, wrap)`, `toggleShuffle()` (`shuffledIds` keeps the current song first).
- **Moving:**
  - `playTrackAt(index)` restarts instead of reloading when the index is already loaded.
  - `nextUp(wrap)` gives the next step: the queue first, then the list. `leaveFor(step)` updates the queue and `resumeFrom` for that step. `advance(wrap)` is the two followed by `playTrackAt`, and DJ mode's swap uses the same two. `playNext()` wraps. `playPrevious()` restarts if more than 3 s in, else returns to `resumeFrom`, else goes back one. `handleTrackEnded()` doesn't wrap.
- **Starting:** `playTrackNow(index)`, `playFrom(source, track)` (switching source clears the queue and reshuffles if shuffle is on), `playLibrary(source, song?)`, `playFromQueue(position)`, `addToQueue(track)` (queues the playing list's copy by `filePath`).
- **Controls:** `toggleDjMode()`, `seekTo(seconds)` (clamped; needs `duration`; ends any DJ mix), `seekToPointer`, `changeVolume` (rounds to 0.01 and unmutes), `toggleMute` (unmuting from 0 gives 0.5), `changeTempo` (see below), and the key handlers for the seek, volume and tempo sliders.
- **Data updates:** `applyPlaylists(updated)` replaces the saved playlists. When playing from Explore or the library, it re-maps `activeTrack`, `resumeFrom`, `queue` and `shuffleOrder` by `filePath`, and stops if the playing song is gone. Background updates arrive through `onChanged` → `applyPlaylistsRef.current`.

## Tempo control
A per-song, per-playlist speed change of ±`MAX_TEMPO_CHANGE` (10%), stored as `tempo_change` on the playlist entry and returned as `PlaylistTrack.tempo`.

**Changing it** (`changeTempo(percent)`):
1. Does nothing with no `currentTrack`, or in DJ mode (the DJ sets the tempo). Clamps to ±10 and rounds to 0.1 (`|| 0` turns −0 into 0).
2. Puts the value in `unsavedTempos` (a `Map` keyed by track ID). `playlists` is a `useMemo` of `withTempos(savedPlaylists, unsavedTempos)`, so the change is heard and shown immediately, even if a background update replaces `savedPlaylists` mid-drag.
3. Restarts that track's timer in `tempoSaveTimers`; after `TEMPO_SAVE_DELAY_MS` (300 ms) it calls `setTrackTempo(trackId, value)`. The result goes through `applyPlaylistsRef.current`, then `forgetUnsavedTempo` drops the overlay only if no newer change is pending for that track.
4. If saving fails, the overlay is dropped (back to the saved value) and an alert shows.
5. On `pagehide` or unmount, every pending save is sent at once.

**The slider** (`role="slider"`, name "Tempo"): `aria-valuemin/max` ±10, `aria-valuenow` = tempo to 0.1, `aria-disabled` with no current track or in DJ mode (pointer, keys, double-click and "Reset tempo" do nothing then; the title says DJ mode sets the tempo). `aria-valuetext` joins `formatTempo(tempo)` (e.g. "+2.5%", "−1.0%", "0%"), the player BPM and `key <formatKey>`, leaving out unknown parts. Pointer: `tempoToPointer` maps the bar's width to −10…+10 with pointer capture for dragging. Keys (`handleTempoKey`): ←/↓ and →/↑ ±0.1, Page Down/Up ±1, Home −10, End +10. Double-click and the "Reset tempo" button (disabled at 0) go back to 0. The readout above it shows key, BPM and the change.

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
- **Web Audio on `playlist-audio:`** was checked in Electron 36 with a hidden sandboxed window: an element with `crossOrigin="anonymous"` on the scheme, registered `corsEnabled` and answering `Access-Control-Allow-Origin: *`.
  - It plays, and `createMediaElementSource` hears it (RMS 0.347 for a 220 Hz sine at −6 dBFS).
  - The element's `volume` scales what Web Audio receives exactly (0.25 → a quarter), and `muted` makes it silent.
  - A lowshelf filter's gain works on it, and so does a `GainNode` with `setTargetAtTime` (0.5 → half). Without CORS the source node outputs silence.
  - Highpass and lowpass sweeps work on it too: a highpass at 2 kHz takes a 220 Hz tone from 0.347 to 0.004. Wide open (10 Hz highpass, 20 kHz lowpass, Q 1) the level is unchanged (0.346), so normal playback isn't coloured.
- The `AudioContext` is `running` as soon as it's created, with no click (Electron's autoplay policy). That's why DJ mode can set it up at launch. Playing calls `resume()` anyway.
- Setting `element.volume` takes effect without smoothing, so changing it every 50 ms during a fade buzzes ("zipper noise"). Mix levels go on the deck's gain.

Not verified; check in `npm run dev` before relying on them:
- **Formats:** the dialog accepts mp3, m4a, aac, wav, aiff, flac, ogg and opus, but decoding is up to Chromium. AIFF in particular may not play; an unplayable file shows the error alert.
- **DJ mode by ear:** whether two decks stay in phase on real tracks.
  - `currentTime` jitter and `play()` latency are handled by the runner's preroll and its rate nudging, but haven't been listened to.
  - Changing `playbackRate` many times a second (the nudges) hasn't been checked for audible glitches.
- **Output device choice** (`setSinkId`, listing outputs) may hit the permission handlers in `index.ts`, which deny all permission requests. Loosening them needs the user's sign-off (`.claude/agents/security.md`).
- **OS media keys / Now Playing** (`navigator.mediaSession`): not used yet. Check it works in Electron on macOS and Windows before building on it.
- Any new media source scheme (e.g. `blob:`) needs a CSP change in `electron.vite.config.ts`, production included only if truly required.

## Tests
- jsdom can't play media. `src/renderer/src/test/setup.ts` replaces `HTMLMediaElement` members: `play`/`pause` flip `paused`; `load` pauses and rewinds; setting `src` rewinds, clears `duration` and resets `playbackRate` to `defaultPlaybackRate`; `currentTime`, `duration`, `playbackRate`, `defaultPlaybackRate` and `preservesPitch` are stored. Any new element property or method you use must be added there, behaving like the real one.
- It also installs a minimal `AudioContext`.
  - It supports `createMediaElementSource`, `createBiquadFilter`, `createGain`, `destination`, `state` and `resume`.
  - `setTargetAtTime` jumps straight to its target.
  - Each node records what it's connected to (`next`), and each element's source is in `globalThis.testDeckGraphs`. `heard()` walks that chain: a node with a `frequency` is the bass filter, and any other gain multiplies the element's volume.
- Helpers in `test/app.tsx`:
  - `player()` → `{ song, playing, time, volume, speed, keepsPitch }`. It's read from the **live** deck; `speed` is a percentage, e.g. 110.
  - `heard()` → `{ [title]: { volume, speed, bass, filter? } }` for every deck playing above zero volume.
    - `volume` is the element's volume times the deck's gain.
    - `filter` is `'high-pass'` (cutoff above 40 Hz) or `'low-pass'` (below 10 kHz), and is present only while one is audibly engaged.
    - The fake filters tell themselves apart by `type`.
  - `relaunch(playlists)` closes the app and opens it again with the same `localStorage` (the volume, DJ mode).
  - `playTo(seconds)` moves the live deck and also advances any other playing deck by the same real time, at its own speed, as real playback would.
  - DJ helpers: `djModeButton()`, `djStatus()`, `djTrack(bpm, { bars, firstBeat, phraseStart, drops })` (a `DjDetails` for song specs).
  - Also: `expectPlaying(title)`, `songLoaded(seconds)`, `playTo(seconds)`, `songEnds()`, `songFailsToLoad()`, `playerButton('Play' | 'Pause' | 'Next' | 'Previous' | 'Shuffle')`, `songButton(title)`, `songRow(title)`, `artworkButton(title)`, `volumeLeftAt(percent)`, `tempoSlider()`, `pressOnTempo(...keys)`, `queuePanel()`, `queueContents()`, `queueButton()`.
  - Add to these rather than reaching into the DOM.
- The fake desktop takes `tempo` in song specs and implements `setTrackTempo` like main (a copied song starts at 0). Tempo saves are debounced, so assert on `desktop.saved()` inside `waitFor`, or fire `pagehide` to save at once.
- Renderer suites: `playback.test.tsx` (play/pause, next/previous, seeking, shuffle, volume), `queue.test.tsx`, `tempo.test.tsx` ("tempo control"), `explore.test.tsx` and `library.test.tsx` (playing from those sources), `artwork.test.tsx`, `djMode.test.tsx` (see the `dj` skill). Main: `src/main/audioProtocol.test.ts` (streaming, ranges, artwork, CORS).
- Assert on what's heard and shown (`player()`, labels, text), never on component state. Cover the product edge cases: empty playlist, last song, shuffle on, removed or missing songs, switching playlists, duplicates in the queue.

## Pitfalls
- `activeTrack` and `resumeFrom` are **indices**; `queue` and `shuffleOrder` are **IDs**. Anything that changes the list must keep them pointing at the same songs.
- Explore and the library play the **earliest-added copy** of each file, so the ID playing (and the tempo used) may belong to a different playlist from the one on screen.
- Setting `src` to the same ID doesn't reload; `playTrackAt` and `playFrom` reset `currentTime` instead.
- Setting `src` resets `playbackRate`; that's why effect 2 also sets `defaultPlaybackRate` and runs before effect 4.
- Read `playlists` (with the tempo overlay), never `savedPlaylists`, when rendering or playing; anything that replaces `savedPlaylists` must leave `unsavedTempos` alone.
- Don't call `setTrackTempo` on every slider move; each save rewrites the database file. That's what the 300 ms debounce is for.
- Pending tempo-save timers are flushed on unmount. Without that they'd fire against the next test's fake desktop.
- **Two decks:** use `liveAudio()` for anything about the current song. Only DJ mode's runner touches `otherAudio()`. The live deck changes at a swap, so event handlers check `liveDeckRef`, not a captured index. Moving an `<audio>` in the DOM pauses it, so the decks are never reordered; `data-deck` marks the live one.
- **Web Audio routing is permanent:** once DJ mode has been on, both decks play through the `AudioContext` until the window closes. If it's suspended, nothing is heard.
- `App.tsx` is about 1,700 lines. Moving playback into a `usePlayer` hook or module is fine if behavior and tests stay the same, but do it as its own change.

## Recipes
- **Repeat (one / all):** add state next to `shuffleOrder`; change `handleTrackEnded` (repeat one: `currentTime = 0` and play; repeat all: `advance(true)`). Add the button near Shuffle with `aria-pressed`, plus tests in `playback.test.tsx`.
- **Remember the last song and position:** store `source`, the track ID and `position` (IDs, not indices) in `localStorage`, like `volume`; restore after `list()` resolves, falling back silently if the song is gone.
- **Media keys / Now Playing:** set `navigator.mediaSession.metadata` in an effect on `currentTrack`, and register action handlers that call `setPlaying`, `playNext` and `playPrevious`. Verify on both platforms first.
- **A tempo per file instead of per playlist entry:** a product decision first (update `product.md`). Then `setTrackTempo` updates by `file_path`, `addAudioFiles` and `addTrack` copy `tempo_change` (see the `dba` agent), and `withTempos` and the fake desktop apply the value to every copy.
- **Equaliser, visualiser or key lock:** confirm with the user, then extend `dj/deckEq.ts`'s graph (CORS is already on; see "Platform facts") rather than adding a parallel player. Remember `createMediaElementSource` can be called only once per element.

## Keeping this file current
When a change alters playback state, effects, actions, the tempo control, streaming, the test stand-ins or helpers, or proves a platform fact, update this file in the same task. Move items from "Not verified" to "Verified" only after checking them in the running app.
