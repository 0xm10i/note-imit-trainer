# AGENTS.md — M10i Bass Tools

Guidance for AI agents working in this repository.

## What this project is

Static browser app for **ear training** on bass (or any fretted instrument). The app plays one or more random MIDI notes in a configured range; the user plays them back in order. The mic detects pitch; wrong answers replay the sequence after a short delay; correct answers show note names, play a success bell, then advance. After N sequences (default 100), a stats screen is shown.

**Product rules (do not break without explicit user request):**

- Pure ear training: **do not show the target note name** until after a correct answer.
- **Exact octave** matching (not pitch class only).
- **No grading while reference or feedback audio plays** — mic capture and pitch analysis must stay off during `playNote`, `playSuccessBell`, and intentional delays. Speaker bleed caused false positives; the session layer enforces this.

## Stack and constraints

- **Plain HTML / CSS / ES modules** — no bundler, no npm dependencies, no build step.
- Deployed as static files on **GitHub Pages** (repo root + `.nojekyll`).
- **Browser APIs only:** `AudioContext`, `getUserMedia`, `AnalyserNode`, `localStorage`.
- Local dev: `python3 -m http.server 8080` (mic needs HTTPS or `localhost`).

Keep changes **small and focused**. Match existing style (vanilla JS, minimal comments, no frameworks).

## Repository layout

| Path | Role |
|------|------|
| [`index.html`](index.html) | Views (home/settings, practice, tuner, metronome, results); toggled via classes / `hidden` |
| [`styles.css`](styles.css) | Dark UI, practice-focused typography |
| [`src/app.js`](src/app.js) | DOM wiring, view switching, settings form, session callbacks |
| [`src/session.js`](src/session.js) | Practice state machine, stats, timing constants, playback/listen sequencing |
| [`src/audio.js`](src/audio.js) | Shared `AudioContext`; `playNote`, `playSuccessBell`, `scheduleMetronomeClick`; `setPlaybackVolume` / `setMetronomeVolume` (separate gain bus for clicks) |
| [`src/pitch.js`](src/pitch.js) | MPM pitch detection, `PitchListener` (mic + stability gating) |
| [`src/notes.js`](src/notes.js) | MIDI ↔ name ↔ frequency, tuning range, `pickRandomNote`, `pickRandomSequence` |
| [`src/tuner.js`](src/tuner.js) | Chromatic tuner: `createTuner`, live cents readout via `PitchListener` |
| [`src/metronome.js`](src/metronome.js) | Metronome: `createMetronome`, lookahead scheduler, accent on beat 1 of each measure |
| [`src/settings.js`](src/settings.js) | Defaults, `localStorage`, form read/write |
| [`README.md`](README.md) | User-facing docs |

## Architecture

```text
app.js  →  createSession(settings, callbacks)
              → PitchListener (mic)
              → playNote / playSuccessBell (audio.js)
              → notes.js (range, targets)
         →  createTuner() (tuner.js) — separate mic stream, not used during practice
         →  createMetronome() (metronome.js) — playback only, stops when practice/tuner starts
settings.js  →  persisted user config
```

**Session flow (high level):**

1. `playTarget`: mute listening → play reference sequence (gap between notes) → tail → wait for mic silence → enable listening.
2. Wrong: 600 ms delay → `playTarget` again (full sequence; `targetIndex` reset); per-note hints shown in the UI only during that replay.
3. Partial correct (multi-note): advance `targetIndex`, keep listening (no bell).
4. Full correct: mute → bell → hold (~800 ms) → wait for silence → `nextNote`.

Home screen passes `noteCount` (1–3) into the session; it is not persisted in settings.

**`PitchListener` listening modes:**

- `setListeningEnabled(false)`: no pitch analysis + **disable** `MediaStreamTrack` (playback / celebration).
- `setMicCaptureEnabled(true)` while still gated: RMS for `waitForSilence` only, no grading.

**`playTargetGeneration`:** incremented on stop and at each `playTarget` start; async paths must bail if generation changed (user stopped mid-sequence).

## Defaults (settings)

- 100 sequences per set, 5 strings, open strings B0–G2, 22 frets, max interval 7 semitones between consecutive notes in a sequence → playable MIDI ~23–65 (B0–F4).
- Intermediate strings: evenly spaced between lowest and highest open string (rounded MIDI).
- Advanced: noise gate, cents tolerance, input device, optional live detection (off by default).
- Playback volume: 0–200% (default 100%) on reference tones and success bell; adjustable in Settings and during practice.

## Testing and verification

- **Pitch regression (Node):** from repo root:
  ```bash
  node --input-type=module -e "import { verifyPitchDetectionAcrossRange } from './src/pitch.js'; console.log(verifyPitchDetectionAcrossRange(23, 65).length);"
  ```
  Expect `0` failures for synthetic bass-like tones.
- **Manual:** practice with headphones; confirm no auto-correct during reference tone, bell, or wrong-answer delay.
- There is no automated UI or E2E test suite.

## Conventions for agents

1. **Prefer editing the module that owns the behavior** — avoid duplicating MIDI or pitch logic in `app.js`.
2. **Any new sound** should use [`src/audio.js`](src/audio.js) and resolve promises on the `AudioContext` timeline, not arbitrary wall-clock guesses alone.
3. **Any change to when the mic listens** must go through `PitchListener` + [`src/session.js`](src/session.js) sequencing; never enable grading during speaker output.
4. **Do not add a build step** or framework unless the user explicitly asks.
5. **Do not edit** `.cursor/plans/` or user plan files unless asked.
6. **Commits:** only when the user asks; follow their git safety rules.
7. **README** is user-facing; **AGENTS.md** is for agents — keep product behavior in sync when behavior changes.

## Common pitfalls

- Two audio contexts: playback uses `getAudioContext()` in `audio.js`; mic uses a separate context in `PitchListener` — intentional.
- `getUserMedia` with `echoCancellation`, `noiseSuppression`, and `autoGainControl` **disabled** for pitch accuracy.
- Checkbox settings: use `form.showLiveDetection.checked`, not `FormData` alone for unchecked boxes.
- GitHub Pages serves from root; asset paths are relative (`src/app.js`, not absolute).

## Optional follow-ups (only if requested)

- GitHub Actions, `gh` deploy automation, PWA, unit tests in a test runner, editable timing constants in settings UI.
