# Games

## Curated list (`games.json` → `library/`)

`games.json` is a merged, de-duplicated compilation of three World of Spectrum archive charts:

- [Official Game Top 100 Of All Time](https://worldofspectrum.net/archive/top-100/) (Your Sinclair / Stuart Campbell + YS Readers)
- [Visitor Voted Top 100 Best Games](https://worldofspectrum.net/archive/best-games/)
- [Visitor Voted Top 100 Best Text Adventures](https://worldofspectrum.net/archive/best-adventures/)

Titles are resolved via the [ZXInfo API v3](https://api.zxinfo.dk/v3/) by Thomas Kolbeck (see also [zxinfo.dk](https://zxinfo.dk)), built on [ZXDB](https://github.com/zxdb/ZXDB) by Einar Saukas; TAP/TZX archives are then downloaded from [World of Spectrum](https://worldofspectrum.net/) using the relative paths in that metadata.

```bash
npm run fetch-games           # metadata + download missing zips (no-op if catalog.json exists)
npm run fetch-games -- --force
npm run fetch-games-catalog   # refresh catalog.json only (no downloads)
```

Zip archives under `games/` are **not committed** (see root `.gitignore`). Metadata lives in `catalog.json`. The Games page lists titles by **rank** (list order) and by **year**.

```text
./#48&g=bomb-jack&l=games/library/0000617-bomb-jack.tap.zip
```

## Licence note

Tape/snapshot files remain copyright of their original publishers. Fetch them for personal offline play as redistributed by World of Spectrum / Spectrum Computing. Do not publish archives you do not have rights to redistribute.

## Drop your own files

Any extra `.tap` / `.tzx` / `.z80` / `.sna` / `.szx` / `.zip` outside `library/` is copied into the build and listed under “Other local files”.
