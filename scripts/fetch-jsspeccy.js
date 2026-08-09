import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const vendorDir = join(root, 'vendor');
const version = '3.2';
const url = `https://github.com/gasman/jsspeccy3/releases/download/v${version}/jsspeccy-${version}.zip`;

async function main() {
  mkdirSync(vendorDir, { recursive: true });
  const zipPath = join(root, `tmp-jsspeccy-${version}.zip`);

  console.log(`Downloading JSSpeccy ${version}…`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath));

  rmSync(vendorDir, { recursive: true, force: true });
  mkdirSync(vendorDir, { recursive: true });

  execFileSync('unzip', ['-o', zipPath, '-d', vendorDir], { stdio: 'inherit' });
  rmSync(zipPath, { force: true });

  // Drop macOS noise from the release zip
  rmSync(join(vendorDir, '__MACOSX'), { recursive: true, force: true });
  execFileSync('find', [vendorDir, '-name', '.DS_Store', '-delete']);
  execFileSync('find', [vendorDir, '-name', '._*', '-delete']);

  if (!existsSync(join(vendorDir, 'jsspeccy', 'jsspeccy.js'))) {
    throw new Error('JSSpeccy extract incomplete: jsspeccy/jsspeccy.js missing');
  }

  console.log(`JSSpeccy ${version} ready in vendor/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
