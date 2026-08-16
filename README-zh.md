# dsh-skin-glass

给 DeepSeek Harness（DSH）Web GUI 换肤的毛玻璃皮肤插件。

- 🖼️ 任意背景图 — 自动提取主色调，生成整套浅色/深色设计令牌
- 💎 逐组件真 `backdrop-filter` 玻璃，遮罩按图自适应，带镜面边缘高光
- 👓 可读性底线 — 任何通透度下正文对比度都 ≥ WCAG AA

| 浅色模式 | 深色模式 |
| --- | --- |
| ![浅色模式](screenshots/screenshot_0.jpg) | ![深色模式](screenshots/screenshot_1.jpg) |

## 安装

```bash
git clone https://github.com/noexcs/dsh-skin-glass
cd dsh-skin-glass && bash install.sh
```

或直接从 GitHub 安装：`bash <(curl -fsSL https://raw.githubusercontent.com/noexcs/dsh-skin-glass/main/install.sh)`。

或手动用 dsh CLI 安装（直接从 GitHub 拉取）：

```bash
dsh plugin --profile web add github:noexcs/dsh-skin-glass
```

脚本自动安装到 `web` profile 并重启 `dsh web`，之后到 **设置 → 通用 → 背景图** 选择图片即可生效；不设背景图时皮肤完全不介入。

## 卸载

```bash
bash uninstall.sh
```

## License

[MIT](LICENSE)
