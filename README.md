# zxwarp

A ZX Spectrum web emulator using Matt Wescott's superb [JSSpeccy 3](https://github.com/gasman/jsspeccy3) engine, with a UI look & feel inspired by Jan Bobrowski’s excellent [Qaop/JS](https://torinak.com/qaop/about), please show your support for that at [https://torinak.com/qaop/donate](https://torinak.com/qaop/donate)

zxwarp adds:

- **Tipshop pokes, auto-matched** — when a game is loaded then available pokes fuzzy-matched from [all-tipshop-pokes](https://github.com/ladyeklipse/all-tipshop-pokes) can be enabled in the control panel.
- **DualShock 4 / USB gamepad** — plug in a PS4 pad (or any standard Gamepad API controller); map to Cursor, Sinclair, or QAOP + Space
- **Realtime zoomable memory map** — scroll to zoom, drag to pan, hover for address / byte.

## Quick start

```bash
npm start             # fetch games/pokes + build + serve
npm run build         # fetch supporting data + write dist/
```

Open http://localhost:4173/

| Script | Purpose |
|--------|---------|
| `npm run build` | Fetch games + pokes + USB IDs, then write static site to `dist/` |
| `npm run serve` | Serve `dist/` (correct `application/wasm` MIME) |
| `npm run fetch-games` | Fetch `games/games.json` via [ZXInfo API](https://api.zxinfo.dk/v3/) into `games/library/` (skipped if `catalog.json` exists; also run by `build`) |
| `npm run fetch-games-catalog` | Refresh `games/catalog.json` from ZXInfo only (no downloads) |
| `npm run fetch-pokes` | Build `games/pokes.json` from Tipshop (also run by `build`) |
| `npm run fetch-usb-ids` | Build `data/usb-ids.json` from [linux-usb.org](http://www.linux-usb.org/usb.ids) (also run by `build`) |
| `npm run fetch-jsspeccy` | Re-download + patch JSSpeccy into `vendor/` |

Requires Node.js 18+.

## Play UI

The bare root page opens the control panels. Game links launch **fullscreen**. Press **Esc** to toggle side panels:

- **Left** — machine, auto-load, gamepad map, Tipshop pokes, keys, share
- **Right** — snapshot slots (IndexedDB, per game) and a realtime memory map

| Key / control | Action |
|---------------|--------|
| Esc / click screen | Toggle control panels |
| Shift / Alt / Tab / Home | Caps Shift / Symbol Shift / Extended / Edit |
| Del | Restart current game |
| F1 | About |
| F2 / F3 | Remember / recall snapshot |
| Pause | Pause / resume |
| Insert | Games list |
| Ctrl+O / Ctrl+S | Open / remember (when paused) |
| Restart | Reload the current game |
| Reset | Power-reset the Spectrum |
| Save | Download a `.z80` of the current state |
| Gamepad | USB DualShock 4 / standard pad → Cursor, Sinclair, or QAOP |

### URL hash parameters

```text
/#48&g=bomb-jack&l=games/library/0000617-bomb-jack.tap.zip
/#48&panels&g=bomb-jack&l=games/library/0000617-bomb-jack.tap.zip
/#128&usr0&l=https://example.com/demo.tap
/#!autoload&pentagon
```

| Param | Meaning |
|-------|---------|
| `#l=URL` | Load tape / snapshot / archive |
| `#g=slug` | Catalog game id (title, pokes, snapshots) |
| `#48` `#128` `#pentagon` | Machine |
| `#autoload` / `#!autoload` | Tape auto-load on/off |
| `#instant` / `#!instant` | Instant tape loading (ROM traps) on/off |
| `#usr0` | 128K-style `usr0` tape load mode |
| `#panels` | Start with side panels open (bare root does this by default) |
| `#sandbox` | Showcase mode (no open UI) |

See `dist/about.html` after build for the full reference.

## Games library

Curated titles from `games/games.json`, resolved through the [ZXInfo API v3](https://api.zxinfo.dk/v3/) and downloaded from [World of Spectrum](https://worldofspectrum.net/).

- List: `games/games.json` (committed)
- Metadata: `games/catalog.json` (written by fetch)
- Archives: `games/library/*.zip` — **gitignored**; fetched by `npm run build`
- Browse/play: `/games.html` (by rank and by year)

Some titles have no public download; they stay listed with a World of Spectrum / ZXInfo link.

Drop extra `.tap` / `.tzx` / `.z80` / `.sna` / `.szx` / `.zip` under `games/` (outside `library/`) and rebuild — they appear under “Other local files”.

## Pokes

Tipshop trainers from [all-tipshop-pokes](https://github.com/ladyeklipse/all-tipshop-pokes) are matched fuzzily to the loaded game. Enable them from the left panel **after** the game is running. Selections are stored in `localStorage`.

## Licence

GPL-3.0-or-later (required by JSSpeccy 3). Spectrum ROMs © Amstrad PLC; redistributed with permission as part of JSSpeccy. Game tape images remain © their publishers — fetch them for personal/offline use; do not commit redistributable archives you are not allowed to publish. See `games/README.md`.

## Credits

- Emulation: [JSSpeccy 3](https://github.com/gasman/jsspeccy3) by Matt Westcott
- UI inspiration: [Qaop/JS](https://torinak.com/qaop/about) by Jan Bobrowski ([donate](https://torinak.com/qaop/donate))
- Pokes: [Your Sinclair Tipshop](https://www.the-tipshop.co.uk/) via [all-tipshop-pokes](https://github.com/ladyeklipse/all-tipshop-pokes)
- Game metadata: [ZXInfo API](https://api.zxinfo.dk/v3/) ([zxinfo.dk](https://zxinfo.dk)) by Thomas Kolbeck, on [ZXDB](https://github.com/zxdb/ZXDB) by Einar Saukas
- Files / charts: [World of Spectrum Classic](https://worldofspectrum.net/) / [Spectrum Computing](https://spectrumcomputing.co.uk/)
