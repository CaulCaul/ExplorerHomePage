/* Explorer Home Page — 本地存储层
 * 数据全部保存在 chrome.storage.local（浏览器本地），不联网、不同步。
 * Schema 见 AGENTS.md「存储 Schema」。
 */
(function () {
  'use strict';

  const EHP = (window.EHP = window.EHP || {});

  const KEY = {
    engine: 'engine',          // 'bing' | 'google'
    shortcuts: 'shortcuts',    // [{ id, title, url }]
    history: 'searchHistory',  // [{ q, engine, ts }] 新→旧
    iconCache: 'iconCache',    // { domain: dataURL }
    settings: 'settings'       // { wordmark, placeholder, sheetColor, groundBg, light } 外观与光影
  };

  const HISTORY_CAP = 1000;   // 最多保留 1000 条搜索历史
  const ICON_CACHE_CAP = 150; // 图标缓存最多 150 个域名

  const DEFAULT_SETTINGS = {
    wordmark: 'EXPLORER HOME', // 签名文字，空字符串则隐藏
    placeholder: 'What shall we explore?', // 搜索框提示语，空字符串恢复默认
    sheetColor: '#eef2f8',     // 上表面（粗布）颜色
    groundBg: '#eff3f9',       // 下表面背景色（透过孔洞看到的那一层）
    /* 光照：物理假设 = 一块平行于屏幕的均匀发光圆盘 + 微弱全局环境光
       color     光色（当作光谱逐通道相乘：越暗光越弱，纯黑 = 无直射光）
       diameter  圆盘直径(px, 200–1200)：决定受光剖面尺度与半影宽度
       intensity 光源强度(0.1–1)：直射光最多能补多少亮度
       height    光源到上表面的距离（世界单位，1–50，默认 10）
       gap       上下表面之间的距离（世界单位，0.1–5，默认 1）
       ambient   全局环境光(0–60%)：唯一决定亮度下限（看不到光源处 = 环境光） */
    light: {
      color: '#6366f1', diameter: 700, intensity: 0.5,
      height: 10, gap: 1, ambient: 30
    }
  };

  /* 防御性清洗：兼容历史遗留/导入数据（旧版 image* 丢弃，旧版 glow.* 迁移到 light.*） */
  function sanitizeSettings(s) {
    s = s && typeof s === 'object' ? s : {};
    const g = s.glow && typeof s.glow === 'object' ? s.glow : {};
    const l = s.light && typeof s.light === 'object' ? s.light : {};
    const D = DEFAULT_SETTINGS.light;
    const num = function (v, d) { return typeof v === 'number' && isFinite(v) ? v : d; };
    const hex = function (v, d) { return /^#[0-9a-f]{6}$/i.test(v) ? v : d; };
    const dark = s.theme === 'dark'; /* 旧版主题开关 → 迁移为深色配色 */
    /* 上表面颜色：旧版双色砖块统一取"颜色 1"，更旧的单一 sheetBg 直接用 */
    const legacySheet = hex(s.sheetColor, hex(s.sheetBg1, hex(s.sheetBg, dark ? '#161f3a' : DEFAULT_SETTINGS.sheetColor)));
    return {
      wordmark: typeof s.wordmark === 'string' ? s.wordmark.slice(0, 30) : DEFAULT_SETTINGS.wordmark,
      placeholder: typeof s.placeholder === 'string' ? s.placeholder.slice(0, 60) : DEFAULT_SETTINGS.placeholder,
      sheetColor: legacySheet,
      groundBg: hex(s.groundBg, dark ? '#0f172a' : DEFAULT_SETTINGS.groundBg),
      light: {
        color: hex(l.color, hex(g.color, D.color)),
        diameter: Math.min(1200, Math.max(200, Math.round(num(l.diameter, num(g.size, D.diameter))))),
        intensity: Math.min(1, Math.max(0.1, num(l.intensity, num(l.tint, num(g.opacity, D.intensity))))),
        height: Math.min(50, Math.max(1, num(l.height, D.height))),
        gap: Math.min(5, Math.max(0.1, num(l.gap, D.gap))),
        ambient: Math.min(60, Math.max(0, Math.round(num(l.ambient, D.ambient))))
      }
    };
  }

  const DEFAULT_SHORTCUTS = [
    { id: 'preset-bing', title: '必应', url: 'https://www.bing.com/' },
    { id: 'preset-google', title: 'Google', url: 'https://www.google.com/' },
    { id: 'preset-github', title: 'GitHub', url: 'https://github.com/' },
    { id: 'preset-bilibili', title: '哔哩哔哩', url: 'https://www.bilibili.com/' },
    { id: 'preset-zhihu', title: '知乎', url: 'https://www.zhihu.com/' },
    { id: 'preset-weibo', title: '微博', url: 'https://weibo.com/' }
  ];

  async function getAll() {
    return chrome.storage.local.get(null);
  }

  async function get(key, fallback) {
    const obj = await chrome.storage.local.get(key);
    return obj[key] !== undefined ? obj[key] : fallback;
  }

  async function set(key, value) {
    const patch = {};
    patch[key] = value;
    await chrome.storage.local.set(patch);
  }

  /* 首次运行懒初始化默认值；任何新设备克隆仓库后都是全新主页 */
  async function ensureDefaults() {
    const all = await getAll();
    const patch = {};
    if (all[KEY.shortcuts] === undefined) patch[KEY.shortcuts] = DEFAULT_SHORTCUTS;
    if (all[KEY.engine] === undefined) patch[KEY.engine] = 'bing';
    if (all[KEY.history] === undefined) patch[KEY.history] = [];
    if (all[KEY.iconCache] === undefined) patch[KEY.iconCache] = {};
    if (all[KEY.settings] === undefined) patch[KEY.settings] = DEFAULT_SETTINGS;
    if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  }

  /* 记录一次搜索：相同关键词去重后置顶 */
  async function recordSearch(q, engine) {
    q = (q || '').trim();
    if (!q) return;
    const list = await get(KEY.history, []);
    const idx = list.findIndex((h) => h.q === q);
    if (idx >= 0) list.splice(idx, 1);
    list.unshift({ q: q, engine: engine, ts: Date.now() });
    if (list.length > HISTORY_CAP) list.length = HISTORY_CAP;
    await set(KEY.history, list);
  }

  async function clearHistory() {
    await set(KEY.history, []);
  }

  async function exportData() {
    const all = await getAll();
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      engine: all[KEY.engine] || 'bing',
      shortcuts: all[KEY.shortcuts] || [],
      searchHistory: all[KEY.history] || [],
      settings: all[KEY.settings] || DEFAULT_SETTINGS
    };
  }

  /* 导入（覆盖式）：字段级校验与清洗，URL 重复的快捷方式去重 */
  async function importData(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error('备份文件不是有效的 JSON 对象');
    }
    const seen = new Set();
    const shortcuts = (Array.isArray(obj.shortcuts) ? obj.shortcuts : [])
      .filter(function (s) {
        return s && typeof s.title === 'string' && s.title.trim() &&
               typeof s.url === 'string' && /^[a-z][a-z0-9+.-]*:\/\//i.test(s.url);
      })
      .map(function (s, i) {
        return { id: typeof s.id === 'string' && s.id ? s.id : 'sc-' + i, title: s.title.trim(), url: s.url };
      })
      .filter(function (s) {
        const k = s.url.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    const history = (Array.isArray(obj.searchHistory) ? obj.searchHistory : [])
      .filter(function (h) {
        return h && typeof h.q === 'string' && h.q.trim();
      })
      .map(function (h) {
        return { q: h.q, engine: h.engine === 'google' ? 'google' : 'bing', ts: Number(h.ts) || Date.now() };
      })
      .slice(0, HISTORY_CAP);
    const settings = sanitizeSettings(obj.settings);
    await chrome.storage.local.set({
      shortcuts: shortcuts,
      searchHistory: history,
      engine: obj.engine === 'google' ? 'google' : 'bing',
      settings: settings
    });
  }

  EHP.storage = {
    KEY: KEY,
    HISTORY_CAP: HISTORY_CAP,
    ICON_CACHE_CAP: ICON_CACHE_CAP,
    DEFAULT_SHORTCUTS: DEFAULT_SHORTCUTS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    sanitizeSettings: sanitizeSettings,
    getAll: getAll,
    get: get,
    set: set,
    ensureDefaults: ensureDefaults,
    recordSearch: recordSearch,
    clearHistory: clearHistory,
    exportData: exportData,
    importData: importData
  };
})();
