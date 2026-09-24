/* Explorer Home Page — 快捷方式区：渲染 / 增删改弹窗 / favicon 抓取与缓存
 * 图标降级链：本地缓存 → DDG 图标服务 → Google s2 → 首字母色块。
 */
(function () {
  'use strict';

  const EHP = window.EHP;
  const KEY = EHP.storage.KEY;

  const SVG_PENCIL = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';

  const grid = document.getElementById('shortcuts');
  const overlay = document.getElementById('overlay');
  const titleEl = document.getElementById('modal-title');
  const nameEl = document.getElementById('sc-name');
  const urlEl = document.getElementById('sc-url');
  const errorEl = document.getElementById('sc-error');
  const saveBtn = document.getElementById('sc-save');
  const cancelBtn = document.getElementById('sc-cancel');
  const deleteBtn = document.getElementById('sc-delete');

  let shortcuts = [];
  let editingId = null;   // null = 添加模式
  let dragEl = null;      // 拖拽排序中的磁贴
  const inFlight = {};    // 域名级并发去重

  /* ---------- 网址协议归一化 ---------- */

  function normalizeHost(host) {
    return (host || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  }

  /* 回环地址：localhost / *.localhost / 127.0.0.0-8 / [::1]——本地服务几乎都是 http */
  function isLoopback(host) {
    host = normalizeHost(host);
    return host === 'localhost' || host === '::1' ||
      /\.localhost$/.test(host) || /^127\./.test(host);
  }

  /* 内网私网段：10/8、172.16-31、192.168/16 */
  function isPrivate(host) {
    host = normalizeHost(host);
    if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
    const m = host.match(/^172\.(\d+)\./);
    return !!m && Number(m[1]) >= 16 && Number(m[1]) <= 31;
  }

  async function init() {
    shortcuts = await EHP.storage.get(KEY.shortcuts, []);
    /* 迁移：回环地址的 https 链接多为旧版「无协议一律补 https」所致，
       自动改写为 http；私网段不动，避免影响真实使用 https 的内网服务 */
    let migrated = false;
    shortcuts.forEach(function (sc) {
      let u;
      try { u = new URL(sc.url); } catch (e) { return; }
      if (u.protocol === 'https:' && isLoopback(u.hostname)) {
        u.protocol = 'http:';
        sc.url = u.href;
        migrated = true;
      }
    });
    if (migrated) await EHP.storage.set(KEY.shortcuts, shortcuts);
    render();
    bindModal();
    bindDrag();
  }

  /* ---------- 渲染 ---------- */

  function render() {
    grid.textContent = '';
    shortcuts.forEach(function (sc) { grid.appendChild(tile(sc)); });
    grid.appendChild(addTile());
  }

  function tile(sc) {
    const el = document.createElement('div');
    el.className = 'tile';
    el.dataset.id = sc.id;
    el.draggable = true;

    const a = document.createElement('a');
    a.href = sc.url;
    a.className = 'tile-link';
    a.title = sc.url;

    const icon = document.createElement('span');
    icon.className = 'tile-icon';
    icon.textContent = (sc.title || sc.url).trim().charAt(0).toUpperCase() || '?';
    icon.style.background = letterColor(sc.url);

    const title = document.createElement('span');
    title.className = 'tile-title';
    title.textContent = sc.title;

    a.appendChild(icon);
    a.appendChild(title);
    el.appendChild(a);

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'tile-edit';
    edit.title = '编辑';
    edit.innerHTML = SVG_PENCIL;
    edit.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openModal(sc);
    });
    el.appendChild(edit);

    /* 异步补图标：缓存命中或联网抓取成功后替换字母色块 */
    fillIcon(sc.url).then(function (dataUrl) {
      if (!dataUrl) return;
      icon.textContent = '';
      icon.style.background = '';
      icon.classList.add('has-img');
      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = '';
      icon.appendChild(img);
    });

    return el;
  }

  function addTile() {
    const el = document.createElement('div');
    el.className = 'tile';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tile-link';
    btn.title = '添加快捷方式';
    const plus = document.createElement('span');
    plus.className = 'tile-plus';
    plus.textContent = '+';
    const title = document.createElement('span');
    title.className = 'tile-title';
    title.textContent = '添加';
    btn.appendChild(plus);
    btn.appendChild(title);
    btn.addEventListener('click', function () { openModal(null); });
    el.appendChild(btn);
    return el;
  }

  /* ---------- favicon 抓取与缓存 ---------- */

  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  async function saveIcon(domain, dataUrl) {
    const cache = await EHP.storage.get(KEY.iconCache, {});
    cache[domain] = dataUrl;
    const keys = Object.keys(cache);
    if (keys.length > EHP.storage.ICON_CACHE_CAP) delete cache[keys[0]]; /* FIFO 淘汰 */
    await EHP.storage.set(KEY.iconCache, cache);
  }

  async function fillIcon(url) {
    let domain;
    try { domain = new URL(url).hostname; } catch (e) { return null; }
    const cache = await EHP.storage.get(KEY.iconCache, {});
    if (cache[domain]) return cache[domain];
    if (inFlight[domain]) return inFlight[domain];
    inFlight[domain] = (async function () {
      const sources = [
        'https://icons.duckduckgo.com/ip3/' + domain + '.ico',
        'https://www.google.com/s2/favicons?domain=' + domain + '&sz=64'
      ];
      for (let i = 0; i < sources.length; i++) {
        try {
          const res = await fetch(sources[i]);
          if (!res.ok) continue;
          const blob = await res.blob();
          if (blob.size < 64) continue; /* 过小视为占位图 */
          const dataUrl = await blobToDataURL(blob);
          await saveIcon(domain, dataUrl);
          return dataUrl;
        } catch (e) { /* 试下一个来源 */ }
      }
      return null;
    })();
    try {
      return await inFlight[domain];
    } finally {
      delete inFlight[domain];
    }
  }

  /* ---------- 拖拽排序（HTML5 DnD，桌面端） ---------- */

  function bindDrag() {
    grid.addEventListener('dragstart', function (e) {
      const t = e.target.closest('.tile[data-id]');
      if (!t) return;
      dragEl = t;
      t.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', t.dataset.id); } catch (err) { /* IE 兼容，可忽略 */ }
    });

    grid.addEventListener('dragover', function (e) {
      if (!dragEl) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const target = e.target.closest('.tile[data-id]');
      if (!target || target === dragEl) return;
      const rect = target.getBoundingClientRect();
      const after = (e.clientX - rect.left) > rect.width / 2;
      grid.insertBefore(dragEl, after ? target.nextSibling : target);
    });

    grid.addEventListener('dragend', function () {
      if (!dragEl) return;
      dragEl.classList.remove('dragging');
      dragEl = null;
      persistOrder();
    });
  }

  /* 按当前 DOM 顺序回写快捷方式数组 */
  async function persistOrder() {
    const order = Array.prototype.map.call(
      grid.querySelectorAll('.tile[data-id]'),
      function (el) { return el.dataset.id; }
    );
    const map = {};
    shortcuts.forEach(function (s) { map[s.id] = s; });
    shortcuts = order
      .map(function (id) { return map[id]; })
      .filter(Boolean);
    await EHP.storage.set(KEY.shortcuts, shortcuts);
  }

  /* ---------- 增删改弹窗 ---------- */

  function bindModal() {
    saveBtn.addEventListener('click', save);
    cancelBtn.addEventListener('click', closeModal);
    deleteBtn.addEventListener('click', remove);
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) closeModal();
    });
    [nameEl, urlEl].forEach(function (el) {
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') save();
      });
    });
  }

  function openModal(sc) {
    editingId = sc ? sc.id : null;
    titleEl.textContent = sc ? '编辑快捷方式' : '添加快捷方式';
    nameEl.value = sc ? sc.title : '';
    urlEl.value = sc ? sc.url : '';
    errorEl.hidden = true;
    deleteBtn.hidden = !sc;
    overlay.hidden = false;
    (editingId ? nameEl : urlEl).focus();
  }

  function closeModal() {
    overlay.hidden = true;
    editingId = null;
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  async function save() {
    const rawName = nameEl.value.trim();
    let url = urlEl.value.trim();
    if (!url) { showError('请填写网址'); return; }
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
      /* 无协议时按目标选默认协议：本地/内网地址用 http，其余用 https
         （如 127.0.0.1:3080 → http://127.0.0.1:3080，本地服务通常无 TLS） */
      let host = '';
      try { host = new URL('http://' + url).hostname; } catch (e) { /* 交给下方统一校验 */ }
      url = ((isLoopback(host) || isPrivate(host)) ? 'http://' : 'https://') + url;
    }

    let u;
    try { u = new URL(url); } catch (e) { showError('网址格式不正确，请检查'); return; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') { showError('仅支持 http/https 网址'); return; }

    const title = rawName || u.hostname.replace(/^www\./, '');
    if (editingId) {
      const idx = shortcuts.findIndex(function (s) { return s.id === editingId; });
      if (idx >= 0) shortcuts[idx] = { id: editingId, title: title, url: u.href };
    } else {
      shortcuts.push({ id: newId(), title: title, url: u.href });
    }
    await EHP.storage.set(KEY.shortcuts, shortcuts);
    render();
    closeModal();
  }

  async function remove() {
    if (!editingId) return;
    shortcuts = shortcuts.filter(function (s) { return s.id !== editingId; });
    await EHP.storage.set(KEY.shortcuts, shortcuts);
    render();
    closeModal();
  }

  function newId() {
    return 'sc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function letterColor(url) {
    let h = 0;
    const s = url || '';
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return 'hsl(' + (Math.abs(h) % 360) + ' 45% 38%)';
  }

  EHP.shortcuts = { init: init, closeModal: closeModal };
})();
