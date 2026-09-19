/* Explorer Home Page — 设置抽屉：主题 / 强调色 / 签名 / 光晕 / 图片展示 / 数据管理
 * 主题通过 :root[data-theme] 变量切换（默认浅色）；
 * 强调色由 JS 注入 --accent-strong / --accent（后者用 color-mix 派生浅色）。
 */
(function () {
  'use strict';

  const EHP = window.EHP;
  const KEY = EHP.storage.KEY;

  const ACCENTS = [
    { color: '#6366f1', name: '靛蓝' },
    { color: '#2563eb', name: '湛蓝' },
    { color: '#0d9488', name: '青碧' },
    { color: '#16a34a', name: '森绿' },
    { color: '#ea580c', name: '暖橙' },
    { color: '#e11d48', name: '玫红' }
  ];

  const drawer = document.getElementById('drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  const settingsBtn = document.getElementById('settings-btn');
  const closeBtn = document.getElementById('drawer-close');
  const themeSwitch = document.getElementById('theme-switch');
  const swatchWrap = document.getElementById('accent-swatches');
  const wordmarkInput = document.getElementById('wordmark-input');
  const wordmarkEl = document.getElementById('wordmark');
  const glowToggle = document.getElementById('glow-toggle');
  const glowColor = document.getElementById('glow-color');
  const imageToggle = document.getElementById('image-toggle');
  const btnPickImage = document.getElementById('btn-pick-image');
  const btnRemoveImage = document.getElementById('btn-remove-image');
  const imageFile = document.getElementById('image-file');
  const btnExport = document.getElementById('btn-export');
  const btnImport = document.getElementById('btn-import');
  const btnClear = document.getElementById('btn-clear-history');
  const fileInput = document.getElementById('import-file');

  let settings = EHP.storage.DEFAULT_SETTINGS;
  let toastTimer = null;
  let wordmarkTimer = null;
  let glowColorTimer = null;

  /* ---------- 应用到页面 ---------- */

  function applyTheme() {
    document.documentElement.dataset.theme = settings.theme;
  }

  function applyAccent() {
    const root = document.documentElement.style;
    root.setProperty('--accent-strong', settings.accent);
    root.setProperty('--accent', 'color-mix(in srgb, ' + settings.accent + ' 65%, white)');
  }

  function applyWordmark() {
    const text = (settings.wordmark || '').trim();
    wordmarkEl.textContent = text;
    wordmarkEl.hidden = !text;
  }

  function applyAll() {
    applyTheme();
    applyAccent();
    applyWordmark();
  }

  async function save() {
    await EHP.storage.set(KEY.settings, settings);
  }

  /* ---------- 抽屉开合 ---------- */

  function openDrawer() {
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    backdrop.hidden = false;
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    backdrop.hidden = true;
  }

  /* ---------- Toast ---------- */

  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* ---------- 数据操作 ---------- */

  function backupName() {
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    return 'ehp-backup-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      '-' + p(d.getHours()) + p(d.getMinutes()) + '.json';
  }

  /* 危险操作二次确认：第一次点击变红提示，3 秒内再点执行 */
  function armConfirm(btn, label, fn) {
    let armed = false;
    let timer = null;
    btn.addEventListener('click', async function () {
      if (!armed) {
        armed = true;
        btn.classList.add('warn');
        btn.textContent = '再点一次确认';
        timer = setTimeout(function () {
          armed = false;
          btn.classList.remove('warn');
          btn.textContent = label;
        }, 3000);
        return;
      }
      clearTimeout(timer);
      armed = false;
      btn.classList.remove('warn');
      btn.textContent = label;
      try {
        await fn();
      } catch (err) {
        showToast('操作失败：' + (err && err.message ? err.message : err));
      }
    });
  }

  function bindDataActions() {
    btnExport.addEventListener('click', async function () {
      const data = await EHP.storage.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = backupName();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      showToast('已导出备份文件，可移动到仓库 data/ 目录保存');
    });

    armConfirm(btnImport, '导入数据', function () {
      fileInput.click();
    });

    fileInput.addEventListener('change', async function () {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        await EHP.storage.importData(obj);
        location.reload();
      } catch (err) {
        showToast('导入失败：' + (err && err.message ? err.message : '文件格式不正确'));
      }
    });

    armConfirm(btnClear, '清空历史', async function () {
      await EHP.storage.clearHistory();
      showToast('搜索历史已清空');
    });
  }

  /* ---------- 控件渲染与绑定 ---------- */

  function renderThemeSwitch() {
    Array.prototype.forEach.call(themeSwitch.querySelectorAll('button'), function (b) {
      b.classList.toggle('active', b.dataset.themeValue === settings.theme);
    });
  }

  function buildSwatches() {
    swatchWrap.textContent = '';
    ACCENTS.forEach(function (a) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (a.color.toLowerCase() === settings.accent.toLowerCase() ? ' active' : '');
      b.style.background = a.color;
      b.title = a.name;
      b.addEventListener('click', function () {
        settings.accent = a.color;
        save();
        applyAccent();
        Array.prototype.forEach.call(swatchWrap.children, function (el) {
          el.classList.remove('active');
        });
        b.classList.add('active');
      });
      swatchWrap.appendChild(b);
    });
  }

  function bind() {
    settingsBtn.addEventListener('click', openDrawer);
    closeBtn.addEventListener('click', closeDrawer);
    backdrop.addEventListener('mousedown', closeDrawer);

    themeSwitch.addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-theme-value]');
      if (!btn) return;
      settings.theme = btn.dataset.themeValue;
      save();
      applyTheme();
      renderThemeSwitch();
    });

    /* 签名输入：即时预览，防抖写盘 */
    wordmarkInput.addEventListener('input', function () {
      settings.wordmark = wordmarkInput.value;
      applyWordmark();
      clearTimeout(wordmarkTimer);
      wordmarkTimer = setTimeout(save, 300);
    });

    /* 鼠标光晕：开关 + 颜色 */
    glowToggle.addEventListener('change', function () {
      settings.glow.enabled = glowToggle.checked;
      save();
      EHP.effects.applyGlow(settings.glow);
    });

    glowColor.addEventListener('input', function () {
      settings.glow.color = glowColor.value;
      EHP.effects.applyGlow(settings.glow);
      clearTimeout(glowColorTimer);
      glowColorTimer = setTimeout(save, 300);
    });

    /* 图片展示：开关 + 选择/移除 */
    imageToggle.addEventListener('change', async function () {
      settings.imageEnabled = imageToggle.checked;
      await save();
      await EHP.effects.applyImage(settings.imageEnabled);
      if (settings.imageEnabled) {
        const src = await EHP.storage.get(KEY.bgImage, '');
        if (!src) imageFile.click(); /* 首次开启自动引导选图 */
      }
    });

    btnPickImage.addEventListener('click', function () {
      imageFile.click();
    });

    imageFile.addEventListener('change', async function () {
      const f = imageFile.files && imageFile.files[0];
      imageFile.value = '';
      if (!f) return;
      try {
        await EHP.effects.setImage(f);
        settings.imageEnabled = true;
        imageToggle.checked = true;
        await save();
        showToast('展示图片已更新');
      } catch (err) {
        showToast('图片处理失败：' + (err && err.message ? err.message : err));
      }
    });

    armConfirm(btnRemoveImage, '移除', async function () {
      await EHP.effects.removeImage();
      settings.imageEnabled = false;
      imageToggle.checked = false;
      await save();
      showToast('已移除展示图片');
    });

    bindDataActions();
  }

  async function init() {
    settings = EHP.storage.sanitizeSettings(await EHP.storage.get(KEY.settings, {}));
    applyAll();
    bind();
    renderThemeSwitch();
    buildSwatches();
    wordmarkInput.value = settings.wordmark;
    glowToggle.checked = settings.glow.enabled;
    glowColor.value = settings.glow.color;
    imageToggle.checked = settings.imageEnabled;
    EHP.effects.applyGlow(settings.glow);
    EHP.effects.applyImage(settings.imageEnabled);
  }

  EHP.settings = { init: init, close: closeDrawer };
})();
