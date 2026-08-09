import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', 'dist');
const port = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.rom': 'application/octet-stream',
  '.szx': 'application/octet-stream',
  '.z80': 'application/octet-stream',
  '.sna': 'application/octet-stream',
  '.tap': 'application/octet-stream',
  '.tzx': 'application/octet-stream',
  '.zip': 'application/zip',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

if (!existsSync(root)) {
  console.error('dist/ missing — run npm run build first');
  process.exit(1);
}

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    const filePath = resolve(root, '.' + normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, ''));
    if (!filePath.startsWith(root + sep) && filePath !== root) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const st = statSync(filePath);
    if (st.isDirectory()) {
      res.writeHead(302, { Location: pathname.endsWith('/') ? pathname + 'index.html' : pathname + '/' });
      res.end();
      return;
    }

    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(readFileSync(filePath));
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    console.error(err);
    res.writeHead(500).end('Server error');
  }
});

server.listen(port, () => {
  console.log(`zxwarp serving dist/ at http://localhost:${port}/`);
});
