# dsh-skin-glass

给 DeepSeek Harness（DSH）Web GUI 换肤的**毛玻璃皮肤插件**：

- 🖼️ **任意背景图**：设置 → 通用 → 背景图，选择本地图片（自动压缩为 data URL 持久化）
- 🎨 **主题色自动提取**：从背景图提取主色调（k-means 量化），生成整套浅色/深色设计令牌
- 🧊 **毛玻璃效果**：面板半透明 + `backdrop-filter` 模糊，组件呈玻璃质感；模糊强度可调

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

安装脚本会自动完成：安装插件依赖 → 安装到 web profile → 自动重启 `dsh web` →
就绪后提示。刷新页面后到 **设置 → 通用 → 背景图** 选择图片即可生效。

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
├── src/               # 源码：color.cjs（取色数学）+ main.js（客户端逻辑）
├── scripts/build.mjs  # 由 src 生成 lib/client.js
├── install.sh / uninstall.sh / restart-web.sh
└── docs/development.md  # 实现原理（面向开发者）
```

## License

[MIT](LICENSE)
