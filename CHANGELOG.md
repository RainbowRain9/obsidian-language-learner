# Changelog

本文件用于维护插件的版本更新日志。发布前先把待发布改动写到 `Unreleased`，执行 `npm version` / `npm run release:*` 后，版本脚本会自动把该部分归档到对应版本号下。

## [Unreleased]

### Fixed

- 修复「仅使用文件数据库」模式下统计面板数据缺失：`FileDb.getCount` / `countSeven` 误用 `every` 做累加（回调无返回值，首个词条后遍历即终止）导致 KPI 与七天趋势计数恒 ≤1，改为 `forEach` 全量遍历；`word_folder` 混入无 `type` 键的普通笔记时跳过该条目，不再让整个统计抛错中断。
- 统计面板七天趋势数据加载失败不再静默中断整个面板：`Stat.vue` 的 `countSeven` 调用纳入独立 try/catch，KPI 卡与环形图照常计算。
- 数据面板单词列表监听 `obsidian-langr-refresh-stat` 事件自动重载：此前仅挂载时加载一次且不监听任何刷新事件，词库更新或换库后表格保持旧数据 / 空白直到关闭重开视图。
- 学习面板标签下拉打开时预取全部标签（naive-ui 仅在真实键入时触发 `@search`，此前刚打开必为空列表），且首次键入即 ≥2 字符（IME / 粘贴）时同样先取数再过滤。
- 词条 frontmatter 解析在 `metadataCache` 未命中（vault 刚打开 / 文件刚批量生成）时改为兜底直读文件解析，不再静默跳过该词文件导致单词列表与统计整体为空。
- 设置页 Reopen / Destroy 数据库后清空词库缓存并派发刷新事件，统计与数据面板即时反映新库，不再显示旧库数据或空白。

## [0.9.0] - 2026-10-12

### Added

- 收藏单词时例句原文中的目标词自动加 `**` 加粗（按选中形态 → 词原形顺序做词边界匹配，`unintentionally` 这类包含词不受影响，重复保存不会叠加星号）；AI 翻译例句支持译文加粗：翻译提示词新增 `{word}` 占位符（替换为本次目标词），默认提示词要求模型把译文中对应目标词的释义用 `**` 加粗，已保存的自定义提示词未包含 `{word}` 时引擎自动追加同样的加粗指令。
- 例句目标词加粗提供设置开关「加粗例句中的目标词」（`bold_word_in_sentence`，默认开启），关闭后新保存的例句不再加粗；重新保存已有词条时按当前开关状态决定是否加粗（不保留旧的 `**` 标记）。

### Changed

- 更新 AI 翻译默认提示词，同步设置页占位符说明文案（en / zh / zh-TW）与 `docs/ai_settings_usage.md`。

## [0.8.0] - 2026-10-10

### Added

- 统计面板升级为学习数据 dashboard（移植自上游）：顶部 KPI 三卡（总词汇量 / 在学词汇 / 无视词汇）、七天采集趋势图与「词汇比例」「在学词汇分布」双环形图；趋势图与环形图改用零依赖 SVG 组件（新增 `CustomChart.vue` / `DonutChart.vue`），替换原 echarts 七天折线图；外部复习工具的复习留存图（echarts）原样保留，英 / 简 / 繁三语文案齐全，语言切换时所有图表标签即时重建。

### Fixed

- 修复阅读模式 `langr-audio` 音频在部分桌面版 Obsidian 中无法加载的问题：`~/` 路径与资源路径回退两处不再硬编码 `app://local/` 前缀，改为经 `electron` IPC（`sendSync("file-url")`）动态获取（移植自上游）。
- 移植上游搜索面板三处修复：词典列表 `v-for` 补 `:key`，避免列表重排时组件复用错乱；词典组件列表由 `ref` 改为 `shallowRef`，去掉不必要的深响应；挂载容器由依赖 Obsidian 内部 DOM 结构的 `containerEl.children[1]` 改为 `containerEl` 本身。
- 移植上游阅读模式杂项修复：内部链接悬停预览的 `hover-link` 事件改经插件实例的 `app` 引用派发；分页栏内联样式 `padding-top: 10px` 修正为 `padding: 10px 0`；`ReadingView.ts` 的组件导入路径改为显式相对路径 `./ReadingArea.vue`。
- 修复 `version-bump.mjs` 归档 CHANGELOG 时字符串替换器会把条目内的 `$$` / `$&` 展开导致归档节损坏的问题，改用函数替换器原样保留；并据此重建已损坏的 `[0.7.1]` 归档节。

### Changed

- 清理 `DictItem.vue` 中两个未使用的导入（`Platform` / `getRGB`）。

## [0.7.1] - 2026-10-10

### Fixed

- 修复阅读模式三处可稳定复现的崩溃：词库含短语时解析器调用不存在的数组方法（`phrase.first()/last()`）导致整页无法渲染；笔记正文缺少 `^^^article` 分节时阅读视图挂载白屏；正文后处理的图片替换正则会把整页文本替换为字面量 `undefined` 或压缩成一张图片。同时消除 `TextParser` 全局单例并发解析时互相覆盖解析状态的竞态。
- 修复词条日期被系统性破坏的两类问题：「Update IndexDB Database」导入/迁移与文件库保存词条时硬编码覆盖原始 `date` 为当前时间，导致按日期统计与排序全部失真；日期写入用本地时区、读取按 UTC 解析造成的往返漂移（UTC+8 下晚间采集的词条日期落到次日）。
- 修复笔记与词条文件写入的数据完整性问题：frontmatter 写入未转义 `$$` / `$&` 等替换模式导致笔记内容被静默损坏；frontmatter YAML 畸形时用单键重写整个块丢失原有键值；阅读位置、完成标记与 words/notes 段并发写入时互相覆盖；词条未做文件名净化导致含 `/` 的短语写入后无法读回；保留式合并导致已删除的例句、笔记、标签、别名「复活」。
- 修复「Open as Reading View」右键菜单入口因读取不存在的 `TFile.cache` 属性而永不出现，以及标题栏「转为阅读模式」按钮在多窗格间共享单槽位导致的重复/消失问题。
- 修复设置页：AI Prompt 输入框每键入一个字符就整页重建导致失焦无法连续编辑；IndexedDB 的 Reopen/Destroy 无视 ONLY file DB 开关强制切换运行时数据库；ONLY file DB 切换时三个异步操作未 await 的竞态；导入设置后数据库与词典配置不生效；损坏的词典配置导致设置面板白屏。
- 修复学习面板：过期查词请求覆盖当前表单；提交失败无任何提示；纯空白输入绕过校验；输入法确认候选词的 Enter 被误判为插入新笔记；已有翻译时仍重复发起 AI 计费请求。
- 修复词典与查词层：慢的旧请求晚到覆盖新查询结果；查询失败后同词重试被静默吞掉；空词仍发起网络请求；剑桥词典外链被拦截无法打开；剑桥拼写建议因线上页面改版失效；多个词典实例并存时监听器错绑与累积。
- 修复 AI 引擎：模型级 Temperature / Max Output Tokens 设置从未生效；Test Connection 对禁用模型静默回退到默认模型；429/5xx 错误被误报为网络错误；`$&` 等替换模式篡改翻译提示词；数组形态 content 响应解析崩溃。
- 修复一批生命周期与资源清理问题：插件卸载不清理防抖定时器与标题栏按钮；组件卸载不清理悬停 tooltip、视频拖拽监听、MutationObserver 与 echarts 实例；关闭词数统计后行内音频无法点击；关闭阅读视图后行内音频不停止。
- 修复多处空值解引用崩溃（元数据缓存未就绪、词条已删除后展开详情等场景）、`use_fileDB`/`only_fileDB` 开关错位导致 word_folder 不创建、复习统计日期轴排序错乱，以及词库导入「先删后建」失败无提示且不可恢复的高危路径。

### Changed

- zh-TW 语言包补齐 103 个缺失文案，修复两处中英文案 key 不一致导致中文界面回退英文的问题。
- AI 设置文档补充 `zhipu-thinking` 能力模式说明，与实现对齐。

## [0.7.0] - 2026-09-15

### Changed

- 词条文件保存改为「保留式合并」：通过学习面板 Submit、阅读模式分级等路径保存词条时，不再整体重建 `word_folder` 中的词条 markdown 文件，而是以现有 frontmatter 为基底，只覆盖本插件管理的白名单键（`expression` / `meaning` / `date` / `status` / `type` / `surface` / `aliases` / `tags` / `notes` / `sentenceN` / `transN` / `originN`），其余未知键按原文保留，frontmatter 之后的正文也不再被清空。与外部工具共享词条存储（如 ScoreFlow 词卡复习回写 `复习次数` / `下次复习` / `复习记录`）时，插件保存不会再抹掉这些外部字段；新建词条文件的行为与旧版本逐字节一致。新增零依赖回归脚本 `scripts/test-merge-wordfile.mjs`（`node scripts/test-merge-wordfile.mjs`）。

### Added

- 词库面板（DataPanel）在检测到外部复习工具写入的「下次复习」字段时，会在表格中新增「下次复习」列；学习面板查询到携带该字段的已有词条时，也会在状态按钮下方显示「下次复习」。
- 统计面板新增「复习留存」图表：按日复习次数（柱）＋累计留存率（折线，百分比），数据来自词条 frontmatter 的 `复习记录` YAML 列表或正文中的复习记录表格，无任何复习记录时显示空态提示。

## [0.6.3] - 2026-04-19

### Changed

- `Translate Select` 现在会在无显式选区时自动查询当前光标所在单词，便于通过 Obsidian 自带 `Hotkeys` 绑定任意自定义快捷键查词。
- 移除插件内专用的 `Search on Ctrl+B` 设置，避免继续和编辑器原生命令型快捷键耦合。

## [0.6.2] - 2026-04-19

### Fixed

- 修复在正常 Markdown 编辑区中，启用 `Search on Ctrl+B` 后 `Ctrl+B` / `Cmd+B` 虽然会执行原生加粗，但因事件已被 Obsidian / CodeMirror 标记为已处理而不会继续联动查词的问题。

## [0.6.0] - 2026-03-27

### Changed

- 学习面板顶部主字段改为响应式两列布局；在较宽面板中会按 `Expression | Surface`、`Meaning | aliases` 排列，在窄宽度下自动回落为单列。

### Fixed

- 修复 `meaning` 在导入、自动填充和清洗流程中如果以右括号结尾时，末尾 `)` / `）` 可能被误删的问题。
- 修复 `npm run release:version:push -- <version>` 会把版本号误判为 release mode、导致无法按指定版本直接发布的问题。

## [0.5.12] - 2026-03-27

### Added

- 学习面板重新加入 `AI Autofill` 按钮，并支持与 `Submit` 并排操作。
- AI 设置页新增 `AI Autofill Settings`，可分别控制 `meaning`、`aliases`、`tags`、`notes` 的触发方式与写入策略。
- AI 设置页新增 `AI Diagnostics`，可查看、复制和清空最近一次 AI 请求日志，便于排查 AI 词典、AI 翻译和 AI 补全问题。

### Changed

- AI 卡片自动填充现在按字段策略执行；每个字段都可以单独设为手动触发、自动触发或两者同时启用。
- AI 卡片自动填充请求会只请求当前启用的字段，减少无关返回内容。
- AI provider capability mode 新增 `Zhipu / GLM (thinking.type)`，兼容需要 `thinking.type` 请求字段的 OpenAI-compatible 接口。
- 学习面板会在按钮下方显示当前手动 `AI Autofill` 涉及的字段，便于确认本次会补哪些内容。

### Fixed

- 修复 AI 词典、例句 AI 翻译和 AI 卡片补全在空响应场景下缺少可见错误线索的问题；现在会给出更明确提示并保留诊断日志。
- 修复推理模型只输出 `reasoning_content` 且因 `finish_reason=length` 截断时，用户侧只看到“空返回”的问题；现在会提示优先检查 capability mode 或提高 `Max Output Tokens`。
- 修复学习面板变形 / aliases 中会混入 `more`、`most` 这类通用比较级 / 最高级占位词的问题。

## [0.5.11] - 2026-03-26

### Added

- AI 设置重构为新的 v2 体系，支持多 provider、多 model、按场景路由和按模型连接测试。
- 新增中文文档 [`docs/ai_settings_usage.md`](./docs/ai_settings_usage.md)，用于补充 AI 设置的完整使用说明。

### Changed

- AI 设置页改为 `Providers / Models / Routing / Prompts / Connection Test` 结构。
- AI 请求现在统一走场景解析层，查词、翻译、卡片自动填充都支持默认模型 + 场景覆盖模型。
- README 已按当前功能更新，AI 相关说明改为以能力和使用方式为主，而不是旧版扁平字段说明。

### Improved

- Provider / Model 列表增加启用状态、路由使用状态和更明确的高亮提示。
- Provider / Model 删除前会提示当前路由影响与回退行为。
- Provider 编辑框增加 Base URL、Header 格式等输入校验。
- Model 编辑框的 `Custom Parameters` 改为结构化编辑，并为 JSON 类型增加即时校验与保存拦截。

### Fixed

- 修复 AI 设置页部分字段、选项和提示文案显示为 `undefined` 的问题。
- 补齐 AI settings v2 相关的中英文与繁中文案，改善 AI 设置页和弹窗的本地化显示。

## [0.5.10] - 2026-03-26

### Fixed

- 修复 GitHub Release workflow 在 `CHANGELOG.md` 缺少当前版本节时直接失败的问题。
- `scripts/extract-changelog-section.mjs` 现在会优先读取当前版本节；如果缺失，则回退到 `Unreleased`，再不行则生成占位 release notes，避免发布流程被中断。

## [0.5.9] - 2026-03-27

### Added

- 设置页 `General` 新增 `Meaning Autofill` 选项，可在关闭、贴近原文翻译、词典词性摘要、按上下文选择词性之间切换。
- 学习面板会从有道词典基础释义区自动提取词形变化，并回填到 `aliases`。

### Changed

- 采词时 `expression` 现在优先使用 Cambridge 词典显示的 headword，其次才回退到有道标题和词形还原规则。
- `meaning` 自动填充改为按模式统一决策，不再让不同来源并行抢写；上下文模式会尽量只回填当前词性的释义。
- GitHub Release 流程现在会把当前版本对应的 `CHANGELOG.md` 版本节写入 Release 正文前缀，方便直接复用发布前的更新说明。

### Fixed

- 修复同一句中同时出现不同词形或同 lemma 不同用法时，已有词条的 `surface` 覆盖当前点击词面的情况，减少 `issued` / `issue` 这类串义。

## [0.5.8] - 2026-03-26

### Changed

- 学习面板暂时移除了 `AI Autofill` 按钮和对应入口，避免兼容端点返回空内容时打断采词流程。
- AI 设置页不再显示 `Card Prompt` 配置项；当前保留的 AI 配置主要用于词典释义、语境释义和句子翻译。

### Fixed

- 修复 Markdown 文档正文包含分割线 `---` 时，打开 Reading View 可能出现空白或无法进入阅读模式的问题。

## [0.5.7] - 2026-03-26

### Added

- AI 词典现在会在有句子上下文时生成更贴合当前语境的释义，并在面板中展示语境句和来源。
- 学习面板新增 `AI Autofill`，可基于当前词条与上下文补全 `meaning`、`aliases`、`tags` 和 `notes`。

### Changed

- AI 设置新增 `Context Prompt` 和 `Card Prompt`，分别用于语境释义和词卡补全。

## [0.5.6] - 2026-03-26

### Added

- 新增界面国际化支持，当前内置 `中文` 与 `English` 两套界面语言包。
- 在设置页新增 `Interface Language` 界面语言选项，可手动切换插件界面语言。

### Changed

- 设置页、查词面板、学习面板、数据面板、阅读面板及相关提示文案统一改造成可翻译文本。
- 界面语言切换后，已打开的插件面板会立即更新文案；语言选择会持久化保存并在下次启动时恢复。

## [0.5.4] - 2026-03-26

### Added

- 采词流程新增 `surface` 原始词形字段，并持久化到 IndexedDB 与 Word Files Database frontmatter。
- 新增常用不规则词形识别，自动采词时能更稳地回推原型。
- 新增 `CHANGELOG.md`，作为仓库内的版本更新日志入口。

### Changed

- 学习面板现在会显示原始词形，`expression`、`aliases` 和 `surface` 的自动填充逻辑更稳定。
- 发布流程现在会在版本同步时自动归档 `Unreleased` 里的更新日志。
- 复习卡片导出现在会优先使用 `surface` 作为题面，并在需要时补出 `expression` 原型提示。

### Fixed

- 修复 `Only Use Word Files Database` 模式下，旧格式 frontmatter 数据可能触发 `aliases.some is not a function`，导致 hover definition 查询失败的问题。
- 修复 Word Files Database 路径对 `status`、`aliases`、`tags`、`notes` 等 frontmatter 字段的兼容性问题，支持更稳地解析旧数据、英文状态值与数字状态值。
- 修复阅读模式下 `surface` 原始词形未参与单词状态匹配的问题；现在 `expression`、`surface` 与 `aliases` 都可用于命中单词样式与刷新。
- 修复 Word Files Database / LocalDb 在部分大小写不一致场景下的单词状态匹配问题。
- 修复词文件变更后阅读模式仍可能复用旧的 parser HTML 缓存，导致当前页样式未及时刷新的问题。

## [0.5.3]

- 历史版本。仓库此前未系统维护逐版更新日志，详细变更请参考 GitHub Releases、提交历史与 `versions.json`。
