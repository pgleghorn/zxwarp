(() => {
  const listEl = document.getElementById('pad-list');
  const metaEl = document.getElementById('pad-meta');
  const logEl = document.getElementById('pad-log');
  const MAX_LOG = 40;

  function log(message) {
    if (!logEl) return;
    const li = document.createElement('li');
    const t = new Date();
    const stamp = [t.getHours(), t.getMinutes(), t.getSeconds()]
      .map((n) => String(n).padStart(2, '0'))
      .join(':');
    li.textContent = `${stamp}  ${message}`;
    logEl.insertBefore(li, logEl.firstChild);
    while (logEl.children.length > MAX_LOG) logEl.removeChild(logEl.lastChild);
  }

  function buttonValue(b) {
    if (b == null) return 0;
    if (typeof b === 'number') return b;
    if (typeof b.value === 'number') return b.value;
    return b.pressed ? 1 : 0;
  }

  function buttonPressed(b) {
    if (b == null) return false;
    if (typeof b === 'number') return b > 0.5;
    return !!(b.pressed || (typeof b.value === 'number' && b.value > 0.5));
  }

  function ensureCard(pad) {
    let card = listEl.querySelector(`[data-index="${pad.index}"]`);
    if (card) return card;

    card = document.createElement('section');
    card.className = 'pad-card';
    card.dataset.index = String(pad.index);
    card.innerHTML = `
      <header class="pad-card-head">
        <h2></h2>
        <p class="pad-card-vendor"></p>
        <p class="pad-card-product"></p>
        <p class="pad-card-id"></p>
        <p class="pad-card-meta"></p>
      </header>
      <div class="pad-axes"></div>
      <div class="pad-buttons"></div>
    `;
    listEl.appendChild(card);
    return card;
  }

  const STALE_MS = 320;
  /** @type {Map<number, number>} */
  const lastTs = new Map();

  function renderPad(pad) {
    const card = ensureCard(pad);
    const title = card.querySelector('h2');
    const vendorEl = card.querySelector('.pad-card-vendor');
    const productEl = card.querySelector('.pad-card-product');
    const idEl = card.querySelector('.pad-card-id');
    const meta = card.querySelector('.pad-card-meta');
    const axesEl = card.querySelector('.pad-axes');
    const buttonsEl = card.querySelector('.pad-buttons');

    const now = performance.now();
    const ts = typeof pad.timestamp === 'number' ? pad.timestamp : null;
    const age = ts == null ? null : Math.max(0, now - ts);
    const prev = lastTs.get(pad.index);
    const tsChanged = prev == null || prev !== ts;
    if (ts != null) lastTs.set(pad.index, ts);
    const stale = age != null && age > STALE_MS && age < 60000;

    const desc = window.ZxUsbIds?.describe?.(pad) || { vendor: '', product: '' };
    title.textContent = `#${pad.index} · ${pad.mapping || 'no mapping'}${stale ? ' · STALE' : ''}`;
    if (vendorEl) {
      vendorEl.textContent = desc.vendor || '';
      vendorEl.hidden = !desc.vendor;
    }
    if (productEl) {
      productEl.textContent = desc.product || '';
      productEl.hidden = !desc.product;
    }
    idEl.textContent = pad.id || '(no id)';
    meta.textContent = [
      `${pad.buttons?.length || 0} buttons`,
      `${pad.axes?.length || 0} axes`,
      pad.connected === false ? 'disconnected' : 'connected',
      ts == null ? 'ts:—' : `ts age ${Math.round(age)}ms`,
      tsChanged ? 'tick' : 'frozen',
    ].join(' · ');
    card.classList.toggle('stale', stale);

    const axes = pad.axes || [];
    while (axesEl.children.length < axes.length) {
      const row = document.createElement('div');
      row.className = 'pad-axis';
      row.innerHTML = `<span class="pad-axis-i"></span><div class="pad-axis-track"><div class="pad-axis-fill"></div></div><span class="pad-axis-v"></span>`;
      axesEl.appendChild(row);
    }
    while (axesEl.children.length > axes.length) axesEl.removeChild(axesEl.lastChild);

    for (let i = 0; i < axes.length; i++) {
      const row = axesEl.children[i];
      const v = Number(axes[i]) || 0;
      const pct = ((v + 1) / 2) * 100;
      row.querySelector('.pad-axis-i').textContent = `a${i}`;
      row.querySelector('.pad-axis-v').textContent = v.toFixed(3);
      const fill = row.querySelector('.pad-axis-fill');
      fill.style.left = '50%';
      fill.style.width = `${Math.abs(v) * 50}%`;
      fill.style.transform = v < 0 ? 'translateX(-100%)' : 'none';
      fill.style.backgroundPosition = `${pct}% 0`;
      row.classList.toggle('active', Math.abs(v) >= 0.12);
    }

    const buttons = pad.buttons || [];
    while (buttonsEl.children.length < buttons.length) {
      const cell = document.createElement('div');
      cell.className = 'pad-btn';
      cell.innerHTML = `<span class="pad-btn-i"></span><span class="pad-btn-v"></span>`;
      buttonsEl.appendChild(cell);
    }
    while (buttonsEl.children.length > buttons.length) buttonsEl.removeChild(buttonsEl.lastChild);

    for (let i = 0; i < buttons.length; i++) {
      const cell = buttonsEl.children[i];
      const b = buttons[i];
      const v = buttonValue(b);
      const on = buttonPressed(b);
      cell.querySelector('.pad-btn-i').textContent = String(i);
      cell.querySelector('.pad-btn-v').textContent = v.toFixed(2);
      cell.classList.toggle('on', on);
      cell.style.setProperty('--press', String(Math.min(1, Math.max(0, v))));
    }
  }

  function pruneMissing(liveIndexes) {
    for (const card of [...listEl.querySelectorAll('.pad-card')]) {
      if (!liveIndexes.has(Number(card.dataset.index))) card.remove();
    }
  }

  function tick() {
    requestAnimationFrame(tick);
    if (!navigator.getGamepads) {
      metaEl.textContent = 'Gamepad API not available in this browser.';
      return;
    }

    const pads = navigator.getGamepads();
    const live = [];
    const indexes = new Set();
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p) continue;
      if (p.connected === false) continue;
      live.push(p);
      indexes.add(p.index);
      renderPad(p);
    }
    pruneMissing(indexes);

    if (!live.length) {
      metaEl.textContent =
        'No gamepad yet — click this page, then press any button on the controller.';
      return;
    }

    metaEl.textContent = `${live.length} gamepad${live.length === 1 ? '' : 's'} connected · tab focused: ${
      document.hasFocus() ? 'yes' : 'no'
    }`;
  }

  if (!navigator.getGamepads) {
    metaEl.textContent = 'Gamepad API not available in this browser.';
    return;
  }

  window.addEventListener('gamepadconnected', (e) => {
    const p = e.gamepad;
    log(`connected #${p.index} ${p.id || ''} (${p.mapping || 'no mapping'})`);
  });
  window.addEventListener('gamepaddisconnected', (e) => {
    const p = e.gamepad;
    log(`disconnected #${p.index} ${p.id || ''}`);
  });
  window.addEventListener('focus', () => log('window focus'));
  window.addEventListener('blur', () => log('window blur'));

  log('listening — press a controller button');
  window.ZxUsbIds?.load?.().catch(() => {});
  requestAnimationFrame(tick);
})();
