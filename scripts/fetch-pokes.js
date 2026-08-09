/**
 * Download Lady Eklipse Tipshop .pok archive and build games/pokes.json
 * Source: https://github.com/ladyeklipse/all-tipshop-pokes
 */
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outPath = join(root, 'games', 'pokes.json');
const ZIP_URL =
  'https://github.com/ladyeklipse/all-tipshop-pokes/archive/refs/heads/master.zip';

const FILE_RE =
  /^(.+?)\s*\((\d{4}|19xx|20xx)\)\s*\(([^)]+)\)(.*)\.pok$/i;

function normalizeTitle(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function parsePok(text) {
  const trainers = [];
  let current = null;

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line) continue;
    const kind = line[0];
    if (kind === 'Y') break;
    if (kind === 'N') {
      current = { name: line.slice(1).trim() || 'Cheat', pokes: [] };
      trainers.push(current);
      continue;
    }
    if ((kind === 'M' || kind === 'Z') && current) {
      // "Z 8 49984 0 0" — letter glued to bank, then address value original
      const m = line.match(/^[MZ]\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/);
      if (!m) continue;
      current.pokes.push({
        bank: Number(m[1]),
        address: Number(m[2]),
        value: Number(m[3]),
        original: Number(m[4]),
      });
    }
  }

  return trainers.filter((t) => t.pokes.length > 0);
}

function parseFilename(name) {
  const m = name.match(FILE_RE);
  if (!m) {
    return {
      title: name.replace(/\.pok$/i, ''),
      year: null,
      publisher: null,
      suffix: '',
    };
  }
  return {
    title: m[1].trim(),
    year: /^\d{4}$/.test(m[2]) ? Number(m[2]) : null,
    publisher: m[3].trim(),
    suffix: (m[4] || '').trim(),
  };
}

function walkPokFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkPokFiles(full, out);
    else if (entry.toLowerCase().endsWith('.pok')) out.push(full);
  }
  return out;
}

async function downloadZip(dest) {
  console.log('Downloading Tipshop pokes archive…');
  const res = await fetch(ZIP_URL, {
    headers: { 'User-Agent': 'zxwrap-poke-fetch' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  console.log(`Saved ${(buf.length / 1e6).toFixed(2)} MB → ${dest}`);
}

function unzipWithSystem(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true });
  // Prefer unzip; fall back to PowerShell / bsdtar
  try {
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', destDir], { stdio: 'inherit' });
    return;
  } catch {
    /* try tar */
  }
  execFileSync('tar', ['-xf', zipPath, '-C', destDir], { stdio: 'inherit' });
}

function findExtractedRoot(base) {
  const entries = readdirSync(base);
  for (const e of entries) {
    const full = join(base, e);
    if (statSync(full).isDirectory() && e.toLowerCase().includes('tipshop')) return full;
  }
  for (const e of entries) {
    const full = join(base, e);
    if (statSync(full).isDirectory()) return full;
  }
  return base;
}

async function main() {
  const work = join(tmpdir(), `zxwrap-pokes-${randomBytes(4).toString('hex')}`);
  mkdirSync(work, { recursive: true });
  const zipPath = join(work, 'pokes.zip');

  try {
    await downloadZip(zipPath);
    unzipWithSystem(zipPath, work);
    const srcRoot = findExtractedRoot(work);
    const files = walkPokFiles(srcRoot);
    console.log(`Parsing ${files.length} .pok files…`);

    const games = [];
    for (const full of files) {
      const file = full.split(/[/\\]/).pop();
      const meta = parseFilename(file);
      let trainers;
      try {
        trainers = parsePok(readFileSync(full, 'utf8'));
      } catch {
        continue;
      }
      if (!trainers.length) continue;

      const norm = normalizeTitle(meta.title);
      games.push({
        id: `${norm}|${meta.year || ''}|${normalizeTitle(meta.publisher || '')}|${normalizeTitle(meta.suffix)}`,
        title: meta.title,
        year: meta.year,
        publisher: meta.publisher,
        suffix: meta.suffix || undefined,
        file,
        norm,
        trainers,
      });
    }

    games.sort((a, b) => a.title.localeCompare(b.title) || (a.year || 0) - (b.year || 0));

    mkdirSync(dirname(outPath), { recursive: true });
    const payload = {
      source: 'https://github.com/ladyeklipse/all-tipshop-pokes',
      fetchedAt: new Date().toISOString(),
      count: games.length,
      games,
    };
    writeFileSync(outPath, JSON.stringify(payload));
    const mb = (statSync(outPath).size / 1e6).toFixed(2);
    console.log(`Wrote ${games.length} games → games/pokes.json (${mb} MB)`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
