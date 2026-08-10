(() => {
  const MACHINE = { '48': 48, '128': 128, pentagon: 5, '5': 5 };
  const MACHINE_LABEL = { 48: 'Spectrum 48K', 128: 'Spectrum 128K', 5: 'Pentagon 128' };
  const MACHINE_STORAGE_KEY = 'zxwarp.machine';
  const DB_NAME = 'zxwarp';
  const DB_STORE = 'snapshots';
  const DB_VERSION = 1;

  const statusEl = document.getElementById('status');
  const toastEl = document.getElementById('toast');
  const shareInput = document.getElementById('share-input');
  const shareNote = document.getElementById('share-note');
  const machineSelect = document.getElementById('machine-select');
  const snapListEl = document.getElementById('snap-list');
  const pauseBtn = document.getElementById('btn-pause');
  const pokePanelEl = document.getElementById('poke-panel');
  const pokeListEl = document.getElementById('poke-list');
  const pokeMatchEl = document.getElementById('poke-match');
  const pokeEmptyEl = document.getElementById('poke-empty');

  let emu = null;
  let toastTimer = null;
  let catalog = null;
  let paused = false;
  let pokeCatalog = null;
  let pokeCatalogPromise = null;
  let pokeMatch = null;
  /** @type {Record<string, { previous: number }[]>} */
  let pokeUndo = {};

  const state = {
    machine: 128,
    autoLoad: true,
    tapeTraps: true,
    tapeAutoLoadMode: 'default',
    sandbox: false,
    openUrl: null,
    gameSlug: null,
    gameTitle: null,
  };

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || '';
  }

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  function gameKey() {
    return state.gameSlug || state.openUrl || 'default';
  }

  function parseHash(hash) {
    const raw = (hash || '').replace(/^#/, '');
    if (!raw) return;

    for (const part of raw.split(/[&;]/).filter(Boolean)) {
      const eq = part.indexOf('=');
      const key = (eq === -1 ? part : part.slice(0, eq)).toLowerCase();
      const value = eq === -1 ? '' : decodeURIComponent(part.slice(eq + 1));
      const negated = key.startsWith('!') || key.startsWith('~');
      const flag = negated ? key.slice(1) : key;

      if (flag === 'l' || flag === 'load') state.openUrl = value;
      else if (flag === 'g' || flag === 'game') state.gameSlug = value;
      else if (flag === '48' || flag === '128' || flag === 'pentagon' || flag === '5') {
        state.machine = MACHINE[flag] ?? Number(flag);
      } else if (flag === 'autoload') state.autoLoad = !negated;
      else if (flag === 'instant' || flag === 'traps') state.tapeTraps = !negated;
      else if (flag === 'usr0') state.tapeAutoLoadMode = negated ? 'default' : 'usr0';
      else if (flag === 'sandbox') state.sandbox = !negated;
      else if (flag === 'panels') {
        document.body.classList.toggle('panels-open', !negated);
      }
    }
  }

  function hashHasMachine(hash) {
    return /(?:^|[&#;])(?:48|128|pentagon|5)(?:[&#;]|$)/i.test(hash || '');
  }

  function rememberMachine() {
    try {
      sessionStorage.setItem(MACHINE_STORAGE_KEY, String(state.machine));
    } catch {
      /* ignore quota / private mode */
    }
  }

  function restoreMachinePreference() {
    if (hashHasMachine(location.hash)) return;
    try {
      const raw = sessionStorage.getItem(MACHINE_STORAGE_KEY);
      if (raw === '48' || raw === '128' || raw === '5') state.machine = Number(raw);
    } catch {
      /* ignore */
    }
  }

  function findCatalogGame({ slug, path } = {}) {
    const games = catalog?.games || [];
    if (slug) {
      const bySlug = games.find((g) => g.slug === slug);
      if (bySlug) return bySlug;
    }
    if (path) return games.find((g) => g.path === path) || null;
    return null;
  }

  function applyCatalogGame(game, { applyMachine = false } = {}) {
    if (!game) return;
    state.gameSlug = game.slug || state.gameSlug;
    state.gameTitle = game.title || state.gameTitle;
    if (game.path) state.openUrl = game.path;
    if (applyMachine && game.machine) state.machine = Number(game.machine);
  }

  function resolveGameFromHashAndCatalog() {
    if (state.gameSlug) {
      const game = findCatalogGame({ slug: state.gameSlug });
      if (game) {
        applyCatalogGame(game, { applyMachine: false });
        return game;
      }
    }
    const game = findCatalogGame({ path: state.openUrl });
    if (game) {
      applyCatalogGame(game, { applyMachine: false });
      return game;
    }
    if (state.openUrl && !state.gameTitle) {
      const leaf = state.openUrl.split('/').pop() || state.openUrl;
      state.gameTitle = leaf.replace(/\.(tap|tzx|z80|sna|szx)\.zip$/i, '').replace(/^\d+-/, '');
    }
    return null;
  }

  function buildShareHash() {
    const bits = [];
    if (state.machine === 48) bits.push('48');
    else if (state.machine === 128) bits.push('128');
    else if (state.machine === 5) bits.push('pentagon');
    if (!state.autoLoad) bits.push('!autoload');
    if (!state.tapeTraps) bits.push('!instant');
    if (state.tapeAutoLoadMode === 'usr0') bits.push('usr0');
    if (state.sandbox) bits.push('sandbox');
    if (document.body.classList.contains('panels-open')) bits.push('panels');
    if (state.gameSlug) bits.push(`g=${encodeURIComponent(state.gameSlug)}`);
    if (state.openUrl) bits.push(`l=${encodeURIComponent(state.openUrl)}`);
    return bits.join('&');
  }

  function syncShare() {
    const hash = buildShareHash();
    const url = `${location.origin}${location.pathname.replace(/games\.html$/, 'index.html')}${hash ? `#${hash}` : ''}`;
    if (shareInput) shareInput.value = url;
    if (shareNote) {
      const label = state.gameTitle || state.openUrl;
      shareNote.textContent = label
        ? `Loads ${label} on ${MACHINE_LABEL[state.machine] || state.machine}.`
        : `Opens ${MACHINE_LABEL[state.machine] || state.machine}.`;
    }
    return url;
  }

  function syncChrome() {
    if (machineSelect) machineSelect.value = String(state.machine);
    const autoBtn = document.getElementById('btn-autoload');
    if (autoBtn) {
      autoBtn.setAttribute('aria-pressed', state.autoLoad ? 'true' : 'false');
      autoBtn.textContent = state.autoLoad ? 'Auto-load: On' : 'Auto-load: Off';
    }
    const instantBtn = document.getElementById('btn-instant');
    if (instantBtn) {
      instantBtn.setAttribute('aria-pressed', state.tapeTraps ? 'true' : 'false');
      instantBtn.textContent = state.tapeTraps ? 'Instant tape load: On' : 'Instant tape load: Off';
    }
    syncShare();
  }

  function setPanelsOpen(open) {
    document.body.classList.toggle('panels-open', open);
    history.replaceState(null, '', `#${buildShareHash()}`);
    if (open) startMemMap();
    else stopMemMap();
    // Recalc after the CSS transition starts so the canvas tracks CRT size.
    requestAnimationFrame(() => {
      fitCanvas();
      setTimeout(fitCanvas, 240);
    });
  }

  function togglePanels() {
    setPanelsOpen(!document.body.classList.contains('panels-open'));
  }


  function applyTapeOptions() {
    if (!emu) return;
    if (typeof emu.setAutoLoadTapes === 'function') emu.setAutoLoadTapes(state.autoLoad);
    if (typeof emu.setTapeTraps === 'function') emu.setTapeTraps(state.tapeTraps);
  }

  function setMachine(machine) {
    state.machine = Number(machine);
    rememberMachine();
    if (emu) emu.setMachine(state.machine);
    syncChrome();
    history.replaceState(null, '', `#${buildShareHash()}`);
  }

  function fitCanvas() {
    const stage = document.querySelector('.screen-stage');
    const crt = document.getElementById('crt');
    if (stage && crt) {
      const sw = stage.clientWidth;
      const sh = stage.clientHeight;
      if (sw > 0 && sh > 0) {
        let w = sw;
        let h = (sw * 3) / 4;
        if (h > sh) {
          h = sh;
          w = (sh * 4) / 3;
        }
        crt.style.width = `${Math.floor(w)}px`;
        crt.style.height = `${Math.floor(h)}px`;
      }
    }

    const root = document.getElementById('jsspeccy');
    if (!root) return;
    root.style.setProperty('width', '100%', 'important');
    root.style.setProperty('height', '100%', 'important');
    const wrap = root.querySelector(':scope > div');
    if (wrap) {
      // JSSpeccy sizes this wrapper to zoom pixels; force CRT fill instead.
      wrap.style.setProperty('position', 'absolute', 'important');
      wrap.style.setProperty('inset', '0', 'important');
      wrap.style.setProperty('width', '100%', 'important');
      wrap.style.setProperty('height', '100%', 'important');
      wrap.style.setProperty('max-width', 'none', 'important');
      wrap.style.setProperty('max-height', 'none', 'important');
      wrap.style.setProperty('margin', '0', 'important');
      wrap.style.setProperty('padding', '0', 'important');
    }
    const canvas = root.querySelector('canvas');
    if (!canvas) return;
    canvas.style.setProperty('position', 'absolute', 'important');
    canvas.style.setProperty('inset', '0', 'important');
    canvas.style.setProperty('width', '100%', 'important');
    canvas.style.setProperty('height', '100%', 'important');
    canvas.style.setProperty('max-width', 'none', 'important');
    canvas.style.setProperty('max-height', 'none', 'important');
    canvas.style.setProperty('display', 'block', 'important');
  }

  function watchCanvasSize() {
    const host = document.getElementById('jsspeccy');
    if (!host || host.dataset.fitWatch) return;
    host.dataset.fitWatch = '1';
    const mo = new MutationObserver(() => fitCanvas());
    mo.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'width', 'height'] });
    window.addEventListener('resize', fitCanvas);
    const stage = document.querySelector('.screen-stage');
    if (stage && typeof ResizeObserver === 'function') {
      new ResizeObserver(() => fitCanvas()).observe(stage);
    }
    fitCanvas();
  }

  function setPaused(next) {
    paused = next;
    if (!emu) return;
    if (paused) {
      if (typeof emu.pause === 'function') emu.pause();
      if (pauseBtn) pauseBtn.textContent = 'Resume';
      setStatus('Paused');
    } else {
      if (typeof emu.start === 'function') emu.start();
      if (pauseBtn) pauseBtn.textContent = 'Pause';
      setStatus('');
    }
  }

  function restart({ quiet = false } = {}) {
    if (!emu) return;
    setPaused(false);
    pokeUndo = {};
    if (state.openUrl) {
      emu.openUrl(state.openUrl);
      if (!quiet) toast('Restarting…');
      setTimeout(() => {
        applyEnabledPokes({ quiet: true }).catch(() => {});
      }, 2500);
    } else {
      powerReset({ quiet });
    }
  }

  function powerReset({ quiet = false } = {}) {
    if (!emu || typeof emu.reset !== 'function') return;
    setPaused(false);
    pokeUndo = {};
    emu.reset();
    if (!quiet) toast('Reset');
  }

  /* ——— IndexedDB snapshots ——— */

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          const store = db.createObjectStore(DB_STORE, { keyPath: 'id' });
          store.createIndex('gameKey', 'gameKey', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbOp(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, mode);
      const store = tx.objectStore(DB_STORE);
      const result = fn(store);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
    });
  }

  function listSnapshots(key) {
    return new Promise(async (resolve, reject) => {
      try {
        const db = await openDb();
        const tx = db.transaction(DB_STORE, 'readonly');
        const idx = tx.objectStore(DB_STORE).index('gameKey');
        const req = idx.getAll(key);
        req.onsuccess = () => {
          const rows = (req.result || []).sort((a, b) => b.createdAt - a.createdAt);
          resolve(rows);
        };
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  function saveSnapshotRecord(record) {
    return dbOp('readwrite', (store) => store.put(record));
  }

  function deleteSnapshotRecord(id) {
    return dbOp('readwrite', (store) => store.delete(id));
  }

  function u8ToB64(u8) {
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  function b64ToU8(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function serializeSnapshot(snapshot) {
    const memoryPages = {};
    for (const [page, data] of Object.entries(snapshot.memoryPages || {})) {
      const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
      memoryPages[page] = u8ToB64(u8);
    }
    return {
      model: snapshot.model,
      registers: snapshot.registers,
      ulaState: snapshot.ulaState,
      tstates: snapshot.tstates,
      halted: !!snapshot.halted,
      memoryPages,
    };
  }

  function deserializeSnapshot(stored) {
    const memoryPages = {};
    for (const [page, b64] of Object.entries(stored.memoryPages || {})) {
      memoryPages[page] = b64ToU8(b64);
    }
    return {
      model: stored.model,
      registers: stored.registers,
      ulaState: stored.ulaState,
      tstates: stored.tstates,
      halted: !!stored.halted,
      memoryPages,
    };
  }

  function captureThumb() {
    const canvas = document.querySelector('#jsspeccy canvas');
    if (!canvas) return null;
    try {
      const thumb = document.createElement('canvas');
      thumb.width = 160;
      thumb.height = 120;
      const ctx = thumb.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
      return thumb.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  function requestWorkerSnapshot() {
    const worker = window.__zxwarpWorker;
    if (!worker) return Promise.reject(new Error('Emulator worker not ready'));

    return new Promise((resolve, reject) => {
      const id = `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timer = setTimeout(() => {
        worker.removeEventListener('message', onMsg);
        reject(new Error('Snapshot timed out'));
      }, 4000);

      function onMsg(e) {
        if (!e.data || e.data.message !== 'snapshot' || e.data.id !== id) return;
        clearTimeout(timer);
        worker.removeEventListener('message', onMsg);
        resolve(e.data.snapshot);
      }

      worker.addEventListener('message', onMsg);
      worker.postMessage({ message: 'getSnapshot', id });
    });
  }

  /* ——— Live memory map (right panel) ——— */
  const memMapCanvas = document.getElementById('memmap-canvas');
  const memMapCtx = memMapCanvas?.getContext('2d', { alpha: false });
  let memMapTimer = null;
  let memMapBusy = false;
  let memMapImage = null;
  let memMapPopup = null;
  let memMapPopupCanvas = null;
  let memMapPopupCtx = null;
  let memMapPopupHint = null;
  /** @type {Uint8Array | null} */
  let memMapBytes = null;
  const memMapView = { zoom: 1, panX: 0, panY: 0 };

  function pageBytes(pages, pageNum) {
    const raw = pages?.[pageNum] ?? pages?.[String(pageNum)];
    if (!raw) return null;
    return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  }

  function memMapPopupOpen() {
    return Boolean(memMapPopup && !memMapPopup.closed && memMapPopupCtx && memMapPopupCanvas);
  }

  function memMapPanelExpanded() {
    return document.getElementById('memmap-panel')?.classList.contains('expanded');
  }

  function memMapShouldRun() {
    const sideLive =
      document.body.classList.contains('panels-open') && memMapPanelExpanded();
    return sideLive || memMapPopupOpen();
  }

  function formatMemHint(addr, value) {
    const hexAddr = addr.toString(16).toUpperCase().padStart(4, '0');
    const hexVal = value.toString(16).toUpperCase().padStart(2, '0');
    return `addr ${addr} / $${hexAddr} · byte ${value} / $${hexVal}`;
  }

  function clampMemMapView() {
    if (!memMapPopupCanvas) return;
    const cw = memMapPopupCanvas.width;
    const ch = memMapPopupCanvas.height;
    const z = memMapView.zoom;
    const dw = cw * z;
    const dh = ch * z;
    if (z <= 1) {
      memMapView.panX = (cw - dw) / 2;
      memMapView.panY = (ch - dh) / 2;
      return;
    }
    memMapView.panX = Math.min(0, Math.max(cw - dw, memMapView.panX));
    memMapView.panY = Math.min(0, Math.max(ch - dh, memMapView.panY));
  }

  function paintMemMapPopup() {
    if (!memMapPopupOpen() || !memMapCanvas) return;
    const cw = memMapPopupCanvas.width;
    const ch = memMapPopupCanvas.height;
    clampMemMapView();
    memMapPopupCtx.imageSmoothingEnabled = false;
    memMapPopupCtx.fillStyle = '#050805';
    memMapPopupCtx.fillRect(0, 0, cw, ch);
    memMapPopupCtx.drawImage(
      memMapCanvas,
      memMapView.panX,
      memMapView.panY,
      cw * memMapView.zoom,
      ch * memMapView.zoom
    );
  }

  function drawMemMap(snapshot) {
    if (!memMapCtx || !memMapCanvas) return;
    const pages = snapshot.memoryPages || {};
    const model = Number(snapshot.model) || 48;
    const paging = Number(snapshot.ulaState?.pagingFlags) || 0;
    const pageC000 = model === 48 ? 0 : paging & 7;
    const order = [5, 2, pageC000];

    if (!memMapImage || memMapImage.width !== 256 || memMapImage.height !== 192) {
      memMapImage = memMapCtx.createImageData(256, 192);
    }
    if (!memMapBytes || memMapBytes.length !== 256 * 192) {
      memMapBytes = new Uint8Array(256 * 192);
    }
    const data = memMapImage.data;
    let i = 0;
    for (const pageNum of order) {
      const page = pageBytes(pages, pageNum);
      for (let b = 0; b < 16384; b++, i++) {
        const v = page ? page[b] & 255 : 0;
        memMapBytes[i] = v;
        const pix = i * 4;
        const addr = 0x4000 + i;
        let r;
        let g;
        let bl;
        if (addr < 0x5800) {
          // Display file
          r = v >> 2;
          g = 30 + (v >> 1);
          bl = 70 + (v >> 1);
        } else if (addr < 0x5b00) {
          // Attributes — expose ink/paper bits
          const ink = v & 7;
          const paper = (v >> 3) & 7;
          r = 40 + ink * 28 + (v & 0x40 ? 40 : 0);
          g = 20 + paper * 18;
          bl = 60 + ink * 20 + paper * 10;
        } else {
          // General RAM
          r = v >> 1;
          g = 40 + (v >> 1);
          bl = v >> 3;
        }
        data[pix] = r;
        data[pix + 1] = g;
        data[pix + 2] = bl;
        data[pix + 3] = 255;
      }
    }
    memMapCtx.putImageData(memMapImage, 0, 0);
    paintMemMapPopup();
  }

  async function updateMemMap() {
    if (memMapBusy) return;
    if (!memMapShouldRun()) return;
    if (!window.__zxwarpWorker) return;
    memMapBusy = true;
    try {
      const snapshot = await requestWorkerSnapshot();
      drawMemMap(snapshot);
    } catch {
      /* emulator not ready / busy */
    } finally {
      memMapBusy = false;
    }
  }

  function startMemMap() {
    if (memMapTimer != null) return;
    updateMemMap();
    memMapTimer = setInterval(updateMemMap, 200);
  }

  function stopMemMap() {
    if (memMapTimer == null) return;
    clearInterval(memMapTimer);
    memMapTimer = null;
  }

  function bindMemMapPopupControls(win, canvas) {
    const hint = win.document.getElementById('hint');
    memMapPopupHint = hint;
    let dragging = false;
    let lastClientX = 0;
    let lastClientY = 0;

    function eventToCanvas(e) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return {
        cx: ((e.clientX - rect.left) / rect.width) * canvas.width,
        cy: ((e.clientY - rect.top) / rect.height) * canvas.height,
        rect,
      };
    }

    function mapPosFromEvent(e) {
      const pt = eventToCanvas(e);
      if (!pt) return null;
      const dw = canvas.width * memMapView.zoom;
      const dh = canvas.height * memMapView.zoom;
      if (dw <= 0 || dh <= 0) return null;
      const x = Math.floor(((pt.cx - memMapView.panX) / dw) * 256);
      const y = Math.floor(((pt.cy - memMapView.panY) / dh) * 192);
      if (x < 0 || y < 0 || x >= 256 || y >= 192) return null;
      return { x, y };
    }

    function updateHint(e) {
      if (!hint) return;
      const pos = mapPosFromEvent(e);
      if (!pos || !memMapBytes) {
        hint.textContent = 'Scroll to zoom · drag to pan · hover for address / byte';
        return;
      }
      const idx = pos.y * 256 + pos.x;
      const addr = 0x4000 + idx;
      const value = memMapBytes[idx] & 255;
      const z = memMapView.zoom >= 10 ? memMapView.zoom.toFixed(0) : memMapView.zoom.toFixed(1);
      hint.textContent = `${formatMemHint(addr, value)} · ×${z}`;
    }

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const pt = eventToCanvas(e);
        if (!pt) return;
        const oldZ = memMapView.zoom;
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const newZ = Math.min(32, Math.max(1, oldZ * factor));
        if (newZ === oldZ) return;
        memMapView.panX = pt.cx - (pt.cx - memMapView.panX) * (newZ / oldZ);
        memMapView.panY = pt.cy - (pt.cy - memMapView.panY) * (newZ / oldZ);
        memMapView.zoom = newZ;
        clampMemMapView();
        paintMemMapPopup();
        updateHint(e);
      },
      { passive: false }
    );

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      e.preventDefault();
    });

    win.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
    });

    win.addEventListener('mousemove', (e) => {
      if (dragging) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          memMapView.panX += ((e.clientX - lastClientX) / rect.width) * canvas.width;
          memMapView.panY += ((e.clientY - lastClientY) / rect.height) * canvas.height;
          lastClientX = e.clientX;
          lastClientY = e.clientY;
          clampMemMapView();
          paintMemMapPopup();
        }
      }
      updateHint(e);
    });

    canvas.addEventListener('mouseleave', () => {
      if (hint && !dragging) {
        hint.textContent = 'Scroll to zoom · drag to pan · hover for address / byte';
      }
    });
  }

  function openMemMapWindow() {
    if (memMapPopupOpen()) {
      memMapPopup.focus();
      return;
    }

    const scale = 4;
    const cw = 256 * scale;
    const ch = 192 * scale;
    const features = `popup=yes,width=${cw + 48},height=${ch + 120},menubar=no,toolbar=no,location=no,status=no`;
    const win = window.open('', 'zxwarp-memmap', features);
    if (!win) {
      toast('Popup blocked — allow popups for this site');
      return;
    }

    memMapView.zoom = 1;
    memMapView.panX = 0;
    memMapView.panY = 0;

    win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>zxwarp – Memory map</title>
  <style>
    html, body { margin: 0; height: 100%; background: #050805; color: #9ab090; font: 12px/1.4 "IBM Plex Mono", Consolas, monospace; }
    body { display: grid; place-items: center; gap: 0.55rem; padding: 0.75rem; box-sizing: border-box; }
    h1 { margin: 0; font: 600 0.95rem/1 "IBM Plex Sans", sans-serif; color: #6ecf6a; }
    canvas { width: min(100%, ${cw}px); height: auto; aspect-ratio: 256 / 192; image-rendering: pixelated; image-rendering: crisp-edges; background: #000; border: 1px solid #2a3a28; cursor: crosshair; }
    .legend { display: flex; gap: 0.75rem; margin: 0; opacity: 0.9; }
    .legend span::before { content: ""; display: inline-block; width: 0.55rem; height: 0.55rem; margin-right: 0.28rem; border-radius: 2px; vertical-align: -0.05rem; }
    .s::before { background: #4a8cff; } .a::before { background: #e05ad0; } .r::before { background: #6ecf6a; }
    #hint { margin: 0; min-height: 1.2em; color: #c8e0c4; letter-spacing: 0.01em; }
  </style>
</head>
<body>
  <h1>Memory map</h1>
  <canvas id="map" width="${cw}" height="${ch}"></canvas>
  <p id="hint">Scroll to zoom · drag to pan · hover for address / byte</p>
  <p class="legend"><span class="s">screen</span><span class="a">attrs</span><span class="r">RAM</span></p>
</body>
</html>`);
    win.document.close();

    memMapPopup = win;
    memMapPopupCanvas = win.document.getElementById('map');
    memMapPopupCtx = memMapPopupCanvas?.getContext('2d', { alpha: false }) || null;
    if (memMapPopupCtx) memMapPopupCtx.imageSmoothingEnabled = false;

    if (memMapPopupCanvas) bindMemMapPopupControls(win, memMapPopupCanvas);

    win.addEventListener('beforeunload', () => {
      if (memMapPopup === win) {
        memMapPopup = null;
        memMapPopupCanvas = null;
        memMapPopupCtx = null;
        memMapPopupHint = null;
        stopMemMap();
      }
    });

    paintMemMapPopup();
    startMemMap();
    updateMemMap();
  }

  async function createSnapshot() {
    if (!emu) return;
    try {
      const wasPaused = paused;
      if (!wasPaused) setPaused(true);
      const snapshot = await requestWorkerSnapshot();
      const thumb = captureThumb();
      const record = {
        id: `${gameKey()}::${Date.now()}`,
        gameKey: gameKey(),
        gameTitle: state.gameTitle || gameKey(),
        createdAt: Date.now(),
        thumb,
        snapshot: serializeSnapshot(snapshot),
      };
      await saveSnapshotRecord(record);
      if (!wasPaused) setPaused(false);
      toast('State remembered');
      await renderSnapshots();
    } catch (err) {
      console.error(err);
      toast('Could not save snapshot');
    }
  }

  /* ——— .z80 file download ——— */

  function pageToZ80Id(model, pageNumber) {
    if (model === 48) {
      return { 5: 8, 2: 4, 0: 5 }[pageNumber];
    }
    return { 0: 3, 1: 4, 2: 5, 3: 6, 4: 7, 5: 8, 6: 9, 7: 10 }[pageNumber];
  }

  function hardwareModeForModel(model) {
    if (model === 48) return 0;
    if (model === 5) return 9; // Pentagon 128
    return 3; // Spectrum 128
  }

  function encodeZ80(snapshot) {
    const regs = snapshot.registers || {};
    const ula = snapshot.ulaState || {};
    const model = Number(snapshot.model) || 48;
    const is48 = model === 48;
    const pages = snapshot.memoryPages || {};

    const headerLen = 30 + 2 + 54; // v1 + length word + v3 extra
    const pageNums = is48 ? [5, 2, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
    const bodySize = pageNums.reduce((n, p) => (pages[p] ? n + 3 + 0x4000 : n), 0);
    const out = new Uint8Array(headerLen + bodySize);
    const view = new DataView(out.buffer);

    const af = regs.AF & 0xffff;
    const af_ = regs.AF_ & 0xffff;
    const ir = regs.IR & 0xffff;
    view.setUint16(0, af, false); // AF big-endian
    view.setUint16(2, regs.BC & 0xffff, true);
    view.setUint16(4, regs.HL & 0xffff, true);
    view.setUint16(6, 0, true); // PC=0 marks v2/v3
    view.setUint16(8, regs.SP & 0xffff, true);
    out[10] = (ir >> 8) & 0xff; // I
    out[11] = ir & 0x7f; // R bits 0-6
    const border = (ula.borderColour || 0) & 7;
    out[12] = ((ir & 0x80) ? 1 : 0) | (border << 1);
    view.setUint16(13, regs.DE & 0xffff, true);
    view.setUint16(15, regs.BC_ & 0xffff, true);
    view.setUint16(17, regs.DE_ & 0xffff, true);
    view.setUint16(19, regs.HL_ & 0xffff, true);
    view.setUint16(21, af_, false); // AF' big-endian
    view.setUint16(23, regs.IY & 0xffff, true);
    view.setUint16(25, regs.IX & 0xffff, true);
    out[27] = regs.iff1 ? 1 : 0;
    out[28] = regs.iff2 ? 1 : 0;
    out[29] = (regs.im || 0) & 3;

    view.setUint16(30, 54, true); // v3 additional header length
    view.setUint16(32, regs.PC & 0xffff, true);
    out[34] = hardwareModeForModel(model);
    out[35] = is48 ? 0 : (ula.pagingFlags || 0) & 0xff;
    // tstate fields left 0 — acceptable for save/load

    let offset = headerLen;
    for (const pageNumber of pageNums) {
      const page = pages[pageNumber];
      const pageId = pageToZ80Id(model, pageNumber);
      if (!page || pageId == null) continue;
      const u8 = page instanceof Uint8Array ? page : new Uint8Array(page);
      view.setUint16(offset, 0xffff, true); // uncompressed
      out[offset + 2] = pageId;
      out.set(u8.subarray(0, 0x4000), offset + 3);
      offset += 3 + 0x4000;
    }

    return out.subarray(0, offset);
  }

  function downloadBlob(filename, bytes) {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function safeFilename(name) {
    return String(name || 'zxwarp')
      .replace(/[^\w\-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'zxwarp';
  }

  async function downloadZ80Snapshot() {
    if (!emu) return;
    const wasPaused = paused;
    try {
      if (!wasPaused) setPaused(true);
      const snapshot = await requestWorkerSnapshot();
      const bytes = encodeZ80(snapshot);
      const base = safeFilename(state.gameTitle || state.gameSlug || 'snapshot');
      downloadBlob(`${base}.z80`, new Uint8Array(bytes));
      toast('Downloaded .z80');
    } catch (err) {
      console.error(err);
      toast('Could not save .z80');
    } finally {
      if (!wasPaused) setPaused(false);
    }
  }

  /* ——— Spectrum key remaps (capture) ——— */

  const ZX = {
    CAPS: { row: 0, mask: 0x01, isCaps: true },
    SYM: { row: 7, mask: 0x02, isSymbol: true },
    ONE: { row: 3, mask: 0x01 },
    TWO: { row: 3, mask: 0x02 },
    THREE: { row: 3, mask: 0x04 },
    FOUR: { row: 3, mask: 0x08 },
    FIVE: { row: 3, mask: 0x10 },
    SIX: { row: 4, mask: 0x10 },
    SEVEN: { row: 4, mask: 0x08 },
    EIGHT: { row: 4, mask: 0x04 },
    NINE: { row: 4, mask: 0x02 },
    ZERO: { row: 4, mask: 0x01 },
    Q: { row: 2, mask: 0x01 },
    A: { row: 1, mask: 0x01 },
    O: { row: 5, mask: 0x02 },
    P: { row: 5, mask: 0x01 },
    M: { row: 7, mask: 0x04 },
    SPACE: { row: 7, mask: 0x01 },
    ENTER: { row: 6, mask: 0x01 },
  };

  const heldExtra = { alt: false, tab: false, home: false, shift: false };
  const GAMEPAD_STORE_KEY = 'zxwarp-gamepad-map';
  const GAMEPAD_DEADZONE = 0.35;
  /** If Gamepad.timestamp hasn't advanced for this long, treat snapshot as frozen. */
  const GAMEPAD_STALE_MS = 320;

  function loadUsbIds() {
    return window.ZxUsbIds?.load() || Promise.resolve({ vendors: {} });
  }

  function describeGamepad(pad) {
    if (window.ZxUsbIds?.describe) return window.ZxUsbIds.describe(pad);
    const raw = pad?.id ? String(pad.id).replace(/\s+/g, ' ').trim() : '';
    const short = raw.replace(/\s*\(.*\)\s*$/, '').trim() || raw || 'Gamepad';
    return { vendor: '', product: short.slice(0, 48) };
  }

  function emuKey(spec, down) {
    if (emu && typeof emu.keyDown === 'function' && typeof emu.keyUp === 'function') {
      if (down) emu.keyDown(spec);
      else emu.keyUp(spec);
      return;
    }
    const worker = window.__zxwarpWorker;
    if (!worker) return;
    worker.postMessage({
      message: down ? 'keyDown' : 'keyUp',
      row: spec.row,
      mask: spec.mask,
    });
  }

  function bindSpectrumKeys() {
    window.addEventListener(
      'keydown',
      (e) => {
        if (isTypingTarget(e.target)) return;

        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') heldExtra.shift = true;

        // Tab = Extended mode (Caps Shift + Symbol Shift)
        if (e.code === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          if (!heldExtra.tab && !e.repeat) {
            heldExtra.tab = true;
            emuKey(ZX.CAPS, true);
            emuKey(ZX.SYM, true);
          }
          return;
        }

        // Alt = Symbol Shift
        if (e.code === 'AltLeft' || e.code === 'AltRight') {
          e.preventDefault();
          e.stopPropagation();
          if (!heldExtra.alt && !e.repeat) {
            heldExtra.alt = true;
            emuKey(ZX.SYM, true);
          }
          return;
        }

        // Home = Edit (Caps Shift + 1)
        if (e.code === 'Home') {
          e.preventDefault();
          e.stopPropagation();
          if (!heldExtra.home && !e.repeat) {
            heldExtra.home = true;
            emuKey(ZX.CAPS, true);
            emuKey(ZX.ONE, true);
          }
        }
      },
      true
    );

    window.addEventListener(
      'keyup',
      (e) => {
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') heldExtra.shift = false;

        if (e.code === 'Tab' && heldExtra.tab) {
          e.preventDefault();
          e.stopPropagation();
          heldExtra.tab = false;
          emuKey(ZX.SYM, false);
          if (!heldExtra.shift) emuKey(ZX.CAPS, false);
          return;
        }

        if ((e.code === 'AltLeft' || e.code === 'AltRight') && heldExtra.alt) {
          e.preventDefault();
          e.stopPropagation();
          heldExtra.alt = false;
          if (!heldExtra.tab) emuKey(ZX.SYM, false);
          return;
        }

        if (e.code === 'Home' && heldExtra.home) {
          e.preventDefault();
          e.stopPropagation();
          heldExtra.home = false;
          emuKey(ZX.ONE, false);
          if (!heldExtra.shift && !heldExtra.tab) emuKey(ZX.CAPS, false);
        }
      },
      true
    );

    window.addEventListener('blur', () => {
      if (heldExtra.tab || heldExtra.alt || heldExtra.home) {
        emuKey(ZX.ONE, false);
        emuKey(ZX.SYM, false);
        emuKey(ZX.CAPS, false);
      }
      heldExtra.alt = heldExtra.tab = heldExtra.home = heldExtra.shift = false;
    });
  }

  /* ——— USB / Bluetooth gamepad (PS4 DualShock via Gamepad API) ——— */

  function gamepadMapMode() {
    try {
      const v = localStorage.getItem(GAMEPAD_STORE_KEY);
      if (v === 'sinclair' || v === 'qaop' || v === 'cursor') return v;
    } catch {
      /* ignore */
    }
    return 'cursor';
  }

  function setGamepadMapMode(mode) {
    const next = mode === 'sinclair' || mode === 'qaop' ? mode : 'cursor';
    try {
      localStorage.setItem(GAMEPAD_STORE_KEY, next);
    } catch {
      /* ignore */
    }
    const sel = document.getElementById('gamepad-map');
    if (sel) sel.value = next;
    return next;
  }

  function updateGamepadStatus(pad, activity = '') {
    const root = document.getElementById('gamepad-status');
    const prompt = document.getElementById('gamepad-prompt');
    const ident = document.getElementById('gamepad-ident');
    const vendorEl = document.getElementById('gamepad-vendor');
    const productEl = document.getElementById('gamepad-product');
    const inputEl = document.getElementById('gamepad-input');
    if (!root || !prompt || !ident) return;

    if (!pad) {
      prompt.hidden = false;
      prompt.textContent = navigator.getGamepads
        ? 'Press a button on your gamepad…'
        : 'Gamepad API not available';
      ident.hidden = true;
      if (vendorEl) vendorEl.textContent = '';
      if (productEl) productEl.textContent = '';
      if (inputEl) inputEl.textContent = '';
      root.classList.remove('on');
      return;
    }

    const { vendor, product } = describeGamepad(pad);
    prompt.hidden = true;
    ident.hidden = false;
    if (vendorEl) {
      vendorEl.textContent = vendor;
      vendorEl.hidden = !vendor;
    }
    if (productEl) productEl.textContent = product;
    if (inputEl) inputEl.textContent = activity || '';
    root.classList.add('on');
  }

  function buttonPressed(buttons, index) {
    const b = buttons[index];
    if (b == null) return false;
    if (typeof b === 'number') return b > 0.5;
    return !!(b.pressed || (typeof b.value === 'number' && b.value > 0.5));
  }

  /** Age since last HID update (Gamepad.timestamp vs performance.now()). */
  function padTimestampAgeMs(pad, now = performance.now()) {
    if (!pad || typeof pad.timestamp !== 'number') return null;
    return Math.max(0, now - pad.timestamp);
  }

  function isPadFresh(pad, now = performance.now()) {
    const age = padTimestampAgeMs(pad, now);
    if (age == null) return true;
    // Different time bases / broken values — don't false-trigger stale.
    if (age > 60000) return true;
    return age <= GAMEPAD_STALE_MS;
  }

  function padActivity(pad) {
    let score = 0;
    const buttons = pad.buttons || [];
    for (let i = 0; i < buttons.length; i++) {
      if (buttonPressed(buttons, i)) score += 1;
    }
    const axes = pad.axes || [];
    for (let i = 0; i < axes.length; i++) {
      if (Math.abs(axes[i]) >= GAMEPAD_DEADZONE) score += 1;
    }
    return score;
  }

  function listConnectedPads() {
    if (!navigator.getGamepads) return [];
    const pads = [];
    const list = navigator.getGamepads();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p) continue;
      if (p.connected === false) continue;
      pads.push(p);
    }
    return pads;
  }

  function pickGamepad(preferredIndex = null) {
    const pads = listConnectedPads();
    if (!pads.length) return null;
    const now = performance.now();

    // Never drive keys from a frozen snapshot (PS button often leaves one stuck).
    const pool = pads.filter((p) => isPadFresh(p, now));
    if (!pool.length) return null;

    const active = pool
      .filter((p) => padActivity(p) > 0)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (active.length) {
      const prefActive = active.find((p) => p.index === preferredIndex);
      if (prefActive) return prefActive;
      return active[0];
    }

    if (preferredIndex != null) {
      const pref = pool.find((p) => p.index === preferredIndex);
      if (pref) return pref;
    }

    pool.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return pool.find((p) => p.mapping === 'standard') || pool[0];
  }

  function axisActive(v) {
    return Math.abs(v) >= GAMEPAD_DEADZONE;
  }

  function readPadDirections(pad) {
    const buttons = pad.buttons || [];
    const axes = pad.axes || [];
    let up = buttonPressed(buttons, 12);
    let down = buttonPressed(buttons, 13);
    let left = buttonPressed(buttons, 14);
    let right = buttonPressed(buttons, 15);

    // Left stick (0/1) and common extras (2/3 or 6/7 on some mappings)
    const axisPairs = [
      [0, 1],
      [2, 3],
      [6, 7],
    ];
    for (const [ax, ay] of axisPairs) {
      if (ax < axes.length && axisActive(axes[ax])) {
        if (axes[ax] < 0) left = true;
        if (axes[ax] > 0) right = true;
      }
      if (ay < axes.length && axisActive(axes[ay])) {
        if (axes[ay] < 0) up = true;
        if (axes[ay] > 0) down = true;
      }
    }

    if (up && down) {
      up = (axes[1] || 0) < 0 || (axes[3] || 0) < 0;
      down = (axes[1] || 0) > 0 || (axes[3] || 0) > 0;
    }
    if (left && right) {
      left = (axes[0] || 0) < 0 || (axes[2] || 0) < 0;
      right = (axes[0] || 0) > 0 || (axes[2] || 0) > 0;
    }
    return { up, down, left, right };
  }

  function gamepadActionMap(mode) {
    // Cross=fire, Circle=Enter (menus). Directions per Spectrum joystick scheme.
    if (mode === 'sinclair') {
      return {
        // Interface 2 / Sinclair port 1: 6 left, 7 right, 8 down, 9 up, 0 fire
        up: [ZX.NINE],
        down: [ZX.EIGHT],
        left: [ZX.SIX],
        right: [ZX.SEVEN],
        fire: [ZX.ZERO],
        enter: [ZX.ENTER],
      };
    }
    if (mode === 'qaop') {
      return {
        up: [ZX.Q],
        down: [ZX.A],
        left: [ZX.O],
        right: [ZX.P],
        fire: [ZX.SPACE],
        enter: [ZX.ENTER],
      };
    }
    // Cursor joystick: Caps+5/6/7/8 + 0 fire (same as arrow keys in JSSpeccy)
    return {
      up: [ZX.CAPS, ZX.SEVEN],
      down: [ZX.CAPS, ZX.SIX],
      left: [ZX.CAPS, ZX.FIVE],
      right: [ZX.CAPS, ZX.EIGHT],
      fire: [ZX.ZERO],
      enter: [ZX.ENTER],
    };
  }

  function bindGamepad() {
    /** @type {Set<string>} */
    let heldKeys = new Set();
    let raf = 0;
    let lastPadId = null;
    let preferredIndex = null;
    let missFrames = 0;
    const MISS_BEFORE_CLEAR = 90; // ~1.5s — Chrome often blanks getGamepads() briefly

    function keyId(spec) {
      return `${spec.row}:${spec.mask}`;
    }

    function keyFromId(id) {
      const [row, mask] = id.split(':').map(Number);
      return { row, mask };
    }

    const select = document.getElementById('gamepad-map');
    if (select) {
      select.value = gamepadMapMode();
      select.addEventListener('change', () => {
        setGamepadMapMode(select.value);
        for (const key of heldKeys) emuKey(keyFromId(key), false);
        heldKeys = new Set();
        toast(`Gamepad → ${select.options[select.selectedIndex].text}`);
      });
    }

    function applyKeySet(desired) {
      for (const id of heldKeys) {
        if (!desired.has(id)) emuKey(keyFromId(id), false);
      }
      for (const id of desired) {
        if (!heldKeys.has(id)) emuKey(keyFromId(id), true);
      }
      heldKeys = desired;
    }

    function releaseAll() {
      applyKeySet(new Set());
    }

    function notePad(pad) {
      if (!pad) return;
      preferredIndex = typeof pad.index === 'number' ? pad.index : preferredIndex;
      const id = pad.id || `index-${preferredIndex}`;
      if (id !== lastPadId) {
        if (lastPadId) releaseAll();
        lastPadId = id;
        updateGamepadStatus(pad);
      }
      missFrames = 0;
    }

    function tick() {
      raf = requestAnimationFrame(tick);
      try {
        if (document.hidden) {
          if (heldKeys.size) releaseAll();
          return;
        }
        if (paused) {
          if (heldKeys.size) releaseAll();
        }

        const connected = listConnectedPads();

        const pad = pickGamepad(preferredIndex);
        if (!pad) {
          if (heldKeys.size) releaseAll();
          missFrames += 1;
          if (connected.length) {
            // Still listed, but every snapshot is frozen — don't keep holding keys.
            const stuck = connected.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
            updateGamepadStatus(stuck, 'stale — press a face button');
            lastPadId = stuck.id || `index-${stuck.index}`;
            missFrames = 0;
            return;
          }
          if (lastPadId && missFrames >= MISS_BEFORE_CLEAR) {
            lastPadId = null;
            preferredIndex = null;
            missFrames = 0;
            updateGamepadStatus(null);
          }
          return;
        }

        // Follow whichever pad is producing fresh input.
        if (typeof pad.index === 'number') preferredIndex = pad.index;
        notePad(pad);
        if (paused) return;

        const mode = gamepadMapMode();
        const map = gamepadActionMap(mode);
        const dir = readPadDirections(pad);
        const buttons = pad.buttons || [];
        const fire =
          buttonPressed(buttons, 0) ||
          buttonPressed(buttons, 7) ||
          buttonPressed(buttons, 2); // Cross / R2 / Square
        const enter = buttonPressed(buttons, 1) || buttonPressed(buttons, 3); // Circle / Triangle

        const desired = new Set();
        const add = (keys, on) => {
          if (!on) return;
          for (const k of keys) desired.add(keyId(k));
        };
        add(map.up, dir.up);
        add(map.down, dir.down);
        add(map.left, dir.left);
        add(map.right, dir.right);
        add(map.fire, fire);
        add(map.enter, enter);
        applyKeySet(desired);

        const bits = [];
        if (dir.up) bits.push('↑');
        if (dir.down) bits.push('↓');
        if (dir.left) bits.push('←');
        if (dir.right) bits.push('→');
        if (fire) bits.push('○');
        if (enter) bits.push('↵');
        updateGamepadStatus(pad, bits.join(''));
      } catch (err) {
        console.warn('gamepad tick', err);
      }
    }

    window.addEventListener('gamepadconnected', (e) => {
      notePad(e.gamepad);
      toast('Gamepad connected');
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad && preferredIndex === e.gamepad.index) preferredIndex = null;
      releaseAll();
      lastPadId = null;
      missFrames = 0;
      const next = pickGamepad(preferredIndex);
      if (next) notePad(next);
      else updateGamepadStatus(null);
      toast('Gamepad disconnected');
    });

    window.addEventListener('focus', () => {
      const pad = pickGamepad(preferredIndex);
      if (pad) notePad(pad);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      const pad = pickGamepad(preferredIndex);
      if (pad) notePad(pad);
    });

    updateGamepadStatus(pickGamepad());
    loadUsbIds().then(() => {
      // Re-resolve vendor/product names once the linux-usb.org database is ready.
      updateGamepadStatus(pickGamepad(preferredIndex));
    });
    raf = requestAnimationFrame(tick);
    window.addEventListener('beforeunload', () => cancelAnimationFrame(raf));
  }

  async function recallLatestSnapshot() {
    const rows = await listSnapshots(gameKey());
    if (!rows.length) {
      toast('No saved state');
      return;
    }
    await loadSnapshotRecord(rows[0]);
    toast('State recalled');
  }

  async function loadSnapshotRecord(record) {
    if (!emu || !record?.snapshot) return;
    try {
      const snap = deserializeSnapshot(record.snapshot);
      state.machine = Number(snap.model) || state.machine;
      emu.loadSnapshotFromStruct(snap);
      setPaused(false);
      syncChrome();
      toast('Snapshot loaded');
      setStatus(`Loaded · ${new Date(record.createdAt).toLocaleString()}`);
    } catch (err) {
      console.error(err);
      toast('Could not load snapshot');
    }
  }

  async function renderSnapshots() {
    if (!snapListEl) return;
    const rows = await listSnapshots(gameKey());
    snapListEl.innerHTML = '';
    for (const row of rows) {
      const li = document.createElement('li');
      const when = new Date(row.createdAt).toLocaleString();
      li.innerHTML = `
        <button type="button" class="thumb" data-load="${row.id}" title="Load snapshot">
          ${row.thumb ? `<img src="${row.thumb}" alt="">` : '<img alt="">'}
        </button>
        <div class="snap-meta"><span>${when}</span></div>
        <div class="snap-actions">
          <button type="button" data-load="${row.id}">Load</button>
          <button type="button" class="danger" data-del="${row.id}">Delete</button>
        </div>
      `;
      snapListEl.appendChild(li);
    }
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  /* ——— Tipshop pokes ——— */

  const POKE_STORE_KEY = 'zxwarp-poke-selection';

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

  function titleTokens(norm) {
    return norm.split(' ').filter((t) => t.length > 1);
  }

  function loadPokeSelections() {
    try {
      return JSON.parse(localStorage.getItem(POKE_STORE_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  function savePokeSelections(all) {
    try {
      localStorage.setItem(POKE_STORE_KEY, JSON.stringify(all));
    } catch (err) {
      console.warn('Could not persist poke selections', err);
    }
  }

  function pokeSelectionKey() {
    return gameKey();
  }

  function getEnabledPokes() {
    const all = loadPokeSelections();
    const entry = all[pokeSelectionKey()];
    if (!entry || !pokeMatch || entry.pokeId !== pokeMatch.id) return {};
    return entry.enabled || {};
  }

  function setEnabledPoke(trainerIndex, enabled, userValue) {
    const all = loadPokeSelections();
    const key = pokeSelectionKey();
    const prev = all[key] && all[key].pokeId === pokeMatch?.id ? all[key] : { pokeId: pokeMatch?.id, enabled: {} };
    const enabledMap = { ...(prev.enabled || {}) };
    if (enabled) {
      enabledMap[String(trainerIndex)] =
        userValue != null && Number.isFinite(Number(userValue)) ? Number(userValue) : true;
    } else {
      delete enabledMap[String(trainerIndex)];
    }
    all[key] = { pokeId: pokeMatch?.id, enabled: enabledMap };
    savePokeSelections(all);
  }

  async function ensurePokeCatalog() {
    if (pokeCatalog) return pokeCatalog;
    if (pokeCatalogPromise) return pokeCatalogPromise;
    pokeCatalogPromise = fetch('./games/pokes.json', { cache: 'force-cache' })
      .then((res) => {
        if (!res.ok) throw new Error(`pokes.json ${res.status}`);
        return res.json();
      })
      .then((data) => {
        pokeCatalog = data;
        return data;
      })
      .catch((err) => {
        console.warn(err);
        pokeCatalogPromise = null;
        return null;
      });
    return pokeCatalogPromise;
  }

  function scorePokeGame(game, queryNorm, queryTokens, year, publisherNorm) {
    let score = 0;
    if (game.norm === queryNorm) score += 120;
    else if (game.norm.startsWith(queryNorm) || queryNorm.startsWith(game.norm)) score += 70;
    else if (game.norm.includes(queryNorm) || queryNorm.includes(game.norm)) score += 45;

    const gTokens = titleTokens(game.norm);
    if (queryTokens.length && gTokens.length) {
      let hit = 0;
      for (const t of queryTokens) if (gTokens.includes(t)) hit += 1;
      score += (hit / Math.max(queryTokens.length, gTokens.length)) * 50;
      // Prefer similar token counts (avoid "Manic Miner" matching "Manic Miner Turbo …")
      score -= Math.abs(gTokens.length - queryTokens.length) * 4;
    }

    if (year && game.year && Number(game.year) === Number(year)) score += 18;
    if (publisherNorm && game.publisher && normalizeTitle(game.publisher) === publisherNorm) score += 12;

    // Prefer plain editions over hacks/demos when titles are otherwise close
    if (game.suffix) score -= 8;
    return score;
  }

  function findBestPokeMatch(title, meta = {}) {
    if (!pokeCatalog?.games?.length || !title) return null;
    const queryNorm = normalizeTitle(title);
    if (!queryNorm) return null;
    const queryTokens = titleTokens(queryNorm);
    const publisherNorm = normalizeTitle(meta.publisher || '');
    const year = meta.year || null;

    let best = null;
    let bestScore = 0;
    for (const game of pokeCatalog.games) {
      const score = scorePokeGame(game, queryNorm, queryTokens, year, publisherNorm);
      if (score > bestScore) {
        bestScore = score;
        best = game;
      }
    }

    // Require a reasonable match; exact-ish titles clear easily
    if (!best || bestScore < 55) return null;
    return { game: best, score: bestScore };
  }

  function workerRequest(message, payload = {}, resultMessage, timeoutMs = 3000) {
    const worker = window.__zxwarpWorker;
    if (!worker) return Promise.reject(new Error('Emulator worker not ready'));
    return new Promise((resolve, reject) => {
      const id = `poke-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const timer = setTimeout(() => {
        worker.removeEventListener('message', onMsg);
        reject(new Error(`${message} timed out`));
      }, timeoutMs);
      function onMsg(e) {
        if (!e.data || e.data.message !== resultMessage || e.data.id !== id) return;
        clearTimeout(timer);
        worker.removeEventListener('message', onMsg);
        resolve(e.data);
      }
      worker.addEventListener('message', onMsg);
      worker.postMessage({ message, id, ...payload });
    });
  }

  async function peekMemory(bank, address) {
    const res = await workerRequest('peekMemory', { bank, address }, 'peekMemoryResult');
    return res.value & 255;
  }

  async function pokeMemory(bank, address, value) {
    const res = await workerRequest('pokeMemory', { bank, address, value }, 'pokeMemoryResult');
    return res.previous & 255;
  }

  function trainerValue(trainer, enabledEntry) {
    // enabledEntry may be true or a user-chosen byte for value=256 pokes
    const needsUser = trainer.pokes.some((p) => p.value === 256);
    if (!needsUser) return null;
    if (typeof enabledEntry === 'number' && enabledEntry >= 0 && enabledEntry <= 255) return enabledEntry;
    return 255;
  }

  async function applyTrainer(trainerIndex, { enable, userValue } = { enable: true }) {
    if (!pokeMatch) return;
    const trainer = pokeMatch.trainers[trainerIndex];
    if (!trainer) return;
    const key = String(trainerIndex);

    if (!enable) {
      const undo = pokeUndo[key];
      if (undo) {
        for (const step of undo) {
          await pokeMemory(step.bank, step.address, step.previous);
        }
        delete pokeUndo[key];
      } else {
        for (const p of trainer.pokes) {
          if (p.original) await pokeMemory(p.bank, p.address, p.original & 255);
        }
      }
      return;
    }

    const undo = [];
    for (const p of trainer.pokes) {
      const val = p.value === 256 ? (userValue ?? 255) & 255 : p.value & 255;
      const previous = await pokeMemory(p.bank, p.address, val);
      undo.push({ bank: p.bank, address: p.address, previous });
    }
    pokeUndo[key] = undo;
  }

  async function applyEnabledPokes({ quiet } = {}) {
    if (!pokeMatch) return;
    const enabled = getEnabledPokes();
    const indexes = Object.keys(enabled);
    if (!indexes.length) {
      if (!quiet) toast('No pokes selected');
      return;
    }
    let n = 0;
    for (const idx of indexes) {
      const trainer = pokeMatch.trainers[Number(idx)];
      if (!trainer) continue;
      await applyTrainer(Number(idx), {
        enable: true,
        userValue: trainerValue(trainer, enabled[idx]),
      });
      n += 1;
    }
    if (!quiet) toast(`Applied ${n} poke${n === 1 ? '' : 's'}`);
  }

  function updatePokeToggleLabel() {
    const label = document.querySelector('.poke-toggle-label');
    if (!label) return;
    const expanded = pokePanelEl?.classList.contains('expanded');
    if (!pokeMatch) {
      label.textContent = 'Pokes';
      return;
    }
    const n = pokeMatch.trainers.length;
    if (expanded) {
      label.textContent = 'Pokes';
      return;
    }
    label.textContent = n === 0 ? 'Pokes (none)' : `Pokes (${n})`;
  }

  function setPokeExpanded(open) {
    const body = document.getElementById('poke-body');
    const toggle = document.getElementById('btn-poke-toggle');
    const apply = document.getElementById('btn-poke-apply');
    if (body) body.hidden = !open;
    if (apply) apply.hidden = !open;
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    pokePanelEl?.classList.toggle('expanded', open);
    updatePokeToggleLabel();
  }

  function renderPokePanel() {
    if (!pokePanelEl || !pokeListEl) return;

    if (!state.gameTitle && !state.gameSlug && !state.openUrl) {
      pokePanelEl.hidden = true;
      setPokeExpanded(false);
      return;
    }

    pokePanelEl.hidden = false;

    if (!pokeMatch) {
      pokeListEl.innerHTML = '';
      if (pokeMatchEl) pokeMatchEl.textContent = 'Looking up Tipshop pokes…';
      if (pokeEmptyEl) pokeEmptyEl.hidden = true;
      updatePokeToggleLabel();
      return;
    }

    const enabled = getEnabledPokes();
    if (pokeMatchEl) {
      const meta = [pokeMatch.year, pokeMatch.publisher].filter(Boolean).join(' · ');
      pokeMatchEl.textContent = meta
        ? `Matched: ${pokeMatch.title} (${meta})`
        : `Matched: ${pokeMatch.title}`;
    }
    if (pokeEmptyEl) pokeEmptyEl.hidden = pokeMatch.trainers.length > 0;
    updatePokeToggleLabel();

    pokeListEl.innerHTML = '';
    pokeMatch.trainers.forEach((trainer, index) => {
      const li = document.createElement('li');
      const id = `poke-${index}`;
      const needsUser = trainer.pokes.some((p) => p.value === 256);
      const isOn = enabled[String(index)] != null && enabled[String(index)] !== false;
      const userVal = trainerValue(trainer, enabled[String(index)]);

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = id;
      cb.checked = !!isOn;
      cb.dataset.pokeIndex = String(index);

      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = trainer.name;

      const num = document.createElement('input');
      num.type = 'number';
      num.min = '0';
      num.max = '255';
      num.value = String(userVal ?? 255);
      num.hidden = !needsUser;
      num.dataset.pokeIndex = String(index);
      num.title = 'Value for this poke (0–255)';

      li.appendChild(cb);
      li.appendChild(label);
      li.appendChild(num);
      pokeListEl.appendChild(li);
    });
  }

  async function refreshPokeMatch() {
    await ensurePokeCatalog();
    pokeUndo = {};
    pokeMatch = null;
    setPokeExpanded(false);

    if (!pokeCatalog) {
      if (pokePanelEl) pokePanelEl.hidden = true;
      return;
    }

    const catalogGame = findCatalogGame({ slug: state.gameSlug, path: state.openUrl });
    const title = state.gameTitle || catalogGame?.title;
    const hit = findBestPokeMatch(title, {
      year: catalogGame?.year,
      publisher: catalogGame?.publisher,
    });
    pokeMatch = hit?.game || null;
    renderPokePanel();

    // Re-apply previously selected pokes for this game (best-effort once running)
    const enabled = getEnabledPokes();
    if (pokeMatch && Object.keys(enabled).length) {
      // Delay so tape auto-load can finish putting game code in RAM
      setTimeout(() => {
        applyEnabledPokes({ quiet: true }).catch(() => {});
      }, 2500);
    }
  }

  function bindPokeUi() {
    document.getElementById('btn-poke-apply')?.addEventListener('click', () => {
      applyEnabledPokes().catch((err) => {
        console.error(err);
        toast('Could not apply pokes');
      });
    });

    pokeListEl?.addEventListener('change', async (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      const index = Number(t.dataset.pokeIndex);
      if (!Number.isFinite(index) || !pokeMatch) return;

      try {
        if (t.type === 'checkbox') {
          const row = t.closest('li');
          const num = row?.querySelector('input[type="number"]');
          const needsUser = pokeMatch.trainers[index].pokes.some((p) => p.value === 256);
          const userValue =
            needsUser && num && !num.hidden && Number.isFinite(Number(num.value))
              ? Number(num.value)
              : null;
          setEnabledPoke(index, t.checked, userValue);
          await applyTrainer(index, {
            enable: t.checked,
            userValue,
          });
          toast(t.checked ? `On: ${pokeMatch.trainers[index].name}` : `Off: ${pokeMatch.trainers[index].name}`);
        } else if (t.type === 'number') {
          const row = t.closest('li');
          const cb = row?.querySelector('input[type="checkbox"]');
          const userValue = Number(t.value);
          if (cb?.checked && Number.isFinite(userValue)) {
            setEnabledPoke(index, true, userValue);
            await applyTrainer(index, { enable: true, userValue });
            toast(`Updated: ${pokeMatch.trainers[index].name}`);
          }
        }
      } catch (err) {
        console.error(err);
        toast('Poke failed — is the game loaded?');
      }
    });
  }

  function bindUi() {
    document.getElementById('crt')?.addEventListener('click', () => {
      togglePanels();
    });

    document.getElementById('btn-open')?.addEventListener('click', () => emu?.openFileDialog());
    document.getElementById('btn-save')?.addEventListener('click', () => downloadZ80Snapshot());
    document.getElementById('btn-pause')?.addEventListener('click', () => setPaused(!paused));
    document.getElementById('btn-restart')?.addEventListener('click', () => restart());
    document.getElementById('btn-reset')?.addEventListener('click', () => powerReset());
    document.getElementById('btn-snap-create')?.addEventListener('click', () => createSnapshot());
    document.getElementById('btn-memmap-popout')?.addEventListener('click', () => openMemMapWindow());
    document.getElementById('btn-poke-toggle')?.addEventListener('click', () => {
      const open = document.getElementById('btn-poke-toggle')?.getAttribute('aria-expanded') !== 'true';
      setPokeExpanded(open);
    });
    document.getElementById('btn-gamepad-toggle')?.addEventListener('click', () => {
      const panel = document.getElementById('gamepad-panel');
      const body = document.getElementById('gamepad-body');
      const toggle = document.getElementById('btn-gamepad-toggle');
      const open = toggle?.getAttribute('aria-expanded') !== 'true';
      if (body) body.hidden = !open;
      if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      panel?.classList.toggle('expanded', open);
    });
    document.getElementById('btn-shortcuts-toggle')?.addEventListener('click', () => {
      const panel = document.getElementById('shortcuts-panel');
      const body = document.getElementById('shortcuts-body');
      const toggle = document.getElementById('btn-shortcuts-toggle');
      const open = toggle?.getAttribute('aria-expanded') !== 'true';
      if (body) body.hidden = !open;
      if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      panel?.classList.toggle('expanded', open);
    });
    document.getElementById('btn-snap-toggle')?.addEventListener('click', () => {
      const panel = document.getElementById('snap-panel');
      const body = document.getElementById('snap-body');
      const toggle = document.getElementById('btn-snap-toggle');
      const open = toggle?.getAttribute('aria-expanded') !== 'true';
      if (body) body.hidden = !open;
      if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      panel?.classList.toggle('expanded', open);
    });
    document.getElementById('btn-memmap-toggle')?.addEventListener('click', () => {
      const panel = document.getElementById('memmap-panel');
      const body = document.getElementById('memmap-body');
      const toggle = document.getElementById('btn-memmap-toggle');
      const open = toggle?.getAttribute('aria-expanded') !== 'true';
      if (body) body.hidden = !open;
      if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      panel?.classList.toggle('expanded', open);
      if (open) startMemMap();
      else stopMemMap();
    });
    bindPokeUi();

    document.getElementById('btn-autoload')?.addEventListener('click', () => {
      state.autoLoad = !state.autoLoad;
      applyTapeOptions();
      syncChrome();
      history.replaceState(null, '', `#${buildShareHash()}`);
      if (state.openUrl) {
        restart({ quiet: true });
        toast(state.autoLoad ? 'Auto-load on — reloading' : 'Auto-load off — reloading');
      } else {
        toast(
          state.autoLoad
            ? 'Auto-load on — tapes will LOAD "" themselves'
            : 'Auto-load off — type LOAD "" yourself'
        );
      }
    });

    document.getElementById('btn-instant')?.addEventListener('click', () => {
      state.tapeTraps = !state.tapeTraps;
      applyTapeOptions();
      syncChrome();
      history.replaceState(null, '', `#${buildShareHash()}`);
      if (state.openUrl) {
        restart({ quiet: true });
        toast(state.tapeTraps ? 'Instant tape load on — reloading' : 'Instant tape load off — reloading');
      } else {
        toast(
          state.tapeTraps
            ? 'Instant tape loading on — ROM load traps enabled'
            : 'Instant tape loading off — real-time tape playback'
        );
      }
    });

    document.getElementById('btn-share')?.addEventListener('click', () => {
      const panel = document.getElementById('panel-share');
      if (!panel) return;
      panel.hidden = !panel.hidden;
      if (!panel.hidden) syncShare();
    });

    document.getElementById('btn-copy-share')?.addEventListener('click', async () => {
      const url = syncShare();
      try {
        await navigator.clipboard.writeText(url);
        toast('Link copied');
      } catch {
        shareInput?.select();
        toast('Copy from the field');
      }
    });

    machineSelect?.addEventListener('change', () => setMachine(machineSelect.value));

    snapListEl?.addEventListener('click', async (e) => {
      const loadId = e.target.closest('[data-load]')?.getAttribute('data-load');
      const delId = e.target.closest('[data-del]')?.getAttribute('data-del');
      if (delId) {
        await deleteSnapshotRecord(delId);
        toast('Snapshot deleted');
        await renderSnapshots();
        return;
      }
      if (loadId) {
        const rows = await listSnapshots(gameKey());
        const row = rows.find((r) => r.id === loadId);
        if (row) await loadSnapshotRecord(row);
      }
    });

    window.addEventListener('keydown', (e) => {
      if (isTypingTarget(e.target)) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        togglePanels();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Del') {
        e.preventDefault();
        restart();
        return;
      }
      if (e.key === 'F1') {
        e.preventDefault();
        location.href = './about.html';
        return;
      }
      if (e.key === 'F2') {
        e.preventDefault();
        createSnapshot();
        return;
      }
      if (e.key === 'F3') {
        e.preventDefault();
        recallLatestSnapshot();
        return;
      }
      if (e.key === 'Pause' || e.code === 'Pause') {
        e.preventDefault();
        setPaused(!paused);
        return;
      }
      if (e.key === 'Insert') {
        e.preventDefault();
        location.href = './games.html';
        return;
      }
      // Qaop-style: Ctrl+O / Ctrl+S only while paused
      if (paused && (e.ctrlKey || e.metaKey) && (e.key === 'o' || e.key === 'O')) {
        if (state.sandbox) return;
        e.preventDefault();
        emu?.openFileDialog();
        return;
      }
      if (paused && (e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        createSnapshot();
      }
    });

    window.addEventListener('hashchange', async () => {
      state.gameTitle = null;
      parseHash(location.hash);
      restoreMachinePreference();
      rememberMachine();
      resolveGameFromHashAndCatalog();
      syncChrome();
      if (emu) {
        emu.setMachine(state.machine);
        applyTapeOptions();
        if (state.openUrl) emu.openUrl(state.openUrl);
      }
      await renderSnapshots();
      await refreshPokeMatch();
    });
  }

  async function loadCatalog() {
    try {
      const res = await fetch('./games.json', { cache: 'no-cache' });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  async function start() {
    catalog = await loadCatalog();
    parseHash(location.hash);
    restoreMachinePreference();
    rememberMachine();

    // Bare root (no hash / query): show control panels. Game links stay fullscreen
    // unless #panels is present.
    const bareLaunch =
      !location.search && !(location.hash || '').replace(/^#/, '').trim();
    if (bareLaunch) {
      document.body.classList.add('panels-open');
    } else if (!/(?:^|[&#;])panels(?:[&#;]|$)/i.test(location.hash || '')) {
      document.body.classList.remove('panels-open');
    }

    resolveGameFromHashAndCatalog();
    history.replaceState(null, '', `#${buildShareHash()}`);
    syncChrome();
    bindUi();
    bindSpectrumKeys();
    bindGamepad();
    await renderSnapshots();
    refreshPokeMatch();

    const container = document.getElementById('jsspeccy');
    if (!container || typeof JSSpeccy !== 'function') {
      setStatus('JSSpeccy failed to load');
      return;
    }

    const opts = {
      zoom: 2,
      machine: state.machine,
      autoStart: true,
      autoLoadTapes: state.autoLoad,
      tapeAutoLoadMode: state.tapeAutoLoadMode,
      sandbox: state.sandbox,
      uiEnabled: false,
      keyboardEnabled: true,
      tapeTrapsEnabled: state.tapeTraps,
    };
    if (state.openUrl) opts.openUrl = state.openUrl;

    emu = JSSpeccy(container, opts);
    if (typeof emu.getWorker === 'function') {
      window.__zxwarpWorker = emu.getWorker();
    }
    watchCanvasSize();

    const ready = () => {
      fitCanvas();
      setStatus('');
      syncChrome();
      if (document.body.classList.contains('panels-open')) startMemMap();
    };
    if (typeof emu.onReady === 'function') emu.onReady(ready);
    else ready();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      start();
    });
  } else {
    start();
  }
})();
