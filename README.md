# Note Imit Trainer

Browser-based ear training for bass (or any fretted instrument). The app plays random notes in your configured range; you play them back on your instrument. Choose **1**, **2**, or **3** notes per round from the home screen. Wrong answers replay the sequence until you match. After a full set, you get session stats. Use **Tuner** on the home screen for a chromatic mic tuner (nearest note and cents).

**Live app:** enable GitHub Pages on this repo (see [Deploy](#deploy)).

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

Playable range is from the lowest open string through the highest string plus frets (default B0–F4).

## Local development

Static files only — no build step:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`. Microphone APIs require a secure context (`localhost` is fine).

## Deploy

1. Push this repository to GitHub.
2. **Settings → Pages → Build and deployment:** Source = **Deploy from a branch**, Branch = **main** / **/ (root)**.
3. Wait for the site URL (e.g. `https://<user>.github.io/note-imit-trainer/`).

The repo includes `.nojekyll` so GitHub Pages serves the app as static files.

## How it works

- **Ear training:** the target note name is shown only after a correct answer (or after each note in a multi-note sequence once you play it correctly).
- **Modes:** 1, 2, or 3 notes per round; consecutive notes in a sequence differ in pitch and stay within the max interval setting.
- **Wrong answers (multi-note):** after a wrong pitch, the full sequence replays after a short delay; while it replays, a per-note hint row shows checkmarks for notes already correct and up/down arrows for remaining targets (relative to the pitch you just played).
- **Pitch detection:** McLeod Pitch Method (MPM) on a decimated, low-pass filtered mic buffer; stability gating before accepting a note.
- **Playback gating:** the mic is ignored while the reference tone plays (plus a short tail).
- **Settings** are stored in `localStorage`.
- **Tuner:** chromatic readout from the microphone (note name, cents, frequency); detection range follows your instrument settings. No reference tone playback.

## License

[MIT](LICENSE)
