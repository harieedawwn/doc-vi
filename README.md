# ĐỌC VỊ

One-device bluffing game for the classroom. Live: https://harieedawwn.github.io/doc-vi/

Vanilla HTML/CSS/JS, no build step, works offline (PWA) and from `file://`.

- `js/rules.js` — pure game rules, timer and storage codec (unit-tested)
- `js/app.js` — screens and flow · `js/audio.js` — Web Audio synth · `js/fx.js` — motion, icons
- Tests: `npm test` (unit), `npm run e2e` (Playwright, 6 viewports), `node tests/perf.js` (frames + throttled perf)

Fonts: Be Vietnam Pro and JetBrains Mono (SIL OFL 1.1, see `fonts/`).
