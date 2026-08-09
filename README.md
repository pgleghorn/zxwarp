# zxwarp

A small Node.js project that builds a **static** ZX Spectrum web UI around [JSSpeccy 3](https://github.com/gasman/jsspeccy3). The front-end aims for the same kind of clear, URL-driven convenience as [Qaop/JS](https://torinak.com/qaop/about).

## Quick start

```bash
npm start
```

Then open http://localhost:4173/

- `npm run build` — write the static site to `dist/`
- `npm run serve` — serve `dist/` with the correct `application/wasm` MIME type
- `npm run fetch-jsspeccy` — re-download JSSpeccy 3.2 into `vendor/`

## Usage

| Control | Action |
|--------|--------|
| **Open** / `O` | Load TAP, TZX, Z80, SNA, SZX, or ZIP |
| **48K / 128K / Pentagon** | Switch machine |
| **100% / 200% / 300%** / `1` `2` `3` | Zoom |
| **Full** / `F` | Fullscreen |
| **Esc** | Keys panel |
| **Share** | Copy a deep link |

### URL hash parameters

```text
/#48&zoom=2&l=games/mygame.z80
/#128&usr0&l=https://example.com/demo.tap
/#!autoload&pentagon
```

| Param | Meaning |
|-------|---------|
| `#l=URL` | Load program / tape / archive |
| `#48` `#128` `#pentagon` | Machine |
| `#zoom=1\|2\|3` | Scale |
| `#autoload` / `#!autoload` | Tape auto-load |
| `#usr0` | 128K-style `usr0` tape load mode |
| `#sandbox` | Showcase mode (no open UI) |

See [about](src/templates/about.html) (built to `dist/about.html`) for the full reference.

## Games library

The World of Spectrum visitor-voted **Top 100** is stored under `games/top100/` with metadata in `games/catalog.json`.

```bash
npm run fetch-games   # refresh from worldofspectrum.net
npm run build
```

Open **Games** (`/games.html`) for a Qaop-style browser: jump by year, or scroll the ranked Top 100, then click to play. Games launch **fullscreen**; press **Esc** to toggle Torinak-style side panels (controls left, snapshot slots right). Snapshots are real save-states kept in IndexedDB per game.

```text
/#48&g=bomb-jack&l=games/top100/009-bomb-jack.tap.zip
/#48&panels&g=bomb-jack&l=games/top100/009-bomb-jack.tap.zip
```

Keys follow Qaop/JS: `Esc` panels, `F2`/`F3` remember/recall state, `Del` restart, `Insert` games, `Ctrl+O`/`Ctrl+S` when paused. Zoom is UI-only (no `1`/`2`/`3` shortcuts).

Some titles have no public WoS `.pub` mirror — they remain listed with a World of Spectrum link.

## Licence

GPL-3.0-or-later (required by JSSpeccy 3). Spectrum ROMs © Amstrad PLC; redistributed with permission as part of JSSpeccy. Game tape images remain © their publishers; see `games/README.md`.
