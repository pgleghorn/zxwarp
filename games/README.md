# Games

## Top 100 (`top100/`)

Visitor-voted classics from [World of Spectrum – Best Games](https://worldofspectrum.net/archive/best-games/), fetched with:

```bash
npm run fetch-games
```

Metadata lives in `catalog.json`. The static site’s Games page lists them by **rank** and by **year** (Qaop-style). Click a title to launch the emulator:

```text
./#48&g=bomb-jack&l=games/top100/009-bomb-jack.tap.zip
```

## Licence note

Tape/snapshot files remain copyright of their original publishers. They are mirrored here for personal offline play, as redistributed by World of Spectrum / Spectrum Computing archives. Remove titles you do not have rights to redistribute if you publish this repo.

## Drop your own files

Any extra `.tap` / `.tzx` / `.z80` / `.sna` / `.szx` / `.zip` outside `top100/` is copied into the build and listed under “Other local files”.
