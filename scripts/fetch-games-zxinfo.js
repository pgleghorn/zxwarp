/**
 * Fetch playable archives for games listed in games/games.json via ZXInfo API v3.
 * Metadata: https://api.zxinfo.dk/v3/games/{game-id}
 * Downloads: https://worldofspectrum.net + release file path
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const listPath = join(root, 'games', 'games.json');
const outDir = join(root, 'games', 'library');
const catalogPath = join(root, 'games', 'catalog.json');

const API_BASE = 'https://api.zxinfo.dk/v3';
const WOS_BASE = 'https://worldofspectrum.net';
const UA = 'zxwarp/0.4 (personal archive mirror; +https://github.com/local/zxwarp)';
const DELAY_MS = Number(process.env.FETCH_DELAY_MS || 500);
const LIMIT = process.env.FETCH_LIMIT ? Number(process.env.FETCH_LIMIT) : null;
const CATALOG_ONLY =
  process.env.CATALOG_ONLY === '1' ||
  process.argv.includes('--catalog-only') ||
  process.argv.includes('-c');
const FORCE =
  process.env.FORCE === '1' ||
  process.argv.includes('--force') ||
  process.argv.includes('-f');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function slugify(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function iaMirrorUrl(wosPubUrl) {
  const m = String(wosPubUrl).match(/\/pub\/(sinclair\/games\/[^?#]+)$/i);
  if (!m) return null;
  const inner = `World of Spectrum June 2017 Mirror/${m[1]}`;
  return (
    'https://archive.org/download/World_of_Spectrum_June_2017_Mirror/' +
    'World%20of%20Spectrum%20June%202017%20Mirror.zip/' +
    encodeURI(inner).replace(/#/g, '%23')
  );
}

function guessMachine(machineType, path) {
  const hay = `${machineType || ''} ${path || ''}`.toLowerCase();
  if (/128|pentagon|plus\s*3|\+3/.test(hay)) return 128;
  return 48;
}

/**
 * Score a release file for download preference. Prefer clean original TAP images.
 * @returns {number} higher is better; < 0 = reject
 */
function scoreFile(file, release) {
  const path = String(file?.path || '');
  const lower = path.toLowerCase();
  const format = String(file?.format || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();

  if (!path) return -1;
  if (!/\/(pub|zxdb)\/sinclair\//.test(lower)) return -1;
  if (/editor|trainer|map|manual|pok|cheat|demo|hack|inlay|screen|advert/.test(lower)) {
    return -1;
  }

  let score = 0;
  if (lower.endsWith('.tap.zip') || format.includes('(tap)') || /\btap\b/.test(format)) {
    score += 100;
  } else if (lower.endsWith('.tzx.zip') || format.includes('(tzx)') || /\btzx\b/.test(format)) {
    score += 70;
  } else if (lower.endsWith('.z80.zip')) score += 40;
  else if (lower.endsWith('.sna.zip')) score += 30;
  else if (lower.endsWith('.szx.zip')) score += 20;
  else if (type.includes('tape')) score += 10;
  else return -1;

  const fileName = lower.split('/').pop() || '';
  if (!/\(/.test(fileName)) score += 25;
  if ((release?.releaseSeq ?? 99) === 0) score += 15;
  if (/original/i.test(String(file?.origin || ''))) score += 10;
  if (lower.includes('/pub/sinclair/games/')) score += 5;
  return score;
}

function collectCandidates(source) {
  const ranked = [];
  for (const release of source.releases || []) {
    for (const file of release.files || []) {
      const score = scoreFile(file, release);
      if (score < 0) continue;
      ranked.push({
        path: file.path,
        score,
        format: file.format,
        releaseSeq: release.releaseSeq,
      });
    }
  }
  ranked.sort((a, b) => b.score - a.score);

  const urls = [];
  const seen = new Set();
  for (const item of ranked) {
    const abs = item.path.startsWith('http')
      ? item.path
      : `${WOS_BASE}${item.path.startsWith('/') ? '' : '/'}${item.path}`;
    if (seen.has(abs)) continue;
    seen.add(abs);
    urls.push(abs);
    if (/worldofspectrum\.net\/pub\//i.test(abs)) {
      const ia = iaMirrorUrl(abs);
      if (ia && !seen.has(ia)) {
        seen.add(ia);
        urls.push(ia);
      }
    }
  }
  return urls;
}

function pickMeta(source, listName) {
  const title = source.title || listName || 'Unknown';
  const year =
    source.originalYearOfRelease ??
    source.releases?.find((r) => r.yearOfRelease)?.yearOfRelease ??
    null;
  const publisher =
    source.publishers?.[0]?.name ||
    source.releases?.find((r) => r.publishers?.[0]?.name)?.publishers?.[0]?.name ||
    null;
  const type =
    source.genre ||
    [source.genreType, source.genreSubType].filter(Boolean).join(': ') ||
    null;
  return { title, year, publisher, type, machineType: source.machineType || null };
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}

async function downloadFile(url, dest) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/zip,*/*' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`download ${url} → ${res.status}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  renameSync(tmp, dest);
}

function extFromUrl(url) {
  const m = String(url).match(/\.(tap|tzx|z80|sna|szx)\.zip$/i);
  return (m?.[1] || 'zip').toLowerCase();
}

async function main() {
  if (!existsSync(listPath)) {
    throw new Error(`Missing ${listPath}`);
  }

  // Skip when catalog already exists — unless forcing or catalog-only refresh.
  if (existsSync(catalogPath) && !FORCE && !CATALOG_ONLY) {
    console.log(`Catalog already exists (${catalogPath}) — skipping fetch (use --force to re-run)`);
    return;
  }

  const list = JSON.parse(readFileSync(listPath, 'utf8'));
  if (!Array.isArray(list) || !list.length) {
    throw new Error(`${listPath} is empty or not an array`);
  }
  const games = LIMIT && LIMIT > 0 ? list.slice(0, LIMIT) : list;

  mkdirSync(outDir, { recursive: true });

  const catalog = {
    source: `${API_BASE}/games/{id} + ${listPath}`,
    fetchedAt: new Date().toISOString(),
    note:
      'Game list from games/games.json; metadata via ZXInfo API v3 (ZXDB); files from World of Spectrum. Personal/offline play only — original rights remain with publishers.',
    games: [],
  };

  console.log(
    CATALOG_ONLY
      ? `Updating catalog for ${games.length} games via ZXInfo API (no downloads)…`
      : `Fetching ${games.length} games via ZXInfo API…`
  );

  for (let i = 0; i < games.length; i++) {
    const entry = games[i];
    const id = String(entry.id || '').padStart(7, '0');
    const rank = i + 1;
    const listName = entry.name || id;
    process.stdout.write(`[${rank}/${games.length}] ${listName} (${id})… `);

    const itemUrl = `${WOS_BASE}/item/${id}/`;
    const apiUrl = `${API_BASE}/games/${id}`;

    try {
      const doc = await fetchJson(apiUrl);
      const source = doc?._source;
      if (!source) throw new Error('no _source in API response');

      const meta = pickMeta(source, listName);
      const slug = slugify(meta.title);
      const candidates = collectCandidates(source);

      if (!candidates.length) {
        console.log('NO FILE');
        catalog.games.push({
          rank,
          id,
          title: meta.title,
          year: meta.year,
          publisher: meta.publisher,
          type: meta.type,
          slug,
          itemUrl,
          apiUrl,
          file: null,
          path: null,
          downloadUrl: null,
          machine: guessMachine(meta.machineType),
          error: 'no suitable tape/snapshot found',
        });
        await sleep(DELAY_MS);
        continue;
      }

      let downloadUrl = null;
      let kind = null;
      let filename = null;
      let dest = null;
      let lastErr = null;
      let fromCache = false;

      for (const candidate of candidates) {
        kind = extFromUrl(candidate);
        filename = `${id}-${slug}.${kind}.zip`;
        dest = join(outDir, filename);
        if (existsSync(dest)) {
          downloadUrl = candidate;
          fromCache = true;
          break;
        }
        if (CATALOG_ONLY) {
          // Record the preferred remote without downloading.
          if (!downloadUrl) {
            downloadUrl = candidate;
          }
          continue;
        }
        try {
          await downloadFile(candidate, dest);
          downloadUrl = candidate;
          break;
        } catch (err) {
          lastErr = err;
        }
      }

      if (CATALOG_ONLY && downloadUrl && !fromCache) {
        // Prefer first candidate's naming even when the local zip is absent.
        kind = extFromUrl(downloadUrl);
        filename = `${id}-${slug}.${kind}.zip`;
        dest = join(outDir, filename);
        const local = existsSync(dest);
        console.log(local ? `meta · local ${kind.toUpperCase()}` : `meta · missing ${kind.toUpperCase()}`);
        catalog.games.push({
          rank,
          id,
          title: meta.title,
          year: meta.year,
          publisher: meta.publisher,
          type: meta.type,
          slug,
          itemUrl,
          apiUrl,
          downloadUrl,
          file: local ? filename : null,
          path: local ? `games/library/${filename}` : null,
          machine: guessMachine(meta.machineType, downloadUrl),
          format: kind,
          ...(local ? {} : { error: 'file not downloaded yet' }),
        });
        await sleep(DELAY_MS);
        continue;
      }

      if (!downloadUrl) {
        console.log(`FAIL ${lastErr?.message || 'all mirrors failed'}`);
        catalog.games.push({
          rank,
          id,
          title: meta.title,
          year: meta.year,
          publisher: meta.publisher,
          type: meta.type,
          slug,
          itemUrl,
          apiUrl,
          file: null,
          path: null,
          downloadUrl: null,
          machine: guessMachine(meta.machineType),
          error: String(lastErr?.message || 'all mirrors failed'),
        });
        await sleep(DELAY_MS);
        continue;
      }

      const relPath = `games/library/${filename}`;
      const machine = guessMachine(meta.machineType, downloadUrl);
      console.log(
        CATALOG_ONLY
          ? `meta · local ${kind.toUpperCase()}`
          : `${fromCache ? 'cached' : 'OK'} ← ${kind.toUpperCase()}`
      );

      catalog.games.push({
        rank,
        id,
        title: meta.title,
        year: meta.year,
        publisher: meta.publisher,
        type: meta.type,
        slug,
        itemUrl,
        apiUrl,
        downloadUrl,
        file: filename,
        path: relPath,
        machine,
        format: kind,
      });
    } catch (err) {
      console.log(`FAIL ${err.message}`);
      catalog.games.push({
        rank,
        id,
        title: listName,
        year: null,
        publisher: null,
        type: null,
        slug: slugify(listName),
        itemUrl,
        apiUrl,
        file: null,
        path: null,
        downloadUrl: null,
        machine: 48,
        error: String(err.message || err),
      });
    }

    await sleep(DELAY_MS);
  }

  writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
  const ok = catalog.games.filter((g) => g.path).length;
  console.log(
    `\nWrote ${catalogPath} (${ok}/${catalog.games.length} with local files${CATALOG_ONLY ? '; catalog-only' : ''})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
