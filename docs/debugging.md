# 调试与验证手册

> 面向皮肤开发者:如何在不打扰运行中的 `dsh web` 的前提下验证改动、对比新旧行为、
> 定位「效果消失」类问题。配套脚本在 `scripts/qa/`。

## 核心原则:服务不用动,用路由拦截换 bundle

页面通过 `GET /plugins/<id>/client.js?rev=<hash>` 加载插件 bundle。用 playwright-core
的 **route interception** 在浏览器侧把响应换成你的本地构建产物,就能对**正在运行的**
GUI 验证新代码——不重启、不安装、不污染现有会话:

```js
await page.route("**/plugins/dsh-skin-glass/client.js*", (route) => {
  route.fulfill({ status: 200, contentType: "application/javascript",
                  body: fs.readFileSync("lib/client.js", "utf8") });
});
```

对比「旧 bundle vs 新 bundle」时,把旧版从 git 里拿出来:

```sh
git show <commit>:lib/client.js > /tmp/orig-client.js   # 旧版做基线
node scripts/qa/verify-glass.mjs --old-bundle /tmp/orig-client.js
```

依赖安装(不进仓库依赖,放在临时目录即可):

```sh
mkdir -p /tmp/dsh-glass-qa && cd /tmp/dsh-glass-qa && npm init -y >/dev/null \
  && npm install playwright-core --no-audit --no-fund --cache /tmp/dsh-glass-qa/.npm-cache
```

playwright-core 需要浏览器。本机缓存位于 `~/Library/Caches/ms-playwright/`,找
`chromium_headless_shell-*/chrome-mac/headless_shell` 传给 `chromium.launch({ executablePath })`;
没有缓存就先 `npx playwright-core install chromium`。

### 几个实测过的坑

- **bundle 可能由服务直接读工作区文件提供。** 本仓库的安装方式下,`curl
  http://127.0.0.1:3080/plugins/dsh-skin-glass/client.js` 与本地 `lib/client.js`
  **逐字节一致**——重建后刷新即生效,无需重启。但 boot manifest 里的 `rev` 是启动时
  算的哈希,文件变了 `rev` 不变,浏览器可能用缓存:用户侧强刷(Cmd+Shift+R),或
  `curl` 先比对线上与本地再下结论。
- **页面有常驻动画**(hero 的鱼、turn status 闪烁),两次截图天然不同。像素对比前先
  `reducedMotion: "reduce"` 开 context,再注入
  `*,*::before,*::after{animation:none!important;transition:none!important}` 冻结。
- **像素 diff 的判读**:`scripts/qa/pngdiff.cjs` 输出差异像素占比、均值/最大通道差与差异
  包围盒。均值 3–4(每通道 1.5%)通常是色调级细微差异;几十到上百说明合成结构变了,别交。
- **主题偏好在宿主 settings 文档(`ui-theme/preference`),boot 脚本注入当前值**——playwright
  的 `colorScheme: "dark"` 模拟**无效**。要验证明暗两态:点 设置 → 外观 的立方体按钮切换,
  测完**切回**,并断言 body 上皮肤令牌值复原(如
  `getPropertyValue("--dsh-glass-hovercard-bg")` 回到浅色值),防止把用户偏好留在深色。

## 标准化检查三步走(每次改动都跑)

1. **单测**:`node scripts/check-surfaces.mjs` —— 用 `new Function` 把 `src/main.js`
   塞进一个**桩掉的浏览器沙箱**(假 `document`/`getComputedStyle`/`MutationObserver`),
   直接驱动 `tagSurface` / `createSurfaceScanner` 的内部行为。皮肤逻辑里凡是「按渲染
   结果决策」的部分都可以照这个模式测——不需要真浏览器,毫秒级回归。
2. **对比度**:`node scripts/check-contrast.mjs` —— 改任何 alpha/scrim 系数前必跑。
3. **行为验证**:`node scripts/qa/verify-glass.mjs`(hover 回归 + 状态复原断言 + 设置弹窗
   检查),必要时 `--old-bundle` 做基线对比 + `pngdiff` 出像素报告。

## 定位「某个面板效果消失」的 SOP

1. **拿标记快照**:注入 `countGlass`/`snapshot`(见 verify-glass.mjs)列出
   `[data-dsh-glass-surface]` / `[data-dsh-glass-sheet]` 元素的类名、定位方式、
   计算背景 alpha、`backdrop-filter`。先确认是「没打标」还是「打了标但被别的东西盖住」。
2. **看计算样式**:`getComputedStyle(el).backdropFilter` 为 `none` 但元素有标记 → 滤镜在
   伪元素上(`::before`),用 `getComputedStyle(el, "::before")` 看;有值但看不见 → 被
   兄弟层(遮罩/其他滤镜元素)盖住,查该元素与兄弟的 z 层关系。
3. **插桩旧代码**:对旧 bundle 做字符串替换(如给 `scaleNestedTint`/walk 分支加
   `console.log("[trace] …")`),route 提供插桩版,看旧行为是**哪条路径**产生的——
   修 bug 时要知道自己复刻的是设计意图还是旧代码的偶然行为。
4. **新旧同屏对比**:同一脚本分别跑旧/新 bundle,截图 + `pngdiff`,差异包围盒能直接指出
   哪个区域变了。

## 产品侧事实清单(本会话实测,写死会过时)

- **Tooltip 气泡是内联渲染的 `position: fixed` span**,不走 portal:挂在
  `cloneElement(children)` 的 Fragment 兄弟位,`left/top` 是视口坐标,hover 时挂载、
  移开即卸载(命令/上下文/发送按钮分别有 500/200/500ms 延迟)。
- **设置弹窗**:透明 `position:fixed; inset:0` 外壳(在**侧边栏 DOM 内部**,无 portal)+
  absolute 遮罩(`--dsw-mask-blur`)+ `position:relative` 面板(`bg-layer-2`)。外壳被
  「铺满视口」规则跳过、不挂玻璃。
- **应用框架 `pI_x6G_frame` 有半透明底色**(约 α 0.62):它位于面板滤镜之下时会被面板的
  滤镜二次饱和/增亮;伪元素磨砂方案下它在伪元素之上、不参与滤镜链(每通道 ~1.5% 色差)。
- **会话/工作区悬停卡片(HoverCard 原语)**:portal 到 `document.body` 的 fixed 卡片,其规则在
  **元素自身**上声明 `--dsw-hovercard-bg: #2C2C2E` 并以此画背景,行文字也写死了浅色系
  (`#fff`/`#cfd3d6`/`#adb2b8`)——body 级令牌覆盖够不到局部声明,所以旧版皮肤里它一直是块
  不透明黑板。皮肤在 chrome CSS 里用 `html[data-dsh-glass] body > div[class]` 把该变量重绑到
  `--dsh-glass-hovercard-bg`(浅色=对话框面板材质 bg-layer-2,深色=tooltip 板;全产品仅此一处
  消费该变量),卡片随之拿到半透明底并被识别器打上 backdrop 磨砂;识别器再用「背景确实由该
  变量绘制」这条判据认出卡片,把写死的文字色重绑到 label 令牌(见 treatHovercardText)。
- 类名按构建哈希(`VOzbGW_panel` 等);composer 卡片是 `position:relative`(`uV2eYG_card`)。
- 设置入口 aria 文本「设置」;命令按钮 aria「命令」、发送按钮 aria「发送消息」、上下文
  环 aria「上下文已用 N%」。

## 脚本目录

| 文件 | 用途 |
| --- | --- |
| `scripts/qa/verify-glass.mjs` | 无重启验证:--old-bundle 基线对比、hover 前后标记快照、状态复原断言、设置弹窗子树 dump |
| `scripts/qa/pngdiff.cjs` | 纯 Node 的 8-bit PNG 像素 diff(无依赖),输出占比/均值/最大差/包围盒 |
