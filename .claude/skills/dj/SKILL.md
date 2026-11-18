---
name: dj
description: How a DJ mixes one song into the next, and how to build a DJ mode in the Playlists app. Use before planning, building, reviewing or answering questions about DJ mode, automix, transitions between songs, crossfades, fade-in or fade-out lengths, beatmatching, phrase matching (16 bars against 16 bars), drop mixing, bass swaps, cue points, beat grids, downbeats, or harmonic (Camelot) mixing. Covers the musical rules, the timing maths, what the current engine can and can't do, and a build plan, so you don't need to research DJ technique or scan the code.
---

# DJ

A DJ makes one continuous set out of separate songs. The craft comes down to four things:
1. **Tempo:** both songs play at the same BPM (beatmatching).
2. **Phase:** their beats land at the same moment.
3. **Structure:** their phrases line up, so a 16-bar section of one song overlaps a 16-bar section of the other.
4. **Transition:** how the outgoing song gives way to the incoming one. This can be a long blend, a quick fade, a bass swap or a drop mix.

**Status: DJ mode is not built.** This file holds the domain rules and a plan. Today the app plays one song at a time through a single `<audio>` element and finds BPM and key per file, but not beat positions. Mark the plan as done section by section as it ships, and move facts into "Files" and "Tests" once they're real.

Other docs:
- Playback, the tempo slider and the platform's limits: the `audio-engine` skill. DJ mode is an **engine change**, so its rules apply, especially rule 3 (one engine: get the user's agreement first).
- How BPM and key are detected and shown when the tempo changes: the `tempo-and-key` skill.
- What users see and product decisions: the `product` agent. Schema: the `dba` agent. IPC: the `data-api` agent. Hardening (CSP, the CORS change on `playlist-audio:`): the `security` agent.

If the code and this file disagree, the code wins: say so, and fix this file in the same task.

## How to work
- **Product first.** The open decisions are listed under "Product decisions to settle". Ask the user about any that a task depends on. Don't guess, and record each answer in `product.md`.
- **Keep the maths pure.** Put beat grids, phrase boundaries, rate matching, key compatibility and transition plans in plain functions with no audio or React (planned module: `src/shared/djMix.ts` or `src/renderer/src/dj/`). Keep the code that drives the audio graph thin and separate.
- **Think in beats and bars.** Express every length in bars (DJs count in bars) and convert to seconds at the last moment, using the **effective** BPM (detected BPM × playback rate).
- **Prove timing by ear.** jsdom can't tell whether two songs are in phase. After the tests pass, listen in `npm run dev` with two songs of known BPM, then write what you found under "Platform facts" in `audio-engine`.

## Files
DJ mode has no files yet. Planned (not backticked until they exist; the doc hook reads backticked paths only):

| File | Role |
|---|---|
| src/shared/djMix.ts (planned) | Pure maths: `secondsPerBeat`, `beatAt`, `nextPhraseBoundary`, `matchRate`, `camelot`, `keysCompatible`, `planTransition` |
| src/main/beatGrid.ts (planned) | Finds each file's beat grid (first beat, downbeat, refined BPM) and possibly its drop, in the analysis worker, next to `trackTempo.ts` |
| src/renderer/src/dj/ (planned) | The deck engine (two decks, one `AudioContext`), the transition scheduler, and the DJ-mode UI |

Existing files it will touch: `src/renderer/src/App.tsx` (playback), `src/main/audioProtocol.ts` (CORS for Web Audio), `src/main/playlistDatabase.ts` (`migrateSchema` for grid columns), `src/main/analysisWorker.ts` and `backgroundAnalysis.ts` (the new analysis), `src/renderer/src/test/setup.ts` (stand-ins for Web Audio). Those already belong to the `audio-engine` and `tempo-and-key` docs. Update them as well.

## Musical structure
| Unit | Size | Notes |
|---|---|---|
| Beat | 60 / BPM seconds | 0.469 s at 128 BPM |
| Bar | 4 beats | Nearly all dance and pop music is in 4/4 |
| Phrase | 8 bars (32 beats) or 16 bars (64 beats) | House, techno and trance use 16 and 32 bars; hip-hop and pop more often 8 |
| Section | 1–4 phrases | Intro, verse/groove, breakdown, build-up, drop, outro |

- **Downbeat:** beat 1 of a bar. Phrases start on a downbeat. A beat grid needs to know which beats are downbeats, not just where the beats are.
- **Phrase matching** (the "16 on one matches 16 on the other" rule): start the incoming song on its phrase boundary at the exact moment the outgoing song reaches a phrase boundary. Then their 16-bar sections overlap one for one, and changes (a new element, a drop, the bass coming in) happen in both songs on the same downbeat. Starting 1 bar early or late sounds wrong to listeners even when the beats are perfectly matched.
- **Mixable sections:** DJ-friendly songs (extended mixes) open with 16–32 bars of mostly drums and close with a similar outro. The usual blend is **outgoing outro over incoming intro**, of equal length in bars.
- **Drop:** the high-energy point after a breakdown and build-up, almost always on a phrase boundary (often bar 33, 65 or 97 of the song). It's usually where the bass comes back in.

## Beatmatching
**Tempo.** The effective BPM of a deck is `bpm × rate`, where `rate = 1 + tempo/100`. To match the incoming song (in) to the outgoing one (out):
```
rateIn = (bpmOut × rateOut) / bpmIn
tempoIn% = (rateIn − 1) × 100        // must stay within ±MAX_TEMPO_CHANGE (10)
```
- Also try `bpmIn × 2` and `bpmIn ÷ 2`, since detectors often report half or double time (70 vs 140, 87 vs 174). Pick the candidate that needs the smallest change.
- If no candidate fits within ±10%, the songs can't be beatmatched. Use a non-beatmatched transition instead: a quick fade, an echo-out, or a cut on the outgoing song's phrase end.
- Pitch follows speed in this app (no key lock; see `audio-engine`), so matching tempo also moves the incoming song's key. Check key compatibility at the shifted key.
- Usually the incoming song changes speed and the outgoing one keeps its own. In a long blend, a DJ may ease the set's tempo towards the incoming song's own BPM over a phrase after the swap.

**Phase.** With a beat grid of `firstBeat` (seconds into the file) and `bpm`, beat *n* falls at `firstBeat + n × 60/bpm` in **file time**. File time runs `rate` times faster than real (wall-clock) time. To start the incoming song in phase, choose a beat (normally a phrase start) in the incoming song and a target wall-clock moment, both on the grid, and start the incoming song from that beat's file time at that moment.

**Precision budget.**
- Beats more than about 10 ms apart start to smear, and at about 20–30 ms you hear two separate hits ("flamming").
- `HTMLMediaElement.play()` starts with tens of ms of uncertain latency. `AudioBufferSourceNode.start(when, offset)` starts on an exact sample.
- BPM is stored to 0.1, which isn't precise enough for long blends. An error of 0.05 at 128 BPM drifts about 23 ms over 32 bars. Store the grid's BPM with more precision (from the detected beat positions), or measure the drift during the mix and correct it by briefly nudging the rate, as a DJ nudges a jog wheel.

## Harmonic mixing
- Map each key to the Camelot wheel: minor keys are A and major keys are B, and each step of the number is a fifth. 8B = C, 8A = Am, 9B = G, 1A = Abm. `parseKey` in `trackKey.ts` already reads Camelot, so add the opposite direction to `musicalKey.ts`.
- Compatible pairs: **same code**; **±1 number with the same letter** (8A↔7A, 8A↔9A); **same number with the other letter** (8A↔8B, the relative key). **+2 numbers** is an "energy boost" and a risky choice. Anything else clashes, so with a clash use a short transition (drop mix, cut or echo) instead of a long blend.
- Compare the keys **after** the tempo change: a change of about ±3% or more moves a song by a semitone (`semitoneShift` in `trackDisplay.ts`). +1 semitone is +7 on the Camelot wheel (mod 12).
- An unknown key ("—") is neither compatible nor a clash. Treat it as unknown and keep the transition short.

## Transitions
Every transition starts on a **downbeat**, and usually on the **outgoing song's phrase boundary**. Lengths are in bars, and the default phrase is 16 bars.

| Type | How it goes | Default lengths | Use when |
|---|---|---|---|
| **Blend** (long mix) | Incoming starts on its intro's first phrase at the outgoing outro's phrase boundary. It fades in, the bass swaps at the midpoint downbeat, then the outgoing song fades out | 16–32 bars total: fade-in 8, bass swap at bar 8 or 16, fade-out 8 | Both songs have mixable intro/outro, matched tempo, compatible keys |
| **Bass swap** (part of a blend) | Both songs play together with the incoming song's lows cut. On one downbeat, its lows come in as the outgoing song's lows drop out | Instant, or over 1 beat | Always in a blend: two basslines together sound muddy |
| **Drop mix** (drop swap) | Incoming starts early enough that its build-up runs under the outgoing song. On the outgoing phrase boundary, the outgoing song cuts and the incoming drop hits | Build lead: 8 or 16 bars before the drop | High energy, songs with a clear drop, keys may clash |
| **Cut** (slam) | Outgoing stops on a phrase-end downbeat and incoming starts on its phrase start (or its drop) at the same moment | 0 | Tempo out of range, clashing keys, a change of genre |
| **Quick fade** | Equal-power crossfade, not beatmatched or on the beat | 1–2 bars, or 2–4 s if the BPM is unknown | When nothing else fits; also the fallback with no BPM |
| **Echo-out** (later) | The outgoing song's last beat feeds an echo timed to the beat while it fades, then incoming starts | 1–2 bars of tail | Clashing tempo or key. Needs a delay node |

**Fade times.** `seconds = bars × 4 × 60 / effectiveBpm`. For example, 16 bars at 128 BPM is 30 s.
- A **fade-in** is usually shorter than the fade-out, or the incoming song comes in at full level with its lows cut (DJs fade in with the EQ more than with the volume).
- A **fade-out** often lasts the outgoing song's last phrase.
- Start and end every fade on a downbeat.

**Curves.** Use an equal-power crossfade for blends, `gainOut = cos(x·π/2)` and `gainIn = sin(x·π/2)` with x from 0 to 1, so the overall loudness doesn't dip in the middle. Linear fades sound like a dip. In Web Audio, use `setValueCurveAtTime` or several `linearRampToValueAtTime` steps. `exponentialRamp` can't reach 0.

**Drop-mix timing.** Inputs:
- the incoming song's drop at file time `D`
- a lead `L` beats long (for example 16 bars = 64)
- the outgoing song's next phrase boundary at wall-clock time `W`
- the matched effective BPM `E`

Then:
```
incoming starts from file time   S = D − L × 60 / bpmIn      (beats in file time use the song's own BPM)
incoming starts at wall-clock    W − L × 60 / E
at W: the outgoing song stops (or its lows and volume go to 0 within a beat); the incoming drop hits
```
If `S < firstBeat`, the build is shorter than the lead. Shorten `L` by whole phrases, or start at the incoming song's first downbeat. If `W` is less than the lead away, use the next boundary instead (`W += phrase length`).

**Next phrase boundary** in a deck at file time `t`, given its downbeat `d0` (the file time of a downbeat that starts a phrase) and `P` beats per phrase:
```
beat = (t − d0) / (60 / bpm)
k = ceil(beat / P)                          // the next phrase boundary at or after t
boundary file time = d0 + k × P × 60 / bpm
wall-clock time = now + (boundary − t) / rate
```

## Planned build
### Engine (the user decides first)
Two decks that play at the same time are needed, but the app has one `<audio>` element today. The options:

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Two media elements in Web Audio** (recommended start) | Two `<audio>` elements → `createMediaElementSource` → per-deck `GainNode` and low-shelf/EQ `BiquadFilterNode` → master gain → destination | Streams like today and seeks with byte ranges. Little memory | Start timing is only roughly accurate, so it needs drift correction by nudging the rate. Needs CORS on `playlist-audio:` (see `audio-engine` "Platform facts") |
| **B. Decoded buffers** | `fetch` the stream → `decodeAudioData` → `AudioBufferSourceNode.start(when, offset)` with `playbackRate` | Starts exactly on time, with no drift between decks | About 10 MB per stereo minute (a 10-minute song is about 210 MB). Decoding takes time and the song must load before it can play. Seeking means a new source node |

- Either way, `AudioBufferSourceNode.playbackRate` and the element with `preservesPitch = false` both work like a turntable, which matches the product.
- **Normal playback must keep working:** the queue, shuffle, previous, the tempo slider and all existing tests. One practical path is a single Web Audio graph for both modes, where normal mode uses deck A only.

### Data
- **Beat grid per file** (it belongs to the file, like BPM): `first_beat REAL` (seconds), `downbeat REAL` (the first downbeat that starts a phrase), and a precise `grid_bpm REAL`. Add a `grid_read` flag that works like `tempo_read`. Add the columns in `migrateSchema()` and copy them for new copies of a file (see the `tempo-and-key` recipe "Another detected detail").
- **Finding it:** `music-tempo` already returns `beats` (beat times in seconds) as well as `tempo`. Fit a line through them to get `first_beat` and `grid_bpm`.
- **Finding the downbeat and phrases** is harder. A heuristic: low-band energy per bar, then choose which beat in the bar is the downbeat (offset 0–3) and which bar starts the phrase (offset 0–15) so that the biggest energy changes (intro→groove, breakdown, drop) land on 16-bar boundaries.
- **Finding the drop** (optional): the largest rise in low-band energy on a phrase boundary after a quieter section.
- **Manual correction:** detection will sometimes be wrong. Plan for the user to nudge the grid (±1 beat, ±1 bar) and set mix-in, mix-out and drop cue points. That could be per file or per playlist entry, which is a product decision.

### Logic (pure, unit-tested)
`planTransition(outgoing, incoming, preferences)` takes each deck's grid, BPM, rate, key, position and duration, and returns a plan:
- the transition type
- the incoming song's rate and start file time
- the wall-clock start
- the gain, EQ and stop events in wall-clock time

It falls back step by step: blend → drop mix → cut → quick fade. A fallback happens when the BPM is unknown, the tempo can't be matched within ±10%, the keys clash, there's no grid, or the song is too short.

### Scheduler
- Before each outgoing song's planned mix-out point (default: the phrase that starts 16–32 bars before its last downbeat), plan the transition with the next song from `playOrder()` and the queue, then schedule it on the `AudioContext` clock.
- If the user skips, seeks, pauses, changes the tempo or edits the list during a transition, cancel the scheduled events (`cancelScheduledValues`), then finish the transition at once or plan a new one.

### UI
- A DJ-mode toggle near Shuffle (`aria-pressed`).
- Show which song is mixing in, a short label for the transition type, and the time until it starts.
- Optionally, a choice of transition length in bars.
- Keep the established dark look (`frontend-design` skill). It must work by keyboard and screen reader: announce transitions politely, and never only by color.

## Product decisions to settle
Ask the user before building anything that depends on these, then record the answers in `product.md`:
1. **Automix or decks?** An automatic DJ that mixes the playlist in order (and the queue), or a manual two-deck mixer, or automix first?
2. **Does tempo stick?** When DJ mode speeds up a song to match the one before, is that temporary, or saved like the tempo slider? Does it return to the song's own tempo after the swap?
3. **Engine:** option A or B above, with the CORS change to `playlist-audio:` (a `security` review).
4. **Shuffle with DJ mode:** play in list order, or reorder by BPM and key compatibility? Reordering would be a new feature.
5. **Cue points:** detected only, or also user-editable? Per file or per playlist entry?
6. **Default transition and length:** for example, a 16-bar blend, and a drop mix when the keys clash.

## Tests (planned)
- **Pure maths:**
  - Vitest tables over `djMix.ts`, named by musical behavior: "matches 126 BPM to 128 by speeding up 1.6%", "treats 87 BPM as half of 174", "falls back to a cut when tempos are 15% apart", "lands the incoming drop on the outgoing song's next 16-bar boundary", "8A blends with 9A, 8B and 7A but not 3B", "compares keys after the tempo shift".
  - The precision tests: phase error stays under 1 ms over 64 bars with the precise grid BPM.
- **Beat grid detection:** extend `src/main/test/wav.ts` `beat()` with accented downbeats and an energy change every 16 bars, then check `firstBeat`, `downbeat` and BPM within a tolerance.
- **Renderer:**
  - jsdom has no Web Audio, so add an `AudioContext` stand-in to `test/setup.ts` with a controllable clock. It should record gain and rate changes so `player()` can report what each deck plays and how loud it is.
  - Add helpers such as `deck('A' | 'B')`, `mixAt(seconds)` and `djModeButton()`.
  - Assert what is heard (which song, volume, speed), not the scheduled calls.
- **Edge cases to cover:** last song (fade out, no next), one-song playlist, an unknown BPM or key, a song shorter than the transition, a skip or a pause during a transition, switching playlists during a transition (cancel it and clear the queue), a removed or missing next song, duplicates, shuffle on, the queue.

## Pitfalls
- **Half or double time** is the most common reason a beatmatch fails. Always try ×2 and ÷2.
- **File time vs wall-clock time:** grid positions are in file time; scheduling is in `AudioContext` time. Divide by the rate when converting, and recalculate when the rate changes mid-transition.
- **Pitch moves with tempo.** A match that is fine for tempo can create a key clash, so check keys after the shift.
- **Detection only covers the first 10 minutes,** so a grid for a longer song has to be extrapolated. Songs with live drums, tempo changes or no beat in the intro or outro (ambient, a cappella) won't hold a grid. Detect this (high spread around the fitted line) and treat them as having no grid.
- **The intro may have no beat:** `first_beat` can be late. Don't start the incoming song before its first beat in a beatmatched blend.
- **Two basslines** at full level sound muddy. In a blend, always cut one song's lows.
- **Clipping:** two full-level songs summed can exceed 0 dBFS. Use equal-power gains, and possibly a master compressor or limiter.
- **Media element drift:** two elements started "together" drift apart and their starts vary. With option A, measure the phase (`currentTime` against the grid) on a timer and correct it by nudging the rate by about 0.1–0.5% for a beat or two, never by seeking.
- **State in `App.tsx`:** `activeTrack` and `resumeFrom` are indices and `queue` is IDs (see `audio-engine` "Pitfalls"). During a transition two songs are "current", so decide when `activeTrack` moves (at the swap downbeat) and keep the queue and `playPrevious` consistent.
- **Tempo saves:** if DJ mode changes rates without saving them, don't write them through `changeTempo` (that saves to the database). Keep a separate per-deck rate.

## Keeping this file current
As DJ mode ships, replace the "planned" notes with facts: backtick the real paths in the Files table (the `.claude/hooks/check-agent-docs.mjs` hook watches them), move the agreed decisions into `product.md`, record verified timing behavior under "Platform facts" in `audio-engine`, and update the schema in the `dba` agent. Keep it a reference (rules, maths, file names, reasons), not a change log.
