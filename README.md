# M10i Bass Tools

Browser-based ear training designed for **5-string bass**. The app plays random notes in your configured range; you play them back on your instrument. Choose **1**, **2**, or **3** notes per round from the home screen. Wrong answers replay the sequence until you match. After a full set, you get session stats. Use **Tuner** on the home screen for a chromatic mic tuner (nearest note and cents). Use **Metronome** for a tempo click with adjustable BPM and beats per measure.

Settings let you configure the number of strings, tuning, and frets, so it can be adapted to other fretted instruments — but pitch detection is tuned for bass frequencies and hasn't been validated on other ranges.

## Requirements

- A modern browser with microphone access (Chrome, Firefox, Safari, Edge)
- Headphones strongly recommended so the mic does not pick up the reference tone

## Defaults

| Setting | Default |
|--------|---------|
| Notes per set | 100 (each round is one sequence) |
| Lowest open string | B0 |
| Highest open string | G2 |
| Frets | 22 |
| Max interval in a sequence | 7 semitones |
| Playback volume | 100% |

Playable range is from the lowest open string through the highest string plus frets (default B0–F4).

## Local development

Static files only — no build step:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`. Microphone APIs require a secure context (`localhost` is fine).

## How it works

- **Ear training:** the target note name is shown only after a correct answer (or after each note in a multi-note sequence once you play it correctly).
- **Modes:** 1, 2, or 3 notes per round; consecutive notes in a sequence differ in pitch and stay within the max interval setting.
- **Wrong answers (multi-note):** after a wrong pitch, the full sequence replays after a short delay; while it replays, a per-note hint row shows checkmarks for notes already correct and up/down arrows for remaining targets (relative to the pitch you just played).
- **Pitch detection:** McLeod Pitch Method (MPM) on a decimated, low-pass filtered mic buffer; stability gating before accepting a note.
- **Playback gating:** the mic is ignored while the reference tone plays (plus a short tail).
- **Settings** are stored in `localStorage`.
- **Tuner:** chromatic readout from the microphone (note name, cents, frequency); detection range follows your instrument settings. No reference tone playback.
- **Metronome:** scheduled clicks (default 90 BPM) through a separate volume control on the Metronome screen; accent on beat 1 of each measure, regular ticks on remaining beats. Independent of Settings playback volume. No microphone.

## License

[MIT](LICENSE)
