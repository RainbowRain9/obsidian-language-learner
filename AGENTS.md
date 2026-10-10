# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 项目概览

- 这是一个 Obsidian 插件：Language Learner。核心能力是查词、AI 释义 / 翻译、单词采集、阅读模式和学习统计。
- 构建产物输出到 `.build/plugin/`，实际有 4 个文件：`main.js`、`main.css`（Vue SFC 样式副产物）、`manifest.json`、`styles.css`。
- `manifest.json` 才是插件元数据的权威来源；`package.json.name` 仍然是 Obsidian sample plugin 的旧值，不要把它当成真实插件 ID。

## 常用命令

- `npm install`：安装依赖。
- `npm run dev`：启动 esbuild watch，入口是 `src/plugin.ts`，持续更新 `.build/plugin/` 下的插件产物。
- `npm run build`：先执行 `tsc -noEmit -skipLibCheck`，再执行生产构建。
- `npx tsc -noEmit -skipLibCheck`：仅做 TypeScript 检查；这是 `npm run build` 的前置检查步骤。
- `node esbuild.config.mjs production`：只做生产打包到 `.build/plugin/`，不运行 TypeScript 检查。
- `npm version <patch|minor|major>` 或 `npm run release:version -- <x.y.z>`：发布入口；会更新 `package.json` / `package-lock.json`，并触发 `version` 生命周期脚本同步 `manifest.json` 和 `versions.json`。
- `npm version` 发布链完整顺序：`preversion` 钩子先执行 `npm run build`（失败即中止发版）→ npm 更新 `package.json` → `version` 钩子执行 `node version-bump.mjs` 同步 `manifest.json` / `versions.json` 并归档 CHANGELOG 的 Unreleased 节（`git add` 这三个文件）→ npm 自动创建 `chore(release): 发布 X.Y.Z` commit 与 `v` 前缀 tag。另有一键命令 `release:<patch|minor|major>:push` 与 `release:version:push -- x.y.z`（`scripts/release-and-push.mjs`）及 `pub` 别名。
- `npm run release:push`：经 `publish.mjs` 执行 `git push <remote> --follow-tags`（默认 origin，可用 `node publish.mjs <remote>` 指定远端），用于把 release commit 和 tag 一起推送到 GitHub。
- `npm run link:obsidian -- "<vault>/.obsidian/plugins/obsidian-language-learner"`：把 Obsidian 插件目录 junction 链接到 `.build/plugin`（旧目录自动时间戳备份、其 `data.json` 拷贝进构建目录，脚本幂等），配合 `npm run dev` 实机联调。

## 测试与 lint 现状

- 仓库已有已提交的零依赖回归测试 `scripts/test-merge-wordfile.mjs`（node 直接运行，无 `npm test` 入口，CI 不跑它），覆盖 `src/utils/word-file.ts` 的保留式合并与复习日志解析（57 项断言）；修改 `src/utils/word-file.ts` 后必须运行 `node scripts/test-merge-wordfile.mjs`。
- 仓库没有测试框架、没有 `npm test` 脚本；除上述脚本外不存在“单个测试”运行命令。
- 仓库里有 `.eslintrc`，但 `package.json` 没有 `lint` 脚本，也没有显式声明 `eslint` 包，所以 lint 目前不是一等开发命令。
- UI / 插件交互流程仍无自动化覆盖：最可靠的回归检查方式是 `npm run build`，然后在 Obsidian 中实际加载插件验证关键流程。

## CI 发布工作流

- `.github/workflows/release.yml` 仅由 push tag 触发（`v*.*.*` 或裸 `*.*.*`，仓库现有 tag 全为 `v` 前缀）。
- `Validate release version` 步骤硬校验 tag 版本（去 `v`）== `package.json.version` == `manifest.json.version` 且 `versions.json` 含该条目，任何一处不符直接 fail。
- CI 跑 `npm ci` + `npm run build`；release notes 由 `scripts/extract-changelog-section.mjs` 从 CHANGELOG 提取（版本节 → Unreleased → fallback 文案）。
- 上传 `main.js` / `manifest.json` / `styles.css` / `obsidian-language-learner-<版本>.zip` 四件资产（zip 只含这三个文件）。

## CHANGELOG 维护约定

- 待发布改动先写入 `CHANGELOG.md` 的 `## [Unreleased]` 节（空置时保留占位符 `- 暂无待发布更新。`）。
- `npm version` 时 `version-bump.mjs` 自动把 Unreleased 归档为 `## [x.y.z] - 日期` 并重置为占位符。
- Unreleased 只有占位符时不归档（CHANGELOG 中 `[0.5.5]` / `[0.6.1]` 无版本节即此机制的正常结果，不要补写）。
- 发版前 Unreleased 为空占位时 Release notes 会退化为 fallback 文案。

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
- plugin 注册 6 个命令（`langr-refresh-word-database` / `langr-refresh-review-database` / `langr-search-word-select`（Translate Select）/ `langr-search-word-input`（Translate Input）/ `langr-debug-copy-cleaned-sentence` / `langr-mark-learning-completed`）、5 个视图与 4 个 ribbon（Search 左、Learn 右、Stat 右、Data tab）。
- `onunload` 用 `detachLeavesOfType` 关闭全部面板，插件重载会丢失用户面板布局位置。
- Vue 组件通过 `vueApp.config.globalProperties.plugin` 访问插件实例（`src/plugin.ts:214`）。

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
- 新增词典必改 4 处：provider 目录（`engine.ts` + `View.vue`）、`src/dictionary/list.ts` 注册、`src/settings.ts` 的 `DEFAULT_SETTINGS.dictionaries` 默认项（漏加时已保存过设置的老用户看不到新词典，`normalizeSettings` 只做浅合并）、`src/lang/locale/en.ts` 的 nameKey / descriptionKey 文案（nameKey 类型为 `Parameters<typeof t>[0]`，key 缺失编译报错；`zh.ts` / `zh-TW.ts` 建议同步，缺省回退英文）。设置 UI 无需手写：由 `Object.keys(dicts)` 自动遍历生成（`src/settings.ts:1953`）。

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
- 已知 bug：monkey-around 对 `MarkdownView.prototype.onPaneMenu` 的 patch 访问了 `TFile` 上不存在的 `file.cache` 属性（`src/plugin.ts:725`），三元条件恒假使 “Open as Reading View” 菜单项从不出现，且 `this.file` 为 null 时会先抛 TypeError；当前实际生效的入口是 `WorkspaceLeaf.setViewState` patch 添加的标题栏切换按钮（`src/plugin.ts:755-798`）。monkey-around 回调内 `this` 无类型约束，tsc 不报错，在这些区域写代码不能依赖类型检查兜底。
- 阅读笔记正文必须含 `^^^article` 分节标记（`^^^words` / `^^^notes` 可选），缺失时 `ReadingArea.vue` 挂载直接抛 TypeError（白屏，`ReadingArea.vue:574` 直接切片 `segments["article"]`）；words 区条目格式 `+ **[[word]]** : meaning <!--langr:{source,updatedAt}-->`，按 `updatedAt` 多设备合并。frontmatter 可选键：`langr-video`（依赖第三方 media-extended）、`langr-audio`（`~/` 与 vault 相对路径）、`langr-pos`（插件自动维护勿手改）；完成阅读写 `status=completed` / `completed` / `words_collected`。
- 单词状态映射 0=ignore / 1=learning / 2=familiar / 3=known / 4=learned 在 `parser.ts:13`、`ReadingView.ts:377`、`LearnPanel.vue:349`、`DataPanel.vue:86` 四处平行定义，改名必须全部同步。
- PDFView 是条件注册：仅当插件安装目录存在 `.obsidian/plugins/obsidian-language-learner/pdf/web/viewer.html` 时 `replacePDF()` 才注册视图并接管 `.pdf` 扩展（`src/plugin.ts:332-352`）；仓库源码无 `pdf/` 目录且发布 zip 只含 main.js / manifest.json / styles.css，viewer 需用户自行放置；iframe 内选词经 window postMessage `{type:"search"}` 转发到 `queryWord`。

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
- `use_fileDB` 的实际作用仅两处：`checkPath()` 是否创建 `word_folder` 目录、阅读笔记 words 区词条是否写成 `[[wiki链接]]`（`src/plugin.ts:1149-1153`）；它不是 `openDB()` 的选择开关。
- `FileDb.postExpression` 按 status 分流：非 0 写 `word_folder/<expression>.md` 并删 IndexedDB 同名词条，0（ignore）写 IndexedDB 并删 `.md` 文件（`src/db/file_db.ts:394-452`）。
- FileDb 多数读操作是 IndexedDB + `plugin.parserAllFM()` 双数据源拼接；改词条数据后的缓存失效统一入口是 `plugin.notifyWordStorageChanged()`（`src/plugin.ts:261`）——parserAllFM 缓存、reviewLogs 缓存、TextParser 缓存、db 层 phrase / simple 缓存是多层独立缓存，只清一层会读脏数据。
- 外部复习字段「下次复习」「复习记录」（中文键，与 ScoreFlow 等外部工具共享）只在 FileDb / parserAllFM 文件路径产出，LocalDb 查询不返回；写入必须走 `buildWordFrontMatter` + `mergeWordFile` 保留式合并（`src/utils/word-file.ts`），禁止整体重建 frontmatter。
- 设置面板 Import / Export 只导出 IndexedDB（dexie-export-import JSON），不含 `word_folder` 的 md 文件。
- `refreshReviewDb` 每次全量重建 `review_database`（仅 `<!--SR-->` 调度注释按词条保留），`refreshWordDb` 有 `last_word_db_hash` 去重；LearnPanel 提交后走 `scheduleRefreshTextDB(500)` 防抖而非直接刷新，刷新结束执行 `various-complements:reload-custom-dictionaries` 外部命令（`src/plugin.ts:552`）。
- 设置面板 db_name 的 Reopen / Destroy 回调无条件 `new LocalDb`，在 `only_fileDB=true` 时触发会静默切换 provider（`src/settings.ts:1988-1996` / `2067-2076`）。

### 8. 状态管理与跨组件共享

- `src/store.ts` 是一个很小的 `reactive()` 单例，不是 Pinia / Vuex。
- 它主要承载主题状态、popup 开关、词典区域高度、固定搜索等跨组件 UI 状态。
- 主题切换是从 Obsidian 的 `css-change` 事件同步进这个 store 的。
- `LearnPanel.vue` 中的 Naive UI 主题也是基于这个 store 切换。

### 9. AI 与外部服务

- AI 配置的数据结构、默认值、旧版迁移与归一化的权威定义在 `src/ai/config.ts`（`AISettingsV2`：version / providers / models / routing / prompts；`normalizeAISettings` 每次保存都会清洗——内置 provider 排前、孤儿 model 剔除、失效 routing 回退 defaultModelId，未进 normalize 链的新字段保存即丢）；`src/settings.ts` 只是设置 UI 挂载层。
- capabilityMode / preset 变更是 4 处联动：`src/ai/config.ts`、`src/dictionary/ai/engine.ts`（`applyCapabilityFields`）、`src/settings.ts`（label 与下拉选项）、`docs/ai_settings_usage.md` 第 10 节。三个主场景（search / translate / card）的 maxTokens / temperature 被 engine 固定值覆盖，模型级设置只有 topP 真正生效（`engine.ts:751-752` / `763-764` / `828-829`）；`baseUrl` 必须是完整 `/chat/completions` 端点，引擎不拼接后缀；search / card 结果存 localStorage `langr-ai-cache`（LRU 200、无 TTL），调试需 `bypassCache`。
- `src/dictionary/ai/engine.ts` 使用 OpenAI-compatible chat completions 请求格式，因此除了 OpenAI，也兼容 Gemini、DeepSeek、SiliconFlow、自定义兼容端点。
- 这个 AI engine 自带重试逻辑，以及基于 `localStorage` 的持久化缓存。
- `src/dictionary/google/engine.ts`、`youdao/engine.ts`、`cambridge/engine.ts` 都是直接请求外部网络服务。

### 10. 仍然存在但已不走主流程的代码

- `src/api/server.ts` 和 `src/db/web_db.ts` 还在仓库里，但 `src/plugin.ts` 已经明确不再初始化 self-server / WebDb 路径。
- 如果用户没有明确要求恢复这条能力，应把它们视为遗留代码，而不是当前主架构的一部分。

### 11. 自定义事件清单

- 全部自定义事件类型集中在 `src/constant.ts` 的 `EventMap`（5 个：`obsidian-langr-search` / `obsidian-langr-refresh` / `obsidian-langr-refresh-stat` / `obsidian-langr-language-change` / `obsidian-langr-toast`）。
- `search` 仅由 `plugin.queryWord` 派发（`src/plugin.ts:1275`），`Global.vue:77` / `SearchPanel.vue:190` / `LearnPanel.vue:1363` 三处消费，detail 字段增删必须同步 EventMap 与三个消费者。
- `refresh` 由 LearnPanel submit 派发、ReadingView / ReadingArea 消费；`refresh-stat` 由 LearnPanel / ReadingArea 派发、Stat 消费；`toast` 由 `Global.vue` 自绘渲染（非 Obsidian Notice），当前仓库内无派发方，使用需自行 `dispatchEvent`；`language-change` 由 `applyUiLanguage` 派发（组件响应靠 `t()` 渲染时读取 `currentLanguageRef`（`src/lang/helper.ts:15`，shallowRef）求值，以及 Stat.vue / ReadingArea.vue / SearchPanel.vue 对 `currentLanguageRef` 的显式 watch；`store.localeVersion` 只有定义 / 自增 / 重置三处、无任何组件消费者，不是实际响应路径）。
- `EventMap` 是纯声明合并且 `.vue` 文件不被 tsc 深检（shims.d.ts 泛化），漏改消费者 / 拼错事件名不会有编译错误。

## 易错点

- 遗留死文件：`src/settings.ts.backup`、`src/views/ReadingArea.vue.backup-20260113-103410`、`_backup_src_20260202_222150/` 被 git 跟踪但不参与编译，不要编辑 / 参照 / 当成配置；根目录 `data.json` 是含明文 API key 的运行数据快照（禁止复制 / 回显其中的密钥），构建链不读写它。
- `src/modals.ts:1` 的 `import { text } from "node:stream/consumers"` 是死导入，当前靠 tree-shaking 通过，一旦使用即构建失败（esbuild external 列表不含 `node:` 子路径）。
- `src/db/web_db.ts` 与 `src/api/server.ts` 无任何活跃 import、不进 bundle，但仍在 tsc 检查范围内。
- `.build/plugin/` 实际 4 个产物（main.js / main.css / manifest.json / styles.css）；styles.css = `src/stalin.css` + Vue SFC 样式 + `src/styles/settings.css` 汇聚；`src/main.css` 是孤儿文件。
- 提交规范：英文 conventional type（feat / fix / chore / docs / style / refactor）+ 中文一句话描述；`chore(release): 发布 X.Y.Z` 提交由脚本生成勿手写。

## 其他仓库约定

- 路径别名在 `tsconfig.json`：
  - `@/*` → `src/*`
  - `@dict/*` → `src/dictionary/*`
  - `@comp/*` → `src/component/*`
- 版本发布依赖 `versions.json`，不要只改 `manifest.json` 而忽略它。
- 当前仓库没有 `.cursorrules`、`.cursor/rules/` 或 `.github/copilot-instructions.md`，所以没有额外的 Cursor / Copilot 仓库内规则需要继承。
- AGENTS.md 与 CLAUDE.md 同日创建、需同步维护；CLAUDE.md 第 10 节所列「缺失能力」三项中，Mark as Learning Completed 命令及配套 `completed` / `words_collected` 工作流（`src/plugin.ts:420`）与全局 toast 通道（`Global.vue` 自绘渲染）确已在源码实现，dashboard 式统计面板也已部分落地——`src/views/Stat.vue` 现为 KPI 三卡（总词汇量 / 在学词汇 / 无视词汇）＋零依赖 SVG 七天趋势图（`CustomChart.vue`）＋双环形分布图（`DonutChart.vue`）＋复习留存图（`updateReviewChart`）四块；Streak / Today New / Mastered / Heatmap / Recent Activity / Hide Meaning、从统计面板打开单词文件等仍未实现，引用任何旧文档前以 `src/` 为准。
- 仓库在 `.agents/skills/` 下提供项目专属 skills（`word-file-persistence`、`release-workflow`、`add-dictionary-provider`、`word-query-flow`、`text-db-sync`、`reading-view-changes`、`local-build-debug`），分别覆盖词条文件持久化、发布流程、词典新增、查词事件链、文本库同步、阅读模式改动与本地构建联调；处理对应领域任务时应先查阅对应 `SKILL.md`。
