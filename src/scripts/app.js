(() => {
  const MACHINE = { '48': 48, '128': 128, pentagon: 5, '5': 5 };
  const MACHINE_LABEL = { 48: 'Spectrum 48K', 128: 'Spectrum 128K', 5: 'Pentagon 128' };
  const DB_NAME = 'zxwrap';
  const DB_STORE = 'snapshots';
  const DB_VERSION = 1;

  const statusEl = document.getElementById('status');
  const nowPlayingEl = document.getElementById('now-playing');
  const toastEl = document.getElementById('toast');
  const shareInput = document.getElementById('share-input');
  const shareNote = document.getElementById('share-note');
  const machineSelect = document.getElementById('machine-select');
  const snapListEl = document.getElementById('snap-list');
  const snapEmptyEl = document.getElementById('snap-empty');
  const pauseBtn = document.getElementById('btn-pause');

  let emu = null;
  let toastTimer = null;
  let catalog = null;
  let paused = false;

  const state = {
    machine: 48,
    zoom: 2,
    autoLoad: true,
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
      } else if (flag === 'zoom') {
        const z = Number(value);
        if (z === 1 || z === 2 || z === 3) state.zoom = z;
      } else if (flag === 'autoload') state.autoLoad = !negated;
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
        applyCatalogGame(game, { applyMachine: !hashHasMachine(location.hash) });
        return game;
      }
    }
    const game = findCatalogGame({ path: state.openUrl });
    if (game) {
      applyCatalogGame(game, { applyMachine: !hashHasMachine(location.hash) });
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
    }
    if (nowPlayingEl) {
      nowPlayingEl.textContent = state.gameTitle || '';
    }
    syncShare();
  }

  function setPanelsOpen(open) {
    document.body.classList.toggle('panels-open', open);
    history.replaceState(null, '', `#${buildShareHash()}`);
    // Recalc after the CSS transition starts so the canvas tracks CRT size.
    requestAnimationFrame(() => {
      fitCanvas();
      setTimeout(fitCanvas, 240);
    });
  }

  function togglePanels() {
    setPanelsOpen(!document.body.classList.contains('panels-open'));
  }

  function setMachine(machine) {
    state.machine = Number(machine);
    if (emu) emu.setMachine(state.machine);
    setStatus(MACHINE_LABEL[state.machine] || String(state.machine));
    syncChrome();
    history.replaceState(null, '', `#${buildShareHash()}`);
  }

  function fitCanvas() {
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
      setStatus(state.gameTitle || 'Running');
    }
  }

  function restart() {
    if (!emu) return;
    setPaused(false);
    if (state.openUrl) {
      emu.openUrl(state.openUrl);
      toast('Restarting…');
    } else if (typeof emu.reset === 'function') {
      emu.reset();
      toast('Reset');
    }
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
    const worker = window.__zxwrapWorker;
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
    return String(name || 'zxwrap')
      .replace(/[^\w\-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'zxwrap';
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
    CAPS: { row: 0, mask: 0x01 },
    SYM: { row: 7, mask: 0x02 },
    ONE: { row: 3, mask: 0x01 },
  };

  const heldExtra = { alt: false, tab: false, home: false, shift: false };

  function emuKey(spec, down) {
    const worker = window.__zxwrapWorker;
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
    if (snapEmptyEl) snapEmptyEl.hidden = rows.length > 0;

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

  function bindUi() {
    document.getElementById('btn-open')?.addEventListener('click', () => emu?.openFileDialog());
    document.getElementById('btn-games')?.addEventListener('click', () => {
      location.href = './games.html';
    });
    document.getElementById('btn-save')?.addEventListener('click', () => downloadZ80Snapshot());
    document.getElementById('btn-pause')?.addEventListener('click', () => setPaused(!paused));
    document.getElementById('btn-restart')?.addEventListener('click', () => restart());
    document.getElementById('btn-snap-create')?.addEventListener('click', () => createSnapshot());

    document.getElementById('btn-autoload')?.addEventListener('click', () => {
      state.autoLoad = !state.autoLoad;
      toast(
        state.autoLoad
          ? 'Auto-load on — tapes will LOAD "" themselves (reload to apply)'
          : 'Auto-load off — type LOAD "" yourself (reload to apply)'
      );
      syncChrome();
      history.replaceState(null, '', `#${buildShareHash()}`);
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
      resolveGameFromHashAndCatalog();
      syncChrome();
      if (emu) {
        emu.setMachine(state.machine);
        if (state.openUrl) emu.openUrl(state.openUrl);
      }
      await renderSnapshots();
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

    // Games launch fullscreen (panels closed) unless #panels is present.
    if (!/(?:^|[&#;])panels(?:[&#;]|$)/i.test(location.hash || '')) {
      document.body.classList.remove('panels-open');
    }

    resolveGameFromHashAndCatalog();
    syncChrome();
    bindUi();
    bindSpectrumKeys();
    await renderSnapshots();

    const container = document.getElementById('jsspeccy');
    if (!container || typeof JSSpeccy !== 'function') {
      setStatus('JSSpeccy failed to load');
      return;
    }

    const opts = {
      zoom: state.zoom,
      machine: state.machine,
      autoStart: true,
      autoLoadTapes: state.autoLoad,
      tapeAutoLoadMode: state.tapeAutoLoadMode,
      sandbox: state.sandbox,
      uiEnabled: false,
      keyboardEnabled: true,
      tapeTrapsEnabled: true,
    };
    if (state.openUrl) opts.openUrl = state.openUrl;

    emu = JSSpeccy(container, opts);
    watchCanvasSize();

    const ready = () => {
      fitCanvas();
      setStatus(state.gameTitle || MACHINE_LABEL[state.machine] || 'Ready');
      syncChrome();
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
