# Language Learner for Obsidian

**Language Learner** 是一个面向 Obsidian 的语言学习插件，把阅读、查词、采词、例句翻译、复习和统计放到同一条工作流里。

它的目标不是做一个孤立的词典面板，而是让你在阅读笔记的过程中，直接完成：

1. 划词查词。
2. 自动收集例句和出处。
3. 保存到个人词库。
4. 导出 `words.md` / `review.md` 供进一步检索或复习。

## 📝 更新日志

- 仓库内版本更新日志统一维护在 [`CHANGELOG.md`](./CHANGELOG.md)。
- 发布前先把待发布变更写到 `Unreleased`。
- 执行 `npm version` 或 `npm run release:*` 后，版本脚本会自动把 `Unreleased` 归档到对应版本号下。

## ✨ 主要功能

### 查词

- 支持 `Youdao`、`Cambridge`、`Google Translate`、`AI` 词典源。
- 支持阅读模式、预览模式、编辑模式下的划词查询。
- 支持 popup 查词窗口和独立侧边栏查词面板。
- 支持自动发音、搜索历史前进 / 后退、点击词条继续追词。
- 支持中英文界面文案切换，查词面板、学习面板、阅读面板和设置页会跟随界面语言更新。

### AI 辅助

- 支持 OpenAI-compatible 接口。
- 已验证的配置方向包括 `OpenAI`、`Gemini`、`DeepSeek`、`SiliconFlow` 和自定义兼容端点。
- 支持 AI 释义、AI 翻译、自定义 `prompt`、`context_prompt` 和 `trans_prompt`。

### 生词采集

- 查询后可直接进入右侧学习面板。
- 会根据已有词条、词典结果和当前上下文预填 `expression`、`surface`、`meaning`、`status`、`type`、`aliases` 和 `sentences`；已有词条也会回填 `tags` / `notes`。
- 阅读模式和普通划词都会尽量自动写入例句与出处。
- 例句支持机器翻译和 AI 翻译。
- 学习面板当前仅保留手动确认后提交，不再提供单独的 `AI Autofill` 词卡补全按钮。

### 阅读模式

- 为带 `langr` frontmatter 的笔记提供专门的 Reading View。
- 支持分页阅读、单词高亮、短语识别、悬停释义、词数统计。
- 单词状态匹配现在会同时考虑 `expression`、`surface` 与 `aliases`，对旧 frontmatter 数据与不同词形更友好。
- 正文中使用 Markdown 分割线 `---` 不会再导致 Reading View 空白或打开失败。
- 点击或划选单词可直接进入查词和采词流程。
- 阅读到最后一页后可标记为学习完成，并回写完成状态到 frontmatter。

### 数据管理

- 支持 IndexedDB。
- 支持 Word Files Database 混合模式。
- 支持数据面板查看、搜索、排序、按标签过滤。
- 支持导出 / 导入数据库。
- 支持持久化保存界面语言选择，下次打开插件时继续使用上次设置。

### 文本数据库

- 支持把非忽略词条导出到 `word_database`。
- 支持把复习卡片导出到 `review_database`。
- 支持自动刷新，也支持手动刷新 Review Database。

### 统计

- 提供近 7 天学习数据折线图。
- 展示 `Day Ignore`、`Day Non-Ignore`、`Accumulated` 等指标。

## 🚀 安装

### 从 Release 手动安装

1. 在 GitHub Releases 页面下载最新发布资产。
2. 使用压缩包，或者手动拿到这 3 个文件：
   - `main.js`
   - `manifest.json`
   - `styles.css`
3. 将它们放到你的 Vault 目录：

```text
.obsidian/plugins/obsidian-language-learner/
```

4. 重启 Obsidian，或在第三方插件设置中重新加载插件。
5. 在 **设置 > 第三方插件** 中启用 `Language Learner`。

### 插件目录说明

插件目录名建议与 `manifest.json` 中的插件 ID 一致，也就是：

```text
obsidian-language-learner
```

## ⚙️ 配置概览

进入 **Settings > Language Learner** 后，主要分为几组配置：

- `General`
  - 界面语言（`中文` / `English`）
  - 母语 / 外语
  - popup search
  - 自动发音
  - 划词功能键
- `Dictionaries`
  - 启用词典
  - 调整优先级
  - 设置词典高度
- `Database`
  - IndexedDB 名称
  - 导入 / 导出 / 重开
- `Text Database`
  - `word_database`
  - `review_database`
  - 自动刷新
  - 手动刷新复习数据库
- `Reading`
  - 字号、字体、行高
  - 默认段数
  - 机器翻译
  - 词数统计
  - hover definition
  - `Only Use Word Files Database` 下兼容旧 frontmatter 数据格式与更稳的阅读模式状态匹配
- `AI & Advanced`
  - provider
  - `api_url`
  - `api_key`
  - `model`
  - `prompt`
  - `context_prompt`
  - `trans_prompt`
  - 连接测试

### 界面语言

- 界面语言可在 **Settings > Language Learner > General > Interface Language** 中手动切换。
- 当前支持 `中文` 与 `English` 两种界面语言。
- 插件默认界面语言保持为英文。
- 切换后，已打开的插件面板会立即更新文案。
- Obsidian 命令名称和部分叶子标题通常会在重新打开对应面板或重载插件后完全刷新。
- 语言选择会持久化到插件设置中，并在下次启动时自动恢复。

## 📖 使用方式

### 1. 划词查词

- 在预览模式或编辑模式中，按住设置里的功能键并划词。
- 或者直接使用命令面板里的 `Translate Select` / `Translate Input`。
- 如果当前上下文可识别，右侧学习面板会自动写入例句和出处。

### 2. 阅读模式

1. 给目标笔记添加 `langr` frontmatter。
2. 打开笔记后，点击 `Open as Reading View`。
3. 在阅读视图中点击或选择单词。
4. 查词结果会显示在 popup 或左侧查词面板中。
5. 右侧学习面板会自动补全词条和例句。

### 3. 生词采集

- 在学习面板中确认释义、状态、标签、笔记和例句。
- 提交后会写入数据库。
- `surface` 会参与阅读模式中的单词状态匹配与即时刷新。
- 如果启用了自动刷新，会继续更新文本数据库。

## 🛠️ 本地开发

### 环境准备

```bash
npm install
```

### 构建命令

```bash
npm run dev
```

- 进入 watch 模式。
- 入口文件是 `src/plugin.ts`。
- 构建产物输出到：

```text
.build/plugin/
```

其中包含：

- `main.js`
- `manifest.json`
- `styles.css`

### 生产构建

```bash
npm run build
```

这会先做 TypeScript 检查，再构建 `.build/plugin/`。

## 🔗 本地测试到 Obsidian

推荐做法是让 Obsidian 插件目录直接指向 `.build/plugin/`，而不是指向整个仓库。

### 创建 Junction

仓库内已提供脚本：

```bash
npm run link:obsidian -- "D:\YourVault\.obsidian\plugins\obsidian-language-learner"
```

这个脚本会：

- 把目标插件目录切换成 Junction。
- 指向仓库里的 `.build/plugin/`。
- 自动备份原目录。
- 如果原目录里有 `data.json`，会自动复制到新构建目录。

### 推荐测试流程

1. 先执行一次：

```bash
npm run link:obsidian -- "D:\YourVault\.obsidian\plugins\obsidian-language-learner"
```

2. 然后持续开发：

```bash
npm run dev
```

3. 在 Obsidian 中执行重新加载插件，或关闭再启用插件。

## 🚢 发布流程

仓库已经配置 GitHub Actions 自动发布，并且版本流已经统一到 `npm version`。

Workflow 文件位于：

[`/.github/workflows/release.yml`](./.github/workflows/release.yml)

### 触发方式

推送 tag 时自动触发，支持这两种格式：

- `v0.5.1`
- `0.5.1`

### 版本同步规则

发布时的版本入口是：

```text
package.json.version
```

然后通过 `version` 生命周期脚本自动同步：

- `manifest.json`
- `versions.json`
- `CHANGELOG.md`

也就是说，正常发布时不需要手动再改 3 份版本号。

### 更新日志维护

发布前请先更新 [`CHANGELOG.md`](./CHANGELOG.md) 里的 `Unreleased` 部分，再执行版本命令。

推荐顺序：

1. 在 `CHANGELOG.md` 的 `Unreleased` 中写入本次版本的更新内容。
2. 执行 `npm run build` 或直接使用 `npm run release:*`。
3. 执行 `npm version <patch|minor|major>` 或 `npm run release:version -- <x.y.z>`。
4. 版本脚本会自动：
   - 同步 `manifest.json`
   - 同步 `versions.json`
   - 把 `Unreleased` 归档为对应版本节
5. GitHub Actions 创建 Release 时，会把当前版本对应的 `CHANGELOG.md` 版本节作为正文前缀写入 Release 页面，再附加自动生成的 release notes。

### 自动执行内容

发布 workflow 会自动：

1. 校验 tag 版本和 `package.json` 一致。
2. 校验 tag 版本和 `manifest.json` 一致。
3. 校验 `versions.json` 中存在对应版本条目。
4. 执行 `npm ci`。
5. 执行 `npm run build`。
6. 从 `.build/plugin/` 收集发布文件。
7. 自动创建或更新 GitHub Release。
8. 自动上传以下资产：
   - `main.js`
   - `manifest.json`
   - `styles.css`
   - `obsidian-language-learner-<version>.zip`

### 推荐发布步骤

#### 自动递增版本

```bash
npm run release:patch:push
```

或：

```bash
npm run release:minor:push
npm run release:major:push
```

#### 指定版本号

```bash
npm run release:version:push -- 0.5.1
```

上面的命令会自动：

1. 更新 `package.json` 和 `package-lock.json`
2. 通过 `version` 脚本同步 `manifest.json` 和 `versions.json`
3. 创建 release commit
4. 创建对应 tag
5. 执行 `git push --follow-tags`

最后等待 GitHub Actions 自动完成 Release。

如果你想手动拆开执行，底层命令仍然可用：

```bash
npm run release:patch
npm run release:push
```

## 📁 项目结构

```text
src/                 源码
.build/plugin/       Obsidian 实际使用的构建产物
scripts/             本地开发辅助脚本
manifest.json        插件元数据
versions.json        Obsidian 版本兼容映射
CHANGELOG.md         仓库内版本更新日志
```

## 🧪 当前验证方式

当前仓库没有测试框架，最可靠的验证方式是：

```bash
npx tsc -noEmit -skipLibCheck
npm run build
```

然后在 Obsidian 中实际加载插件验证交互。

## 📌 说明

- `manifest.json` 仍然是插件元数据的权威来源，但发布时的版本输入源已经统一为 `package.json.version`，再由脚本同步到 `manifest.json` 和 `versions.json`。
- 构建产物不再默认输出到仓库根目录，而是统一输出到 `.build/plugin/`。
- 根目录旧的 `main.js` / `styles.css` 仅可能是历史残留，不应作为当前开发产物使用。

---

如果你在使用过程中发现某个功能“运行中的插件有，但源码里没有”，优先以 `src/` 为可维护实现来源，根目录历史 bundle 只作为行为参考。
