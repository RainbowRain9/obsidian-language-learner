---
name: local-build-debug
description: 本地构建插件、在 Obsidian vault 中实机联调、排查样式不生效/构建产物异常/构建报错，或需要区分仓库遗留死文件时使用。凡涉及 npm run build / npm run dev / .build/ 产物 / styles.css 样式管线 / link:obsidian 联调的问题都应触发本 skill。
---

# 本地构建与实机联调（local-build-debug）

## 何时使用

- 本地构建插件、检查 `.build/plugin/` 产物是否正常（缺文件、bundle 异常、构建报错）。
- 要在真实 Obsidian vault 里联调：把构建目录链接进 `<vault>/.obsidian/plugins/`、保留用户 `data.json`。
- 排查「样式不生效」：改了 CSS / Vue SFC style 但界面没变化，需要理清样式打包管线。
- 全文搜索命中可疑文件，需要判断哪些是仓库遗留死文件（不参与编译、不该参照）。

## 必读文件（动手前先读）

| 文件 | 看什么 |
|---|---|
| `esbuild.config.mjs` | entryPoints（`./src/plugin.ts`，第 59 行）、样式入口生成（`writeStylesEntry`，35-44 行）、external 列表（61-86 行）、dev watch 行为（118-125 行） |
| `scripts/link-obsidian-plugin.mjs` | junction 链接、旧目录时间戳备份、`data.json` 拷贝、幂等逻辑（46-81 行） |
| `src/stalin.css` | 全局静态样式（词典图标、speaker 等）的存放处 |
| `src/styles/settings.css` | 设置页样式，经 `src/settings.ts:39` 的 `import "./styles/settings.css"` 进入 bundle |
| `package.json` | scripts 定义（7-9 行：`dev` / `build` / `link:obsidian`） |

## 推荐执行流程

### 常规构建

```bash
npm install
npm run build    # = tsc -noEmit -skipLibCheck && node esbuild.config.mjs production（package.json:8）
```

产物输出到 `.build/plugin/`，共 4 个文件（本次实测 `ls .build/plugin/` 确认）：

- `main.js`——JS bundle（prod 时 minify、无 sourcemap；dev 时非 minify、inline sourcemap，见 esbuild.config.mjs:90-91）
- `main.css`——Vue SFC 样式的汇聚副产物（esbuild 把 SFC `<style>` 抽到与 outfile 同名的 .css）
- `manifest.json`——每次构建从仓库根 `manifest.json` 复制（esbuild.config.mjs:31-33）
- `styles.css`——由 `.build/styles.entry.css` 打包而来

`.build/` 在 `.gitignore` 中，不入库。

### 实机联调（vault 中调试）

```bash
npm install
npm run link:obsidian -- "<vault>/.obsidian/plugins/obsidian-language-learner"
npm run dev
# 然后在 Obsidian 里重载插件（禁用再启用，或 Ctrl/Cmd+P → Reload app without saving）
```

`link:obsidian` 的行为（scripts/link-obsidian-plugin.mjs:46-81）：

- 把插件安装目录 **junction 链接**到仓库的 `.build/plugin`，之后 `npm run dev` 的每次增量构建直接反映到 vault。
- 目标目录已存在时：先重命名为 `<目录>.backup-<时间戳>`，备份里的 `data.json` 会被拷贝进构建目录（用户设置不丢）。
- 幂等：目录已是指向 `.build/plugin` 的链接时直接返回，不重复备份。
- 链接后真实运行数据在 `.build/plugin/data.json`。

### dev watch 的两个特性（esbuild.config.mjs）

- JS 与 CSS 双 watch；另以 500ms `watchFile` 监听根 `manifest.json` 并同步到 `.build/plugin/manifest.json`（121-125 行）。
- **`npm run dev` 不跑 tsc**（package.json:7 只有 `node esbuild.config.mjs`），watch 期间的类型错误不会被发现，提交前务必手动 `npx tsc -noEmit -skipLibCheck`。
- Vue 插件在 dev 下也是 `isProd: true`（第 57 行），本地调试**不会**出现 Vue 开发模式警告，不要据此误判代码路径。

## 样式管线（排查「样式不生效」必看）

`styles.css` 的生成链：

1. 每次构建（dev 和 prod 都会）先执行 `prepareBuildArtifacts()` 重写 `.build/styles.entry.css`（esbuild.config.mjs:46-50），内容固定为两行 `@import`（本次构建后实测）：
   ```css
   @import "../src/stalin.css";
   @import "plugin/main.css";
   ```
2. esbuild 再把该入口打包成 `.build/plugin/styles.css`。所以最终 `styles.css` = `src/stalin.css` + `.build/plugin/main.css`，而 `main.css` 汇聚了所有 Vue SFC 的 `<style>` 与 `src/settings.ts:39` 引入的 `src/styles/settings.css`。
3. Obsidian 只加载插件目录下的 `styles.css` 与 `main.js`；改样式后确认对应内容确实进了 `.build/plugin/styles.css`（如 `grep -c "ll-settings-container" .build/plugin/styles.css`，本次实测命中）。

样式修改的落点约定：

- 全局图标 / 静态样式 → `src/stalin.css`。**文件名被 esbuild.config.mjs:36-38 硬编码**，改名必须同步改构建脚本。
- 设置页样式 → `src/styles/settings.css`。
- 组件样式 → 对应 `.vue` 的非 scoped `<style>`（scoped 样式只对 SFC 生效，popup 等挂在 `document.body` 的全局浮层不要用 scoped）。
- 颜色 / 主题相关一律优先用 Obsidian CSS 变量（`--background-*`、`--text-*`、`--interactive-accent` 等），兼容明暗主题。
- `src/main.css` 是**无引用孤儿文件**：源码中无任何 import 引用它（本次 grep 全 src 无命中），且它自己的 `@import "../main.css"` 指向不存在的仓库根文件。不要编辑、不要参照。

## esbuild external 与 Node 模块陷阱

external 列表（esbuild.config.mjs:61-86）= `obsidian`、`electron`、`@codemirror/*` + `builtin-modules` 包展开。实测该包共 44 项，除裸模块名外仅含 `node:sea`、`node:sqlite`、`node:test` 三个**无子路径**的 node: 名——即：**任何 `node:模块/子路径` 形式的导入都不在 external 覆盖范围**，esbuild 会尝试打包并在打包失败时报 "wasn't found"。

已知雷：`src/modals.ts:1` 的 `import { text } from "node:stream/consumers"` 是死导入，当前仅因 tree-shaking（符号未被使用）通过构建（本次实测 `grep -c "node:stream/consumers" .build/plugin/main.js` = 0）；一旦实际使用该符号，构建立即失败。修复方向是移除该导入或改用 Web 兼容实现。

另注意 `manifest.json` 的 `isDesktopOnly: false`——插件需兼容移动端，新增 Node 内置模块依赖本身就不合法。

## 遗留死文件清单（不编辑、不参照、搜索时排除）

以下文件被 git 跟踪但不在编译路径上（tsconfig include 只有 `src/**/*.ts|tsx|vue`，`.backup` 后缀不匹配；也不在 esbuild 依赖图中）：

- `src/settings.ts.backup`、`src/views/ReadingArea.vue.backup-20260113-103410`——历史快照，全文搜索时极易误命中，务必排除。
- `_backup_src_20260202_222150/`——初始导入遗留目录（内有 styles.css 等）。
- 根目录 `data.json`——**含明文 API key**（`ai.api_key`，本次已验证存在、未回显）：禁止复制、回显、当作测试夹具。构建链完全不读写它，改它对插件零影响。
- `src/db/web_db.ts`、`src/api/server.ts`——无任何活跃 import、不进 bundle（本次实测 grep `web_db`/`WebDb`/`api/server` 在 main.js 中均为 0），但**仍在 tsc 检查范围内**（匹配 include glob），改共享类型时可能在这里报编译错。
- `src/main.css`——见上文样式管线一节。

在全文搜索时建议显式排除：`grep -r --exclude="*.backup*" --exclude-dir=_backup_src_* ...`（或 ripgrep 默认已忽略 .gitignore，但注意这些 backup 文件**被跟踪**，rg 不会忽略它们）。

## 完成后的验证方式

```bash
npx tsc -noEmit -skipLibCheck     # 类型检查（本次实测 exit 0）
npm run build                     # 完整构建（本次实测 exit 0）
ls .build/plugin/                 # 必须恰好 4 个文件：main.js main.css manifest.json styles.css
grep -c "可疑模块名" .build/plugin/main.js   # 确认某模块是否进 bundle（0 = 未进）
grep -c "选择器名" .build/plugin/styles.css  # 确认样式改动是否生效
```

涉及样式或 UI 的改动，最终以 vault 实机重载插件后的表现为准（link:obsidian + npm run dev 流程）。
