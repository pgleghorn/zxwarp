import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dist = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const VERSION = pkg.version || '0.0.0';
const vendorJs = join(root, 'vendor', 'jsspeccy', 'jsspeccy.js');
const gamesDir = join(root, 'games');
const catalogPath = join(gamesDir, 'catalog.json');

const GAME_EXTS = new Set(['.tap', '.tzx', '.z80', '.sna', '.szx', '.zip']);

function ensureJsspeccy() {
  if (!existsSync(vendorJs)) {
    console.log('JSSpeccy not found — fetching…');
    execFileSync(process.execPath, [join(root, 'scripts', 'fetch-jsspeccy.js')], {
      stdio: 'inherit',
    });
  }
  execFileSync(process.execPath, [join(root, 'scripts', 'patch-jsspeccy.js')], {
    stdio: 'inherit',
  });
}

function runScript(name) {
  execFileSync(process.execPath, [join(root, 'scripts', name)], {
    stdio: 'inherit',
  });
}

function ensureSupportingData() {
  // Always refresh catalog / pokes so `npm run build` is enough for a full site.
  // Game zip downloads are cached; missing archives are fetched.
  console.log('Fetching games…');
  runScript('fetch-top-games.js');
  console.log('Fetching pokes…');
  runScript('fetch-pokes.js');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function playHref(game) {
  if (!game.path) return null;
  // Machine is chosen in the play UI / remembered preference — don't force 48K here.
  const bits = [`l=${encodeURIComponent(game.path)}`];
  if (game.slug) bits.push(`g=${encodeURIComponent(game.slug)}`);
  return `./index.html#${bits.join('&')}`;
}

function loadCatalog() {
  if (!existsSync(catalogPath)) return null;
  return JSON.parse(readFileSync(catalogPath, 'utf8'));
}

function listLooseGames(catalogSlugs) {
  if (!existsSync(gamesDir)) return [];

  const games = [];

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('.') || entry === 'catalog.json' || entry === 'README.md') continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry === 'top50' || entry === 'top100') continue; // covered by catalog
        walk(full);
        continue;
      }
      if (!GAME_EXTS.has(extname(entry).toLowerCase())) continue;
      const rel = relative(gamesDir, full).split(/[/\\]/).join('/');
      const name = entry.replace(/\.[^.]+$/, '').replace(/^\d+-/, '');
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (catalogSlugs.has(slug)) continue;
      games.push({
        name: name.replace(/-/g, ' '),
        file: entry,
        path: `games/${rel}`,
        slug,
      });
    }
  }

  walk(gamesDir);
  return games.sort((a, b) => a.name.localeCompare(b.name));
}

function renderGamesPage(catalog) {
  const games = catalog?.games || [];
  const byYear = new Map();

  for (const g of games) {
    const year = g.year || 'Other';
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(g);
  }

  const years = [...byYear.keys()].sort((a, b) => {
    if (a === 'Other') return 1;
    if (b === 'Other') return -1;
    return Number(a) - Number(b);
  });

  const yearNav = [
    '<a href="#top100">Top 100</a>',
    ...years.map((y) => `<a href="#y${y}">${escapeHtml(String(y))}</a>`),
  ].join('\n');

  const rankList = games
    .map((g) => {
      const href = playHref(g);
      const title = escapeHtml(g.title);
      const meta = escapeHtml(
        [g.year, g.publisher, g.type].filter(Boolean).join(' · ')
      );
      if (href) {
        return `<li value="${g.rank}"><a href="${href}">${title}</a> <span class="meta">${meta}</span></li>`;
      }
      return `<li value="${g.rank}" class="unavailable"><span class="title">${title}</span> <span class="meta">${meta} · file unavailable — <a href="${escapeHtml(g.itemUrl)}" target="_blank" rel="noopener">WoS</a></span></li>`;
    })
    .join('\n');

  const yearSections = years
    .map((year) => {
      const items = byYear
        .get(year)
        .slice()
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((g) => {
          const href = playHref(g);
          const title = escapeHtml(g.title);
          if (href) return `<li><a href="${href}">${title}</a></li>`;
          return `<li class="unavailable"><span class="title">${title}</span></li>`;
        })
        .join('\n');
      return `<h2 id="y${year}">${escapeHtml(String(year))}</h2>\n<ul class="games year-list">\n${items}\n</ul>`;
    })
    .join('\n\n');

  return { yearNav, rankList, yearSections, count: games.filter((g) => g.path).length };
}

function copyTemplate(name, vars = {}) {
  let html = readFileSync(join(root, 'src', 'templates', name), 'utf8');
  const allVars = { VERSION, ...vars };
  for (const [key, value] of Object.entries(allVars)) {
    html = html.replaceAll(`{{${key}}}`, value);
  }
  writeFileSync(join(dist, name), html);
}

function main() {
  ensureJsspeccy();
  ensureSupportingData();

  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  cpSync(join(root, 'vendor', 'jsspeccy'), join(dist, 'jsspeccy'), { recursive: true });
  copyFileSync(join(root, 'vendor', 'favicon.ico'), join(dist, 'favicon.ico'));
  copyFileSync(join(root, 'vendor', 'COPYING'), join(dist, 'COPYING'));

  mkdirSync(join(dist, 'assets'), { recursive: true });
  copyFileSync(join(root, 'src', 'styles', 'main.css'), join(dist, 'assets', 'main.css'));
  copyFileSync(join(root, 'src', 'scripts', 'app.js'), join(dist, 'assets', 'app.js'));

  if (existsSync(gamesDir)) {
    cpSync(gamesDir, join(dist, 'games'), { recursive: true });
  } else {
    mkdirSync(join(dist, 'games'), { recursive: true });
  }

  const catalog = loadCatalog();
  const catalogSlugs = new Set((catalog?.games || []).map((g) => g.slug).filter(Boolean));
  const loose = listLooseGames(catalogSlugs);

  const publicCatalog = {
    source: catalog?.source || null,
    fetchedAt: catalog?.fetchedAt || null,
    games: (catalog?.games || []).map((g) => ({
      rank: g.rank,
      id: g.id,
      title: g.title,
      year: g.year,
      publisher: g.publisher,
      type: g.type,
      slug: g.slug,
      path: g.path,
      machine: g.machine || 48,
      itemUrl: g.itemUrl,
      available: Boolean(g.path),
    })),
    loose,
  };
  writeFileSync(join(dist, 'games.json'), JSON.stringify(publicCatalog, null, 2));

  const page = renderGamesPage(catalog);
  const looseHtml = loose.length
    ? `<h2 id="local">Other local files</h2>\n<ul class="games">\n${loose
        .map(
          (g) =>
            `<li><a href="./index.html#l=${encodeURIComponent(g.path)}">${escapeHtml(g.name)}</a> <span class="meta">${escapeHtml(g.file)}</span></li>`
        )
        .join('\n')}\n</ul>`
    : '';

  copyTemplate('index.html');
  copyTemplate('about.html');
  copyTemplate('games.html', {
    YEAR_NAV: page.yearNav || '<span class="empty">No catalog yet — <code>npm run build</code> fetches games.</span>',
    RANK_LIST:
      page.rankList ||
      '<li class="empty">No catalog yet. <code>npm run build</code> fetches games.</li>',
    YEAR_SECTIONS: `${page.yearSections || ''}\n${looseHtml}`,
  });

  writeFileSync(join(dist, '.htaccess'), 'AddType application/wasm wasm\n');

  const totalFiles = page.count + loose.length;
  console.log(
    `Built dist/ (${page.count} top-100 files, ${loose.length} other local, ${totalFiles} playable)`
  );
}

main();
