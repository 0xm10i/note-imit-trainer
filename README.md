# Note Imit Trainer

Browser-based ear training for bass (or any fretted instrument). The app plays a random note in your configured range; you play it back on your instrument. Wrong answers replay the target until you match the pitch. After a full set, you get session stats.

**Live app:** enable GitHub Pages on this repo (see [Deploy](#deploy)).

## Requirements

- A modern browser with microphone access (Chrome, Firefox, Safari, Edge)
- Headphones strongly recommended so the mic does not pick up the reference tone

## Defaults

| Setting | Default |
|--------|---------|
| Notes per set | 100 |
| Strings | 5 |
| Lowest open string | B0 |
| Highest open string | G2 |
| Frets | 22 |

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

- **Ear training:** the target note name is shown only after a correct answer.
- **Pitch detection:** McLeod Pitch Method (MPM) on a decimated, low-pass filtered mic buffer; stability gating before accepting a note.
- **Playback gating:** the mic is ignored while the reference tone plays (plus a short tail).
- **Settings** are stored in `localStorage`.

## License

MIT
