/* Explorer Home Page — 页面效果：鼠标跟随光晕 + 左侧图片展示面板
 * 光晕：rAF 循环 lerp 跟随；浅色主题 mix-blend-mode: multiply / 深色 screen，
 *       保证任何背景与颜色下可见（曾因低透明度浅色渐变不可见）。
 * 图片：canvas 高质量缩放（imageSmoothingQuality='high'，长边 2560 / JPEG 90%）；
 *       裁剪采用「焦点百分比定位」：background-size 按 cover×zoom 换算为 px，
 *       background-position 用 (fx, fy) 百分比——天然适配面板任意尺寸/宽度变化，
 *       面板与设置页预览框共用同一套布局函数。
 */
(function () {
  'use strict';

  const EHP = window.EHP;
  const KEY = EHP.storage.KEY;

  /* ---------- 鼠标光晕 ---------- */

  const glowEl = document.getElementById('glow');
  let glowSize = 700; /* 可由设置调整，applyGlow 时更新 */

  function clampNum(v, min, max, d) {
    v = Number(v);
    if (!isFinite(v)) v = d;
    return Math.min(max, Math.max(min, v));
  }
  let targetX = window.innerWidth / 2;
  let targetY = window.innerHeight / 2;
  let curX = targetX;
  let curY = targetY;
  let rafId = null;

  window.addEventListener('mousemove', function (e) {
    targetX = e.clientX;
    targetY = e.clientY;
  });

  function loop() {
    curX += (targetX - curX) * 0.14;
    curY += (targetY - curY) * 0.14;
    glowEl.style.transform = 'translate3d(' + (curX - glowSize / 2) + 'px,' +
      (curY - glowSize / 2) + 'px,0)';
    rafId = requestAnimationFrame(loop);
  }

  function applyGlow(g) {
    const enabled = !!(g && g.enabled);
    glowEl.hidden = !enabled;
    if (enabled) {
      glowSize = clampNum(g.size, 200, 1200, 700);
      glowEl.style.width = glowSize + 'px';
      glowEl.style.height = glowSize + 'px';
      glowEl.style.setProperty('--glow-o', clampNum(g.opacity, 0.1, 1, 0.5));
      glowEl.style.background = 'radial-gradient(circle, ' +
        (g.color || '#6366f1') + ' 0%, transparent 62%)';
      if (rafId === null) rafId = requestAnimationFrame(loop);
    } else if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  /* ---------- 左侧图片展示面板 ---------- */

  const panel = document.getElementById('image-panel');
  let crop = { fx: 0.5, fy: 0.5, zoom: 1, iw: 0, ih: 0 };

  /* 通用：按裁剪参数布局任一容器（面板 / 预览框共用） */
  function bgLayout(el, c, cw, ch) {
    if (!c || !c.iw || !c.ih || !cw || !ch) {
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      return;
    }
    const cover = Math.max(cw / c.iw, ch / c.ih);
    const s = cover * (c.zoom || 1);
    el.style.backgroundSize = Math.round(c.iw * s) + 'px ' + Math.round(c.ih * s) + 'px';
    el.style.backgroundPosition = (c.fx * 100) + '% ' + (c.fy * 100) + '%';
  }

  function layoutPanel() {
    if (!document.body.classList.contains('has-image')) return;
    bgLayout(panel, crop, panel.offsetWidth, panel.offsetHeight);
  }

  window.addEventListener('resize', layoutPanel);

  function setWidthVar(pct) {
    document.documentElement.style.setProperty('--img-w', pct + 'vw');
  }

  async function applyImage(enabled, c, widthPct) {
    if (widthPct) setWidthVar(widthPct);
    if (c) crop = c;
    const src = enabled ? ((await EHP.storage.get(KEY.bgImage, '')) || '') : '';
    panel.style.backgroundImage = src ? 'url("' + src + '")' : '';
    document.body.classList.toggle('has-image', !!(enabled && src));
    requestAnimationFrame(layoutPanel);
  }

  /* 宽度滑杆实时拖动：只改变量并重算布局，不重复读取图片 */
  function setWidth(pct) {
    setWidthVar(pct);
    requestAnimationFrame(layoutPanel);
  }

  /* 裁剪交互中：同步面板布局 */
  function relayout(c) {
    if (c) crop = c;
    layoutPanel();
  }

  /* 本地图片 → 高质量压缩 dataURL（高质量平滑防止大图缩小模糊） */
  function processImage(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const img = new Image();
        img.onload = function () {
          const MAX = 2560;
          const iw = img.naturalWidth;
          const ih = img.naturalHeight;
          const scale = Math.min(1, MAX / Math.max(iw, ih));
          const w = Math.max(1, Math.round(iw * scale));
          const h = Math.max(1, Math.round(ih * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.9), iw: w, ih: h });
        };
        img.onerror = function () { reject(new Error('无法解析图片')); };
        img.src = reader.result;
      };
      reader.onerror = function () { reject(new Error('无法读取文件')); };
      reader.readAsDataURL(file);
    });
  }

  async function setImage(file) {
    const r = await processImage(file);
    await EHP.storage.set(KEY.bgImage, r.dataUrl);
    return { iw: r.iw, ih: r.ih }; /* 供调用方初始化裁剪参数 */
  }

  async function removeImage() {
    await EHP.storage.set(KEY.bgImage, '');
    panel.style.backgroundImage = '';
    document.body.classList.remove('has-image');
  }

  EHP.effects = {
    applyGlow: applyGlow,
    applyImage: applyImage,
    setWidth: setWidth,
    relayout: relayout,
    bgLayout: bgLayout,
    setImage: setImage,
    removeImage: removeImage
  };
})();
