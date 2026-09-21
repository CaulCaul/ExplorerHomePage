/* Explorer Home Page — 网络状态探测（国内/国外双通道）与右下角角标
 * 国内通道：msftconnecttest → baidu → bing 轮换（均为国内可达端点）。
 * 国外通道：仅 www.google.com 同域端点（generate_204 → favicon）。
 *   不用 gstatic 等其他 Google 域名——它们在国内部分网络可达，
 *   但不代表 Google 主站/搜索可用，会造成误报（用户实测反馈）。
 * 策略：HTTP 探针轮询（不用 navigator.onLine，它只反映网卡状态）；
 *       一轮内全部探针失败即显示离线（轮完所有端点本身就是去抖），
 *       恢复显示则仍以一次成功探针为准。
 */
(function () {
  'use strict';

  const EHP = window.EHP;

  const DOMESTIC = [
    { url: 'http://www.msftconnecttest.com/connecttest.txt', label: 'msftconnecttest' },
    { url: 'https://www.baidu.com/favicon.ico', label: 'baidu' },
    { url: 'https://www.bing.com/favicon.ico', label: 'bing' }
  ];
  const FOREIGN = [
    { url: 'https://www.google.com/generate_204', label: 'google' },
    { url: 'https://www.google.com/favicon.ico', label: 'google-favicon' }
  ];

  const POLL_MS = 8000;    // 轮询间隔
  const TIMEOUT_MS = 2000; // 单次探测超时

  const COLORS = {
    good: 'var(--good)',
    fair: 'var(--fair)',
    poor: 'var(--poor)',
    offline: 'var(--offline)',
    unknown: 'var(--text-dim)'
  };

  function fmt(ms) {
    return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms';
  }

  function levelFromLatency(ms) {
    if (ms < 300) return 'good';
    if (ms < 1200) return 'fair';
    return 'poor';
  }

  /* 通用监视器：探针轮换 + 角标 UI 更新 */
  function createMonitor(probes, rowEl, dotEl, textEl, textOf) {
    let preferred = 0;   // 上次成功的探针下标
    let checking = false;

    function update(level, latency) {
      const color = COLORS[level];
      if (color) {
        dotEl.style.background = color;
        dotEl.style.boxShadow = '0 0 6px ' + color;
      }
      textEl.textContent = textOf(level, latency);
      rowEl.title = '探测点：' + probes[preferred].label + '（点击重新检测）';
    }

    async function probe(url) {
      const ctrl = new AbortController();
      const timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
      const t0 = performance.now();
      try {
        const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
        if (res.status !== 204 && !res.ok) throw new Error('HTTP ' + res.status);
        return Math.round(performance.now() - t0);
      } finally {
        clearTimeout(timer);
      }
    }

    async function check() {
      if (checking) return;
      checking = true;
      try {
        let latency = null;
        let hit = -1;
        const order = [preferred].concat(
          probes.map(function (_, i) { return i; })
            .filter(function (i) { return i !== preferred; })
        );
        for (let k = 0; k < order.length; k++) {
          const i = order[k];
          try {
            latency = await probe(probes[i].url);
            hit = i;
            break;
          } catch (e) { /* 换下一个探针 */ }
        }
        if (hit >= 0) {
          preferred = hit;
          update(levelFromLatency(latency), latency);
        } else {
          /* 一轮内已尝试全部探针均失败 → 立即判定离线/不可达 */
          update('offline', null);
        }
      } finally {
        checking = false;
      }
    }

    function reset() {
      update('unknown', null);
    }

    function offlineNow() {
      update('offline', null);
    }

    return { check: check, reset: reset, offlineNow: offlineNow };
  }

  const domestic = createMonitor(
    DOMESTIC,
    document.getElementById('net-domestic'),
    document.getElementById('net-dot-domestic'),
    document.getElementById('net-text-domestic'),
    function (level, latency) {
      if (level === 'offline') return '离线';
      if (level === 'unknown') return '检测中…';
      return fmt(latency);
    }
  );

  const foreign = createMonitor(
    FOREIGN,
    document.getElementById('net-foreign'),
    document.getElementById('net-dot-foreign'),
    document.getElementById('net-text-foreign'),
    function (level, latency) {
      if (level === 'offline') return '不可达';
      if (level === 'unknown') return '检测中…';
      return fmt(latency);
    }
  );

  function start() {
    domestic.reset();
    foreign.reset();
    domestic.check();
    foreign.check();

    setInterval(function () {
      if (document.visibilityState === 'visible') {
        domestic.check();
        foreign.check();
      }
    }, POLL_MS);

    window.addEventListener('online', function () {
      domestic.reset();
      foreign.reset();
      domestic.check();
      foreign.check();
    });
    /* 网卡断开：无需等探针超时，直接显示离线 */
    window.addEventListener('offline', function () {
      domestic.offlineNow();
      foreign.offlineNow();
    });

    document.getElementById('net-domestic').addEventListener('click', function () {
      domestic.reset();
      domestic.check();
    });
    document.getElementById('net-foreign').addEventListener('click', function () {
      foreign.reset();
      foreign.check();
    });
  }

  EHP.net = { start: start };
})();
