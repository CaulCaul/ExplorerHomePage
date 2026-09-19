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
    await EHP.settings.init(); /* 先应用主题/强调色/签名，避免加载闪色 */
    EHP.net.start();
    EHP.search.init();
    EHP.shortcuts.init();
    bindKeys();
    input.focus();
  })();
})();
