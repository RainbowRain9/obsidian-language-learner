# Changelog

本文件用于维护插件的版本更新日志。发布前先把待发布改动写到 `Unreleased`，执行 `npm version` / `npm run release:*` 后，版本脚本会自动把该部分归档到对应版本号下。

## [Unreleased]

- 暂无待发布更新。

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
