/* Explorer Home Page — 搜索栏：引擎切换 / 在线联想 / 本地历史候选 / 键盘导航
 * 联想降级链：选中引擎 → 备用引擎 → 仅本地历史（离线时依然可用）。
 * 候选列表有两种来源：
 *   · 输入了内容 → 本地历史（包含匹配）+ 在线联想；
 *   · 输入框为空（刚聚焦、刚被清空）→ 直接列出最近的历史记录，不必先敲一个字符。
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

  /* 空输入时最多列出几条历史 */
  const EMPTY_LIMIT = 8;

  const input = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  const listEl = document.getElementById('suggestions');
  const switchEl = document.getElementById('engine-switch');

  let engine = 'bing';
  let items = [];        // [{ text, source: 'history' | 'online' }]
  let activeIndex = -1;
  let gen = 0;           // 代际号：输入变化后丢弃过期的异步结果
  /* 一次性开关：程序化"安静聚焦"（开页自动聚焦搜索框）时不要弹出候选列表，
     否则每次打开新标签页都会先糊一层历史记录在下拉里 */
  let quietFocus = false;

  async function init() {
    engine = await EHP.storage.get(EHP.storage.KEY.engine, 'bing');
    renderSwitch();
    /* 首次按存储里的引擎"直接落位"：不要先按 HTML 默认引擎挖孔再滑过来 */
    if (EHP.holes) EHP.holes.engineJump();

    switchEl.addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-engine]');
      if (!btn) return;
      engine = btn.dataset.engine;
      EHP.storage.set(EHP.storage.KEY.engine, engine);
      renderSwitch();
      if (EHP.holes) EHP.holes.schedule(); /* 让孔洞滑到新选中的图标上 */
      input.focus();
      onInput();
    });

    input.addEventListener('input', onInput);

    /* 聚焦即亮候选：空输入时直接给最近历史（用户要求：不必先输入一个字才出现）；
       Esc 关掉列表后再点一下输入框也能重新打开 */
    input.addEventListener('focus', function () {
      if (quietFocus) {
        quietFocus = false;
        return;
      }
      openForFocus();
    });
    input.addEventListener('click', function () {
      if (listEl.hidden) openForFocus();
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (listEl.hidden || !items.length) return;
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        /* 从"未选中"进入时：↓ 选第一条、↑ 选最后一条（旧版 ↑ 会落到倒数第二条） */
        if (activeIndex < 0) activeIndex = dir === 1 ? 0 : items.length - 1;
        else activeIndex = (activeIndex + dir + items.length) % items.length;
        updateActive();
        /* 边选边把候选文本写回搜索框（光标停在末尾），于是可以
           「敲一两个字 → ↑↓ 补全 → 接着敲后面的字」 */
        syncInputToActive();
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
    switchEl.dataset.active = engine; /* 驱动滑块滑动 */
    Array.prototype.forEach.call(switchEl.querySelectorAll('button'), function (b) {
      b.classList.toggle('active', b.dataset.engine === engine);
    });
  }

  async function onInput() {
    const q = input.value.trim();
    if (!q) {
      /* 清空输入时不清空列表：退回"最近历史"模式 */
      showHistory();
      return;
    }
    const my = ++gen;
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

  /* ---------- 空输入 / 重新聚焦：最近的历史记录 ---------- */

  /* 历史本身是"新的在前"（storage.recordSearch 用 unshift），取前 N 条即可 */
  async function showHistory() {
    const my = ++gen;
    const history = await EHP.storage.get(EHP.storage.KEY.history, []);
    if (my !== gen) return;
    items = (Array.isArray(history) ? history : [])
      .filter(function (h) { return h && typeof h.q === 'string' && h.q; })
      .slice(0, EMPTY_LIMIT)
      .map(function (h) { return { text: h.q, source: 'history' }; });
    activeIndex = -1;
    render();
  }

  /* 聚焦 / 点回输入框：有内容就走一遍正常输入流程（历史 + 在线联想），没内容就列最近历史 */
  function openForFocus() {
    if (input.value.trim()) onInput();
    else showHistory();
  }

  /* 把当前选中的候选写进搜索框，光标停在末尾。
     ⚠ 必须直接赋值 .value——它不会触发 input 事件，所以列表不会被新文本立刻重新过滤
     （否则选中第一条的瞬间列表就换成"以该条为前缀"的结果，没法继续上下选） */
  function syncInputToActive() {
    const it = items[activeIndex];
    if (!it) return;
    input.value = it.text;
    try {
      input.setSelectionRange(it.text.length, it.text.length);
    } catch (e) { /* 极端环境下不支持选区，忽略即可 */ }
  }

  /* 程序化聚焦且不弹候选：开页自动聚焦搜索框时用 */
  function focusQuiet() {
    quietFocus = true;
    input.focus();
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
    /* 代际号 +1：丢掉还在路上的异步结果，避免"失焦后列表又被一次迟到的渲染弹出来" */
    gen++;
    listEl.hidden = true;
    listEl.textContent = '';
    items = [];
    activeIndex = -1;
  }

  EHP.search = { init: init, focusQuiet: focusQuiet };
})();
