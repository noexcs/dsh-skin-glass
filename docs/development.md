# 开发文档：dsh-skin-glass 实现原理

> 面向想改皮肤或排查问题的开发者。普通用户只需要 README 里的一键安装/卸载。

## 架构

```
┌─ 设置 → 通用 → 背景图（settings.general.item 槽位）
│   行组件（React）→ inject face（chooseFile / clearImage / setBlur）
│        ↓ 写入
│   dsh-skin-glass 设置命名空间（宿主侧 settings.register 注册，
│   image: data URL，blur: 0-64px）—— 经 ctx.settingsScope 读写
│        ↓ 订阅变化
├─ 取色：canvas 采样 64×64 → k-means 量化（k=6）→ 主色调
│   （src/color.cjs 纯函数，node 可测）
│        ↓
├─ ctx.theme.overrideTokens("dsh-skin-glass", 69 个 { light, dark } 令牌对)
│   —— 官方主题服务，写为 <body> 内联 CSS 变量，自动跟随明暗
└─ 毛玻璃 chrome（data-plugin-css 样式标签，官方支持的插件 CSS 注入）：
     body::before = 固定背景图层（var(--dsh-glass-image)，轻微预模糊）
     #root > div  = backdrop-filter: blur(var(--dsh-glass-blur)) —— 整层毛玻璃
     body 背景透明，各面板令牌改为半透明 → 玻璃质感
```

## 关键文件

| 文件 | 说明 |
| --- | --- |
| `src/color.cjs` | 纯色数学：HSL 互转、mix、tune、k-means 量化、主色挑选、69 个令牌对的生成器 |
| `src/main.js` | 浏览器侧逻辑：设置行组件、图片压缩（≤1920px、webp/jpeg）、取色、令牌应用、chrome 样式 |
| `scripts/build.mjs` | 把 src 内联进 `lib/client.js` 的 `__ModuleLoader__.load` 包装 |
| `lib/index.js` | 宿主侧：`settings.register` 注册设置命名空间（唯一需要 node 依赖的地方） |
| `install.sh` | 先 `pnpm install --prod` 装包内依赖（宿主侧 import dsh-settings/schemastery），再 `dsh plugin add` |

## 构建与测试

```bash
node scripts/build.mjs          # src → lib/client.js
node --check lib/client.js      # 语法检查
node /tmp/... # 冒烟测试：模拟 window.__ModuleLoader__ 跑通 factory
node -e "require('./src/color.cjs')"  # 取色数学单测（量化/主色/令牌对）
```

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

- 背景图存为 data URL（客户端压缩到 ≤1920px / ~2MB），随设置文档持久化；
  本地单用户场景足够，不占附件系统（附件系统面向消息图片）。
- 毛玻璃 backdrop-filter 作用于 `#root > div`（AppFrame 根）；若布局结构变化
  导致选择器失配，面板仍是半透明 + 背景图预模糊，视觉退化有限。
- 明暗两套令牌均从同一主色调推导：浅色用加深版、深色用提亮版。
