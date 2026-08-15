# dsh-skin-glass

给 DeepSeek Harness（DSH）Web GUI 换肤的**毛玻璃皮肤插件**：

- 🖼️ **任意背景图**：设置 → 通用 → 背景图，选择本地图片（自动压缩为 data URL 持久化）
- 🎨 **主题色自动提取**：从背景图提取主色调（k-means 量化），生成整套浅色/深色设计令牌
- 💎 **逐组件真玻璃**：运行时识别每个玻璃面——浮层（菜单/弹窗）直接挂 `backdrop-filter`，
  面板的磨砂挂在自身 `::before` 伪元素上，透出背后的应用内容，同时不会把按钮悬停提示
  （内联 `position: fixed` 气泡）重锚定；大面额外叠 SVG 位移**折射**（Chromium）
- ✨ **镜面边缘高光**：浮层左上亮、右下暗的内描边，让玻璃有厚度
- 🧊 **模糊与通透度分开调**：「背景模糊」只柔化壁纸，「通透度」只放开聊天背景与侧边栏
- 🔆 **遮罩按图自适应**：分析壁纸明暗后只压制真正影响可读性的方向——深色壁纸在深色模式下
  几乎不加遮罩，同样的通透度看起来更透
- 👓 **字迹永远看得清**：弹窗、菜单、代码块、输入框等阅读区域有不透明度下限，
  最通透档位下正文对比度仍 ≥ WCAG AA（由 `scripts/check-contrast.mjs` 10500 组断言守住），
  并跟随系统的「降低透明度」偏好

| 效果预览 | |
| --- | --- |
| （截图待补充） | |

## 快速安装

方式一：克隆后一键安装（推荐）

```bash
git clone https://github.com/noexcs/dsh-skin-glass
cd dsh-skin-glass
bash install.sh
```

方式二：不克隆，直接从 GitHub 安装

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/noexcs/dsh-skin-glass/main/install.sh)
```

安装脚本会自动完成：安装到 web profile → 自动重启 `dsh web` → 就绪后提示。
刷新页面后到 **设置 → 通用 → 背景图** 选择图片即可生效（偏好保存在浏览器本地）。
没有设置背景图时，皮肤完全不介入，外观与原生主题一致。

## 快速卸载

```bash
cd dsh-skin-glass
bash uninstall.sh
```

卸载后自动重启 `dsh web`，刷新页面即恢复默认外观。

## 要求

- **pnpm**：`corepack enable` 或 `npm i -g pnpm`
- **dsh CLI**：可选的；没有时脚本会自动用 `npx @deepseek-ai/dsh` 兜底

## 目录结构

```
dsh-skin-glass/
├── package.json       # 插件包（dsh.bundle + dsh.client 双 manifest）
├── cordis.patch.yml   # bundle patch 层，挂载插件行
├── lib/               # 宿主侧（设置命名空间注册）+ 浏览器侧 bundle
├── src/               # 源码：color.cjs（取色数学 + 分层令牌）+ main.js（客户端逻辑）
├── scripts/build.mjs  # 由 src 生成 lib/client.js
├── scripts/check-contrast.mjs  # 正文对比度断言（WCAG AA）
├── scripts/qa/        # 无重启验证：verify-glass.mjs（bundle 路由替换 + hover 回归）
│                      # + pngdiff.cjs（纯 Node 像素 diff）
├── install.sh / uninstall.sh / restart-web.sh
├── docs/development.md  # 实现原理（面向开发者）
└── docs/debugging.md    # 调试与验证手册（含本次「效果消失」案例排查法）
```

## License

[MIT](LICENSE)
