# Language Learner for Obsidian

**Language Learner** 是一款专为 Obsidian 设计的沉浸式语言学习插件。它将查词、生词管理、AI 辅助和阅读模式无缝集成到您的知识库中，帮助您在阅读和写作的过程中自然地积累词汇，构建个人语言数据库。

## ✨ 主要功能 (Features)

*   **🔍 多源查词 (Multi-source Dictionary)**
    *   集成 Youdao (有道)、Cambridge (剑桥)、YouGlish (真实语境视频) 等多种词典。
    *   **划词搜索**：在阅读或编辑模式下，选中单词即可弹出释义窗口。
    *   **侧边栏面板**：提供独立的查词和详情面板，支持手动输入查询。

*   **🤖 AI 智能助手 (AI Integration)**
    *   支持 **OpenAI**, **Gemini**, **DeepSeek** 等主流大模型。
    *   **深度释义**：AI 提供词根词缀、多场景例句和同义/反义词解析。
    *   **整句翻译**：在阅读模式下，支持调用 AI 翻译长难句。
    *   **自定义 Prompt**：可完全自定义 AI 的提示词，打造专属外教。

*   **📖 沉浸式阅读模式 (Reading Mode)**
    *   **专注视图**：将 Markdown 笔记转换为适合精读的排版。
    *   **生词高亮**：根据您的学习进度，自动高亮 "新词" (New) 和 "正在学习" (Learning) 的单词。
    *   **点击查词**：阅读时点击任意单词即刻查询，不打断心流。
    *   **阅读统计**：实时统计文章总词数、生词数和生词比例。

*   **🗂️ 单词管理系统 (Word Management)**
    *   **状态追踪**：将单词标记为 `New` (新词), `Familiar` (眼熟), `Known` (已会), `Learned` (掌握) 或 `Ignore` (忽略)。
    *   **标签与笔记**：为单词添加自定义标签 (Tags) 和富文本笔记 (Notes)。
    *   **本地数据库**：数据存储在 IndexedDB 中，支持导出为 JSON 备份。

*   **📊 统计与复习 (Statistics & Review)**
    *   可视化展示每日学习量和累积词汇量。
    *   (开发中) 基于间隔重复算法 (Spaced Repetition) 的复习提醒。

## 🚀 安装 (Installation)

### 手动安装
1.  下载最新的 `language-learner-plugin.zip` 发布包。
2.  在您的 Obsidian 仓库中，进入 `.obsidian/plugins/` 目录。
3.  新建文件夹 `language-learner`。
4.  将压缩包解压到该文件夹中（确保包含 `main.js`, `manifest.json`, `styles.css`）。
5.  重启 Obsidian，在 **设置 > 第三方插件** 中启用 "Language Learner"。

## ⚙️ 配置 (Configuration)

进入 **Settings > Language Learner** 进行基础设置：

1.  **General (通用)**
    *   **Native Language**: 设置您的母语（如 Chinese）。
    *   **Foreign Language**: 设置您正在学习的语言（如 English）。

2.  **Dictionaries (词典)**
    *   开启您需要的词典源。
    *   **推荐**：开启 `AI` 和 `Youdao`，并将 `AI` 优先级调高以获得最佳体验。

3.  **AI & Advanced (AI 设置)**
    *   **Provider**: 选择您的 AI 服务商。
    *   **API Key**: 输入您的 API 密钥。
    *   **Model**: 选择模型（推荐 `gpt-4o-mini` 或 `gemini-1.5-flash` 以获得极速响应）。

## 📖 使用指南 (Usage Guide)

### 1. 查词 (Lookup)
*   **划词**：在笔记中选中单词，按住 `Ctrl` (或您设置的功能键)，松开鼠标即可弹出查词窗口。
*   **侧边栏**：点击右侧栏的 🔍 图标，输入单词回车查询。

### 2. 单词状态管理 (Manage)
在查词结果界面，您会看到单词的状态栏：
*   遇到生词 -> 点击 **New** (加入生词本)。
*   太简单/人名地名 -> 点击 **Ignore** (不再高亮)。
*   复习时 -> 根据熟悉程度更新为 **Familiar** 或 **Learned**。

### 3. 阅读模式 (Reading Mode)
1.  打开一篇外语笔记。
2.  点击笔记右上角的 **📖 书本图标** ("Open as Reading View")。
3.  在阅读视图中，生词会被自动高亮。
4.  点击单词查看释义，选中句子查看翻译。

## 💡 建议学习流程 (Suggested Workflow)

1.  **导入素材**：将外刊文章或阅读材料复制到 Obsidian 笔记中。
2.  **开启阅读模式**：进入 Reading View，浏览全文。
3.  **扫除生词**：
    *   阅读过程中，点击高亮单词或不懂的词。
    *   查看 AI 释义，理解语境。
    *   将其标记为 **New**，并简要记录笔记（可选）。
4.  **回顾与巩固**：
    *   阅读结束后，打开右侧 **Learn Panel** (📊 图标)。
    *   浏览刚才收集的生词，进行二次记忆。
5.  **定期复习**：利用碎片时间回顾生词本，更新单词状态。

## ⌨️ 快捷键 (Shortcuts)

| 功能 | 默认快捷键 | 说明 |
| :--- | :--- | :--- |
| **划词搜索** | `Ctrl` + 选中文本 | 可在设置中更改为 `Alt` 或 `Meta` |
| **打开查词面板** | - | 可在设置 > 快捷键中自定义 |
| **打开阅读模式** | - | 可在设置 > 快捷键中自定义 |

---

**Enjoy your language learning journey in Obsidian!** 🚀
