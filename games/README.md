# Games

## Top 100 (`top100/`)

Visitor-voted classics from [World of Spectrum – Best Games](https://worldofspectrum.net/archive/best-games/), fetched with:

```bash
npm run fetch-games
```

Zip archives under `games/` are **not committed** (see root `.gitignore`). Metadata lives in `catalog.json`. The Games page lists titles by **rank** and by **year**.

```text
./#48&g=bomb-jack&l=games/top100/009-bomb-jack.tap.zip
```

## Licence note

Tape/snapshot files remain copyright of their original publishers. Fetch them for personal offline play as redistributed by World of Spectrum / Spectrum Computing. Do not publish archives you do not have rights to redistribute.

## Drop your own files

Any extra `.tap` / `.tzx` / `.z80` / `.sna` / `.szx` / `.zip` outside `top100/` is copied into the build and listed under “Other local files”.
