/* Explorer Home Page — 页面效果：鼠标跟随光晕 + 左侧图片展示面板
 * 光晕：rAF 循环对鼠标位置做插值（lerp），产生柔和的拖尾跟随；
 * 图片：本地图片经 canvas 等比压缩（长边 1920 / JPEG 85%）后存为 dataURL，
 *       独立存储于 bgImage 键（不随导出，控制备份文件体积）。
 */
(function () {
  'use strict';

  const EHP = window.EHP;
  const KEY = EHP.storage.KEY;

  /* ---------- 鼠标光晕 ---------- */

  const glowEl = document.getElementById('glow');
  const GLOW_SIZE = 600;
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
    curX += (targetX - curX) * 0.12;
    curY += (targetY - curY) * 0.12;
    glowEl.style.transform = 'translate3d(' + (curX - GLOW_SIZE / 2) + 'px,' +
      (curY - GLOW_SIZE / 2) + 'px,0)';
    rafId = requestAnimationFrame(loop);
  }

  function applyGlow(g) {
    const enabled = !!(g && g.enabled);
    glowEl.hidden = !enabled;
    if (enabled) {
      glowEl.style.background = 'radial-gradient(circle, ' +
        (g.color || '#818cf8') + ' 0%, transparent 62%)';
      if (rafId === null) rafId = requestAnimationFrame(loop);
    } else if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  /* ---------- 左侧图片展示面板 ---------- */

  const panel = document.getElementById('image-panel');

  async function applyImage(enabled) {
    let src = '';
    if (enabled) src = await EHP.storage.get(KEY.bgImage, '') || '';
    panel.style.backgroundImage = src ? 'url("' + src + '")' : '';
    document.body.classList.toggle('has-image', !!(enabled && src));
  }

  /* 本地图片 → 压缩 dataURL（控制存储体积，chrome.storage.local 上限 10MB） */
  function processImage(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const img = new Image();
        img.onload = function () {
          const MAX = 1920;
          let w = img.naturalWidth;
          let h = img.naturalHeight;
          const scale = Math.min(1, MAX / Math.max(w, h));
          w = Math.round(w * scale);
          h = Math.round(h * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = function () { reject(new Error('无法解析图片')); };
        img.src = reader.result;
      };
      reader.onerror = function () { reject(new Error('无法读取文件')); };
      reader.readAsDataURL(file);
    });
  }

  async function setImage(file) {
    const dataUrl = await processImage(file);
    await EHP.storage.set(KEY.bgImage, dataUrl);
    await applyImage(true);
  }

  async function removeImage() {
    await EHP.storage.set(KEY.bgImage, '');
    await applyImage(false);
  }

  EHP.effects = {
    applyGlow: applyGlow,
    applyImage: applyImage,
    setImage: setImage,
    removeImage: removeImage
  };
})();
