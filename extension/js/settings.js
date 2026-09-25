/* Explorer Home Page — 设置抽屉：上下表面背景色 / 签名 / 提示语 / 光照 / 数据管理
 * 配色由 JS 注入 --sheet-bg（上表面粗布色）与 --ground-bg；界面明暗（data-tone）按**下表面**颜色的
 * 明度自动切换，上表面文字（data-sheet-tone）按**上表面**颜色的明度切换 —— 所以任意背景色下都读得清；
 * 光照参数全部交给 holes.js 按物理几何推导（圆盘光源直径 / 光源高度 / 层间距 / 环境光等）。
 */
(function () {
  'use strict';

  const EHP = window.EHP;
  const KEY = EHP.storage.KEY;

  const drawer = document.getElementById('drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  const settingsBtn = document.getElementById('settings-btn');
  const sheetColorInput = document.getElementById('sheet-color');
  const groundBgInput = document.getElementById('ground-bg');
  const wordmarkInput = document.getElementById('wordmark-input');
  const wordmarkEl = document.getElementById('wordmark');
  const placeholderInput = document.getElementById('placeholder-input');
  const searchInput = document.getElementById('search-input');
  const lightColor = document.getElementById('light-color');
  const lightDiameter = document.getElementById('light-diameter');
  const lightDiameterVal = document.getElementById('light-diameter-val');
  const lightIntensity = document.getElementById('light-intensity');
  const lightIntensityVal = document.getElementById('light-intensity-val');
  const lightHeight = document.getElementById('light-height');
  const lightHeightVal = document.getElementById('light-height-val');
  const lightGap = document.getElementById('light-gap');
  const lightGapVal = document.getElementById('light-gap-val');
  const lightAmbient = document.getElementById('light-ambient');
  const lightAmbientVal = document.getElementById('light-ambient-val');
  const btnExport = document.getElementById('btn-export');
  const btnImport = document.getElementById('btn-import');
  const btnClear = document.getElementById('btn-clear-history');
  const fileInput = document.getElementById('import-file');

  let settings = EHP.storage.DEFAULT_SETTINGS;
  let toastTimer = null;
  let wordmarkTimer = null;
  let placeholderTimer = null;
  let lightSaveTimer = null;

  /* ---------- 应用到页面 ---------- */

  /* 相对亮度（sRGB → 线性，WCAG 公式）：用来判断某个背景色该配深字还是浅字 */
  function hexLum(hex) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return 1;
    const lin = function (i) {
      const v = parseInt(m[i], 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(1) + 0.7152 * lin(2) + 0.0722 * lin(3);
  }

  /* 背景色 + 自动明暗：
     · 界面（设置面板/搜索框/角标/齿轮/浮层）画在下表面 → 明暗取**下表面**颜色
     · 签名/名称/引擎边框画在上表面 → 明暗取**上表面**颜色 */
  function applyAppearance() {
    const root = document.documentElement;
    root.style.setProperty('--ground-bg', settings.groundBg);
    root.style.setProperty('--sheet-bg', settings.sheetColor);
    root.dataset.tone = hexLum(settings.groundBg) < 0.2 ? 'dark' : 'light';
    root.dataset.sheetTone = hexLum(settings.sheetColor) < 0.2 ? 'dark' : 'light';
  }

  function applyWordmark() {
    const text = (settings.wordmark || '').trim();
    wordmarkEl.textContent = text;
    wordmarkEl.hidden = !text;
    /* 签名显隐会移动控件位置，孔位/透光区需跟随 */
    if (EHP.holes) EHP.holes.schedule();
  }

  function applyPlaceholder() {
    const text = (settings.placeholder || '').trim();
    searchInput.placeholder = text || EHP.storage.DEFAULT_SETTINGS.placeholder;
  }

  /* 光照：一切由物理几何推导（圆盘剖面 / 半影宽度），此处只把参数推给 holes.js */
  function applyLight() {
    EHP.holes.applyLightSettings(settings.light);
  }

  /* 关于区的版本号：从 manifest 读，**不要**在 HTML 里写死——v2.0.0 发版时就漏改过一次
     （页面里还写着 v1.3.0）。HTML 里 `#about-version` 的文本只是兜底，
     用于非扩展环境（直接用浏览器打开 newtab.html）时仍能显示一个版本号。 */
  function applyVersion() {
    const el = document.getElementById('about-version');
    if (!el || !window.chrome || !chrome.runtime || !chrome.runtime.getManifest) return;
    try {
      const v = chrome.runtime.getManifest().version;
      if (v) el.textContent = 'v' + v;
    } catch (e) { /* 忽略：保留 HTML 里的兜底文本 */ }
  }

  function applyAll() {
    applyAppearance();
    applyWordmark();
    applyPlaceholder();
    applyVersion();
    applyLight();
  }

  async function save() {
    await EHP.storage.set(KEY.settings, settings);
  }

  /* ---------- 抽屉开合 ---------- */

  function openDrawer() {
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    backdrop.hidden = false;
    /* 开合动画 = 齿轮孔洞长成整页高的大圆角矩形（面板本身不动） */
    if (EHP.holes) EHP.holes.setPanel(true);
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    backdrop.hidden = true;
    if (EHP.holes) EHP.holes.setPanel(false);
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

  function syncLightLabels() {
    const L = settings.light;
    lightDiameterVal.textContent = L.diameter + 'px';
    lightIntensityVal.textContent = Math.round(L.intensity * 100) + '%';
    lightHeightVal.textContent = String(L.height);
    lightGapVal.textContent = String(L.gap);
    lightAmbientVal.textContent = L.ambient + '%';
  }

  function saveLightDebounced() {
    clearTimeout(lightSaveTimer);
    lightSaveTimer = setTimeout(save, 400);
  }

  function bind() {
    /* 齿轮是唯一的开/关按钮：展开状态下再点一次即收回 */
    settingsBtn.addEventListener('click', function () {
      if (drawer.classList.contains('open')) closeDrawer();
      else openDrawer();
    });
    backdrop.addEventListener('mousedown', closeDrawer);

    /* 上下表面配色：即时生效（文字明暗自动跟随），防抖写盘 */
    sheetColorInput.addEventListener('input', function () {
      settings.sheetColor = sheetColorInput.value;
      applyAppearance();
      saveLightDebounced();
    });

    groundBgInput.addEventListener('input', function () {
      settings.groundBg = groundBgInput.value;
      applyAppearance();
      saveLightDebounced();
    });

    /* 签名 / 提示语：即时预览，防抖写盘 */
    wordmarkInput.addEventListener('input', function () {
      settings.wordmark = wordmarkInput.value;
      applyWordmark();
      clearTimeout(wordmarkTimer);
      wordmarkTimer = setTimeout(save, 300);
    });

    placeholderInput.addEventListener('input', function () {
      settings.placeholder = placeholderInput.value;
      applyPlaceholder();
      clearTimeout(placeholderTimer);
      placeholderTimer = setTimeout(save, 300);
    });

    /* 光照：光色 / 光源直径 / 光源强度 / 光源高度 / 层间距 / 环境光 —— 全部即时生效 */
    lightColor.addEventListener('input', function () {
      settings.light.color = lightColor.value;
      applyLight();
      saveLightDebounced();
    });

    lightDiameter.addEventListener('input', function () {
      settings.light.diameter = Number(lightDiameter.value);
      syncLightLabels();
      applyLight();
      saveLightDebounced();
    });

    lightIntensity.addEventListener('input', function () {
      settings.light.intensity = Number(lightIntensity.value) / 100;
      syncLightLabels();
      applyLight();
      saveLightDebounced();
    });

    lightHeight.addEventListener('input', function () {
      settings.light.height = Number(lightHeight.value);
      syncLightLabels();
      applyLight();
      saveLightDebounced();
    });

    lightGap.addEventListener('input', function () {
      settings.light.gap = Number(lightGap.value);
      syncLightLabels();
      applyLight();
      saveLightDebounced();
    });

    lightAmbient.addEventListener('input', function () {
      settings.light.ambient = Number(lightAmbient.value);
      syncLightLabels();
      applyLight();
      saveLightDebounced();
    });

    bindDataActions();
  }


  async function init() {
    settings = EHP.storage.sanitizeSettings(await EHP.storage.get(KEY.settings, {}));
    applyAll();
    bind();
    sheetColorInput.value = settings.sheetColor;
    groundBgInput.value = settings.groundBg;
    wordmarkInput.value = settings.wordmark;
    placeholderInput.value = settings.placeholder;
    lightColor.value = settings.light.color;
    lightDiameter.value = settings.light.diameter;
    lightIntensity.value = Math.round(settings.light.intensity * 100);
    lightHeight.value = settings.light.height;
    lightGap.value = settings.light.gap;
    lightAmbient.value = settings.light.ambient;
    syncLightLabels();
  }

  EHP.settings = { init: init, close: closeDrawer };
})();
