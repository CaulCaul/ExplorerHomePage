# AGENTS.md — 面向 LLM 助手的项目上下文

> 本文件帮助后续会话中的 LLM 快速接手本项目。请先通读再动手；
> 与「关键决策」冲突的建议，除非用户明确要求，否则不要擅自推翻。

## 项目使命

为用户（Windows + Edge）做一个**离线优先**的新标签页主页扩展：
断网时主页必须能完整加载；联网时提供搜索联想、网站图标等增强。
用户痛点：Edge 默认主页依赖网络，网络差时主页本身加载失败。

## 用户偏好

- 全程使用**中文**交流与撰写文档；
- 原型优先：先保证功能可用，审美与细节后续迭代（当前处于 M1 阶段）；
- 用户**不熟悉浏览器扩展的开发/安装流程**——README 中的安装与使用教学必须与实际功能保持同步更新；
- 数据隐私敏感：所有个人数据只存本机，不做任何账号/云端功能（用户已明确放弃账号同步方案）。

## 关键决策（含理由，勿轻易推翻）

| 决策 | 理由 |
| --- | --- |
| Edge MV3 扩展，`chrome_url_overrides.newtab` 接管新标签页 | 纯本地 HTML 无法接管新标签页且有 CORS 限制；扩展可用 host_permissions 跨域请求联想接口 |
| 零构建、零依赖，原生 JS/CSS | 仓库即扩展源码，`git pull` + 扩展页「重新加载」即完成更新 |
| 数据存 `chrome.storage.local`，仓库 `data/` 仅放导出的 JSON 备份（已 gitignore） | 浏览器级持久化比仓库内文件更稳；克隆仓库者得到全新主页（用户的核心诉求） |
| 网络探测用 HTTP 探针轮询，不用 `navigator.onLine` | onLine 只反映网卡连接，会出现「连着路由器但断网」的误报 |
| 联想接口降级链：选中引擎 → 备用引擎 → 仅本地历史 | 联想 API 均为非官方接口，且 Google 端点在国内可能不可达 |
| 图标策略：DDG 图标服务 → Google s2 → 首字母色块；抓到后以 dataURL 缓存 | 保证断网时图标仍可显示 |
| 右下角双通道网络角标：国内（msft/baidu/bing）与国外（google generate_204 / gstatic）分行探测 | 用户需要分别了解国内外可达性；国外以 Google 可达性为准，直接服务 Bing/Google 引擎选择 |
| 浅色为默认主题，深色可选；强调色与签名在设置页配置，通过 CSS 变量注入（--accent 用 color-mix 派生） | 用户反馈深色背景下部分网站图标看不清 |
| 图片展示为左侧 33vw 固定面板（body.has-image 时内容右移居中），本地图片经 canvas 压缩（长边 1920 / JPEG 85%）存独立 bgImage 键 | chrome.storage.local 有 10MB 上限且导出备份不应含图片；分区展示避免整页背景图被内容遮挡（用户明确不要整页背景） |
| 光晕用单个 rAF 循环对鼠标位置 lerp 插值渲染，随开关启停 | 流畅跟随且关闭时零开销 |

## 文件地图

```
README.md                 面向用户：功能/安装/使用/FAQ（教学文档，保持同步）
AGENTS.md                 本文件
.gitignore                排除 data/*（保留 .gitkeep）与系统杂项
data/                     用户导出的 JSON 备份（gitignore，仓库里只有 .gitkeep）
tools/make-icons.ps1      重新生成扩展工具栏图标（System.Drawing，一次性工具）
extension/                ★ 扩展根目录（安装时「加载解压缩的扩展」选择的就是它）
  manifest.json           MV3 清单：newtab 接管 + storage 权限 + host_permissions
  newtab.html             页面结构（注意：CSP 禁止内联 script/事件属性）
  newtab.css              全部样式（浅色默认/深色可选双主题，CSS 变量见 :root）
  icons/icon16|48|128.png 工具栏图标
  js/storage.js           存储层：默认值/读写/历史记录/导入导出（模块命名空间 window.EHP）
  js/net.js               网络探测：国内/国外双通道，多探针轮换、延迟分级、右下角单气泡双行角标
  js/search.js            搜索：引擎切换/在线联想/本地历史候选/键盘导航
  js/shortcuts.js         快捷方式：渲染/增删改弹窗/拖拽排序/favicon 抓取缓存
  js/effects.js           页面效果：鼠标跟随光晕（rAF lerp）+ 左侧图片展示面板（canvas 压缩存储）
  js/settings.js          设置抽屉：主题/强调色/签名/光晕/图片 + 数据导入导出/清空历史
  js/main.js              启动接线：ensureDefaults → settings（先应用主题）→ 各模块 init → 快捷键
```

脚本加载顺序（defer，共享 `window.EHP` 命名空间）：storage → net → search → shortcuts → effects → settings → main。

## 存储 Schema（chrome.storage.local）

| 键 | 结构 | 说明 |
| --- | --- | --- |
| `engine` | `'bing' \| 'google'` | 当前搜索引擎 |
| `shortcuts` | `[{ id, title, url }]` | url 一定是带 http(s):// 的绝对地址 |
| `searchHistory` | `[{ q, engine, ts }]` | 新→旧，上限 1000，相同关键词去重置顶 |
| `iconCache` | `{ domain: dataURL }` | favicon 缓存，上限 150，FIFO 淘汰 |
| `settings` | `{ wordmark, theme, accent, glow: { enabled, color }, imageEnabled }` | 外观设置；sanitizeSettings 清洗，settings.js 注入 CSS 变量 |
| `bgImage` | `dataURL`（JPEG） | 展示图片，压缩后存储；**不随导出/导入**，换机需重选 |

首次运行由 `ensureDefaults()` 懒初始化（无 background service worker，刻意保持零后台）。

## 外部端点（均为非官方，须保持降级容错）

| 用途 | 端点 | 失败行为 |
| --- | --- | --- |
| 联想-Google | `https://suggestqueries.google.com/complete/search?client=chrome&q=` | 换备用引擎再试，最终退到本地历史 |
| 联想-Bing | `https://api.bing.com/osjson.aspx?query=` | 同上 |
| 网络探针-国内 | msftconnecttest / baidu favicon / bing favicon | 轮换尝试，连续 2 次全失败才判离线 |
| 网络探针-国外 | google generate_204 / gstatic generate_204 | 同上；全失败显示「不可达」 |
| favicon | `https://icons.duckduckgo.com/ip3/{domain}.ico` → `https://www.google.com/s2/favicons?domain=` | 首字母色块兜底 |

## 已知坑（改代码前必读）

1. **MV3 CSP 禁止内联脚本与内联事件属性**（`onclick=`、`<script>...</script>` 都不行），所有监听必须 `addEventListener`；
2. 联想 API 返回的是**不可信字符串**，注入 DOM 一律用 `textContent`，严禁 innerHTML 拼接用户/接口数据（静态 SVG 图标字符串除外）；
3. 联想响应可能声明错误 charset，统一用 `TextDecoder('utf-8')` 手动解码，避免中文乱码；
4. 搜索跳转前必须 `await` 历史写入完成（`location.href` 赋值后页面可能被销毁）；
5. favicon 小于 64 字节视为占位图，直接走兜底；
6. 重新加载扩展必须从**同一路径**加载，否则 extension id 变化会导致存储「丢失」；
7. `color-mix()` 与 `:root[data-theme]` 变量切换依赖较新 Chromium（Edge 111+），当前目标环境可接受；
8. 主题/强调色必须在 boot 最早阶段应用（`settings.init` 先于渲染模块执行），避免加载闪色；
9. HTML5 拖拽排序不支持触屏（桌面 Edge 是主场景，可接受）；磁贴内链接/图片需 `-webkit-user-drag: none` 防止拖出链接；
10. 本地图片必须先 canvas 压缩再写入存储（长边 1920/JPEG 85%），否则可能撑爆 chrome.storage.local 配额。

## 开发调试循环

1. 修改 `extension/` 下文件；
2. `edge://extensions` → 卡片 ↻ 重新加载；
3. `Ctrl+T` 验证（新标签页上 `F12` 可调试）；
4. 语法自检（可选）：`node --check extension/js/*.js`。

## 当前状态与路线图

- **M1**：双引擎搜索 + 在线/历史候选、快捷方式增删改 + 图标缓存、导出/导入、安装教学——已实现并交付；
- **M2（进行中）**：已完成双通道角标（合并为单气泡双行：圆点+地域+延迟）、设置抽屉（主题/强调色/签名/光晕/图片/数据管理）、浅色默认主题、快捷方式拖拽排序、鼠标光晕、左侧图片展示面板；剩余：候选关键词高亮、可配置探针间隔/历史上限；
- M3（候选）：跨设备同步（`chrome.storage.sync` 先做 spike，或轻量自托管后端）——用户已明确当前不需要账号体系。

## 变更习惯

- 完成改动后：同步更新 README（面向用户）与本文件（面向 LLM）中受影响的部分；
- 不要提交 `data/` 下的用户备份；不要引入构建工具/框架依赖；
- 提交信息使用中文。
