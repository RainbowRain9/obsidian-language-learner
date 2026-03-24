# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

- 这是一个 Obsidian 插件：Language Learner。核心能力包括查词、例句翻译、单词采集、阅读模式和学习统计。
- 可编辑源码在 `src/`。根目录的 `main.js`、`styles.css` 是构建产物，不要直接修改。
- `manifest.json` 才是插件元数据的权威来源；`package.json.name` 仍然保留了 sample plugin 的旧值，不能据此判断真实插件 ID。

## 先确认 source / bundle 是否分叉

- 这个仓库存在“`src/**` 与已构建 `main.js` / 外部参考构建不完全同步”的情况。
- 如果用户说“运行中的插件已经有某个功能”，不要只看 `src/` 就下结论；先核对相关源码文件，再看当前根目录 `main.js` 是否已经包含该行为。
- 如果用户要求实现 / 修复功能，默认以 `src/**` 为可维护实现位置；`main.js` 只作为行为参考，不作为正常修改目标。
- 如果用户提到旧词典列表、旧设置布局或历史功能，优先检查当前 `src/`，不要根据旧 README、旧 bundle 记忆或历史分支做判断。

## 常用命令

- `npm install`：安装依赖。
- `npm run dev`：启动 esbuild watch。入口是 `src/plugin.ts`，输出 `main.js`；同时把 `src/main.css` 打包为 `styles.css`。
- `npm run build`：先执行 `tsc -noEmit -skipLibCheck`，再执行生产构建。
- `npx tsc -noEmit -skipLibCheck`：仅做 TypeScript 检查。
- `node esbuild.config.mjs production`：只做生产打包，不运行 TypeScript 检查。
- `npm run version`：根据 `package.json.version` 更新 `manifest.json` 和 `versions.json`。
- `npm run pub -- <version>`：发布脚本；会改 `manifest.json`、提交、`git push`、打 tag 并推送 tag，不是普通本地开发命令。

## 测试与 lint 现状

- 当前仓库没有测试框架、没有 `npm test` 脚本，也没有已提交的测试文件。
- 因此不存在“运行单个测试”的现成命令；如果需要测试，需要先补测试基础设施。
- 仓库里有 `.eslintrc`，但 `package.json` 没有 `lint` 脚本，也没有显式声明 `eslint` 依赖，所以 lint 不是当前主开发流程的一部分。
- 当前最可靠的回归检查方式是：`npm run build`，然后在 Obsidian 里实际加载插件验证交互。

## 当前源码中的关键能力

### 1. 插件入口与全局挂载

- `src/plugin.ts` 是唯一入口，也是运行时编排中心。
- `onload()` 负责加载设置、初始化数据库、初始化 `TextParser`、注册命令 / 视图 / Ribbon 图标，并挂载全局 Vue 应用。
- `src/views/Global.vue` 目前负责全局 popup 搜索浮层；当前 `src/` 里没有全局 toast 事件通道。

### 2. 词典层：当前 `src/` 以 AI / Google 为准

- 当前注册表在 `src/dictionary/list.ts:1`，注册的是 `youdao` / `cambridge` / `ai` / `google`。
- 如果用户提到 `Jukuu` / `HJdict` / `DeepL`，那是旧实现或其他参考构建，不是当前 `src/` 的注册结果。
- 每个 provider 基本都是 `engine.ts` + `View.vue`：
  - `engine.ts` 负责请求与解析。
  - `View.vue` 负责展示和 loading 状态。
- `SearchPanel.vue` 会按 `plugin.settings.dictionaries` 的启用状态与优先级动态渲染词典。

### 3. 查词、采集、例句翻译是同一条事件链

- 统一入口是 `plugin.queryWord()`，它会派发 `obsidian-langr-search` 事件。
- `Global.vue` 监听这个事件，负责 popup 搜索框定位与显示。
- `SearchPanel.vue` 监听同一事件，维护搜索历史并渲染词典结果。
- `LearnPanel.vue` 也监听同一事件：
  - 自动预填词条表单。
  - 尝试从数据库读取已有词条。
  - 自动补全词形变化。
  - 可在“机器翻译 / AI 翻译”之间切换例句翻译，而不只是单向机器翻译填充。
- 这部分能力已经在当前 `src/views/LearnPanel.vue` 中，不需要依赖外部参考构建才能确认。

### 4. 设置页已经是 tabbed settings，不是旧的线性 section

- 当前设置页实现位于 `src/settings.ts`，已经是 tabbed UI，而不是旧的平铺 section。
- 当前 `src/` 已经包含：
  - `Configuration Management`（配置导出 / 导入）
  - `AI Settings`（provider、API URL、API Key、model、prompt）
  - `Test Connection`（连接测试）
  - `Hover Definition` 开关与语言配置
- 如果用户说这些能力“参考构建里才有”，先核对当前 `src/settings.ts`，因为这部分已经同步到源码。

### 5. 阅读模式链路

- 阅读模式不是独立 markdown 渲染器，而是对 Obsidian 原生视图做增强。
- `src/plugin.ts` 使用 `monkey-around` patch `MarkdownView` 和 `WorkspaceLeaf`，为带 `langr` frontmatter 的笔记提供 “Open as Reading View”。
- `src/views/ReadingView.ts` 是自定义 `TextFileView`，真正的 UI 在 `src/views/ReadingArea.vue`。
- `src/views/parser.ts` 的 `TextParser` 是核心：
  - 用 `unified` + `retext-english` 解析文本。
  - 查询数据库里的已知单词 / 短语。
  - 输出带状态 class 的 HTML。
  - 处理短语包裹、部分 Markdown 样式、音频嵌入和词数统计。
- `src/utils/frontmatter.ts` 负责把阅读位置等状态写回 frontmatter，例如 `langr-pos`。

### 6. 悬停释义已经在当前源码中

- 当前 `src/settings.ts` 已经有 `hover_definition_enabled` 和 `hover_definition_lang`。
- 当前 `src/views/ReadingArea.vue` 已经有 tooltip 创建、定位、缓存、hover 延时和释义获取逻辑。
- 释义获取策略是：
  - 优先在本地数据库中取 meaning（当 hover 语言等于 native 语言时）。
  - 否则走 Google 翻译获取简短释义。
- 所以“hover definition 只在参考构建里”这个判断对当前 `src/` 已经不成立。

### 7. 数据存储抽象

- `src/db/base.ts` 定义统一 `DbProvider` 抽象接口。
- `src/db/idb.ts` 定义 Dexie / IndexedDB schema，核心表是 `expressions` 和 `sentences`。
- `src/db/local_db.ts` 是纯 IndexedDB 实现。
- `src/db/file_db.ts` 是文件库 / Dexie 混合实现：会读写 `word_folder` 里的单词笔记 frontmatter，同时保留缓存与辅助查询能力。
- `src/plugin.ts` 的 `openDB()` 运行时只依据 `settings.only_fileDB` 选择 provider：
  - `false` → `LocalDb`
  - `true` → `FileDb`
- 这是个容易踩坑的点：`use_fileDB` 不是 `openDB()` 的切换开关。

### 8. 文件库与刷新机制：当前源码已经有一部分增强

- `src/plugin.ts` 当前已经有：
  - `registerWordFolderWatchers()`：监听词文件目录 create / modify / delete / rename，并使 parser frontmatter 缓存失效。
  - `scheduleRefreshTextDB()` + `runRefreshTextDB()`：防抖 + 队列式刷新。
  - `replacePDF()`，并且 `onload()` 已经调用它。
- 所以这些能力不应再被描述为“只在参考构建中”。
- 但当前 `src/` 里没有看到“自动确保默认 `words.md` / `review.md` 存在”的显式实现；如果用户要这个能力，需要补到源码里。

### 9. PDF 支持当前源码已启用

- `src/plugin.ts` 的 `onload()` 会调用 `replacePDF()`。
- `replacePDF()` 会在插件目录存在 PDF viewer 资源时注册 PDF 视图，并监听 viewer 发来的 `search` 消息。
- 因此不要再把 PDF 支持描述为“源码里是关闭 / 注释状态”。

### 10. 当前源码里仍然缺失或未发现的能力

以下能力我在当前 `src/` 中没有找到，若用户提到它们，通常意味着它们只存在于 bundle / 参考构建，尚未完整回写源码：

- “Mark as Learning Completed” 命令，以及配套写入 frontmatter 的 `completed` / `words_collected` 工作流。
- dashboard 式统计面板（Streak、Total Words、Today New、Mastered、Heatmap、Recent Activity、Hide Meaning、从统计面板打开单词文件等）。当前 `src/views/Stat.vue` 仍然只是 7 天折线图。
- 全局 toast 通道，例如 `obsidian-langr-toast` 事件和对应 UI。

如果用户要修这些能力，优先在 `src/plugin.ts`、`src/views/Stat.vue`、`src/views/Global.vue`、对应设置与语言文件中补齐，而不是改 bundle。

### 11. 遗留代码

- `src/api/server.ts` 和 `src/db/web_db.ts` 仍在仓库中，但 `src/plugin.ts` 当前主流程已不再初始化 self-server / WebDb。
- 默认情况下把它们视为遗留代码，除非用户明确要求恢复这一套能力。

## 其他仓库约定

- 路径别名在 `tsconfig.json`：
  - `@/*` → `src/*`
  - `@dict/*` → `src/dictionary/*`
  - `@comp/*` → `src/component/*`
- 版本发布依赖 `versions.json`，不要只改 `manifest.json` 而忽略它。
- 当前仓库没有 `.cursorrules`、`.cursor/rules/` 或 `.github/copilot-instructions.md`。

## 当用户说“参考构建里已经有”时的处理方式

- 先在 `src/**` 中确认该能力是否其实已经同步回来。
- 如果 `src/**` 没有，但根目录 `main.js` 或用户提供的参考 bundle 里有：
  - 把 bundle 当作行为参考。
  - 在 `src/**` 中重新实现。
  - 不要直接对 bundle 做维护性修改。
- 回答用户时要明确区分：
  - “当前源码已具备”
  - “当前源码没有，但参考 / bundle 里有”
  - “两边都没有”
