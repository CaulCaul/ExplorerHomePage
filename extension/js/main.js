/* Explorer Home Page — 启动接线与全局快捷键 */
(function () {
  'use strict';

  const EHP = window.EHP;

  const input = document.getElementById('search-input');
  const overlay = document.getElementById('overlay');
  const drawer = document.getElementById('drawer');

  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        EHP.shortcuts.closeModal();
        EHP.settings.close();
        return;
      }
      if (e.key === '/' && overlay.hidden) {
        const active = document.activeElement;
        const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
        const drawerOpen = drawer.classList.contains('open');
        if (!isTyping && !drawerOpen) {
          e.preventDefault();
          input.focus();
        }
      }
    });
  }

  (async function boot() {
    await EHP.storage.ensureDefaults();
    await EHP.settings.init(); /* 先应用上下表面背景色/文字明暗/签名，避免加载闪色 */
    EHP.net.start();
    /* 先让各模块拿到存储里的状态（引擎、磁贴）再统一挖孔：
       否则会先按 HTML 默认状态挖一次孔，再"切换"到真实状态（开页时可见的多余动画） */
    await EHP.search.init();
    await EHP.shortcuts.init();
    bindKeys();
    input.focus();
    /* 壁孔跟随控件位置：启动后立即 + 延迟兜底（字体/图标加载可能引起布局微调） */
    EHP.holes.schedule();
    setTimeout(function () { EHP.holes.schedule(); }, 200);
  })();
})();
