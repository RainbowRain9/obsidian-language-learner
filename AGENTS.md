# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 项目概览

- 这是一个 Obsidian 插件：Language Learner。核心能力是查词、AI 释义 / 翻译、单词采集、阅读模式和学习统计。
- 构建产物输出到 `.build/plugin/`：`main.js`、`styles.css`、`manifest.json`。
- `manifest.json` 才是插件元数据的权威来源；`package.json.name` 仍然是 Obsidian sample plugin 的旧值，不要把它当成真实插件 ID。

## 常用命令

- `npm install`：安装依赖。
- `npm run dev`：启动 esbuild watch，入口是 `src/plugin.ts`，持续更新 `.build/plugin/` 下的插件产物。
- `npm run build`：先执行 `tsc -noEmit -skipLibCheck`，再执行生产构建。
- `npx tsc -noEmit -skipLibCheck`：仅做 TypeScript 检查；这是 `npm run build` 的前置检查步骤。
- `node esbuild.config.mjs production`：只做生产打包到 `.build/plugin/`，不运行 TypeScript 检查。
- `npm version <patch|minor|major>` 或 `npm run release:version -- <x.y.z>`：发布入口；会更新 `package.json` / `package-lock.json`，并触发 `version` 生命周期脚本同步 `manifest.json` 和 `versions.json`。
- `npm run release:push`：执行 `git push --follow-tags`，用于把 release commit 和 tag 一起推送到 GitHub。

## 测试与 lint 现状

- 仓库当前没有测试框架、没有 `npm test` 脚本，也没有已提交的测试文件。
- 因此也不存在“单个测试”运行命令；如果需要测试，只能先补测试基础设施。
- 仓库里有 `.eslintrc`，但 `package.json` 没有 `lint` 脚本，也没有显式声明 `eslint` 包，所以 lint 目前不是一等开发命令。
- 当前最可靠的回归检查方式是：`npm run build`，然后在 Obsidian 中实际加载插件验证关键流程。

## 代码架构

### 1. 插件入口与 Vue 挂载

- `src/plugin.ts` 是唯一的打包入口，也是运行时编排中心。
- `onload()` 负责：加载设置、选择数据库实现、初始化 `TextParser`、注册命令 / 视图 / Ribbon 图标、接管部分 Obsidian UI 行为，并把全局 Vue 应用挂到 `document.body`。
- `src/views/Global.vue` 不是独立面板，而是全局浮层容器，主要负责弹出的查词窗口。

### 2. 视图层的组织方式

- `src/views/*View.ts` 是 Obsidian 的 `ItemView` / `TextFileView` 包装层，本身通常很薄，职责主要是把 Vue 组件挂到 Obsidian 容器里。
- 真正的 UI 和交互逻辑主要在对应的 `.vue` 文件里，例如：
  - `SearchPanelView.ts` → `SearchPanel.vue`
  - `LearnPanelView.ts` → `LearnPanel.vue`
  - `DataPanelView.ts` → `DataPanel.vue`
  - `StatView.ts` → `Stat.vue`
  - `ReadingView.ts` → `ReadingArea.vue`

### 3. 查词与采集的事件流

- `plugin.queryWord()` 是统一查词入口。无论是划词、右键菜单、命令面板还是阅读模式点击，最终都会走到这里。
- 这个方法会派发自定义事件 `obsidian-langr-search`。
- `Global.vue` 监听这个事件来定位并显示 popup 搜索窗口。
- `SearchPanel.vue` 也监听同一个事件，负责维护搜索历史，并根据设置决定展示哪些词典组件。
- `LearnPanel.vue` 同样监听 `obsidian-langr-search`：收到查询后会自动预填表单、尝试从数据库取已有词条、补全词形变化、并为例句补机器翻译 / AI 翻译，然后通过 `plugin.db.postExpression()` 保存。

### 4. 词典层结构

- 词典注册中心在 `src/dictionary/list.ts`。
- 每个 provider 基本都是一组 `engine.ts` + `View.vue`：
  - `engine.ts` 负责网络请求和结果解析。
  - `View.vue` 负责渲染结果并向外发 loading / result 状态。
- `SearchPanel.vue` 会按照 `plugin.settings.dictionaries` 里的启用状态和优先级排序后渲染 provider。
- 如果要新增词典，通常至少要改 3 处：provider 目录、`src/dictionary/list.ts`、`src/settings.ts` 的默认配置 / 设置 UI。

### 5. 阅读模式链路

- 阅读模式不是独立的 markdown 渲染器，而是对 Obsidian 原生视图做增强。
- `src/plugin.ts` 用 `monkey-around` patch 了 `MarkdownView` 和 `WorkspaceLeaf`，从而给满足条件的笔记增加 “Open as Reading View” 入口。
- 这个入口只会出现在 frontmatter 含有 `langr` 的笔记上。
- `src/views/ReadingView.ts` 是自定义 `TextFileView`，它把 `ReadingArea.vue` 挂进去。
- `src/views/parser.ts` 的 `TextParser` 是阅读模式核心：
  - 用 `unified` + `retext-english` 解析文本。
  - 从当前数据库实现里查询已知单词 / 短语。
  - 给单词和短语打上 `new` / `learning` / `familiar` / `known` / `learned` 等状态 class。
  - 处理短语包裹、部分 Markdown 样式、音频嵌入和词数统计。
- `src/utils/frontmatter.ts` 用来把阅读位置等状态写回笔记 frontmatter，例如 `langr-pos`。

### 6. 数据存储抽象

- `src/db/base.ts` 定义统一的 `DbProvider` 抽象接口。
- `src/db/idb.ts` 定义 Dexie / IndexedDB schema：核心表是 `expressions` 和 `sentences`。
- `src/db/local_db.ts` 是纯 IndexedDB 实现。
- `src/db/file_db.ts` 是混合实现：既会读写 `word_folder` 里的单词笔记 frontmatter，也会继续使用 Dexie 做辅助存储和缓存。
- `src/plugin.ts` 里的 `openDB()` 只根据 `settings.only_fileDB` 选择运行时 provider：
  - `false` → `LocalDb`
  - `true` → `FileDb`

### 7. 持久化相关的重要细节

- 一个很容易看错的点：运行时数据库实现的切换依据是 `only_fileDB`，不是 `use_fileDB`。
- `use_fileDB` 仍然出现在设置项和部分辅助逻辑里，但它不是 `openDB()` 的选择开关。
- 默认设置里 `only_fileDB` 是 `false`，所以默认运行时 provider 实际上是 `LocalDb`。
- `plugin.ts` 里的 `refreshWordDb()` 和 `refreshReviewDb()` 会把当前词条数据导出 / 同步到配置的 markdown 文件路径：
  - `word_database`
  - `review_database`
- `LearnPanel.vue` 提交词条后，如果开启 `auto_refresh_db`，会自动触发这两个文本数据库刷新流程。

### 8. 状态管理与跨组件共享

- `src/store.ts` 是一个很小的 `reactive()` 单例，不是 Pinia / Vuex。
- 它主要承载主题状态、popup 开关、词典区域高度、固定搜索等跨组件 UI 状态。
- 主题切换是从 Obsidian 的 `css-change` 事件同步进这个 store 的。
- `LearnPanel.vue` 中的 Naive UI 主题也是基于这个 store 切换。

### 9. AI 与外部服务

- AI 配置集中在 `src/settings.ts` 的 `settings.ai`。
- `src/dictionary/ai/engine.ts` 使用 OpenAI-compatible chat completions 请求格式，因此除了 OpenAI，也兼容 Gemini、DeepSeek、SiliconFlow、自定义兼容端点。
- 这个 AI engine 自带重试逻辑，以及基于 `localStorage` 的持久化缓存。
- `src/dictionary/google/engine.ts`、`youdao/engine.ts`、`cambridge/engine.ts` 都是直接请求外部网络服务。

### 10. 仍然存在但已不走主流程的代码

- `src/api/server.ts` 和 `src/db/web_db.ts` 还在仓库里，但 `src/plugin.ts` 已经明确不再初始化 self-server / WebDb 路径。
- 如果用户没有明确要求恢复这条能力，应把它们视为遗留代码，而不是当前主架构的一部分。

## 其他仓库约定

- 路径别名在 `tsconfig.json`：
  - `@/*` → `src/*`
  - `@dict/*` → `src/dictionary/*`
  - `@comp/*` → `src/component/*`
- 版本发布依赖 `versions.json`，不要只改 `manifest.json` 而忽略它。
- 当前仓库没有 `.cursorrules`、`.cursor/rules/` 或 `.github/copilot-instructions.md`，所以没有额外的 Cursor / Copilot 仓库内规则需要继承。
