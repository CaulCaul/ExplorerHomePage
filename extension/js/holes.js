/* Explorer Home Page — 挖孔、光照/遮挡阴影、上层装饰与命中测试
 *
 * 层结构（z-index）：下表面基底(0) < 控件(1) < 下表面光照+遮挡阴影(2) < 板材(3) < 装饰/签名(4) < 上表面光照(5) < 候选下拉(6) < 抽屉/弹窗/Toast(80+)
 *   ⚠ 控件必须在**下表面光照层之下**（否则阴影压到图标上时图标还是亮的）；
 *     签名/标题/边框必须在**上表面光照层之下**（否则它们完全不受光照影响）。
 *
 * 光照模型（物理假设：光源 = 平行于屏幕的均匀发光圆盘，直径可调；另有可调环境光托底）：
 *   **显示值 = 反射率 × 光照**（逐通道乘法，mix-blend-mode: multiply）——
 *   所以纯黑反照率（如 GitHub 图标）在再强的光下也保持黑色，光色只补它自己的通道。
 *   光照倍数 = 环境光 + (1 − 环境光) × 光源强度 × 光谱 × 可见比例。
 *   受光剖面：discProfile(d, h, R) 数值积分圆盘辐照度 ∫dA/(ρ²+h²)²，
 *     以正下方解析解 πR²/(R²+h²) 归一化。剖面旋转对称，故只需一维剖面 →
 *     烘成径向渐变：上表面 h = 光源高度、下表面 h = 光源高度 + 层间距（再乘两平面的绝对比 groundScale）。
 *   孔洞投影（遮挡阴影）：孔按 (1 + gapK) 放大（gapK = 层间距/光源高度），向背离光源方向偏移
 *     dist × gapK，再按半影带宽 patchDilation = 光源半径 × gapK 膨胀，
 *     由 feGaussianBlur(σ = 半影/2) 柔化 —— 光源越大越柔、越高越锐、层间距越大越柔。
 *   透光区几何集中定义在 <g id="lit-patches">，由 #shadow-mask（白底 + 黑透光区）用 <use> 引用；
 *   遮挡阴影的烘培值是 环境光 / 下表面光照，正好把直射光那一份"除"掉 → 阴影区只剩环境光。
 *   偏移上限取视口对角线的一半（旧版固定 120px 会导致远处的角标透光区不再移动）。
 *
 * 悬停：用缓存 rect 做命中测试（图标孔 ∪ 编辑按钮）驱动，不依赖下层 mouseenter（避免抖动）。
 */
(function () {
  'use strict';

  const EHP = window.EHP;
  const NS = 'http://www.w3.org/2000/svg';

  const SVG_PENCIL = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';

  /* 固定控件：rx = 控件自身圆角（控件的明暗由 z2 的三个光影层统一处理，此处无需亮度参数） */
  const FIXED = {
    'search-wrap': { rx: 14 },
    'net-panel': { rx: 14 },
    'settings-btn': { rx: 19 }
  };
  const TILE_RX = 12;

  /* 光照：世界单位 → 屏幕像素的换算（光源高度 10 → 700px 的视觉尺度） */
  const PX_PER_UNIT = 70;

  /* 由设置推导的几何量：gapK = 层间距/光源高度（透光区放大与偏移比例）
     patchDilation = 半影带宽度(px) = 光源半径 × gapK（面积光源的软阴影宽度） */
  let gapK = 0.1;
  let patchDilation = 35;

  /* 光照设置（settings.js 通过 applyLightSettings 推入） */
  let lightCfg = {
    color: '#6366f1', diameter: 700, intensity: 0.5,
    height: 10, gap: 1, ambient: 30
  };

  /* 引擎选择器：下表面两个图标 + 上表面一个可移动的孔洞（滑动切换） */
  const ENGINE_RX = 12;
  let engineTarget = null;   /* 目标几何（选中图标的位置） */
  let engineShown = null;    /* 当前显示的几何（滑动插值） */
  let engineRaf = null;
  let engineFrame = null;    /* 上表面外扩边框（与搜索框同高，框住两个图标） */
  let engineSnap = false;    /* 下一次更新直接落位（不播放滑动动画）：用于首次加载 */

  /* 设置面板：孔洞的展开/收回（面板本身不做位移，全靠孔洞几何驱动） */
  const PANEL_RX = 22;       /* ⚠ 必须与 .drawer 的 border-radius 一致 */
  let panelTarget = null;
  let panelShown = null;
  let panelRaf = null;
  let panelOpen = false;     /* 目标状态（true = 展开） */
  let panelLive = false;     /* 当前是否存在这个孔 */

  /* ---------- 光源的逐通道光谱 ---------- */

  /* 光色 → [r,g,b]（0..1）。光色直接当作**光谱**用：
     纯黑 → 三个通道全 0 → 没有直射光，全局只剩环境光；
     饱和色（如纯红）→ 只有红通道有值，正是"红光不照亮绿蓝" */
  function hexToRgbUnit(hex) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return [1, 1, 1];
    return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
  }

  let shMax = 600;        /* 偏移上限，update() 中按视口对角线重算 */
  let lastW = 0;
  let lastH = 0;

  const decor = document.getElementById('tile-decor');

  /* ---------- SVG：柔化滤镜 + 三个蒙版 ---------- */

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';

  const defs = document.createElementNS(NS, 'defs');

  const filter = document.createElementNS(NS, 'filter');
  filter.setAttribute('id', 'penumbra');
  filter.setAttribute('x', '-100%');
  filter.setAttribute('y', '-100%');
  filter.setAttribute('width', '300%');
  filter.setAttribute('height', '300%');
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const blur = document.createElementNS(NS, 'feGaussianBlur');
  blur.setAttribute('id', 'penumbra-blur');
  blur.setAttribute('stdDeviation', '8');
  filter.appendChild(blur);
  defs.appendChild(filter);

  function mkMask(id, baseFill) {
    const m = document.createElementNS(NS, 'mask');
    m.setAttribute('id', id);
    m.setAttribute('maskUnits', 'userSpaceOnUse');
    /* 先给一个足够大的显式区域，避免首次布局前 mask 区域为空导致整层不可见 */
    m.setAttribute('x', '-10000');
    m.setAttribute('y', '-10000');
    m.setAttribute('width', '30000');
    m.setAttribute('height', '30000');
    const base = document.createElementNS(NS, 'rect');
    base.setAttribute('fill', baseFill);
    base.setAttribute('x', '-10000');
    base.setAttribute('y', '-10000');
    base.setAttribute('width', '30000');
    base.setAttribute('height', '30000');
    m.appendChild(base);
    defs.appendChild(m);
    return { el: m, base: base };
  }

  const sheetMask = mkMask('hole-mask', '#fff');    /* 板材挖孔：精确孔位，**边界保持锐利** */
  const shadowMask = mkMask('shadow-mask', '#fff'); /* 白 = 被板材挡住（阴影），黑 = 透光区 */
  /* 孔洞矩形直接挂在掩版上（不做模糊）：上下表面的分界必须干净利落；
     孔缘"向下凹陷"的观感由 WebGL 层的法线倾斜负责，而不是把边界糊掉 */
  const sheetHoles = sheetMask.el;

  /* 透光区几何集中定义一次，两个蒙版各用自己的 currentColor 引用（黑/白） */
  const patches = document.createElementNS(NS, 'g');
  patches.setAttribute('id', 'lit-patches');
  defs.appendChild(patches);

  function addUse(maskEl, color) {
    const u = document.createElementNS(NS, 'use');
    u.setAttribute('href', '#lit-patches');
    u.setAttribute('filter', 'url(#penumbra)');
    u.setAttribute('color', color);
    maskEl.appendChild(u);
  }
  addUse(shadowMask.el, '#000');

  function mkRect(parent, fill) {
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('fill', fill);
    r.setAttribute('width', '0');
    r.setAttribute('height', '0');
    parent.appendChild(r);
    return r;
  }

  function setRect(el, x, y, w, h, rx) {
    el.setAttribute('x', x.toFixed(2));
    el.setAttribute('y', y.toFixed(2));
    el.setAttribute('width', w.toFixed(2));
    el.setAttribute('height', h.toFixed(2));
    el.setAttribute('rx', rx.toFixed(2));
  }

  function hideRect(el) {
    el.setAttribute('width', '0');
    el.setAttribute('height', '0');
  }

  svg.appendChild(defs);
  document.body.appendChild(svg);

  /* ---------- 孔（控件 / 磁贴图标） ---------- */

  function newHole() {
    return {
      sheetRect: mkRect(sheetHoles, '#000'),        /* 板材上的孔（放进模糊组 → 孔缘柔化） */
      patchRect: mkRect(patches, 'currentColor'),   /* 透光区（被两个蒙版引用） */
      base: null /* {x, y, w, h, rx} 布局时的精确几何 */
    };
  }

  function setHole(spec, r, rx) {
    if (!r || r.width < 1 || r.height < 1) {
      hideRect(spec.sheetRect);
      hideRect(spec.patchRect);
      spec.base = null;
      return;
    }
    const cr = Math.min(rx, r.height / 2);
    spec.base = { x: r.left, y: r.top, w: r.width, h: r.height, rx: cr };
    setRect(spec.sheetRect, r.left, r.top, r.width, r.height, cr);
    shapePatch(spec);
  }

  /* 透光区 = 孔按 (1 + gapK) 放大，向远离光源方向偏移 dist × gapK，
     再按半影带 patchDilation 膨胀（面积光源的软阴影） */
  function shapePatch(spec) {
    const b = spec.base;
    if (!b) {
      hideRect(spec.patchRect);
      return;
    }
    const s = 1 + gapK;
    let ox = 0;
    let oy = 0;
    if (mouse.seen) {
      const vx = (b.x + b.w / 2) - mouse.x;
      const vy = (b.y + b.h / 2) - mouse.y;
      const len = Math.sqrt(vx * vx + vy * vy) || 1;
      const k = Math.min(shMax, len * gapK);
      ox = vx / len * k;
      oy = vy / len * k;
    }
    const w = b.w * s + patchDilation * 2;
    const h = b.h * s + patchDilation * 2;
    setRect(spec.patchRect,
      b.x + ox - (w - b.w) / 2,
      b.y + oy - (h - b.h) / 2,
      w, h, Math.min(b.rx * s + patchDilation, h / 2));
  }

  const fixed = {};
  Object.keys(FIXED).forEach(function (id) {
    fixed[id] = {
      el: document.getElementById(id),
      hole: newHole()
    };
  });

  /* 引擎选择器的孔洞：下表面两个图标中，只有一个能透过这个（可滑动的）孔被看到 */
  const engineSpec = newHole();

  /* 设置面板的孔洞：收起时不存在，点击齿轮后从齿轮位置长成大圆角矩形 */
  const panelSpec = newHole();

  /* ---------- 磁贴：装饰在上层，图标各自挖孔 ---------- */

  const tiles = {}; /* id → {hole, title, name, tileEl, titleHit} */

  function createTileDecor(id, tileEl) {
    const title = document.createElement('div');
    title.className = 'tile-decor-title';
    const name = document.createElement('span');
    name.className = 'tile-decor-name';
    const pencil = document.createElement('span');
    pencil.className = 'tile-decor-edit';
    pencil.innerHTML = SVG_PENCIL;
    title.appendChild(name);
    title.appendChild(pencil);
    /* 名称即编辑入口：点击打开编辑弹窗（openModal 逻辑在 shortcuts.js 单点维护）；
       ⚠ 传 id 而不是元素/对象：磁贴重渲染后旧引用会指向旧数据 */
    title.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (EHP.shortcuts && EHP.shortcuts.edit) EHP.shortcuts.edit(id);
    });
    decor.appendChild(title);
    tiles[id] = {
      hole: newHole(), title: title, name: name, tileEl: tileEl, titleHit: null
    };
  }

  function destroyTileDecor(id) {
    const t = tiles[id];
    if (!t) return;
    sheetHoles.removeChild(t.hole.sheetRect);
    patches.removeChild(t.hole.patchRect);
    decor.removeChild(t.title);
    delete tiles[id];
  }

  /* 磁贴集合变化（增删/重排）后调用 */
  function syncTiles() {
    const seen = {};
    Array.prototype.forEach.call(
      document.querySelectorAll('#shortcuts .tile[data-id]'),
      function (tileEl) {
        const id = tileEl.dataset.id;
        seen[id] = true;
        if (!tiles[id]) createTileDecor(id, tileEl);
        else tiles[id].tileEl = tileEl;
      }
    );
    Object.keys(tiles).forEach(function (id) {
      if (!seen[id]) {
        if (hoverId === id) hoverId = null;
        destroyTileDecor(id);
      }
    });
    schedule();
  }

  function positionTile(t) {
    const iconEl = t.tileEl.querySelector('.tile-icon');
    const slotEl = t.tileEl.querySelector('.tile-title');
    if (iconEl) {
      setHole(t.hole, iconEl.getBoundingClientRect(), TILE_RX);
    }
    if (slotEl) {
      const sr = slotEl.getBoundingClientRect();
      /* 宽度取「整个磁贴」而不是文字槽：文字槽宽度恰好等于文字宽度，
         短名称（如 "OA"）会因取整/渲染的细微差异被判溢出，显示成 "O…"（实测 bug）；
         改用磁贴宽度后，省略只在真的超出磁贴时才发生 */
      const tr = t.tileEl.getBoundingClientRect();
      /* 名称区域上下各放宽 3px：细字更好点中；元素盒子与命中区必须完全一致，
         否则会出现"悬停显示了铅笔、点下去却穿透到下层磁贴"的错位 */
      const left = Math.round(tr.left);
      const top = Math.round(sr.top) - 3;
      const w = Math.round(tr.width);
      const h = Math.round(sr.height) + 6;
      t.name.textContent = slotEl.textContent;
      t.title.style.left = left + 'px';
      t.title.style.top = top + 'px';
      t.title.style.width = w + 'px';
      t.title.style.height = h + 'px';
      t.titleHit = { left: left, top: top, right: left + w, bottom: top + h };
    }
  }

  /* ---------- 新建磁贴：虚线框完全在上层，下层按钮仅作点击占位 ---------- */

  let addDecor = null;
  let addHit = null;

  function positionAddTile() {
    const addTileEl = document.querySelector('#shortcuts .tile-add');
    if (!addTileEl) {
      if (addDecor) addDecor.style.display = 'none';
      addHit = null;
      return;
    }
    if (!addDecor) {
      addDecor = document.createElement('div');
      addDecor.className = 'tile-add-decor';
      const plus = document.createElement('span');
      plus.textContent = '+';
      addDecor.appendChild(plus);
      decor.appendChild(addDecor);
    }
    addDecor.style.display = '';
    const iconEl = addTileEl.querySelector('.tile-plus');
    const r = (iconEl || addTileEl).getBoundingClientRect();
    const PAD = 2;
    const x = Math.round(r.left - PAD);
    const y = Math.round(r.top - PAD);
    const w = Math.round(r.width + PAD * 2);
    const h = Math.round(r.height + PAD * 2);
    addDecor.style.left = x + 'px';
    addDecor.style.top = y + 'px';
    addDecor.style.width = w + 'px';
    addDecor.style.height = h + 'px';
    addDecor.style.borderRadius = Math.min(13, h / 2) + 'px';
    addHit = { left: x, top: y, right: x + w, bottom: y + h };
  }

  /* ---------- 鼠标：光源位置、透光区、命中测试 ---------- */

  /* seen = 光标是否出现过（决定受光点是否居中：开页还没动鼠标时用画面中心）
     away = 指针当前是否在窗口之外（此时**保持离开前的光影**，只是不再参与悬停命中） */
  const mouse = { x: -1e5, y: -1e5, seen: false, away: false };
  let mouseRaf = null;
  let lastShadowX = null;
  let lastShadowY = null;
  let hoverId = null;
  let addHover = false;

  function eachHole(cb) {
    Object.keys(fixed).forEach(function (id) { cb(fixed[id].hole); });
    Object.keys(tiles).forEach(function (id) { cb(tiles[id].hole); });
    cb(engineSpec);
    cb(panelSpec);
  }

  /* 光源位置 → 受光点（--lx/--ly）
     ⚠ 必须写在 :root 上：三条光照渐变（--sheet-light/--ground-light/--ground-shadow）也声明在 :root，
     而 var() 是在「声明该自定义属性的元素」上完成替换的——写在下层元素上不会生效
     （曾导致受光区永久停在画面中心、只有阴影跟随鼠标）。
     ⚠ 刻意**不做**量化/限流（用户明确要求"不要限制帧率和鼠标抖动"）：每帧写的就是真实光标位置。
     代价是引用这两个变量的三条整屏径向渐变会重新栅格化 + 重新 multiply 合成，
     鼠标移动时 GPU 占用偏高即来源于此；要真正降下来只能改结构（见 AGENTS.md 第 21/22 条）。
     ⚠ 上面的「未动鼠标 → 回中心」分支只在开页时走一次：指针移出窗口**不再**回到中心
     （clearPointer 只标记 away），否则离开与回来时受光点会各跳一次，看起来就是抖动。 */
  function applySheetLight() {
    const root = document.documentElement.style;
    if (!mouse.seen) {
      root.setProperty('--lx', '50%');
      root.setProperty('--ly', '50%');
      return;
    }
    root.setProperty('--lx', mouse.x + 'px');
    root.setProperty('--ly', mouse.y + 'px');
  }

  /* 光源移动 → 重算所有透光区（模糊后的大面积渐变，2px 内不重算；
     用户明确要求不做更强节流） */
  function applyShadow(force) {
    if (!force && mouse.seen && lastShadowX !== null) {
      const dx = mouse.x - lastShadowX;
      const dy = mouse.y - lastShadowY;
      if (dx * dx + dy * dy < 4) return;
    }
    lastShadowX = mouse.x;
    lastShadowY = mouse.y;
    eachHole(shapePatch);
  }

  function inRect(r, x, y) {
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  /* 悬停：**只有指向名称**才进入悬停态（图标上不播编辑动画，
     否则鼠标只是路过图标就会闪出下划线与铅笔）。
     ⚠ 指针在窗口外时必须直接清空命中：布局变化（缩放/滚动/磁贴重排）也会调用本函数，
     否则会拿"离开前留下的旧坐标"重新点亮某个名称 —— 指针明明不在窗口里，铅笔却冒出来。 */
  function applyHover() {
    if (mouse.away) { resetHover(); return; }
    let hit = null;
    Object.keys(tiles).forEach(function (id) {
      if (inRect(tiles[id].titleHit, mouse.x, mouse.y)) hit = id;
    });
    if (hit !== hoverId) {
      if (hoverId !== null && tiles[hoverId]) setTileHover(hoverId, false);
      hoverId = hit;
      if (hoverId !== null) setTileHover(hoverId, true);
    }
    const a = inRect(addHit, mouse.x, mouse.y);
    if (a !== addHover) {
      addHover = a;
      setAddHover(a);
    }
  }

  function updateMouseDriven() {
    mouseRaf = null;
    applySheetLight();
    applyShadow(false);
    applyHover();
  }

  function scheduleMouseDriven() {
    if (mouseRaf !== null) return;
    mouseRaf = requestAnimationFrame(updateMouseDriven);
  }

  window.addEventListener('mousemove', function (e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.seen = true;
    mouse.away = false;
    scheduleMouseDriven();
  });

  function resetHover() {
    if (hoverId !== null && tiles[hoverId]) setTileHover(hoverId, false);
    hoverId = null;
    if (addHover) {
      addHover = false;
      setAddHover(false);
    }
  }

  /* 指针离开窗口 / 窗口失焦：**停在离开前的状态**（受光点与所有透光区都不动）。
     旧实现把 seen 置回 false 并强刷一次：受光点跳回画面中心、透光区偏移全部归零 ——
     离开窗口的瞬间整套光影"啪"地变一次、移回来又变回去，这就是看到的抖动。
     现在只标记 away（供 applyHover 停止命中），不碰 --lx/--ly 与透光区几何；
     lastShadowX/Y 也保留，移回来时继续按同一基准做 2px 阈值判断。 */
  function clearPointer() {
    if (mouse.away) return;
    mouse.away = true;
    resetHover();
  }

  document.addEventListener('mouseleave', clearPointer);
  window.addEventListener('blur', clearPointer);
  /* 拖拽期间没有 mousemove，避免悬停态残留 */
  document.addEventListener('dragstart', resetHover);
  document.addEventListener('dragend', scheduleMouseDriven);

  function setTileHover(id, on) {
    const t = tiles[id];
    if (!t) return;
    /* 悬停只改名称（变深 + 下划线 + 滑出铅笔符号）：图标本身不做任何变化 */
    t.title.classList.toggle('hover', on);
  }

  function setAddHover(on) {
    if (addDecor) addDecor.classList.toggle('hover', on);
  }

  /* ---------- 引擎选择器：可滑动的孔洞 + 上表面外扩边框 ---------- */

  /* 孔与它的遮挡阴影必须用**同一份几何**：补间过程中两者都跟着显示位置走，
     否则阴影会先跳到终点，在孔洞移动途中露出"不该有的影子"（实测现象） */
  function applyEngineSpec(r) {
    engineSpec.base = { x: r.x, y: r.y, w: r.w, h: r.h, rx: r.rx };
    setRect(engineSpec.sheetRect, r.x, r.y, r.w, r.h, r.rx);
    shapePatch(engineSpec);
  }

  function engineTick() {
    engineRaf = null;
    const t = engineTarget;
    if (!t || !engineShown) return;
    /* 每帧插值比例：0.14 ≈ 0.4s 滑到位（越小越慢、越平顺） */
    const k = 0.14;
    engineShown.x += (t.x - engineShown.x) * k;
    engineShown.y += (t.y - engineShown.y) * k;
    engineShown.w += (t.w - engineShown.w) * k;
    engineShown.h += (t.h - engineShown.h) * k;
    const near = Math.abs(t.x - engineShown.x) < 0.3 && Math.abs(t.y - engineShown.y) < 0.3 &&
      Math.abs(t.w - engineShown.w) < 0.3 && Math.abs(t.h - engineShown.h) < 0.3;
    if (near) engineShown = { x: t.x, y: t.y, w: t.w, h: t.h, rx: t.rx };
    applyEngineSpec(engineShown);
    if (!near) engineRaf = requestAnimationFrame(engineTick);
  }

  function updateEngine() {
    const sw = document.getElementById('engine-switch');
    if (!sw) return;
    const btns = sw.querySelectorAll('button[data-engine]');
    if (btns.length < 2) return;
    const a = btns[0].getBoundingClientRect();
    const b = btns[1].getBoundingClientRect();
    const active = sw.dataset.active === 'google' ? b : a;
    /* 孔 = 选中图标的按钮边界（方案 A：孔与控件同形同圆角） */
    const next = {
      x: active.left,
      y: active.top,
      w: active.width,
      h: active.height,
      rx: Math.min(ENGINE_RX, active.height / 2)
    };
    /* 已经滑到位（或首次落位、或布局微调）→ 直接写几何，不播放滑动 */
    const moved = engineShown && (Math.abs(next.x - engineShown.x) > 0.5 ||
      Math.abs(next.y - engineShown.y) > 0.5);
    if (engineSnap || !moved) {
      engineSnap = false;
      if (engineRaf !== null) { cancelAnimationFrame(engineRaf); engineRaf = null; }
      engineShown = { x: next.x, y: next.y, w: next.w, h: next.h, rx: next.rx };
      engineTarget = next;
      applyEngineSpec(engineShown);
    } else {
      /* 切换引擎 → 让孔洞（连同它的阴影）一起滑过去 */
      engineTarget = next;
      if (engineRaf === null) engineRaf = requestAnimationFrame(engineTick);
    }

    /* 上表面外扩边框：**与搜索框同高**（外扩量 = (搜索框高 − 图标按钮高) / 2），
       框住两个图标位置，标示孔洞可移动的范围 */
    if (!engineFrame) {
      engineFrame = document.createElement('div');
      engineFrame.className = 'engine-frame';
      decor.appendChild(engineFrame);
    }
    const btnTop = Math.min(a.top, b.top);
    const btnLeft = Math.min(a.left, b.left);
    const btnW = Math.max(a.right, b.right) - btnLeft;
    const btnH = Math.max(a.bottom, b.bottom) - btnTop;
    const wrapEl = document.getElementById('search-wrap');
    const wrapR = wrapEl ? wrapEl.getBoundingClientRect() : null;
    const F = wrapR && wrapR.height > btnH ? (wrapR.height - btnH) / 2 : 0;
    engineFrame.style.left = Math.round(btnLeft - F) + 'px';
    engineFrame.style.top = Math.round(btnTop - F) + 'px';
    engineFrame.style.width = Math.round(btnW + F * 2) + 'px';
    engineFrame.style.height = Math.round(btnH + F * 2) + 'px';
    frameHit = {
      left: btnLeft - F, top: btnTop - F,
      right: btnLeft - F + btnW + F * 2, bottom: btnTop - F + btnH + F * 2
    };
  }

  /* ---------- 布局更新 ---------- */

  let rafId = null;

  function update() {
    rafId = null;
    const W = window.innerWidth;
    const H = window.innerHeight;
    /* 偏移上限 = 视口对角线的一半：保证光源拉到远处时透光区能真正移出孔外 */
    shMax = Math.round(Math.sqrt(W * W + H * H) * 0.5);

    /* 视口变化会影响剖面渐变的取样半径，重烘一次 */
    if (W !== lastW || H !== lastH) {
      lastW = W;
      lastH = H;
      buildLightGradients();
    }

    /* 三个蒙版的白/黑底与区域都显式覆盖全屏（含外扩余量） */
    [sheetMask, shadowMask].forEach(function (m) {
      m.base.setAttribute('x', '-400');
      m.base.setAttribute('y', '-400');
      m.base.setAttribute('width', String(W + 800));
      m.base.setAttribute('height', String(H + 800));
      m.el.setAttribute('x', '-400');
      m.el.setAttribute('y', '-400');
      m.el.setAttribute('width', String(W + 800));
      m.el.setAttribute('height', String(H + 800));
    });

    /* 固定控件孔位（控件的明暗由其上方的 #ground-lit/#ground-shadow 逐像素乘法给出） */
    Object.keys(FIXED).forEach(function (id) {
      const f = fixed[id];
      if (!f.el) return;
      setHole(f.hole, f.el.getBoundingClientRect(), FIXED[id].rx);
    });

    Object.keys(tiles).forEach(function (id) { positionTile(tiles[id]); });
    positionAddTile();
    updateEngine();
    syncPanel();
    /* 面板展开期间若磁贴被重建（例如导入数据后重渲染），新装饰元素也要重新遮挡 */
    if (panelLive && panelShown) hideDecorOverPanel(panelShown);

    /* 布局变化后重算光影与悬停，保证与孔位一致 */
    applyShadow(true);
    applyHover();
  }

  /* rAF 合帧：一帧内多次 schedule 只计算一次 */
  function schedule() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(update);
  }

  /* ---------- 物理光照：均匀发光圆盘 ---------- */

  /* 圆盘（半径 R、距平面 h、观察点水平偏移 d）在平行平面上的相对辐照度：
     E(d) ∝ ∫ dA/(ρ²+h²)²（均匀辐射），以正下方 E(0) 归一化 → 0..1。
     数值积分：以观察点投影为极坐标原点，圆盘圆心位于 (d, 0)。
     R ≪ h 时退化为平方反比；R ≫ h 时趋近均匀。 */
  function discProfile(d, h, R) {
    if (!(R > 0) || !(h > 0)) return 0;
    const r0 = Math.max(0, d - R);
    const r1 = d + R;
    const N = 160;
    const dr = (r1 - r0) / N;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const rho = r0 + (i + 0.5) * dr;
      const denom = rho * rho + h * h;
      let phi;
      if (rho <= R - d) {
        phi = Math.PI; /* 该半径整圈都落在圆盘内 */
      } else {
        const c = (d * d + rho * rho - R * R) / (2 * d * rho);
        phi = Math.acos(Math.min(1, Math.max(-1, c)));
      }
      sum += (rho / (denom * denom)) * 2 * phi * dr;
    }
    const e = h * h * sum;
    const e0 = Math.PI * R * R / (R * R + h * h); /* 解析解：正下方 */
    return Math.min(1, e / e0);
  }

  /* 把逐通道光照倍数 m(r,g,b) 编码成一段 CSS 颜色，配合 mix-blend-mode: multiply 使用：
     multiply 下最终倍数 = (1 − α) + α·c（逐通道）。取 α = 1 − min(m)、c = (m − min)/(1 − min)
     即可精确还原 m（m ≤ 1 保证 c 落在 0..1）。这样"光照"是纯乘法：
     黑色反照率永远保持黑色，饱和光色只补它自己的通道。 */
  function encodeMul(m) {
    const mn = Math.min(m[0], m[1], m[2]);
    const a = 1 - mn;
    if (a <= 1e-4) return 'rgba(0, 0, 0, 0)'; /* 满光照：完全透明，不做任何压暗 */
    const ch = function (v) {
      return Math.round(Math.max(0, Math.min(1, (v - mn) / a)) * 255);
    };
    return 'rgba(' + ch(m[0]) + ', ' + ch(m[1]) + ', ' + ch(m[2]) + ', ' + a.toFixed(4) + ')';
  }

  /* 把圆盘剖面烘成径向渐变（旋转对称 → 只需一维剖面；仅在设置/视口变化时重算）：
     · --sheet-light   上表面光照（h = 光源高度 H）
     · --ground-light  下表面光照（h = H + 层间距 g）
     · --ground-shadow 遮挡阴影 = 环境光 / 下表面光照（把直射光那一份"除"掉）
     光照倍数 = 环境光 + (1 − 环境光) × 光源强度 × 光谱 × 可见比例，
     其中 可见比例 = discProfile(d, h, R)；环境光是唯一决定亮度下限的参数。
     ⚠ 必须显式写死圆半径（circle Npx）——不写时默认 farthest-corner，
       百分比→像素的映射会随中心位置变化，导致光斑随鼠标缩放（实测 bug）。 */
  function buildLightGradients() {
    const L = lightCfg;
    const R = L.diameter / 2;
    const ambient = L.ambient / 100;
    const gain = 1 - ambient;                    /* 直射光最多能补多少 */
    const I = L.intensity;                       /* 光源标称强度（0.1–1） */
    const k = hexToRgbUnit(L.color);             /* 光谱（逐通道 0..1） */
    const hUp = Math.max(1, L.height * PX_PER_UNIT);
    const hDown = Math.max(1, (L.height + L.gap) * PX_PER_UNIT);
    /* 下表面中心的绝对亮度 / 上表面中心 = (R²+hUp²)/(R²+hDown²)：远一点自然暗一点 */
    const groundScale = (R * R + hUp * hUp) / (R * R + hDown * hDown);
    const W = window.innerWidth;
    const H = window.innerHeight;
    const dMax = Math.max(400, Math.sqrt(W * W + H * H) * 1.15);
    const STOPS = 12;
    const up = [];
    const down = [];
    const shade = [];
    for (let i = 0; i <= STOPS; i++) {
      const d = dMax * i / STOPS;
      const pos = (i / STOPS * 100).toFixed(1) + '%';
      const pUp = discProfile(d, hUp, R);
      const pDown = discProfile(d, hDown, R) * groundScale;
      const mUp = [0, 0, 0];
      const mDown = [0, 0, 0];
      const mShade = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        mUp[c] = ambient + gain * I * k[c] * pUp;
        mDown[c] = ambient + gain * I * k[c] * pDown;
        mShade[c] = mDown[c] > 0 ? ambient / mDown[c] : 1; /* 阴影里只剩环境光 */
      }
      up.push(encodeMul(mUp) + ' ' + pos);
      down.push(encodeMul(mDown) + ' ' + pos);
      shade.push(encodeMul(mShade) + ' ' + pos);
    }
    const at = 'circle ' + Math.round(dMax) + 'px at var(--lx, 50%) var(--ly, 50%)';
    const root = document.documentElement.style;
    root.setProperty('--sheet-light', 'radial-gradient(' + at + ', ' + up.join(', ') + ')');
    root.setProperty('--ground-light', 'radial-gradient(' + at + ', ' + down.join(', ') + ')');
    root.setProperty('--ground-shadow', 'radial-gradient(' + at + ', ' + shade.join(', ') + ')');
  }

  /* 光照设置 → 几何量（gapK / 半影带宽）+ 三条光照渐变 */
  function applyLightSettings(light) {
    if (light) lightCfg = light;
    const L = lightCfg;
    gapK = L.gap / L.height;                     /* g/H */
    patchDilation = (L.diameter / 2) * gapK;     /* 半影带宽度 = 光源半径 × g/H */
    blur.setAttribute('stdDeviation',
      Math.max(0.2, Math.min(60, patchDilation / 2)).toFixed(2));
    buildLightGradients();
    applyShadow(true);
  }

  window.addEventListener('resize', schedule);
  /* 页面可滚动（磁贴太多时）：孔位/装饰用视口坐标，滚动后必须重算，否则会与控件错位 */
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('load', schedule);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(schedule).catch(function () {});
  }

  /* 引擎孔洞"直接落位"（不播放滑动）：搜索模块从存储里读出引擎后调用，
     避免开页时先按 HTML 里的默认引擎挖孔、再滑到真实引擎（可见的初始动画） */
  function engineJump() {
    engineSnap = true;
    schedule();
  }

  /* ---------- 设置面板：孔洞从齿轮位置长成整页高的大圆角矩形 ---------- */

  /* 面板画在下表面（z1），而上层装饰（磁贴名称/新建虚线框/引擎边框）在 z4——
     它们会浮在面板之上。所以把与孔洞相交的那几个装饰暂时隐藏：
     这些元素本来就在孔洞范围内，不隐藏就会"穿"到设置面板上 */
  let frameHit = null; /* 引擎外扩边框的 rect（供上面的相交判断用） */

  function decorIntersects(r, b) {
    return !!r && !!b && b.left < r.x + r.w && b.right > r.x && b.top < r.y + r.h && b.bottom > r.y;
  }

  function hideDecorOverPanel(r) {
    Object.keys(tiles).forEach(function (id) {
      const t = tiles[id];
      t.title.style.visibility = decorIntersects(r, t.titleHit) ? 'hidden' : '';
    });
    if (addDecor) addDecor.style.visibility = decorIntersects(r, addHit) ? 'hidden' : '';
    if (engineFrame) engineFrame.style.visibility = decorIntersects(r, frameHit) ? 'hidden' : '';
  }

  function applyPanelSpec(r) {
    panelSpec.base = { x: r.x, y: r.y, w: r.w, h: r.h, rx: r.rx };
    setRect(panelSpec.sheetRect, r.x, r.y, r.w, r.h, r.rx);
    shapePatch(panelSpec);
    hideDecorOverPanel(r);
  }

  function hidePanelSpec() {
    panelSpec.base = null;
    hideRect(panelSpec.sheetRect);
    hideRect(panelSpec.patchRect);
    hideDecorOverPanel(null);
  }

  function panelTick() {
    panelRaf = null;
    const t = panelTarget;
    if (!t || !panelShown) return;
    const k = 0.16; /* 略快于引擎孔洞：大孔洞滑动距离长，太快会糊 */
    panelShown.x += (t.x - panelShown.x) * k;
    panelShown.y += (t.y - panelShown.y) * k;
    panelShown.w += (t.w - panelShown.w) * k;
    panelShown.h += (t.h - panelShown.h) * k;
    panelShown.rx += (t.rx - panelShown.rx) * k; /* 圆角也一起插值，避免最后一帧跳一下 */
    const near = Math.abs(t.x - panelShown.x) < 0.3 && Math.abs(t.y - panelShown.y) < 0.3 &&
      Math.abs(t.w - panelShown.w) < 0.3 && Math.abs(t.h - panelShown.h) < 0.3;
    if (near) panelShown = { x: t.x, y: t.y, w: t.w, h: t.h, rx: t.rx };
    applyPanelSpec(panelShown);
    if (!near) {
      panelRaf = requestAnimationFrame(panelTick);
    } else if (!panelOpen) {
      /* 收回到齿轮大小后彻底移除这个孔（避免与齿轮自己的孔重复、也省一层蒙版） */
      hidePanelSpec();
      panelLive = false;
    }
  }

  function rectOf(id, rx) {
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height, rx: rx };
  }

  /* 齿轮孔洞的"当前几何"：直接用 FIXED 表里那个孔已经算好的 base，
     保证面板的收/开动画终点与齿轮自己的孔**逐像素重合**（另测一次 rect 会因悬停等状态而不同 → 收尾跳变） */
  function gearHoleRect() {
    const f = fixed['settings-btn'];
    const b = f && f.hole ? f.hole.base : null;
    if (b) return { x: b.x, y: b.y, w: b.w, h: b.h, rx: b.rx };
    return rectOf('settings-btn', 19);
  }

  /* 打开/收起：孔洞几何由 .drawer 自身的 rect 决定（面板就画在下表面，位置随视口变化） */
  function setPanel(open) {
    panelOpen = !!open;
    if (panelOpen) {
      const to = rectOf('drawer', PANEL_RX);
      if (!to) return;
      if (!panelLive) {
        panelShown = gearHoleRect() || to; /* 从齿轮的孔开始长 */
        panelLive = true;
      }
      panelTarget = to;
      if (panelRaf === null) panelRaf = requestAnimationFrame(panelTick);
    } else {
      if (!panelLive) return;
      panelTarget = gearHoleRect() || panelShown;
      if (panelRaf === null) panelRaf = requestAnimationFrame(panelTick);
    }
  }

  /* 视口变化：展开状态下让孔洞直接跟上（不做补间） */
  function syncPanel() {
    if (!panelLive || !panelOpen || panelRaf !== null) return;
    const to = rectOf('drawer', PANEL_RX);
    if (!to) return;
    panelShown = { x: to.x, y: to.y, w: to.w, h: to.h, rx: to.rx };
    panelTarget = to;
    applyPanelSpec(panelShown);
  }

  EHP.holes = {
    schedule: schedule,
    engineJump: engineJump,
    setPanel: setPanel,
    syncTiles: syncTiles,
    setTileHover: setTileHover,
    setAddHover: setAddHover,
    applyLightSettings: applyLightSettings
  };
})();
