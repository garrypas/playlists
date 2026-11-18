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

**Status: DJ mode is built as an automix.** It's off by default and toggled by a button in the player.
- Every file's DJ details (beat grid, phrase start, sections, drops, loudness, sound bounds) are found in the background and saved per file; see "DJ details (built)".
- While DJ mode is on, each song mixes into the next on a second `<audio>` deck; see "DJ mode (built)".
- This file holds the domain rules, what's built and what's left.

Other docs:
- Playback, the tempo slider and the platform's limits: the `audio-engine` skill. DJ mode is an **engine change**, so its rules apply, especially rule 3 (one engine: get the user's agreement first).
- How BPM and key are detected and shown when the tempo changes: the `tempo-and-key` skill.
- What users see and product decisions: the `product` agent. Schema: the `dba` agent. IPC: the `data-api` agent. Hardening (CSP, the CORS change on `playlist-audio:`): the `security` agent.

If the code and this file disagree, the code wins: say so, and fix this file in the same task.

## How to work
- **Product first.** Settled decisions are under "Product decisions". The open ones are product calls for the user: record each answer in `product.md`.
- **Keep the maths pure.** Beat grids, phrase boundaries, rate matching, key compatibility, transition plans and levels belong in `dj/djMix.ts`, with no audio or React. Keep the code that drives the decks (the runner in `App.tsx`) thin.
- **Think in beats and bars.** Express every length in bars (DJs count in bars) and convert to seconds at the last moment, using the **effective** BPM (detected BPM × playback rate).
- **Prove timing by ear.** jsdom can't tell whether two songs are in phase. After the tests pass, listen in `npm run dev` with two songs of known BPM, then write what you found under "Platform facts" in `audio-engine`.

## Files
| File | Role |
|---|---|
| `src/shared/djDetails.ts` | `DjDetails`, `BeatGrid`, `DjSection`, `DjSectionKind`: what's known about a file for mixing. Shared, so the renderer can use it in DJ mode |
| `src/main/trackRhythm.ts` | `detectRhythm(filePath)` → `{ bpm, dj }`: one decode, then BPM, the beat grid, phrase start, sections, drops, loudness and sound bounds. Run on the analysis worker as kind `rhythm` |
| `src/main/trackRhythm.test.ts` | Detection on generated songs ("finding what a DJ needs to mix a song") |
| `src/main/test/wav.ts` | `song(bpm, parts, { silenceSeconds })`: a generated dance track from parts in bars (kick, bass pad, level) |

| `src/renderer/src/dj/djMix.ts` | Pure maths: `matchRate`, `keyAtRate`, `keysCompatible`, `planTransition`, `levelsAt`, `incomingTimeAt` / `outgoingTimeAt`, `nudgedRate`, `transitionName`; types `Deck`, `TransitionPlan`, `MixLevels` |
| `src/renderer/src/dj/djMix.test.ts` | The maths, by musical behavior |
| `src/renderer/src/dj/deckEq.ts` | Each deck's bass filter (Web Audio); see `audio-engine` |
| `src/renderer/src/djMode.test.tsx` | DJ mode as the user hears and sees it |
| `src/shared/musicalKey.ts` | `camelotCode(key)` ("8A", "8B", …), next to the key spellings |

These belong to other docs, so update those as well when DJ mode changes them:
- `src/main/playlistDatabase.ts` (`dj_details`/`dj_read`, `filesNeedingRhythm`, `saveRhythm`, `getDjDetails`), `index.ts` (`rhythmScanner`, `playlists:dj-details`) and the worker files belong to the `tempo-and-key` skill, the `dba` agent and the `data-api` agent.
- `App.tsx` (the decks and the runner), `audioProtocol.ts` (CORS) and the test stand-ins belong to `audio-engine`.

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
- Map each key to the Camelot wheel: minor keys are A and major keys are B, and each step of the number is a fifth. 8B = C, 8A = Am, 9B = G, 1A = Abm. `parseKey` in `trackKey.ts` reads Camelot, and `camelotCode` in `musicalKey.ts` writes it.
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

## DJ details (built)
**Flow:**
- When songs are added, and at launch, `scanForMissingDetails()` queues each file with `tempo_read = 0 OR dj_read = 0` **once**, however many playlists it's in. Older databases have `dj_read = 0` everywhere, so every saved file is analysed once.
- The `rhythm` worker job runs `detectRhythm`, and `saveRhythm` writes `bpm`, `dj_details` (JSON) and both flags on every row with that `file_path`.
- `addAudioFiles` and `addTrack` copy `dj_details`/`dj_read` to new copies, so a file is never analysed twice.
- A missing or undecodable file leaves the flags at 0 and is retried at the next launch.

**Reading them:**
- The window calls `window.desktop.playlists.djDetails(trackId)`, which goes over IPC `playlists:dj-details` (`requireId`) to `PlaylistDatabase.getDjDetails`, and returns `DjDetails | null`.
- They're deliberately **not** in `PlaylistTrack` or `list()`: they're 0.5–3 kB per file, and the full list is pushed to the window after every background result.
- `App` fetches them only for the playing and next songs, while DJ mode is on, and caches them by file path. Null results are dropped from the cache whenever the saved playlists change, so they're asked for again once analysis finishes.

**What's found** (`src/shared/djDetails.ts`; all times are seconds into the file at normal speed):

| Field | Meaning |
|---|---|
| `soundStart`, `soundEnd` | First and last 10 ms above −60 dBFS; null if silent throughout |
| `loudness` | dBFS of the 400 ms blocks louder than −60 dB and no more than 10 dB below their mean. Use it to match levels between decks |
| `grid.bpm` | The exact tempo (to 0.0001), for beatmatching. Phase stays within 5 ms over 64 bars on test songs. `bpm` on the song is this to 0.1 |
| `grid.firstBeat`, `grid.lastBeat` | The first and last kicks that start or end a run of at least 3 kicks in 4 beats (a stray hit doesn't count). Beat n is at `firstBeat + n × 60 / grid.bpm` |
| `grid.phraseStart` | The first beat at or after `firstBeat` that starts a 16-bar phrase. Bars every 4 beats and phrases every 64 beats from it, in both directions |
| `grid.confidence` | The share of beats with a kick in bars that have a beat (breakdowns aren't counted). Below 0.3 there's no grid. Real tracks score 0.8–1.0 |
| `sections` | `{ kind, start, end }`, covering 0 to `analysedSeconds` without gaps, cut on bar lines (every 2 s with no grid) and at `soundStart`/`soundEnd`. `silent` ≤ −60 dB; `quiet` more than 12 dB below `loudness`; `beat` when at least half its beats have a kick; else `beatless` |
| `drops` | Starts of `beat` sections that follow a `beatless` or `quiet` section of 8 bars or more, after the beat has first started (the first kick after an intro is the mix-in point, not a drop) |
| `analysedSeconds` | The first 1200 s at most; nothing is known after it (long mixes) |

**Algorithms** (`trackRhythm.ts`):
1. **Decode** once at 11,025 Hz mono, with no ffmpeg filter. Energy is summed in 32-sample hops (2.9 ms), with running totals, so the level of any span costs O(1).
2. **Tempo:** `music-tempo` on a 500 Hz low-pass (see `tempo-and-key` for its parameters).
3. **Kicks:** a further 150 Hz low-pass. Kick strength at each hop is `ln(energy of the next 4 hops / energy of the 4 before)`, with silence before the file. Four hops (11.6 ms) is the shortest window that doesn't see a held bass note's own cycles as kicks.
4. **Grid:**
   - Number `music-tempo`'s beats by the periods between them, and fit a line (least squares, refitted without points more than 50 ms off).
   - Shift it by ¼, ½ or ¾ of a beat if that lands on more kick energy (`music-tempo` sometimes follows a rolling off-beat bassline).
   - Refine three times: at every predicted beat, take the strongest kick within 60, then 30 ms, placed between hops with a parabola. Refit through the kicks above the threshold, dropping any more than 20 ms off.
   - The threshold is a log ratio of a third of the 75th-percentile strength, clamped to 0.5–0.8. 0.8 is a kick that doubles the energy over a held bass note.
5. **Phrase start:**
   - Each beat's change is the difference between the 4 beats after and the 4 before, in full-band dB, low-band dB (each smoothly limited to about 12 dB with `tanh`) and the share of kicks (×12).
   - Only local peaks count, by how far they stand out above twice the median change, squared.
   - Choose the bar line first: offsets 0–3 from the first kick, where offset 0 counts double (dance music brings the kick in on beat 1). Then choose which of the 16 bars starts the phrase, with weights 4, 2 and 1 for changes on the phrase, half-phrase and quarter-phrase lines.
   - On 30 real tracks, 27 put it on the first kick's bar lines.
6. **Sections and drops:** as in the table above. A single odd bar between two of the same kind is folded into them (a missed kick or a one-bar fill).

**Speed:**
- About 1 s for a 6-minute song and 1.5 s for 10½ minutes, on an Apple Silicon Mac. That's checked on 46 real tracks, and a test requires a 6-minute song to take under 5 s.
- The old ffmpeg `loudnorm` pre-filter took 10–30 s per song.
- The key scan (1.5–2.5 s) runs at the same time on another worker.

## DJ mode (built)
**Engine: two media elements**, the old option A.
- Two `<audio>` decks stream from `playlist-audio:` as before, and levels are set on each element's `volume`.
- Bass goes through a lowshelf filter per deck: 200 Hz, cut to −30 dB, in one `AudioContext` (`dj/deckEq.ts`), created on the first click of the DJ-mode button. That needs CORS on the scheme; see `audio-engine` "Platform facts".
- Normal playback is unchanged on the live deck.
- Option B (decoded buffers, sample-exact starts, ~10 MB per minute) was not chosen.

**Planning** (`planTransition(outgoing, incoming, now)`, all in the outgoing song's file time):
- **Inputs.** Each `Deck` is `{ bpm, key, rate, duration, details }`.
  - A grid is used only if its `confidence` is ≥ 0.5.
  - The outgoing song's grid is used only if the file isn't longer than `analysedSeconds`.
  - The incoming song must be within ±10% after `matchRate` (which tries ×1, ×2 and ÷2).
  - Keys are compared at their played speeds (`keyAtRate`, rounded to a semitone) with `keysCompatible`: the same code, ±1 with the same letter, or the same number with the other letter. Unknown → undefined.
- **Mix-out line:** the last line every N bars from `phraseStart`, at or before the end of the last bar of beats (`lastBeat` + 1 beat, capped at `soundEnd`/duration).
- **Order of preference:**
  1. **Blend** of 16 bars (8 if a key is unknown) when the keys don't clash. It ends on the mix-out line for that length. The incoming song starts at its `phraseStart`, so phrase meets phrase. Swap halfway. Falls to 8 bars if 16 has passed or doesn't fit the incoming song.
  2. **Drop mix** when the keys clash: the first drop with a full 16 (else 8) bars of beats before it. The incoming song starts `bars` bars before its drop, so the drop lands on the 16-bar mix-out line. Swap there; the outgoing song fades out over one beat.
  3. **Cut** on the 16-bar mix-out line, or the next bar line if that has passed. Beatmatched if the tempos matched, else at the incoming song's own saved rate.
  4. **Fade** (no usable grids): equal power over the last 2 bars by the song's BPM, or 3 s, ending at `soundEnd`/duration. The incoming song starts from its `soundStart` at its own rate.
  - Null in the last half second.
- Every plan has `startAt` (incoming comes in), `incomingFrom`, `incomingRate`, `ratio` (incoming file seconds per outgoing file second = incomingRate ÷ outgoing rate), `beatmatched`, `swapAt` and `endAt`.
- **Levels** (`levelsAt`):
  - **Blend:** an equal-power crossfade over its whole length (`cos`/`sin`), so the decks are at about 0.71 each at the swap. Bass is cut on the incoming deck before the swap and on the outgoing deck after.
  - **Drop:** the build-up rises to 0.7 without bass; at the drop it's 1 with bass, and the outgoing song goes to 0 within a beat.
  - **Cut:** instant. **Fade:** an equal-power crossfade, no bass changes.

**The runner** (`App.tsx`: `djTick`, `loadIncoming`, `startIncoming`, `swapDecks`, `endMix`):
- **Ticks** run on every `timeupdate` and every 50 ms while a mix exists and is playing.
- **Clock:** the live deck leads, and the mix clock is the outgoing song's file time. Before the swap that's read from the live deck; after it, it's derived with `outgoingTimeAt`.
- **Load:** 20 s before `startAt`, the incoming song is loaded on the other deck: silent, at `incomingRate`, seeked to where it should be at the preroll.
- **Start:** the incoming deck starts silently up to 2 s early (the preroll; less if `incomingFrom` is near 0). A `setTimeout` is timed from the live deck. If the start is late, it's placed where it should be.
- **Phase:** each tick, the following deck (the one that isn't live) is compared with where the plan says it should be. The error, smoothed (0.7/0.3), sets its rate through `nudgedRate`: 4 ms dead band; up to ±1.5% while it's audible, ±5% while it's silent. The live deck is never nudged.
- **Swap:** at `swapAt`, `swapDecks` checks that `nextUp(false)` is still the incoming song. It flips `liveDeck` and sets `djTempo` to the incoming rate as a percent (unrounded). It takes the step with `leaveFor` (the queue or the list) and sets `activeTrack`. Effects then see the song already loaded on the new live deck and don't reload it.
- **End:** at `endAt` (or when the outgoing song ends), `endMix` pauses the outgoing deck and restores full level and bass.
- **Re-planning:** an effect re-plans whenever there's no mix. A mix is dropped (`endMix`) when any of these happen:
  - DJ mode is turned off, or playback pauses.
  - The current song changes (not by the swap) or the next song changes.
  - The details it was planned with change (only before it starts).
  - The user seeks.
  - A planned mix's time has already passed: past `endAt`, and at least 0.5 s past `startAt`, so a cut gets half a second's grace.
- **Tempo:** `tempo` in `App` is `djTempo` while it's for the current song, else the song's saved tempo. That's how "the playing song's tempo is the DJ's starting tempo" works. `changeTempo` does nothing in DJ mode, and the slider is `aria-disabled`.

**UI:** a headphones button left of Shuffle ("DJ mode", `aria-pressed`). A `role="status"` line (`.dj-status`) sits under the progress bar:
- "DJ: 16-bar blend into Two at 3:44" (planned, with the outgoing song's time)
- "DJ: mixing into Two (16-bar blend)"
- "DJ: mixing out of One"
- "DJ: next up, Two" (waiting for details)
- "DJ: nothing to mix into after this song"

**Not built yet:**
- correcting grids, phrases and cue points;
- matching levels with `loudness`;
- echo-out;
- a choice of transition or length;
- easing the set tempo back towards each song's own BPM;
- ordering by BPM or key;
- remembering whether DJ mode is on.

## Product decisions
Settled (the user asked for DJ mode off by default and toggled in the UI, with the tempo control off while it's on and the DJ starting from the playing song's tempo; the rest were the recommended defaults, recorded in `product.md`):
1. **Automix**, mixing the play order (the queue first), never wrapping. No manual decks.
2. **Tempo isn't saved.** The matched speed holds for the rest of the song; turning DJ mode off restores saved tempos.
3. **Engine:** option A, two elements, with CORS on `playlist-audio:` (see `security.md` rule 16).
4. **Shuffle:** DJ mode follows the shuffle order; it doesn't reorder.
5. **Default transition:** a 16-bar blend; a drop mix on a key clash.

Open: cue points (detected only, or user-editable? per file or per playlist entry?), and whether to remember DJ mode between launches.

## Tests
**Built** (`src/main/trackRhythm.test.ts`, "finding what a DJ needs to mix a song", real ffmpeg decoding of generated WAVs):
- grids at 120 and 128 BPM starting at the first kick
- 5 ms phase accuracy over 64 bars
- the first kick and phrase after a beatless intro
- silence, beat, a 30 s breakdown, the drop and a quiet outro on bar lines
- loudness that ignores quiet parts
- a silent song
- a 6-minute song analysed in under 5 s

`playlistDatabase.test.ts` "DJ details" covers one scan per file, sharing and copying to new copies, songs saved before DJ details, and unknown songs.

**DJ mode:**
- `src/renderer/src/dj/djMix.test.ts` covers:
  - matching tempos, including half and double time;
  - Camelot codes and compatibility, with keys compared after the shift;
  - every plan type and its fallbacks (shorter blends, the next bar line, a loose grid, a file longer than its analysis);
  - phase within 1 ms over 64 bars;
  - equal-power levels and the bass swap.
- `src/renderer/src/djMode.test.tsx` tests through `heard()`, `player()` and `djStatus()`:
  - off by default, and the tempo lock;
  - a 16-bar blend (levels, bass, speed, the swap, the end);
  - matching the playing song's saved tempo;
  - a drop mix, a cut and a quick fade;
  - mixing into the queue;
  - pausing mid-mix and re-planning shorter, skipping mid-mix, turning DJ mode off mid-mix;
  - the last song;
  - details arriving late.
  - Song specs take `dj: djTrack(bpm, { bars, firstBeat, drops })`.
  - The test drives time with `playTo` on the live deck: before the swap that's the outgoing song's time, after it the incoming song's.
- `src/main/index.test.ts` covers "song DJ details" over IPC, and `audioProtocol.test.ts` the CORS header.
- **Not covered yet:** switching playlists mid-mix, a removed next song, and shuffle on.

## Pitfalls
- **Half or double time** is the most common reason a beatmatch fails. Always try ×2 and ÷2.
- **Grid timing:** kicks over a held bass note are placed about 10 ms after their true start (the onset window has to be 11.6 ms long), and kicks after silence within about 1 ms. Two decks share the bias, so beatmatching is fine. When starting a deck exactly on a kick, start about 15 ms early (on silence or the bar before) so the attack isn't clipped.
- **Phrase start is a heuristic.** It's right on most dance tracks but can be a bar or a beat off (about 1 in 10 in a sample). A wrong phrase is worse than none, so let the user correct it before DJ mode depends on it for long blends.
- **music-tempo parameters:** `timeStep` must match the hop length, and `expiryTime` must outlast breakdowns (see `tempo-and-key`). Changing the sample rate or hop means changing both.
- **File time vs wall-clock time:** grid positions are in file time; scheduling is in `AudioContext` time. Divide by the rate when converting, and recalculate when the rate changes mid-transition.
- **Pitch moves with tempo.** A match that is fine for tempo can create a key clash, so check keys after the shift.
- **Detection only covers the first 20 minutes** (`analysedSeconds`), so a grid for a longer song has to be extrapolated. Songs with live drums, tempo changes or no beat in the intro or outro (ambient, a cappella) won't hold a grid. Detect this (high spread around the fitted line) and treat them as having no grid.
- **The intro may have no beat:** `first_beat` can be late. Don't start the incoming song before its first beat in a beatmatched blend.
- **Two basslines** at full level sound muddy. In a blend, always cut one song's lows.
- **Clipping:** two full-level songs summed can exceed 0 dBFS. Use equal-power gains, and possibly a master compressor or limiter.
- **Media element drift:** two elements started "together" drift apart and their starts vary. The runner corrects it by nudging the following deck's rate, never by seeking once it's audible. Don't nudge the live deck: the tempo effect owns its rate.
- **State in `App.tsx`:** `activeTrack` and `resumeFrom` are indices and `queue` is IDs (see `audio-engine` "Pitfalls"). `activeTrack` moves only at the swap, through `nextUp`/`leaveFor`, the same as `advance`. Anything new that changes what plays next must let the invalidation effect see it, or a mix will swap to a song that's no longer next. `swapDecks` checks this too.
- **Stale closures:** timers and intervals call `djTickRef.current` and read `mixRef`/`liveDeckRef`, never state captured when they were scheduled.
- **Tempo saves:** DJ tempo lives in `djTempo`, never in `changeTempo` (that saves to the database). Keep it unrounded: rounding to 0.1% drifts about 10 ms every 4 bars.
- **A cut ends where it starts** (`endAt === startAt`). Any "has this mix been missed?" check must allow for that.

## Keeping this file current
When DJ mode changes, update this file in the same task.
- Keep the Files table to real, backticked paths: the `.claude/hooks/check-agent-docs.mjs` hook watches them.
- Move agreed decisions into `product.md`.
- Record timing behavior verified by ear under "Platform facts" in `audio-engine`.
- Update the schema in the `dba` agent. Keep it a reference (rules, maths, file names, reasons), not a change log.
