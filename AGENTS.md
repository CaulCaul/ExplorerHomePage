# AGENTS.md — 面向 LLM 助手的项目上下文

> 本文件帮助后续会话中的 LLM 快速接手本项目。请先通读再动手；
> 与「关键决策」冲突的建议，除非用户明确要求，否则不要擅自推翻。

## 项目使命

为用户（Windows + Edge）做一个**浏览器主页扩展**（接管新标签页，离线优先）：
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
| **左下角**双通道网络角标：国内（msft/baidu/bing）与国外（仅 www.google.com 同域端点：generate_204 → favicon）分行探测；一轮内全部探针失败立即显示离线/不可达 | 用户需要分别了解国内外可达性；gstatic 在用户网络可达但 Google 主站不可达，曾造成「国外可达」误报（v1.0.1 移除）；新标签页每次从「检测中」开始，双轮去抖曾致断网时长时间停留「检测中」（v1.0.1 改单轮判定，超时 3s→2s）；v1.3.0 起从右下角移到左下角，把右侧整片让给设置面板 |
| **表面一律是单色平面，不做纹理**（v1.3.0 收尾决定）：上表面 = `settings.sheetColor` → `--sheet-bg`，下表面 = `settings.groundBg` → `--ground-bg`（`--ground-fill` 是它的材质渐变，设置面板复用同一份）；文字明暗按这两种颜色自动判定（`data-tone` / `data-sheet-tone`）。曾实现过整套「上表面贴图 + 法线 + ORM + WebGL 着色器 + 孔缘凹陷 + 砂纸 + 文字光晕」（`js/sheet.js`、`extension/textures/`），用户实测后认为**纹理破坏界面简洁性、不值得**，已整体回退并删除 | 用户明确要求「消除对纹理的支持，消除孔缘柔化」；材质感交给主题色本身，界面回到干净的单色平面 |
| **双层光影模型（v1.3.0，物理推导）**：无背景图、无光晕元素（#glow 已删，effects.js 已移除）。**物理假设**：光源 = 一块平行于屏幕的均匀发光圆盘（直径可调）+ 全局环境光；**环境光是唯一决定亮度下限与阴影深度的参数**（看不到光源处 = 环境光；遮挡阴影也恰好落在环境光上，没有独立的「阴影强度」参数）。层结构：下表面基底 #ground-base(0) < **控件**(1) < **下表面光照 #ground-lit + 遮挡阴影 #ground-shadow**(2，multiply) < **板材 #wall-layer**(3) < 签名/磁贴装饰(4) < **上表面光照 #sheet-lit**(5，multiply、被 #hole-mask 裁掉孔洞) < 候选下拉(6) —— ⚠ 控件必须在**下表面光照层之下**（否则阴影压到图标上图标还是亮的），签名/标题等上层元素必须在**上表面光照层之下**（否则完全不受光照影响）。**受光剖面**：`discProfile(d,h,R)` 数值积分圆盘辐照度 `∫dA/(ρ²+h²)²`、以正下方解析解 `πR²/(R²+h²)` 归一化（已验证 R/h→0 时收敛到点光源律 `h⁴/(d²+h²)²`），旋转对称 → 烘成 12 段径向渐变（上表面 h=H、下表面 h=H+g，**两者同一套逻辑**，只是下表面再乘两平面的绝对比 `groundScale`），只在设置/视口变化时重算。**光照一律是乘法**（`mix-blend-mode: multiply`）：**显示值 = 反射率 × 光照** —— 纯黑反照率（如 GitHub 的黑色图标）在再强的光下也保持黑色，光色只补它自己的通道（纯红光的阴影只抹掉红通道）。光照倍数 = 环境光 + (1 − 环境光) × 光源强度 × 光谱 × 可见比例，逐通道烘成三条渐变 `--sheet-light` / `--ground-light` / `--ground-shadow`；`encodeMul()` 把逐通道倍数编码成 `rgba(α, c)`（`α = 1 − min(m)`、`c = (m − min)/(1 − min)`，乘回去精确等于 m）。**遮挡阴影** = 环境光 ÷ 该点光照（把直射光那一份"除"掉）→ 阴影区恰好只剩环境光，纯黑光色时自动没有阴影（`--shade-alpha` 已删）。**孔洞投影**：孔按 `1+g/H` 放大、向背离光源方向偏移 `dist·g/H`，再按半影带宽 `R·g/H` 膨胀，`feGaussianBlur(σ=半影/2)` 柔化 —— 光源越大越柔、越高越锐、层间距越大越柔。**挖孔**：方案 A（孔 = 控件自身边界，`#hole-mask`），透光区几何集中在 `<g id="lit-patches">`，由 `#shadow-mask`（白底 + 黑透光区）以 `<use fill=currentColor>` 引用（`#lit-mask` 已随"加法着色"一起删除）。**引擎选择器**：两个引擎图标都画在下表面（z1 控件层），上表面只挖**一个可滑动的孔**（`#engine-switch[data-active]` 决定目标位置，rAF 插值 k=0.14≈0.4s），装饰层只画「与搜索框同高的外扩边框」；**孔与遮挡阴影必须用同一份几何一起走**（`applyEngineSpec`），首次加载用 `engineJump()` 直接落位；切换引擎后必须调 `EHP.holes.schedule()` | 用户提出的物理假设（圆盘光源 + 面积可见度决定光强 + 环境光托底；可调光源高度与层间距，默认 10/1）；随后用户要求「阴影强度」并入环境光、下表面与上表面同逻辑、图标需受光照影响，均已落地。背景图因妨碍双层结构呈现于 v1.3.0 移除（bgImage/imageCrop/imageEnabled/imageWidth 全废弃） |
| 引擎选择器在**搜索框左侧、与搜索框同高**：两个引擎图标渲染在下表面，上表面只挖一个可滑动的孔（透过孔看到的就是当前引擎），外扩边框的高度 = 搜索框高度（`F = (搜索框高 − 按钮高)/2`）；切换时**孔与它的遮挡阴影用同一份几何一起滑动**（`k = 0.14`，约 0.4s），首次加载由 `engineJump()` 直接落位不播动画 | 用户指定的形态：与搜索框并列成一行更紧凑、框与搜索框等高读作一组；阴影先跳到终点会"露出不该有的影子"，故两者必须同步；旧版的"未选中位置空心圆圈"与磁贴悬停上浮/放大均已按用户要求删除 |
| **设置面板 = 下表面上的面板 + 会长大的孔洞**：面板（`#drawer`）与其它控件同层（z1，被光照层乘到），收起时被板材完全遮住；点击齿轮由 `EHP.holes.setPanel(true)` 让**齿轮自己的孔洞**长成"与页面同高的大圆角矩形"（`PANEL_RX = 22` 必须与 `.drawer` 的 `border-radius` 一致），再点齿轮/点空白/Esc 收回（收回动画结束后把该孔收成 0）。**齿轮是唯一的开/关按钮**（面板内不再有叉号，`.drawer-head` 取 38px 高与齿轮对齐）；齿轮刻意排在面板之后的 DOM 里 —— 同为 z1 时后来者居上，故展开时它仍浮在面板之上可点；点击空白用的占位层 `#drawer-backdrop` 是**透明**的（不压暗板材，否则破坏"挖孔"观感），排在面板之前。**面板底色 = 下表面本身**（`--ground-fill`，与 `#ground-base` 同一份渐变且都 `background-attachment: fixed`），且必须不透明（压住同一层背后的磁贴/搜索框） | 用户要求"点击齿轮 → 齿轮对应的孔洞扩大成整页高的大圆角矩形孔洞，露出下表面的设置选项，再点收回"、"齿轮代替叉号承担全部开合"；用浅色蒙层当底色会把纯红的下表面洗成浅红（实测 bug），故直接复用下表面材质 |

## 文件地图

```
README.md                 面向用户：功能/安装/使用/FAQ（教学文档，保持同步）
AGENTS.md                 本文件
.gitignore                排除 data/*（保留 .gitkeep）与系统杂项
data/                     用户导出的 JSON 备份（gitignore，仓库里只有 .gitkeep）
tools/make-icons.ps1      重新生成扩展工具栏图标（System.Drawing，一次性工具）
extension/                ★ 扩展根目录（安装时「加载解压缩的扩展」选择的就是它）
  manifest.json           MV3 清单：newtab 接管 + storage 权限 + host_permissions
  newtab.html             页面结构（注意：CSP 禁止内联 script/事件属性）；`#wall-layer` 是空的单色板材（纹理层已回退删除）
  newtab.css              全部样式（CSS 变量见 :root；UI 明暗 = :root[data-tone='dark']，上表面文字 = :root[data-sheet-tone='dark']）
  icons/icon16|48|128.png 工具栏图标
  js/storage.js           存储层：默认值/读写/历史记录/导入导出（模块命名空间 window.EHP）
  js/net.js               网络探测：国内/国外双通道，多探针轮换、延迟分级、左下角单气泡双行角标
  js/search.js            搜索：引擎切换（搜索框左侧的独立图标行；切换后调 holes.schedule 让孔滑过去）/在线联想/本地历史候选/键盘导航
  js/shortcuts.js         快捷方式：渲染/增删改弹窗/拖拽排序/favicon 抓取缓存；对外暴露 `EHP.shortcuts.edit(id)` 供上层名称调用
  js/holes.js             挖孔/光照(multiply 三条渐变)/遮挡阴影/装饰/命中测试：按控件边界挖孔(#hole-mask)、透光区几何(#lit-patches → #shadow-mask)、encodeMul 逐通道乘法、引擎孔洞与滑动(.engine-frame)、磁贴名称(#tile-decor)、受光点与光照变量
  js/settings.js          设置面板（分区：外观/光照/数据/关于）：上表面颜色与下表面背景色（含自动明暗 hexLum）、签名/提示语、光照参数、数据导入导出/清空历史；开关面板时调 `EHP.holes.setPanel()`
  js/main.js              启动接线：ensureDefaults → settings（先应用背景色/文字明暗）→ **await search/shortcuts.init** → 统一挖孔 → 快捷键
```

脚本加载顺序（defer，共享 `window.EHP` 命名空间）：storage → net → search → shortcuts → holes → settings → main。

## 存储 Schema（chrome.storage.local）

| 键 | 结构 | 说明 |
| --- | --- | --- |
| `engine` | `'bing' \| 'google'` | 当前搜索引擎 |
| `shortcuts` | `[{ id, title, url }]` | url 一定是带 http(s):// 的绝对地址 |
| `searchHistory` | `[{ q, engine, ts }]` | 新→旧，上限 1000，相同关键词去重置顶 |
| `iconCache` | `{ domain: dataURL }` | favicon 缓存，上限 150，FIFO 淘汰 |
| `settings` | `{ wordmark, placeholder, sheetColor, groundBg, light: { color, diameter(200–1200px), intensity(0.1–1), height(1–50, 默认 10), gap(0.1–5, 默认 1), ambient(0–60, 默认 30) } }` | 外观与光影设置；`sheetColor` = 上表面颜色、`groundBg` = 下表面颜色（`#rrggbb`，文字明暗自动派生）；`intensity` = 光源标称强度（直射光最多能补多少亮度），`color` 当作**光谱**逐通道相乘（纯黑 ⇒ 无直射光）；sanitizeSettings 清洗并钳位（旧 **theme:'dark'** 与旧 **sheetBg / sheetBg1** 一律迁移到 sheetColor，旧 image*/accent 丢弃，旧 glow.color/size/opacity 与旧 light.tint **迁移**到 light.color/diameter/intensity，旧 light.shadow 丢弃），settings.js 调 `EHP.holes.applyLightSettings()` 生效 |

首次运行由 `ensureDefaults()` 懒初始化（无 background service worker，刻意保持零后台）。

## 外部端点（均为非官方，须保持降级容错）

| 用途 | 端点 | 失败行为 |
| --- | --- | --- |
| 联想-Google | `https://suggestqueries.google.com/complete/search?client=chrome&q=` | 换备用引擎再试，最终退到本地历史 |
| 联想-Bing | `https://api.bing.com/osjson.aspx?query=` | 同上 |
| 网络探针-国内 | msftconnecttest / baidu favicon / bing favicon | 轮换尝试，一轮全失败即「离线」 |
| 网络探针-国外 | www.google.com generate_204 / 同域 favicon.ico（**不用** gstatic 等其他 Google 域名） | 一轮全失败即「不可达」；gstatic 国内部分网络可达会造成误报 |
| favicon | `https://icons.duckduckgo.com/ip3/{domain}.ico` → `https://www.google.com/s2/favicons?domain=` | 首字母色块兜底 |

## 已知坑（改代码前必读）

1. **MV3 CSP 禁止内联脚本与内联事件属性**（`onclick=`、`<script>...</script>` 都不行），所有监听必须 `addEventListener`；
2. 联想 API 返回的是**不可信字符串**，注入 DOM 一律用 `textContent`，严禁 innerHTML 拼接用户/接口数据（静态 SVG 图标字符串除外）；
3. 联想响应可能声明错误 charset，统一用 `TextDecoder('utf-8')` 手动解码，避免中文乱码；
4. 搜索跳转前必须 `await` 历史写入完成（`location.href` 赋值后页面可能被销毁）；
5. favicon 小于 64 字节视为占位图，直接走兜底；
6. 重新加载扩展必须从**同一路径**加载，否则 extension id 变化会导致存储「丢失」；
7. `color-mix()` 与 `:root[data-tone]` 变量切换依赖较新 Chromium（Edge 111+），当前目标环境可接受；
8. **背景色必须在 boot 最早阶段应用**（`settings.init` 先于渲染模块执行），否则会闪一下默认配色；用户可自选任意背景色，所以文字明暗一律走 `hexLum()` 自动判定（`data-tone` 看下表面、`data-sheet-tone` 看上表面），**不要**再写死"浅色主题用什么字色"；
9. HTML5 拖拽排序不支持触屏（桌面 Edge 是主场景，可接受）；磁贴内链接/图片需 `-webkit-user-drag: none` 防止拖出链接；
10. 光照参数（全部由物理几何推导，改默认值前先想清楚单位）：`PX_PER_UNIT = 70`（世界单位→屏幕像素，光源高度 10 → 700px，**只影响剖面视觉尺度**）；`gapK = gap/height`（放大与偏移比例）；`patchDilation = (直径/2) × gapK`（半影带宽 px），`σ = patchDilation/2`；`shMax` 按视口对角线的一半动态计算（**不要改回固定值**，固定 120px 曾导致远处角标透光区不再移动）；**光照 = 逐通道乘法**：`光照倍数 = 环境光 + (1 − 环境光) × 光源强度 × 光谱 × 可见比例`，`光谱 = hexToRgbUnit(光色)`（纯黑 ⇒ 全 0 ⇒ 只剩环境光）；`encodeMul()` 把倍数编码成 `rgba(α,c)`（`α = 1 − min(m)`、`c = (m − min)/(1 − min)`）交给 `mix-blend-mode: multiply` 还原；**遮挡阴影倍数 = 环境光 ÷ 该点光照**（把直射光"除"掉），因此纯黑光色时阴影自动消失（`--shade-alpha`/`effectiveIntensity()` 均已删除）；
11. 裁剪/图片相关实现已整体移除（v1.3.0），不要再引入 `bgImage` 之类的存档键；
12. 角标在**每个新标签页**都从「检测中」重新开始——离线判定必须一轮内完成（全探针失败即显示），不能用多轮去抖，否则断网时用户长时间看到「检测中」；
13. **板材无显隐状态**：#wall-layer 常驻（旧 boot-no-anim / body.has-image 机制已全部移除），其内容就是 `--sheet-bg` 单色 —— **不要再往上加贴图/纹理层**（v1.3.0 试过并整体回退），板材与下表面的区分完全靠阴影与光照体现；
14. **层叠上下文陷阱 + 分层必须与光照一致**：`.main` 与 `.search-area` 绝不能设 z-index（会生成层叠上下文，把签名/候选下拉困在板材之下）——由 `.search-box`/`.shortcuts`/`.net-panel`/`.settings-btn`/`.engine-row`（**z1 控件层**）、`#ground-lit`/`#ground-shadow`（**z2 下表面光照，必须在控件之上、板材之下**）、`#wall-layer`（z3）、`.wordmark`/`#tile-decor`（z4）、`#sheet-lit`（**z5 上表面光照，必须在装饰之上、候选之下**）、`.suggestions`（z6）各自分层。所有光照层都 `pointer-events: none`。⚠ 把元素放到对应光照层**之上**就等于「不受光照」——签名、磁贴名称、引擎边框都必须留在 z4；
15. **壁孔/装饰更新时机**：任何移动控件的布局变化后都要 `EHP.holes.schedule()`——窗口缩放、签名显隐（applyWordmark）、磁贴渲染（render 调 syncTiles）、拖动中（dragover）；磁贴集合增删后必须调 `EHP.holes.syncTiles()`（重建装饰元素）；新增固定控件时在 holes.js 的 FIXED 表登记；⚠ **被挖孔的控件自身尺寸必须稳定**——尺寸随内容变化会让孔位滞后于新尺寸，表现为「阴影/边框分离」（网络角标曾用 `min-width` 被「检测中…」撑宽，现已固定宽度 132px + 文本 `flex:1`）；⚠ **同理不要给被挖孔的控件加 `transform`**：齿轮曾用 `.settings-btn:hover { transform: rotate(30deg) }` 做悬停旋转，而旋转后的 `getBoundingClientRect()` 会胀成 38·(cos30+sin30) ≈ 52px，导致悬停时孔忽大忽小、设置面板收回时先缩成"大一圈"的形状再跳成小圆（v1.3.0 实测）——旋转要转**里面的图标**（`.settings-btn:hover svg`）；
16. **SVG mask 必须显式设置区域**：`<mask>` 的 x/y/width/height（userSpaceOnUse）缺省时按百分比解析，会参照 0×0 的宿主 SVG 视口 → mask 区域为空 → 壁纸整层不可见（v1.2.0 实测踩坑，update() 中每次显式写全屏坐标）；
17. **磁贴名称由 JS 绘制在上层**：下层 `.tile-title` 只作占位（visibility:hidden，维持布局尺寸），实际名称由 holes.js 画在 `#tile-decor`（板材之上、上表面光照之下）。名称**就是编辑入口**：`.tile-decor-title.hover` 时才 `pointer-events: auto`，点击调 `EHP.shortcuts.edit(id)`（⚠ 传 id 而不是对象/元素，`shortcuts.edit` 内部现查数组，磁贴重渲染后旧引用一律失效——旧版"隐藏按钮转发"的坑就是这么来的）；`shortcuts.save()` 编辑时**就地改字段**而不是替换对象；⚠ 名称的**宽度要取整个磁贴**（`tileEl` 的 rect）而不是文字槽：文字槽宽度恰好等于文字宽度，短名称（如 "OA"）会因取整/渲染的细微差异被判溢出而显示成 "O…"（v1.3.0 实测 bug）；元素盒子与 `titleHit` 必须完全一致（上下各放宽 3px），否则会出现"悬停显示铅笔、点下去却穿透到下层磁贴"；
18. **悬停由 JS 命中测试驱动**（holes.js 的 applyHover），且**命中区只有名称 rect**：图标上不进入悬停态——用户明确要求"编辑动画只在鼠标移到名称上时播放"，指针路过图标时不该闪出下划线与铅笔。**不要**改回下层 `mouseenter/mouseleave`（指针从图标移到上方名称时下层会 mouseleave，形成振荡）。点击命中用 pointer-events 反转（`.tile`/`.tile-link` 为 none，仅 `.tile-icon`/`.tile-plus` 为 auto；`.tile-decor-title` 默认 none、`.hover` 时 auto）。⚠ 代价：名称区域不再参与 HTML5 拖拽排序，**排序请抓图标**；
19. **`input[type="range"]` 必须排除 `.set-row input` 的 padding/background**：那段内边距会把 range 的**内容盒**左右各缩 12px，拇指于是只能停在离两端 12px 处（表现为"滑块滑不到左右两端"），外面还多出一个方框；`.set-row input` 与 `input[type="range"]` 特异性相同，靠**书写顺序**取胜（range 规则在后），改动顺序时当心；
20. **设置面板开合 = 孔洞几何**：面板（`#drawer`）在下表面（z1），收起时被板材盖住，**不是**靠 `transform/opacity` 播动画（旧滑入抽屉已废弃）；`PANEL_RX` 必须与 `.drawer` 的 `border-radius` 一致；齿轮（`.settings-btn`）必须排在面板**之后**的 DOM 里才能在展开时浮在面板之上，且它是唯一的开/关按钮（`.drawer-head` 高度取 38px = 齿轮高度，标题才与齿轮同高）；`#drawer-backdrop` 是**透明**接收层且排在面板之前。⚠ 面板底色必须用 `--ground-fill`（与 `#ground-base` 同一份渐变 + `background-attachment: fixed`）并保持**不透明**：换成 `--panel-strong` 之类浅色蒙层会在下表面是深色/纯色时把它洗白（纯红 → 浅红，实测 bug）；不透明则是为了压住同一层背后的磁贴与搜索框。⚠ 上层装饰（磁贴名称/新建框/引擎边框，z4）会浮在展开的面板之上，故 `applyPanelSpec()` 里要用 `hideDecorOverPanel()` 把与孔洞相交的装饰临时隐藏（`update()` 里也会补一次，覆盖"面板开着时磁贴被重建"的情况）；
21. **阴影蒙版每帧重算要节流**：`shapePatch` 只在**透光区自身**位移 ≥2px 时重写透光区矩形（光标位移 ≥2px 才重写；**不要**做更强的节流——用户明确要求"不要限制帧率和鼠标抖动"，v1.3.0 曾按 gapK 折算出 ≈20px 阈值，被要求回退）。这一路最贵：重跑 `feGaussianBlur` + 重传整屏 `#shadow-mask` + 重新合成。`#ground-lit`/`#ground-shadow`/`#sheet-lit` 都不要加 transition（否则光影滞后）。透光区矩形集中在 `<g id="lit-patches">`，被 `#shadow-mask`（白底 + 黑透光区）以 `<use fill="currentColor">` 引用——改几何只需改一处；柔化由 `feGaussianBlur` 的 stdDeviation 控制（`color-interpolation-filters="sRGB"`，避免线性空间下遮罩明度异常）。⚠ 光照层必须用 `mix-blend-mode: multiply`，**不要改回 screen / source-over**：加法会把黑色反照率（黑图标）洗成光色，也让"光色"失去物理意义；
22. **光照渐变只在参数/视口变化时重烘**：`buildLightGradients()` 由 `applyLightSettings()` 与 `update()` 中的视口变化检测触发（12 段剖面 × 2 个平面 ≈ 4k 次数值积分，<1ms）；每帧只写 `--lx/--ly`（受光点），不再有任何逐控件亮度计算；⚠ 但**写这两个变量本身就是昂贵操作**：三条整屏径向渐变会立刻重新栅格化 + 重新 multiply 合成，这是鼠标移动时 GPU 占用的主因。**刻意不做量化与限流**（`applySheetLight()` 每帧写真实光标位置）：用户明确要求"不要限制帧率和鼠标抖动"，v1.3.0 试过 6px 网格量化 + ~30Hz 限流（含尾帧补偿），被要求整体回退。要真正把占用降下来只能改结构：把整屏渐变换成"固定尺寸、可 `transform` 平移的光斑层"（合成器平移不重绘），把整屏 SVG 蒙版换成逐孔的小图层。同类陷阱：**不要把 `backdrop-filter` 加回 `.suggestions`**——`--surface` 已 97% 不透明，模糊不可见，却会在每次光影更新时强制重做整块背景快照 + 模糊（v1.3.0 已删）。三个坑：① ⚠ **`--lx/--ly` 必须写在 `:root` 上**——四条渐变字符串声明在 `:root`，而 `var()` 是在「声明该自定义属性的元素」上完成替换的，写在下层元素（如 #wall-layer）不会生效，曾导致受光区永久停在画面中心、只有阴影跟随鼠标；② ⚠ **radial-gradient 必须显式写死半径**（`circle <px> at …`）——不写时默认 `farthest-corner`，百分比→像素的映射会随中心位置变化，曾导致光斑在屏幕中央看着比在角落小；③ 下表面光照（`#ground-lit`）必须是**不加蒙版**的整屏乘法层（板材只留出孔洞，故它实际只作用于孔内），而上表面光照（`#sheet-lit`）必须用 `#hole-mask` 裁掉孔洞，否则孔内会被照两遍。
23. **multiply 不能以画布为混合底**：`#ground-base` 必须存在并带 `--ground-bg` 底色——html/body 的背景会被提升为**画布背景**，混合时不算「下面的内容」；若把下表面基底直接放在 body 上，孔内的光照就会退化成一层盖在画布上的灰纱。同理，任何新增的"要参与光照"的层，都要确认它下面有一个**真实元素**提供底色；

## 开发调试循环

1. 修改 `extension/` 下文件；
2. `edge://extensions` → 卡片 ↻ 重新加载；
3. `Ctrl+T` 验证（新标签页上 `F12` 可调试）；
4. 语法自检（可选）：`node --check extension/js/*.js`。

## 当前状态与路线图

- **M1**：双引擎搜索 + 在线/历史候选、快捷方式增删改 + 图标缓存、导出/导入、安装教学——已实现并交付；
- **v1.0.0**：首个正式版本，含 M1 全部 + M2 功能集：双通道角标（单气泡双行）、设置抽屉（分区：外观/光晕/图片展示/数据/关于）、浅色默认主题、拖拽排序、鼠标光晕（混合模式修复可见性，大小/透明度可调，零延迟直跟）、图片展示（模糊修复、焦点裁剪、宽度 15%–50% 可调、右缘锐利阴影+描边、开合滑动动画）、添加按钮与磁贴统一风格（悬停背景等宽）、引擎选择器内嵌搜索框（图标+滑块+分割线；Bing/Google 图标为从网上下载的官方 SVG，来源 gilbarbara/logos（CC0，经 Iconify API 获取），Bing 为官方多色渐变 logo，渐变 id 加 bing- 前缀避免冲突）、搜索按钮内缩圆角与外框嵌套；产品定位描述统一为「浏览器主页扩展」；
- **v1.0.1**：断网立即显示离线（单轮判定 + 超时 2s）；国外通道仅测 Google 主站（移除 gstatic 误报源，manifest 同步移除其 host 权限）；图片面板动画仅在交互切换时播放（boot-no-anim 抑制初始加载过渡）；
- **v1.0.2**：快捷方式协议归一化——无协议网址按目标选默认协议（回环+私网→http，其余→https，曾一律补 https 致 `127.0.0.1:3080` 打不开本地 HTTP 服务）；存量回环 https 链接自动迁移为 http；
- **v1.1.0**：公开仓库准备——默认搜索框提示语改为「What shall we explore?」并可在设置中自定义（settings.placeholder，留空恢复默认）；关于区新增 AI 声明（GLM/智谱）与 GitHub 仓库链接；README 安装章节改为引导 Releases；
- **v1.2.0**：双层挖孔布局——上层板材常驻 + 控件下层；挖孔按**方案 A**（孔 = 控件边界，焦点描边同形叠加，消除双框）；磁贴悬停/编辑按钮改由 JS 命中测试驱动（修复编辑按钮一碰就跳转的振荡 bug）；每磁贴图标独立开孔、标题/新建虚线框/编辑按钮在上层；图标去掉底片与边框、首字母按主题分档色相渲染；
- **v2.0.0（当前）**（开发期版本号曾写作 1.3.0，发布时定为 2.0.0）：光影模型重做为**物理推导 + 纯乘法**——移除自定义背景图与鼠标光晕元素；光源 = 平行于屏幕的均匀发光圆盘 + 全局环境光，上下表面用**同一套** `discProfile` 剖面（下表面 h 多一个层间距），孔洞投影按 `1+g/H` 放大、偏移 `dist·g/H`、半影带宽 `R·g/H`（全部由几何决定）；**光照一律是逐通道乘法**（`mix-blend-mode: multiply` + `encodeMul()` 编码）：**显示值 = 反射率 × 光照**，所以纯黑图标（GitHub）在强光下仍是黑色、纯红光的阴影只抹掉红通道；**遮挡阴影 = 环境光 ÷ 该点光照**，阴影区恰好只剩环境光（纯黑光色自动无阴影）；**环境光是唯一决定亮度下限的参数**；新增 `#ground-base`（multiply 的混合底）与 `#sheet-lit`（上表面光照，装饰/签名也在其下，故上表面元素同样受光照）；控件层下沉到 z1、取消逐控件亮度查表 —— 阴影与半影逐像素横穿图标/文字；设置项「光色强度」更名「光源强度」（直射光最多能补多少亮度）；**引擎选择器在搜索框左侧、与搜索框同高**（下表面两个图标 + 上表面可滑动孔洞 + 与搜索框等高的外扩边框；孔与阴影同步滑动、首次加载直接落位、未选中位置的圆圈已删）；**删除强调色**，把深/浅两档主题换成**上表面颜色 + 下表面背景色**两个取色器（文字与浮层明暗按背景色明度自动判定，`data-tone`/`data-sheet-tone`，旧 `theme:'dark'` 与旧单一 `sheetBg` 自动迁移）；磁贴图标不再有悬停上浮/放大，**编辑入口改为"点名称"**（悬停名称变深 + 下划线 + 滑出铅笔，`EHP.shortcuts.edit(id)`；悬停图标不触发；旧的 ✏️ 按钮、`#hole-ui`、`.tile-edit` 占位全部删除）；**设置面板改为"下表面上的面板 + 会长大的孔洞"**（点击齿轮让齿轮孔洞长成整页高的大圆角矩形；**齿轮同时承担开与关**，面板内的叉号已删、标题行与齿轮同高；面板底色直接复用下表面材质 `--ground-fill`，不再用浅色蒙层，否则纯色下表面会被洗成浅色）；面板与控件同层故同样受光照；网络角标随之从右下角移到左下角；**设置面板删掉各栏的提示语（`<em>`）与关于区的 AI 声明**；修复滑块滑不到两端（range 被 `.set-row input` 的内边距缩了内容盒）；移除搜索框焦点描边、控件自身残留阴影（旧 `--hole-shadow/--hole-line`）与磁贴图标孔缘；滚动时重算孔位；修复实测 bug：受光点变量写到 :root、渐变显式半径、名称宽度取磁贴 rect（短名称 "OA" 显示成 "O…"）、上表面元素不受光照、黑色图标被光洗白、引擎切换途中露出多余阴影、开页时引擎孔洞从默认引擎滑过来、齿轮悬停旋转导致孔位胀大/收回时跳变（旋转改到内部 `<svg>` 上）；README 中的 AI 协助声明一并删除；**纹理尝试整体回退**（贴图/法线/ORM/WebGL 着色器/砂纸/孔缘凹陷/文字光晕全部删除，回到单色平面，理由见上表）；**修复配色变量缺失引发的一类"看不见"bug**（浅色档基础变量块 + `--ground-fill` 都曾漏定义）：设置面板分割线与引擎外扩框不画线、编辑弹窗/候选下拉/Toast 没有背景板、网络角标速度圆点变透明——现在全部变量都在 `:root` 定义、面板与描边一律由 `color-mix(… var(--text) …)` 混出以适配任意底色；删掉 `.suggestions` 的无用 `backdrop-filter`（97% 不透明，模糊看不见却每次光影更新都要重做背景快照）；鼠标光影**保留**每帧写真实光标位置、不做帧率/抖动节流（用户要求）；后续候选：候选关键词高亮、可配置探针间隔/历史上限；
- M3（候选）：跨设备同步（`chrome.storage.sync` 先做 spike，或轻量自托管后端）——用户已明确当前不需要账号体系。

## 变更习惯

- 完成改动后：同步更新 README（面向用户）与本文件（面向 LLM）中受影响的部分；
- 不要提交 `data/` 下的用户备份；不要引入构建工具/框架依赖；
- 提交信息使用中文；
