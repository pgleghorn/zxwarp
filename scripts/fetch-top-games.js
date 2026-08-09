/**
 * Fetch the World of Spectrum visitor-voted top 100 and store playable zips.
 * Source: https://worldofspectrum.net/archive/best-games/
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'games', 'top100');
const legacyDir = join(root, 'games', 'top50');
const catalogPath = join(root, 'games', 'catalog.json');
const LIMIT = Number(process.env.TOP_GAMES || 100);
const BEST_URL = 'https://worldofspectrum.net/archive/best-games/';
const UA = 'zxwrap/0.1 (personal archive mirror; +https://github.com/local/zxwrap)';

function decodeEntities(text) {
  return String(text)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function slugify(title) {
  return decodeEntities(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function iaMirrorUrl(wosPubUrl) {
  const m = wosPubUrl.match(/\/pub\/(sinclair\/games\/[^?#]+)$/i);
  if (!m) return null;
  const inner = `World of Spectrum June 2017 Mirror/${m[1]}`;
  return (
    'https://archive.org/download/World_of_Spectrum_June_2017_Mirror/' +
    'World%20of%20Spectrum%20June%202017%20Mirror.zip/' +
    encodeURI(inner).replace(/#/g, '%23')
  );
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBestList(html) {
  const games = [];
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

  for (const row of rows) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
    if (cells.length < 6) continue;

    const link = cells[2].match(
      /href="[^"]*(?:infoseekid\.cgi\?id=|\/item\/)(\d{7})\/?"[^>]*>([^<]+)/i
    );
    if (!link) continue;

    const scoreText = stripTags(cells[1]);
    const scoreMatch = scoreText.match(/([\d.]+)\s*\(?\s*(\d+)\s*\)?/);
    const yearText = stripTags(cells[3]);
    const year = /^\d{4}$/.test(yearText) ? Number(yearText) : null;
    const rankText = stripTags(cells[0]);
    const rankHint = rankText.match(/^(\d+)\.?$/)?.[1];

    games.push({
      rankHint: rankHint ? Number(rankHint) : null,
      score: scoreMatch ? Number(scoreMatch[1]) : null,
      votes: scoreMatch ? Number(scoreMatch[2]) : null,
      id: link[1],
      title: decodeEntities(stripTags(link[2])),
      year,
      publisher: decodeEntities(stripTags(cells[4])),
      type: decodeEntities(stripTags(cells[5])),
    });
  }

  return games.slice(0, LIMIT).map((g, i) => ({
    ...g,
    rank: i + 1,
    slug: slugify(g.title),
  }));
}

function scoreDownload(url, titleSlug) {
  const lower = url.toLowerCase();
  if (!/\/pub\/sinclair\/games\//.test(lower) && !/\/zxdb\/sinclair\/entries\//.test(lower)) {
    return -1;
  }
  if (/editor|trainer|map|manual|pok|cheat|demo|hack/.test(lower)) return -1;

  const file = lower.split('/').pop() || '';
  const base = file.replace(/\.(tap|tzx|z80|sna|szx)\.zip$/i, '');
  const hasParen = /\(/.test(file);
  let score = 0;

  if (file.endsWith('.tap.zip')) score += 100;
  else if (file.endsWith('.tzx.zip')) score += 80;
  else if (file.endsWith('.z80.zip')) score += 60;
  else if (file.endsWith('.sna.zip')) score += 50;
  else if (file.endsWith('.szx.zip')) score += 40;
  else return -1;

  if (!hasParen) score += 25;
  if (base.replace(/[^a-z0-9]+/g, '-') === titleSlug) score += 15;
  if (lower.includes('worldofspectrum.net')) score += 5;
  return score;
}

function pickDownloads(html, titleSlug) {
  const urls = [
    ...html.matchAll(/https?:\/\/[^"'<\s]+\.(?:tap|tzx|z80|sna|szx)\.zip/gi),
  ].map((m) => m[0]);

  const ranked = [...new Set(urls)]
    .map((url) => ({ url, score: scoreDownload(url, titleSlug) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score);

  const expanded = [];
  for (const item of ranked) {
    expanded.push(item.url);
    if (/worldofspectrum\.net\/pub\//i.test(item.url)) {
      const ia = iaMirrorUrl(item.url);
      if (ia) expanded.push(ia);
    }
  }
  return expanded;
}

function guessMachine(title, type) {
  // Heuristic: late 128K-era titles often need 128; keep simple + override via catalog later.
  const t = `${title} ${type}`.toLowerCase();
  if (/where time stood still|chase h\.?q|midnight resistance|rainbow islands|wec le mans|myth/.test(t)) {
    return 128;
  }
  return 48;
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

async function main() {
  mkdirSync(outDir, { recursive: true });

  console.log(`Fetching ${BEST_URL}`);
  const bestHtml = await fetchText(BEST_URL);
  const list = parseBestList(bestHtml);
  if (list.length < LIMIT) {
    console.warn(`Only parsed ${list.length} games (wanted ${LIMIT})`);
  } else {
    console.log(`Parsed top ${list.length}`);
  }

  const catalog = {
    source: BEST_URL,
    fetchedAt: new Date().toISOString(),
    note: 'Visitor-voted Top games from World of Spectrum Classic. Files redistributed for personal/offline play; original rights remain with their owners. ROMs/tapes © respective publishers.',
    games: [],
  };

  for (const game of list) {
    const itemUrl = `https://worldofspectrum.net/item/${game.id}/`;
    process.stdout.write(`[${game.rank}/${list.length}] ${game.title}… `);

    try {
      const itemHtml = await fetchText(itemUrl);
      const candidates = pickDownloads(itemHtml, game.slug);
      if (!candidates.length) {
        console.log('NO DOWNLOAD');
        catalog.games.push({
          ...game,
          itemUrl,
          file: null,
          path: null,
          downloadUrl: null,
          machine: guessMachine(game.title, game.type),
          error: 'no suitable download found',
        });
        continue;
      }

      let downloadUrl = null;
      let kind = null;
      let filename = null;
      let dest = null;
      let lastErr = null;
      let fromCache = false;

      for (const candidate of candidates) {
        const extMatch = candidate.match(/\.(tap|tzx|z80|sna|szx)\.zip$/i);
        kind = (extMatch?.[1] || 'zip').toLowerCase();
        filename = `${String(game.rank).padStart(3, '0')}-${game.slug}.${kind}.zip`;
        dest = join(outDir, filename);
        const legacyNames = [
          join(outDir, `${String(game.rank).padStart(2, '0')}-${game.slug}.${kind}.zip`),
          join(legacyDir, `${String(game.rank).padStart(2, '0')}-${game.slug}.${kind}.zip`),
          join(legacyDir, filename),
        ];
        if (existsSync(dest)) {
          downloadUrl = candidate;
          fromCache = true;
          break;
        }
        const legacyHit = legacyNames.find((p) => existsSync(p));
        if (legacyHit) {
          mkdirSync(outDir, { recursive: true });
          renameSync(legacyHit, dest);
          downloadUrl = candidate;
          fromCache = true;
          break;
        }
        try {
          await downloadFile(candidate, dest);
          downloadUrl = candidate;
          break;
        } catch (err) {
          lastErr = err;
        }
      }

      if (!downloadUrl) {
        console.log(`FAIL ${lastErr?.message || 'all mirrors failed'}`);
        catalog.games.push({
          ...game,
          itemUrl,
          file: null,
          path: null,
          downloadUrl: null,
          machine: guessMachine(game.title, game.type),
          error: String(lastErr?.message || 'all mirrors failed'),
        });
        continue;
      }

      const relPath = `games/top100/${filename}`;
      console.log(`${fromCache ? 'cached' : 'OK'} ← ${kind.toUpperCase()}`);

      const machine = /128/i.test(filename)
        ? 128
        : guessMachine(game.title, game.type);

      catalog.games.push({
        rank: game.rank,
        id: game.id,
        title: game.title,
        year: game.year,
        publisher: game.publisher,
        type: game.type,
        score: game.score,
        votes: game.votes,
        slug: game.slug,
        itemUrl,
        downloadUrl,
        file: filename,
        path: relPath,
        machine,
        format: kind,
      });
    } catch (err) {
      console.log(`FAIL ${err.message}`);
      catalog.games.push({
        ...game,
        itemUrl,
        file: null,
        path: null,
        downloadUrl: null,
        machine: guessMachine(game.title, game.type),
        error: String(err.message || err),
      });
    }

    // Be polite to WoS
    await new Promise((r) => setTimeout(r, 250));
  }

  writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
  const ok = catalog.games.filter((g) => g.path).length;
  console.log(`\nWrote ${catalogPath} (${ok}/${catalog.games.length} files)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
