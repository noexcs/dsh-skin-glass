# 开发文档：dsh-skin-glass 实现原理

> 面向想改皮肤或排查问题的开发者。普通用户只需要 README 里的一键安装/卸载。

## 架构

```
┌─ 设置 → 通用 → 背景图（settings.general.item 槽位）
│   行组件（React）→ inject face（chooseFile / clearImage / setBlur / setTranslucency）
│        ↓ 持久化
│   localStorage（"dsh-skin-glass:v1" = { image: data URL, blur, translucency }）
│   注：不走 settings 传输——浏览器可读写的命名空间是宿主侧硬编码白名单
│   （dsh-host-apiproxy 的 exposedNamespaces），第三方命名空间无法写入；
│   皮肤属浏览器呈现偏好，存 localStorage 与平台"非 loopback 内存态"分层一致
│        ↓ 直接刷新
├─ 取色与画像：canvas 采样 64×64 → 一次采样同时得到
│   主色调（k-means 量化 k=6）+ 壁纸亮度画像（均值/标准差）
│   （src/color.cjs 纯函数，node 可测）
│        ↓
├─ ctx.theme.overrideTokens("dsh-skin-glass", 106 个 { light, dark } 令牌对)
│   —— 官方主题服务，写为 <body> 内联 CSS 变量，自动跟随明暗
└─ 毛玻璃 chrome（data-plugin-css 样式标签，官方支持的插件 CSS 注入）：
     body::before = 壁纸层：scrim 渐变 + 图片，filter: blur(…) —— 壁纸模糊在这层
     运行时识别器给每个玻璃面打标记，按定位方式分两种承载：
       • 浮层（fixed/absolute：菜单 / 弹窗 / portal 弹层）直接挂 backdrop-filter
       • 在流面板（列 / 卡片 / 行：侧栏、对话列、轨迹面板）把磨砂挂在自身 ::before
         伪元素上——视觉一致，但面板本身不再是 fixed 后代的包含块，悬停提示气泡
         （内联 position: fixed）既不被重锚定，也不会触发任何摘除
     （大面积玻璃面额外走 SVG feDisplacementMap 折射，仅 Chromium）
     整套规则由 html[data-dsh-glass] 门控（无背景图时皮肤零介入）
```

## 玻璃面是「算出来」的，不是选择器选出来的

产品的类名是按构建内容哈希的（`VOzbGW_panel`、`_wrap_1ao1y_1`），扫一遍它的样式表，
用到表面令牌的类名有 **约 80 个**，而且大量是 `root` / `row` / `body` / `header` / `card`
这种泛名——`[class*="_root"]` 既会误伤一大片，又会把 backdrop-filter **层层嵌套**（模糊
叠模糊会糊成一团，开销还翻倍）。所以选择器这条路是错的。

改成**问渲染结果**：`getComputedStyle(el).backgroundColor` 的 alpha 落在真实表面区间
（0.2–0.995）、尺寸够大、且尚未进入某个玻璃面内部的元素，就是玻璃面。这条判据与类名
完全无关，产品换构建也不会失配。

几条关键规则，每条都有对应的测试（`scripts/check-surfaces.mjs`）：

- **命中后停止「打标」但继续下探**：只取最外层、杜绝嵌套 backdrop-filter；之所以不能像
  最初那样直接剪枝，见下面那条——要找的东西恰恰藏在玻璃面**内部**。
- **在流面板的磨砂挂在 `::before` 伪元素上**：`backdrop-filter` 会让元素成为其 fixed
  后代的**包含块**。产品的 Tooltip 气泡是内联渲染的 `position: fixed` span（就在输入框
  的按钮旁），设置弹窗也是内联渲染的 `position: fixed; inset: 0` div（就在侧边栏里）。
  滤镜一旦直接挂在面板上，悬停气泡就会被重锚定错位，旧方案只好在气泡挂载时把整条
  玻璃祖先链摘掉——这就是「鼠标划过按钮，透明效果消失」的根因。改成伪元素承载后：
  面板本身不再是包含块，气泡位置始终正确，玻璃也不再被摘除；设置弹窗的 `inset: 0`
  也永远以视口为参照。伪元素需要面板 `position: relative` 锚定 `inset: 0`（只影响
  absolute 后代，不影响 fixed 后代）。仅当 fixed 元素出现在**真正挂滤镜的浮层**内部
  时，才沿用摘除逻辑，且按快照精确恢复（旧版的重扫会造成标记漂移）。
- **浮层壳内的面板仍然直挂滤镜**：设置弹窗的外壳是透明的 fixed 容器（被「铺满视口」
  规则跳过），内部面板是 `position: relative`。面板背后是遮罩和应用内容，若走伪元素
  磨砂会被遮罩盖住、折射被遮罩的模糊洗掉——这就是「设置面板效果消失」的根因。所以
  在流元素往上 12 层内遇到 fixed/absolute 外壳时按浮层处理；扫描器下探经过**未标记的**
  离流外壳时也会重置玻璃上下文，保证重扫（改通透度）后设置面板的滤镜不丢。
- **嵌套填充按「玻璃区」染色**：位于已标记玻璃区（sheet 或 surface）内的填充元素都会
  按 `nestedTintScale` 缩放 alpha——包括经 MutationObserver 增补进 DOM 的子树（设置弹窗
  的面板、遮罩都在侧栏 sheet 区内，不染色就会叠成实心）。这是属性级查找，零样式开销。
- **跳过铺满视口的面**：它背后只有壁纸（本来就模糊过了），是全应用最贵的一次 backdrop
  却没有任何视觉收益。跳过但**继续下探**。
- **alpha < 0.2 的不算**：那是 hover 着色，不是表面。

### 同色堆叠必须清零

产品里大量组件会在自己的面板内部**重复刷同一个背景令牌**：轨迹面板 `details` 是
`bg-layer-1`，而它内部的 `split` / `table` / `assistantOutput` / `schema` /
`overviewHeading` / `promptDiff` **又都是 `bg-layer-1`**。

不透明主题下这么写完全没有副作用——同色覆同色看不出任何区别，所以产品自然会这么写。
但令牌一旦变半透明，每叠一层就乘一次：α 0.81 叠四层就是 99.9% 不透明，面板直接变实心。
**这就是「轨迹界面没有变透明」的原因，令牌本身是对的。**

所以识别器在下探时携带「最近一个上层实际绘制的背景色」，凡是后代的计算背景色与它
**完全相同**，就打 `data-dsh-glass-merge` 置为透明——恢复不透明主题本来的样子。

只认**完全相同**：面板里嵌一个真正不同的面（代码块之类）本来就该看得见，保留。
而且遇到不同颜色的中间层时，参照色会更新成那一层——否则 `A > B > A` 里最内层的 A
被清零后会错误地露出 B。这条有专门的测试。

### 异色嵌套要「染色」而不是「加板」

同色清零只解决了一半。轨迹面板剩下的实心来自**颜色不同但同样在堆叠**的那一类：它的行
几乎每一行都有自己的底色（`bg-module-platform`、`state-*-tertiary`、
`color-mix(…, bg-layer-1)`、`markdown-code-block`），一行压一行铺满整个面板。

这些底色是**为不透明底板设计的**——在那里它们唯一的作用是染色。放到玻璃上，它们染色的
同时还在**追加不透明度**，于是面板自己的令牌再透也没用。

所以玻璃面内部凡是还在实际绘制背景的后代，其 alpha 会按 `nestedTintScale(t) = 1 - 0.7t`
缩放（t=0 时为 1，即不透明档位不做任何改动）。色相保留，堆叠没了。

因为是逐元素的值，只能写成**行内样式**；原始颜色存在 `data-dsh-glass-tint` 属性里，
所以重扫时能分辨「已经缩放过」和「还没缩放」，不会反复相乘。产品自己设了行内背景的
元素一律不碰。

`nestedTintScale` 定义在 `src/color.cjs` 并被对比度脚本共用——**运行时和测试必须按同一套
合成规则算**，否则测试就是在给浏览器不会绘制的组合打分。对比度脚本因此也加了 `parent`
字段：嵌套面按「壁纸 → scrim → 父面 → 缩放后的子面 → 文字」评分。

增量维护靠 `MutationObserver`（产品会流式渲染 markdown、用 portal 挂弹层，新表面一直在
出现），加进队列后在 `requestIdleCallback` 里分片处理，每片上限 2500 个元素。改通透度时
令牌 alpha 变了，`retag()` 清空重扫。

## 折射（仅 Chromium）

`backdrop-filter: url(#…)` 只有 Chromium 支持——Safari / Firefox 为了把 backdrop-filter
留在 GPU 上，只允许内置滤镜函数（[W3C svgwg#1142](https://github.com/w3c/svgwg/issues/1142)
正在讨论标准化）。所以这是**纯增强**：`CSS.supports()` 检测不通过时，识别器根本不发
`lg` 这个值，那条规则永远不匹配，自动退回 blur + saturate。

位移图用的是 `feTurbulence`（湍流）而不是「液态玻璃」组件常用的边缘聚集渐变映射——因为
我们要把它套在识别器找到的**任意尺寸**元素上，映射必须与元素大小无关。

社区那些 liquid-glass 库（nikdelvin、deepika-builds、liquid-svg-glass 等）**对本插件无法
直接复用**：它们提供的是 React/Web 组件，要塞进你自己的 JSX；而皮肤插件不拥有产品的 DOM，
只能注入 CSS + 覆盖令牌。能搬的只有 SVG 滤镜这一技术本身。

## 可读性模型（本皮肤的核心约束）

半透明表面只削弱背景的**细节**，不削弱**亮度起伏**。所以「统一调透明度」必然在某些
壁纸上让文字失去对比度。本皮肤把表面按承载物分三层，只有 A 层跟随通透度大幅变化：

| 层 | 代表令牌 | alpha 区间（t: 0→1） |
| --- | --- | --- |
| A 通透层 | `bg-base`（助手正文坐在这层）、`sidebar-fill` | 0.90 → 0.28 / 0.86 → 0.24 |
| B 半通透阅读层 | `bg-layer-1`、`bubble`、`input-major`、`markdown-*`、各类按钮面 | 0.94 → 0.64 |
| C 浮层阅读面 | `bg-layer-2`（**设置面板/对话框**）、`bg-layer-3`、`specific-menu`、`overlay`、toast/tooltip | 0.96 → 0.72 |

这些 alpha 比「纯平铺」时代低得多，前提是**每个玻璃面现在都有自己的 backdrop-filter**：
表面终于是在透出**应用内容**，而不只是给一张预模糊壁纸上色。没有逐面模糊时，同样的
alpha 只会变成一片糊掉的底色。

真正让 A 层敢放开的是 **scrim**：`--dsh-glass-scrim` 在壁纸之上先把亮度方差压平，再让
半透明表面叠上去。它作为令牌下发，因此明暗切换自动生效，chrome CSS 里不需要写
`body[data-ds-dark-theme]` 分支。

### scrim 按图片自适应

关键观察：**每种配色只怕一个方向**——浅色模式（深色文字）怕的是**暗**壁纸，深色模式
（浅色文字）怕的是**亮**壁纸。所以两套 scrim 各自只按自己面对的威胁定量：

```
needLight = clamp01( (1 - meanL) + 1.6 * stdL )
needDark  = clamp01(      meanL  + 1.6 * stdL )
scrim = base + t * range * need
```

`need = 1` 正好复现「按最坏图片留余量」的固定值，也就是一张纯黑（浅色模式）或纯白
（深色模式）壁纸拿到的下限；友好的图片会落到远低于它的位置，把透明度真正赚回来：

| 壁纸 | 浅色 scrim | 深色 scrim |
| --- | --- | --- |
| 纯黑 | 0.48 | **0.06** |
| 纯白 | **0.04** | 0.58 |
| 偏暗的照片 | 0.48 | 0.31 |
| 中间调、平 | 0.30 | 0.37 |

`meanL` / `stdL` 由 `analyzeWallpaper()` 从**取色用的同一批采样**算出，不额外读一次图。
采样是 1920px 图降到 64×64 的结果，每个采样点本身已是重度均值——所以 `stdL` 恰好近似
「经过 chrome 层模糊之后还幸存的方差」，这正是我们需要的量。

`1.6` 这个系数是**测出来的不是猜的**：取 1.2 时，深色模式 + 青色主色调 + 中间调高对比
壁纸会把侧边栏压到 4.47:1，刚好低于 AA。

### 镜面边缘高光

玻璃的「厚度」来自左上亮、右下暗的那圈内描边。这层通过 `--dsw-shadow-lv2/lv3` 注入
`inset` 阴影——已核实全产品 **21 处消费这些令牌，全部是 `box-shadow`，0 处
`filter: drop-shadow()`**（后者遇到 `inset` 会整条失效），所以这条路对话框、菜单、面板、
toast 一次覆盖，且不需要任何选择器。深色模式高光必须压到 `0.12`，否则边缘发白。

`scripts/check-contrast.mjs` 是这套模型的守门人：按浏览器实际的合成顺序
（壁纸 → scrim → 遮罩 → 表面 → 文字），对 5 种主色调 × 5 档通透度 × 7 种壁纸画像 ×
明暗 × 每种画像的明暗两个极端，共 **10500 组**断言正文对比度 ≥ WCAG AA 4.5:1。
改任何 alpha 或 scrim 系数前先跑它。

自适应 scrim 之后，测试模型也必须跟着变严：**不能再拿一种画像喂给皮肤、却用另一种壁纸
去合成**——那等于拿皮肤没见过的图给它打分。所以每个画像同时给出「皮肤看到的统计量」和
「这个画像真正可能产生的最坏局部背景」。因为壁纸层会被模糊，极端像素会被拉向均值，
最坏局部块取 `mean ± 2σ` 而不是图片的绝对最黑/最白。

脚本还会遍历**全部**令牌做结构断言（值里不得出现 `undefined` / `NaN` / 空串），见下。

## 为什么壁纸的模糊不用 backdrop-filter

（注意与上面的「逐面 backdrop-filter」区分：**壁纸**的模糊在壁纸层自己完成，
**表面**的 backdrop-filter 模糊的是它背后的应用内容。两者职责不同。）

早期版本用 `#root > div{backdrop-filter:blur(…)}` 来做壁纸模糊。但 `#root` 的 backdrop **只有壁纸**
——`body` 背景透明，`body::before` 是 `z-index:-1` 的固定层，后面只剩 `html` 的底色。
所以那层 backdrop-filter 与「直接模糊壁纸本身」视觉等价，却要每帧对全视口重算，而且：

- 产品的 Popover 原语走 `createPortal(J, document.body)`（容器类名 `_portal_…`），
  DOM 上是 `#root` 的**兄弟**，永远拿不到 `#root` 内部的模糊——下拉菜单因此直接压在
  几乎未处理的壁纸上。壁纸层模糊天然覆盖它们。
- `backdrop-filter` 会让元素成为 fixed 定位的包含块。逐面 backdrop-filter 把这个副作用带
  了回来，识别器用两条规则兜住：跳过铺满视口的面；**在流面板的磨砂改挂 `::before`
  伪元素**（见上）——面板本身不再是包含块，内联渲染的 fixed 气泡（按钮悬停提示）和
  设置弹窗都不会再被重锚定，玻璃也不会在悬停时被摘除。**这条真的会咬人**——修复前
  「鼠标划过命令/上下文/发送按钮，透明效果消失」就是它的症状，现在有专门的回归测试守着。

代价是失去「弹层背后的**应用内容**被模糊」的层次感，用产品自带的钩子补回：模态遮罩
（`.mask`）本就声明了 `backdrop-filter: var(--dsw-mask-blur)`，而该变量默认只有
`blur(2px)`（定义在 `dsh-client-ui-theme/lib/styles/gradient-shadow-text.css` 的
`body {}` 上）。皮肤把它覆盖为 `blur(blur*0.75)`。这条之所以合法：`overrideTokens` 的
`validateOverrides` 只校验 `{light, dark}` 结构、**不校验变量名**，且令牌最终由
`ThemePresenter` 写成 `document.body.style.setProperty(…)`，行内样式压过 `body {}` 规则。

壁纸层用 `inset: calc(-2 * var(--dsh-glass-blur))` 外扩，避免模糊在视口边缘吸入透明
像素形成暗边。

## 关键文件

| 文件 | 说明 |
| --- | --- |
| `src/color.cjs` | 纯色数学：HSL 互转、mix、tune、k-means 量化、主色挑选、壁纸亮度画像、106 个令牌对的分层生成器 |
| `src/main.js` | 浏览器侧逻辑：设置行组件、图片压缩（≤1920px、webp/jpeg）、取色、令牌应用、chrome 样式、localStorage 持久化 |
| `scripts/build.mjs` | 把 src 内联进 `lib/client.js` 的 `__ModuleLoader__.load` 包装 |
| `scripts/check-contrast.mjs` | 对比度守门人（见上「可读性模型」） |
| `scripts/check-surfaces.mjs` | 玻璃面识别器单测：桩掉 DOM 后直接跑 `src/main.js` 的内部函数 |
| `lib/index.js` | 宿主侧 no-op（loader 要求每个条目有 apply 导出；皮肤无宿主状态） |

## 构建与测试

```bash
pnpm test                       # build + node --check + 对比度断言
node scripts/build.mjs          # src → lib/client.js
node scripts/check-contrast.mjs # 10500 组正文对比度断言 + 全令牌结构断言
node scripts/check-surfaces.mjs # 52 条玻璃面识别断言（含「绝不嵌套」「悬停不摘玻璃」「设置弹窗不丢玻璃」「异色不堆叠」）
node -e "require('./src/color.cjs')"  # 取色数学可直接 node 引用
```

> 注意 `src/color.cjs` 里的 `rgb()` / `rgba()` **各只接受一个 `[r,g,b]` 数组**。
> 早期版本有 10 处误写成 `rgb(232, 236, 248)` 这样的分通道调用，产出
> `rgb(undefined, undefined, undefined)`——这类值会被 CSSOM 静默丢弃，令牌无声退回
> 基础样式表，症状是「某些面板怎么调都不生效」。对比度脚本会解析每个值，顺带挡住这类回归。

## 重新安装（改完代码后）

```bash
bash install.sh   # 幂等：依赖已装则跳过，bundle 内容变化重启后生效
```

## 校验

```bash
curl -s http://127.0.0.1:3080/ | grep -o 'dsh-skin-glass[^,]*' | head -2
curl -s "http://127.0.0.1:3080/plugins/dsh-skin-glass/client.js" | head -3
```

## 已知取舍

- 背景图存为 data URL（客户端压缩到 ≤1920px / ~2MB），存 localStorage；
  皮肤属浏览器呈现偏好，不占设置文档/附件系统。
- 不走 settings 传输的原因：`dsh-host-apiproxy` 的 `exposedNamespaces()`
  是硬编码白名单（产品命名空间），第三方命名空间无法从浏览器写入。
- 模糊在壁纸层完成，不依赖任何产品侧类名/结构选择器；唯一依赖的产品内部约定是
  `--dsw-mask-blur` 与 `--dsw-alias-bg-mask-*` 这几个令牌名。即使产品改掉它们，
  也只是失去弹层背后的内容模糊，可读性由分层 alpha 独立保证，不会退化成看不清。
- C 层（弹窗/菜单）最通透时也有 0.72 的下限：玻璃感在这类面上要让位给可读性。
- 折射只在 Chromium 生效；其余内核自动退回 blur+saturate，不会穿帮但也不会惊艳。
- 逐面 backdrop-filter 是真实的性能开销。当前取「效果优先」：所有识别到的玻璃面都开，
  面积够大的还叠折射。若长会话滚动掉帧，先调 `REFRACT_MIN_AREA`（少一些折射面），
  再调 `SURFACE_MIN_W/H`（少一些玻璃面）。
- 在流面板的磨砂挂在 `::before` 伪元素上，代价是「面板所在容器的底色不参与滤镜链」
  （旧方案中它位于面板滤镜之下会被饱和/增亮）。实测差异约为每通道 1.5% 的色调偏移，
  肉眼几乎不可辨；换取的是悬停气泡与内联弹窗的包含块问题被结构性消灭。
- 浮层（fixed/absolute）及浮层壳内的面板仍直接挂 backdrop-filter，若产品未来在某个浮层
  内部再放 `position: fixed` 元素，摘除逻辑会按快照精确恢复它。
- 明暗两套令牌均从同一主色调推导：浅色用加深版、深色用提亮版。

## 多皮肤共存（重要）

所有皮肤插件都通过 `ctx.theme.overrideTokens(source, tokens)` 叠加令牌层。主题运行时的
规则是：**按调用顺序叠加，同一令牌后者覆盖前者**（`overrideSeq` 单调递增）。

- aurora 在插件 apply 时无条件调用（启动即生效）；
- glass 在**设置了背景图后**才调用（晚于 aurora），所以有图时两者重叠的令牌以 glass 为准；
- 双方各自独有的令牌互不影响（aurora 的静态色、glass 的动态色阶）；
- 移除背景图时 glass 的层被 dispose，aurora 完全恢复。

**结论：想纯粹体验某个皮肤，一次只装一个**（`bash uninstall.sh` 切换即可）；
共存时生效顺序是 glass（有图）> aurora > 内置主题。
