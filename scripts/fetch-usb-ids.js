/**
 * Download the Linux USB ID repository and build data/usb-ids.json
 * Source: http://www.linux-usb.org/usb.ids
 * Fallback: systemd hwdb mirror on GitHub
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outPath = join(root, 'data', 'usb-ids.json');

const SOURCES = [
  'http://www.linux-usb.org/usb.ids',
  'https://raw.githubusercontent.com/systemd/systemd/main/hwdb.d/usb.ids',
];

async function downloadUsbIds() {
  let lastErr;
  for (const url of SOURCES) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} → ${res.status}`);
      const text = await res.text();
      if (!text.includes('054c') || text.length < 10_000) {
        throw new Error(`${url} returned unexpected content`);
      }
      return { url, text };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Could not download usb.ids');
}

/**
 * Parse the classic usb.ids text format into a compact vendor→products map.
 * @param {string} text
 */
function parseUsbIds(text) {
  /** @type {Record<string, { name: string, products: Record<string, string> }>} */
  const vendors = {};
  let current = null;

  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    // Device classes / other trailing sections (C / AT / R / …)
    if (/^[A-Z]\s/.test(line)) break;

    const vendor = line.match(/^([0-9a-fA-F]{4})\s{2}(.+)$/);
    if (vendor) {
      const id = vendor[1].toLowerCase();
      current = { name: vendor[2].trim(), products: {} };
      vendors[id] = current;
      continue;
    }

    const product = line.match(/^\t([0-9a-fA-F]{4})\s{2}(.+)$/);
    if (product && current) {
      current.products[product[1].toLowerCase()] = product[2].trim();
    }
  }

  return vendors;
}

async function main() {
  const { url, text } = await downloadUsbIds();
  const vendors = parseUsbIds(text);
  const vendorCount = Object.keys(vendors).length;
  const productCount = Object.values(vendors).reduce(
    (n, v) => n + Object.keys(v.products).length,
    0
  );

  mkdirSync(dirname(outPath), { recursive: true });
  const payload = {
    source: url,
    fetchedAt: new Date().toISOString(),
    vendorCount,
    productCount,
    vendors,
  };
  writeFileSync(outPath, JSON.stringify(payload));
  console.log(
    `Wrote ${outPath} (${vendorCount} vendors, ${productCount} products from ${url})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
