# SilentJab — 网站路线图

> 域名：**silentjab.com**　｜　站点目录：`web/`　｜　最后更新：2026-10-23
> 定位：英文内容站，用可交互 3D 演示讲拳击基本动作与组合，靠自然搜索获客 + AdSense 变现。

---

## 1. 当前状态

| 页面 | 作用 | 状态 |
|---|---|---|
| `index.html` | 首页：3D 舞台 + 6 个动作按钮 + 6 张招式卡 | ✅ 已改版 |
| `jab.html` `cross.html` `<br>leadhook.html` `rearhook.html` `<br>leaduppercut.html` `rearuppercut.html` | 六个单招页：左侧 3D 动画自动播放该动作，右侧四段技法说明；手机端动画在上、文字在下 | ✅ 由生成器产出 |
| `build/gen_move_pages.py` | 六页的生成器（改文案/新增动作只改这里，不手改 HTML） | ✅ |
| `assets/home-stage.js` | 共享 3D 舞台：`window.STAGE` 传 `buttons / labels / autoPlay`，首页与六个单招页共用一套代码 | ✅ 已参数化 |
| `assets/home.css` | 首页 + 单招页 + 训练页样式（`.move-hero` 顶端对齐 / 桌面吸顶 / 手机单列 / `.combo-bar`） | ✅ |
| `training.html` | 训练页：双人对练，勾选招式 → Confirm 连播，命中锚点触发火花与音效 | ✅ 新增（见第 11 节） |
| `assets/training-stage.js` | 训练页引擎：双骨架隔离、命中帧预计算、进步位移、火花/音效 | ✅ |
| `assets/boxing.js` / `boxing.css` | 旧双人对打引擎（仅 `_archive/` 里的备份页引用） | 保留不删 |
| `media/glb/*.glb` | 压缩后的模型（1 / 2 / index / combine） | ✅ 39.7 → 5.8 MB；combine 39.7 → 6.1 MB |
| `media/audio/*.wav` | 命中音效 | ✅ |
| `sitemap.xml` / `robots.txt` | 搜索引擎入口 | ✅ 8 条 URL |
| `_archive/jab-twoFighters-20261023.html`、`<br>`_archive/jab-cross-twoFighters-20261023.html`、`<br>`_archive/index-tabs.bak.html` | 改版前的页面备份 | 已移出部署目录 |

> 部署单位就是 `web/` 一个目录，不再依赖外部 `resources/`。
> 单招页的 HTML 由 `python3 build/gen_move_pages.py` 生成，模板里改一处即可全站同步。

---

## 2. P0 — 上线前必须解决（不做会直接损失流量/收入）

### 2.1 正文只存在于 JS 里（最大风险）　✅ 已完成
`jab.html` / `jab-cross.html` 的正文原本由 `renderBrief()` 在模型加载后注入空 `<aside>`，
爬虫抓到的 HTML 里没有正文。**已改为静态 HTML**：默认招式的四段（Action / When to use /
Advantages / Limits）直接写在 `<aside class="brief show">` 里，引擎只在切换招式时替换。

- [x] 静态正文写入 `<aside>`（四段 × 2 页）
- [x] JS 未加载时正文依然可见（无 WebGL 也有完整文字）
- [x] 验收：`curl -s https://silentjab.com/jab.html | grep -c "b-sec"` = 4

### 2.1b 移动端正文可见性　✅ 已随改版解决
旧 `assets/boxing.css` 第 503 行有 `@media (max-width: 980px) { .brief { display: none; } }`，
手机用户在旧页面上**看不到任何技法说明**。新单招页已改用 `home.css`：≤980px 时
`.hero-grid` 变单列（动画在上、文字在下），正文全部留在文档流里。

- [x] 六个单招页在 390px 宽度实测：无横向溢出、chips 自动折行、四段说明完整可见
- [ ] 若以后恢复旧 `boxing.css` 页面，仍需处理 `.brief` 的 `display:none`

### 2.2 资产路径跑到 web 目录外　✅ 已完成
原本 `SCENE.glb` 写 `../resources/glb/1.glb`、音频写 `../resources/audio/*.wav`。

- [x] 资源复制/产出到 `web/media/glb/`、`web/media/audio/`
- [x] `jab.html` / `jab-cross.html` / `assets/home-stage.js` 路径改为 `./media/...`
- [x] 验证：只把 `web/` 当站点根目录时，glb 与 wav 全部 200，无 404
- 注：`resources/` 保留为原始资产（源文件），不再被页面引用

### 2.3 单条模型 39.7 MB　✅ 已压到 5.8 MB
体积构成：**贴图占 89%**（两张 4096×4096 RGBA PNG 各 13–15 MB，全部没有用到 alpha）。

- [x] `build/compress_glb.py`：按材质绑定识别角色 → baseColor 2048 / normal 1024 / 未绑定 512，统一转 JPEG
- [x] `1.glb` `2.glb` 39.7 MB → **5.8 MB**（-85%）；`index.glb` 21 MB → **3.2 MB**
- [x] 无头浏览器复验：模型正常加载、贴图无可见劣化、无 JS 报错
- [ ] 下一档：几何 + 动画仍占 3.4 MB，用 Draco 或 meshopt 可再降到 ~2 MB（需在 `GLTFLoader` 挂 `DRACOLoader` / `MeshoptDecoder`，并 vendor 解码器）
- 注：脚本只改贴图字节、重算 bufferView 偏移，不碰骨骼与动画，命中锚点不受影响

### 2.4 基础文件
- [x] `sitemap.xml`（7 条 URL：首页 + 六个单招页，`lastmod` 2026-10-23）
- [x] `robots.txt`（`Sitemap:` 指向 + 显式 Allow `media/ assets/ vendor/`）
- [ ] `<link rel="icon" href="data:,">` → 换成真实 favicon（32/180/512 三档）
- [ ] 补 `og:image`（1200×630），三页共用
- [ ] `404.html`
- [ ] `privacy.html` + `about.html` + `contact.html` —— AdSense 审核硬性要求

**上线后提交顺序**：GSC 加资源 → 提交 `sitemap.xml` → `URL Inspection` 逐条请求收录
→ 7 天后看 `Coverage` 是否有「已抓取未编入索引」。

---

## 3. 品牌与域名

- 品牌：**SilentJab**；全站文案、`og:site_name`、JSON-LD、logo 已统一
- [ ] 注册 `silentjab.com`（查过当时可注册；**.net / .store / .shop / .fit / .xyz / .app / .dev / .club 同样空着**，可顺手护住 `.store`/`.fit`）
- [ ] 占位社交账号：Instagram / TikTok / X / YouTube 的 `@silentjab`
- [ ] 全站 `canonical` 已写死 `https://silentjab.com/...`，上线前确认 301：`www → 非 www`、`http → https`
- [ ] 商标：`SILENT JAB` 属任意组合，比 `crisp/sharp` 一类描述性词好注册；Class 28（运动器械）+ 41（教学/娱乐）各查一次

---

## 4. Google Analytics 4

### 4.1 接入
在**每个页面** `<head>` 末尾放一段（用统一 id 替换 `G-XXXXXXX`）：

```html
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXX');
</script>
```

- [ ] 建 GA4 媒体资源 + 数据流（Web），拿到 `G-` ID
- [ ] 三页 + 404 全部加上
- [ ] 绑定 Search Console（GA4 后台关联），用来对关键词

### 4.2 建议埋的事件（3D 站的真正价值数据）

| 事件名 | 触发时机 | 参数 |
|---|---|---|
| `demo_loaded` | 模型首帧渲染完成 | `page`, `ms` |
| `attack_select` | 点攻击按钮 | `move`（jab / long-jab / jab-cross-head …） |
| `sound_toggle` | 音效开关 | `state` |
| `scroll_depth` | 25/50/75/100% | `percent` |
| `outbound_click` | 外链 | `url` |

- [ ] 在 `assets/boxing.js` 的 `selectAttack()` / `onLoaded` 里加 `gtag('event', ...)`
- [ ] 只发事件，**不要**把 `attack_select` 当转化——它太频繁，会污染报表

### 4.3 合规
- [ ] 若面向 EEA/UK：启用 Consent Mode v2，先拒后授
- [ ] cookie 说明写进 `privacy.html`

---

## 5. Google AdSense

### 5.1 申请前置条件（按顺序做）
- [ ] 内容量：**≥ 15–20 篇**有实质正文的页面（现在 3 页，不够）
- [ ] 必备页面：About / Contact / Privacy Policy / Terms
- [ ] 原创性：正文必须自己写（目前文案是原创的，保持）
- [ ] 站点可访问、无 404 主链路、移动端可用

### 5.2 接入
```html
<!-- <head> 内 -->
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX" crossorigin="anonymous"></script>
```
```
# ads.txt（必须在 web 根目录，不能放子目录）
google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
```

- [ ] 过审后再放广告位，**不要**提前插代码
- [ ] 阶段一：只开 1 个「文中」广告位（正文第一段之后），关掉 Auto Ads
- [ ] 阶段二：正文底部 + 侧栏（仅桌面端）

### 5.3 广告位规则（针对 3D 站的特殊约束）
- ❌ 不要覆盖 canvas 与攻击按钮——误点率高，易被判无效流量
- ❌ 不要在 100vh 的全屏演示区内插入广告
- ✅ 广告容器给固定 `min-height`，避免 CLS 飙升（AdSense 是 CLS 主要来源）
- ✅ 演示页广告放在正文区，与 3D 区物理分离
- 参考：AdSense 政策要求「广告不得干扰内容」，全屏沉浸式页面尤其容易被判违规

---

## 6. 页面缓存策略

### 6.1 缓存分层

| 资源 | 缓存 | 说明 |
|---|---|---|
| `*.html` | `no-cache`（每次校验） | 内容会改，必须让 CDN/浏览器回源校验 |
| `assets/*.css/js` | 1 年 + `immutable` | **需要文件名带 hash**，否则不能长缓存 |
| `media/*.glb` | 30 天 | 体量大，靠 hash 或版本号更新 |
| `media/audio/*` | 30 天 | 同上 |
| `vendor/three/**` | 1 年 + `immutable` | 版本号已写进路径（`three@0.170.0`） |

### 6.2 nginx 片段
```nginx
# HTML 不缓存
location ~* \.html$ {
    add_header Cache-Control "no-cache, must-revalidate";
}

# 带 hash 的静态资源
location ~* \.(css|js)$ {
    add_header Cache-Control "public, max-age=31536000, immutable";
}

# 3D 与音频
location ~* \.(glb|gltf|bin|ktx2|wav|mp3)$ {
    add_header Cache-Control "public, max-age=2592000";
    add_header Accept-Ranges bytes;
    gzip off;                       # 二进制不再压，靠 Draco/KTX2
}

gzip on;
gzip_types text/css application/javascript application/json image/svg+xml;
gzip_min_length 1024;
# 有 HTTPS 就上 brotli（需 ngx_brotli 模块）
```

- [ ] 资源加 hash：`boxing.a1b2c3.js`（构建脚本里加一步，或手工改版本号）
- [ ] 上 CDN（Cloudflare 免费版即可）：HTML 走 `BYPASS`，静态资源走 `Cache Everything`
- [ ] 若用 Cloudflare：确认 SSL 模式 = Full (strict)，源站装 Let's Encrypt
- [ ] 上线后验证：`curl -I https://silentjab.com/assets/boxing.js` 看到 `immutable`

### 6.3 不要做的事
- ❌ 不要给 HTML 设长缓存——改完文案用户看不到新版，是最常见的上线事故
- ❌ 不要用 Service Worker 缓存 HTML（内容站更新频繁，收益低风险高）

---

## 7. 内容路线（按关键词价值排序）

| 阶段 | 页面 | 目标词 |
|---|---|---|
| 已完成 | `/jab.html` | how to throw a jab in boxing |
| 已完成 | `/jab-cross.html` | jab cross combination / the 1-2 |
| P1 | `/cross.html` | how to throw a cross |
| P1 | `/hook.html` | how to throw a hook punch |
| P1 | `/uppercut.html` | how to throw an uppercut |
| P1 | `/combinations.html` | **boxing combinations numbers**（1–6 编号表，竞争小、意图准） |
| P2 | `/stance.html` `/footwork.html` `/guard.html` | boxing stance / footwork / guard |
| P2 | `/defense.html` | boxing defense techniques（slip / roll / parry） |
| P3 | `/kicking-techniques.html` | muay thai kicks |
| P3 | `/knee-strikes.html` `/elbow-strikes.html` | muay thai knee / elbow techniques |

> 提醒：在拳击簇（P1/P2）没做满之前不要开腿膝肘——主题一散，`boxing combinations` 这类主词就抓不住。

---

## 8. 性能与体验目标

| 指标 | 目标 | 现状 |
|---|---|---|
| LCP（移动 4G） | < 2.5 s | ⚠️ 单页 5.8 MB 模型，接近但仍偏重 |
| CLS | < 0.1 | ⚠️ 加载态布局待测 |
| INP | < 200 ms | ✅ 无重交互 |
| 单页传输量 | < 6 MB | ✅ 20 MB → 5.8 MB（-85%） |

- [x] 贴图重编码（39.7 → 5.8 MB）
- [ ] 几何 + 动画压缩（Draco / meshopt，5.8 → ~2 MB）
- [ ] 加 `preload` 只给 poster 图，**不要** preload glb
- [ ] 移动端降级：低端机（`deviceMemory < 4` 或 `hardwareConcurrency <= 4`）只播 poster + 静态图

---

## 9. 技术债

- [x] `index-tabs.bak.html` 移出 `web/`（已移到项目根 `_archive/`）
- [x] 三页 head 高度重复 → 已由 `build/gen_move_pages.py` 生成六个单招页，head 只在一处
- [x] 「每加一招就复制一页」→ 现在改生成器的 `MOVES` 数组即可，页面与 sitemap 一起产出
- [ ] `assets/boxing.js` / `home-stage.js` 里的中文注释逐步转英文（便于以后交接/开源）
- [ ] `SCENE` 配置与页面耦合，后续可考虑 `?move=x` 单页方案（P2 再评估，会牺牲独立 URL 的 SEO 收益）
- [ ] 旧 `assets/boxing.js` 双人对打引擎已无在线页面引用，确认不再需要后可整体移入 `_archive/`

### 9.1 踩过的坑（避免重犯）

- **`.stage` 必须是 `position: relative`**：`canvas` 是 `position: absolute; inset: 0`，
  一旦把 `.stage` 改成 `static`，canvas 的包含块退化成 viewport，宽高变成"整页大小"，
  取景随之全乱（模型巨大并溢出卡片）。手机上"取消吸顶"只能写 `position: relative; top: auto;`，
  **漏掉 `top: auto` 会残留 `top: 84px` 的相对偏移**，把动画从 91px 推到 175px、压住标题。
- **无头浏览器测移动端**：`--window-size` 最小被钳到 500px，390px 的"截断"其实只是截图裁剪；
  要看真实 390 布局，用一个 390px 宽的 `iframe` 包一层再截图。
- **`--dump-dom` 不进入 iframe**：测 iframe 内部布局，要在父页面读 `iframe.contentDocument` 把结果写进父页面 `<title>`。

---

## 10. 里程碑

| # | 内容 | 完成标准 |
|---|---|---|
| M1 | 品牌替换 + 页面精简 | ✅ 完成（SilentJab / 2 张卡 / 去中文） |
| M2 | 静态正文 + 资产自包含 | ✅ 完成（无 JS 也有全文；只传 `web/` 能跑） |
| M3 | 模型压缩 + sitemap / robots | ✅ 完成（39.7 → 5.8 MB） |
| M3.5 | 移动端正文可见 + 几何压缩 | `.brief` 不再是 `display:none`；单页 ≤ 2 MB |
| M4 | GA4 + GSC | 能按页面看关键词与事件 |
| M5 | 内容补到 15 篇 | 拳击簇 P1/P2 全部上线 |
| M6 | AdSense 申请与首轮广告位 | 过审 + 文中单广告位，CLS 不破 0.1 |
| M7 | 训练页（双人对练 + 组合连击） | ✅ 完成（见第 11 节） |

---

## 11. 训练页 `training.html`

**模型**：`media/glb/combine.glb`（39.7 MB → **6.1 MB**，`build/compress_glb.py` 处理）
- `Armature`＝进攻方（红，右侧），驱动 6 条拳法动画
- `Armature.001`＝防守方（黑，左侧），播 `defence-idle`，身上挂两个命中锚点：
  - `ancher1` → 父级 `Head`（世界 y≈0.74，约在 74% 身高）
  - `ahcher2` → 父级 `Spine1`（世界 y≈0.52，约在 52% 身高）
  - 注意导出名有拼写：`ancher1` / `ahcher2`，代码按 `/(ancher|ahcher)/i` 匹配

**实现要点**（`assets/training-stage.js`）
- 两套骨架同名（Mixamo），加载后给骨骼加 `@atk` / `@def` 后缀并同步改写所有动画轨，避免 PropertyBinding 串绑
- GLTFLoader 会去掉名字里的冒号、给重名节点追加 `_1`，所以按名找骨骼统一走 `canon()`（去后缀 + 去 `_N`）
- 进攻方没有自己的 idle → 运行时克隆防守方的 `defence-idle` 并按规范名逐轨映射到进攻骨架（零额外体积）
- **按招式指定命中锚点**（`MOVES[].target`）：jab / cross → `ahcher2`（躯干），两个 hook / 两个 uppercut → `ancher1`（头部）
- 锚点角色识别：优先看父骨骼（`Head|Neck` → head，`Spine|Chest|Hips` → body），判不出才退回名字规则，重新导出改名也不会错配
- 命中帧 `impactT` 用两段式选帧：先取「拳套到目标锚点水平距离最小」的帧，再在 `dh ≤ 最小值 + 6cm` 的候选里挑垂直偏差最小的，兼顾「手真的伸出去」和「打到该高度」
- 播放时：起手前采样命中帧姿势 → 反解下蹲角 → 量出水平差值 → 进攻方整体平移（0.11s 补间）→ 拳到达命中帧时补一次水平残差 → 火花 + 命中音效
- **防守方下蹲**（`bendDefender` / `solveCrouch`）：髋 + 膝 + 踝按角度屈曲、脊柱三段前倾，再按脚踝高度把根压回地面（脚不离地）。二分反解「蹲多少度能让目标锚点降到拳套高度」，上限 1.75 rad。这样拳套够不到头部锚点时由黑方沉身去接，而不是把红方抬到空中
- 命中精度实测：6 个动作水平 `hitDist` 全部 **0.000**，垂直残差 0.6–6.7 cm；播完自动回原位（`baseAttackerPos`）并解锁 UI

**踩过的坑（本节新增）**
1. 位移把 `gap.y` 也算进去 → 后手上勾拳把红方抬离地面 0.22（≈ 1/4 身高），像悬浮。位移必须只取水平分量。
2. `bendDefender` 用「当前根高度」算落脚校正，而根高度里已经含上一帧的偏移 → 误差逐帧累积，越蹲越浅（同一角度实测差 10 cm）。必须先 `position.y = baseRootY` 再量脚踝。
3. 连招求解前没清掉上一招的下蹲叠加 → 二分出来的是「相对已蹲高度」的增量，连招越往后越蹲不到位。求解前 `mixer.update(0)` 把骨骼重写回纯动画姿势。
4. 二分的基准姿势本身随 idle 呼吸浮动，命中帧还可能差几厘米（实测最大 6.7 cm，在上勾拳）。可以接受；若追求更准，可对 idle 做 0.7s 的相位预判。

**已知取舍**
- `back-hand-hook` / `back-hand-uppercut` 这两条 clip 的拳套最高只到 y≈0.50–0.58，要贴头部锚点（y≈0.74）必须让黑方深蹲 51°–75°。当前按此实现（用户确认「让黑方下蹲」），视觉是明显的躲闪式沉身；若觉得蹲太深，两个替代方案：a) 把 `anchor1` 下移到下颌；b) 重新导出这两条动画，把拳套抬到下颌高度。
- 音效用 WebAudio（`media/audio/punch-impact.wav`），首次点 Confirm 时创建 AudioContext；无音频设备的环境会静默降级。

**测试脚本**（真实时间 CDP，无头浏览器虚拟时间会被网络加载卡住，不可靠）
- `build/cdp_training.mjs`：单招式测试（`node build/cdp_training.mjs <url> <clipName>`，默认 jab），含命中帧截图
- `build/cdp_training_all.mjs`：六招连播，逐招打印锚点与贴合误差
