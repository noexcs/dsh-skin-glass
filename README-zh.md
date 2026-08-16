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
npx @deepseek-ai/dsh plugin --profile web add github:noexcs/dsh-skin-glass
```


## 卸载

```bash
npx @deepseek-ai/dsh plugin --profile web remove dsh-skin-glass
```

## License

[MIT](LICENSE)
