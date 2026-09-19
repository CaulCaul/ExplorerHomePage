/* Explorer Home Page — 搜索栏：引擎切换 / 在线联想 / 本地历史候选 / 键盘导航
 * 联想降级链：选中引擎 → 备用引擎 → 仅本地历史（离线时依然可用）。
 */
(function () {
  'use strict';

  const EHP = window.EHP;

  const ENGINE_URL = {
    bing: 'https://www.bing.com/search?q=',
    google: 'https://www.google.com/search?q='
  };

  const SVG_SEARCH = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/></svg>';
  const SVG_CLOCK = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7z"/></svg>';

  const input = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  const listEl = document.getElementById('suggestions');
  const switchEl = document.getElementById('engine-switch');

  let engine = 'bing';
  let items = [];        // [{ text, source: 'history' | 'online' }]
  let activeIndex = -1;
  let gen = 0;           // 代际号：输入变化后丢弃过期的异步结果

  async function init() {
    engine = await EHP.storage.get(EHP.storage.KEY.engine, 'bing');
    renderSwitch();

    switchEl.addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-engine]');
      if (!btn) return;
      engine = btn.dataset.engine;
      EHP.storage.set(EHP.storage.KEY.engine, engine);
      renderSwitch();
      input.focus();
      onInput();
    });

    input.addEventListener('input', onInput);

    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (listEl.hidden || !items.length) return;
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        activeIndex = (activeIndex + dir + items.length) % items.length;
        updateActive();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex >= 0 && items[activeIndex]) input.value = items[activeIndex].text;
        doSearch();
      } else if (e.key === 'Escape') {
        hide();
      }
    });

    /* mousedown + preventDefault：先于 blur 触发，避免点击候选时下拉先消失 */
    input.addEventListener('blur', function () {
      setTimeout(hide, 120);
    });

    searchBtn.addEventListener('click', doSearch);
  }

  function renderSwitch() {
    Array.prototype.forEach.call(switchEl.querySelectorAll('button'), function (b) {
      b.classList.toggle('active', b.dataset.engine === engine);
    });
  }

  async function onInput() {
    const q = input.value.trim();
    const my = ++gen;
    if (!q) { hide(); return; }
    activeIndex = -1;

    /* 1) 本地历史候选（离线也可用） */
    const history = await EHP.storage.get(EHP.storage.KEY.history, []);
    if (my !== gen) return;
    const lower = q.toLowerCase();
    const local = history
      .filter(function (h) { return h.q.toLowerCase().indexOf(lower) !== -1; })
      .slice(0, 4)
      .map(function (h) { return { text: h.q, source: 'history' }; });
    items = local;
    render();

    /* 2) 在线联想（选中引擎优先，失败自动换备用引擎） */
    const online = await fetchSuggestions(q);
    if (my !== gen) return;
    const seen = local.map(function (i) { return i.text.toLowerCase(); });
    const extra = online
      .filter(function (t) { return seen.indexOf(t.toLowerCase()) === -1; })
      .map(function (t) { return { text: t, source: 'online' }; });
    items = local.concat(extra).slice(0, 10);
    render();
  }

  async function fetchSuggestions(q) {
    const order = [engine, engine === 'bing' ? 'google' : 'bing'];
    for (let i = 0; i < order.length; i++) {
      try { return await suggestFrom(order[i], q); } catch (e) { /* 试下一个 */ }
    }
    return [];
  }

  async function suggestFrom(eng, q) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, 2000);
    try {
      const url = eng === 'google'
        ? 'https://suggestqueries.google.com/complete/search?client=chrome&q=' + encodeURIComponent(q)
        : 'https://api.bing.com/osjson.aspx?query=' + encodeURIComponent(q);
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      /* 手动按 UTF-8 解码，避免响应头 charset 声明错误导致中文乱码 */
      const buf = await res.arrayBuffer();
      const data = JSON.parse(new TextDecoder('utf-8').decode(buf));
      const list = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
      return list
        .filter(function (s) { return typeof s === 'string' && s && s.length <= 100; })
        .slice(0, 8);
    } finally {
      clearTimeout(timer);
    }
  }

  function render() {
    listEl.textContent = '';
    if (!items.length) { listEl.hidden = true; return; }
    items.forEach(function (it, i) {
      const li = document.createElement('li');
      li.className = 'sug' + (i === activeIndex ? ' active' : '');
      const icon = document.createElement('span');
      icon.className = 'sug-icon';
      icon.innerHTML = it.source === 'history' ? SVG_CLOCK : SVG_SEARCH;
      const text = document.createElement('span');
      text.className = 'sug-text';
      text.textContent = it.text; /* 接口数据不可信，一律 textContent */
      li.appendChild(icon);
      li.appendChild(text);
      if (it.source === 'history') {
        const tag = document.createElement('span');
        tag.className = 'sug-tag';
        tag.textContent = '历史';
        li.appendChild(tag);
      }
      li.addEventListener('mousedown', function (e) {
        e.preventDefault();
        chooseIndex(i);
      });
      listEl.appendChild(li);
    });
    listEl.hidden = false;
  }

  function updateActive() {
    Array.prototype.forEach.call(listEl.children, function (li, i) {
      li.classList.toggle('active', i === activeIndex);
      if (i === activeIndex) li.scrollIntoView({ block: 'nearest' });
    });
  }

  function chooseIndex(i) {
    if (!items[i]) return;
    input.value = items[i].text;
    doSearch();
  }

  async function doSearch() {
    const q = input.value.trim();
    if (!q) return;
    /* 先 await 写入历史，再跳转（跳转后页面可能被销毁） */
    await EHP.storage.recordSearch(q, engine);
    window.location.href = ENGINE_URL[engine] + encodeURIComponent(q);
  }

  function hide() {
    listEl.hidden = true;
    listEl.textContent = '';
    items = [];
    activeIndex = -1;
  }

  EHP.search = { init: init };
})();
