/**
 * Shared USB ID lookup against data from linux-usb.org (see scripts/fetch-usb-ids.js).
 * Exposes window.ZxUsbIds for plain script tags (no bundler).
 */
(() => {
  /** @type {{ vendors?: Record<string, { name: string, products?: Record<string, string> }> } | null} */
  let db = null;
  /** @type {Promise<object> | null} */
  let loadPromise = null;

  function load(url = './assets/usb-ids.json') {
    if (loadPromise) return loadPromise;
    loadPromise = fetch(url, { cache: 'force-cache' })
      .then((res) => {
        if (!res.ok) throw new Error(`usb-ids.json ${res.status}`);
        return res.json();
      })
      .then((data) => {
        db = data && typeof data === 'object' ? data : { vendors: {} };
        return db;
      })
      .catch((err) => {
        console.warn('USB ID database unavailable', err);
        db = { vendors: {} };
        return db;
      });
    return loadPromise;
  }

  function parseIds(id) {
    if (!id) return null;
    let m = String(id).match(/Vendor:\s*([0-9a-fA-F]{1,4})\s+Product:\s*([0-9a-fA-F]{1,4})/i);
    if (!m) m = String(id).match(/^([0-9a-fA-F]{4})-([0-9a-fA-F]{4})(?:-|$)/);
    if (!m) return null;
    return {
      vendor: m[1].toLowerCase().padStart(4, '0'),
      product: m[2].toLowerCase().padStart(4, '0'),
    };
  }

  function describe(padOrId) {
    const raw =
      typeof padOrId === 'string'
        ? padOrId.replace(/\s+/g, ' ').trim()
        : padOrId?.id
          ? String(padOrId.id).replace(/\s+/g, ' ').trim()
          : '';
    const ids = parseIds(raw);
    if (ids) {
      const entry = db?.vendors?.[ids.vendor];
      return {
        vendorId: ids.vendor,
        productId: ids.product,
        vendor: entry?.name || `Vendor ${ids.vendor}`,
        product: entry?.products?.[ids.product] || `Product ${ids.product}`,
        resolved: Boolean(entry?.name || entry?.products?.[ids.product]),
      };
    }
    const short = raw.replace(/\s*\(.*\)\s*$/, '').trim() || raw || 'Gamepad';
    return {
      vendorId: null,
      productId: null,
      vendor: '',
      product: short.slice(0, 48),
      resolved: false,
    };
  }

  window.ZxUsbIds = {
    load,
    parseIds,
    describe,
    get db() {
      return db;
    },
  };
})();
