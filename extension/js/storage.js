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
    settings: 'settings',      // { wordmark, theme, accent, glow, imageEnabled } 外观设置
    bgImage: 'bgImage'         // 展示图片 dataURL（压缩后；不随导出）
  };

  const HISTORY_CAP = 1000;   // 最多保留 1000 条搜索历史
  const ICON_CACHE_CAP = 150; // 图标缓存最多 150 个域名

  const DEFAULT_SETTINGS = {
    wordmark: 'EXPLORER HOME', // 签名文字，空字符串则隐藏
    theme: 'light',            // 'light' | 'dark'
    accent: '#6366f1',         // 强调色（#rrggbb）
    glow: { enabled: false, color: '#6366f1' }, // 鼠标光晕
    imageEnabled: false,       // 左侧图片展示
    imageWidth: 33,            // 展示区域宽度（vw 百分比，15–50）
    imageCrop: { fx: 0.5, fy: 0.5, zoom: 1, iw: 0, ih: 0 } // 裁剪：焦点(0-1)+缩放(1-3)+原图尺寸
  };

  /* 防御性清洗：兼容历史遗留/导入数据 */
  function sanitizeSettings(s) {
    s = s && typeof s === 'object' ? s : {};
    const g = s.glow && typeof s.glow === 'object' ? s.glow : {};
    const c = s.imageCrop && typeof s.imageCrop === 'object' ? s.imageCrop : {};
    const num = function (v, d) { return typeof v === 'number' && isFinite(v) ? v : d; };
    return {
      wordmark: typeof s.wordmark === 'string' ? s.wordmark.slice(0, 30) : DEFAULT_SETTINGS.wordmark,
      theme: s.theme === 'dark' ? 'dark' : 'light',
      accent: /^#[0-9a-f]{6}$/i.test(s.accent) ? s.accent : DEFAULT_SETTINGS.accent,
      glow: {
        enabled: !!g.enabled,
        color: /^#[0-9a-f]{6}$/i.test(g.color) ? g.color : DEFAULT_SETTINGS.glow.color
      },
      imageEnabled: !!s.imageEnabled,
      imageWidth: Math.min(50, Math.max(15, Math.round(num(s.imageWidth, 33)))),
      imageCrop: {
        fx: Math.min(1, Math.max(0, num(c.fx, 0.5))),
        fy: Math.min(1, Math.max(0, num(c.fy, 0.5))),
        zoom: Math.min(3, Math.max(1, num(c.zoom, 1))),
        iw: Math.max(0, Math.round(num(c.iw, 0))),
        ih: Math.max(0, Math.round(num(c.ih, 0)))
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
