---
name: reading-view-changes
description: 修改阅读模式（TextParser 解析、单词状态 class、短语包裹、选词交互、阅读笔记 ^^^ 分节格式、langr-pos/音频/视频嵌入）或排查阅读视图白屏、高亮不更新、样式切换后回退时使用。凡涉及 ReadingView/ReadingArea/parser.ts 或 markdown↔阅读模式切换链路，先读这个 skill。
---

# 阅读模式改动（reading-view-changes）

## 何时使用

- 修改 `src/views/parser.ts` 的解析/渲染管线（WordNode/PhraseNode、状态 class、音频占位符）
- 修改单词状态映射、短语高亮包裹、阅读区选词/悬停交互
- 修改阅读笔记 `^^^article` / `^^^words` / `^^^notes` 分节格式、words 区多设备合并
- 修改 `langr-pos` 写回、`langr-video` / `langr-audio`、行内音频嵌入
- 排查症状：阅读视图白屏（TypeError）、改状态后高亮不变、切换视图后 markdown 样式回退、短语不高亮

## 必读文件（动手前全文/指定段读一遍）

- `src/views/parser.ts` 全文：unified + retext-english 四插件管线（`retextEnglish`→`addPhrases`→`addMarkdown`→`stringfy2HTML`，parser.ts:33-37）、`STATUS_MAP`（parser.ts:13）、`compileHTML`/`toHTMLString`（parser.ts:345-465）
- `src/views/ReadingView.ts`：`divide()` 分节（280-294）、`refresh` 状态刷新（365-499）、`statusMap`（377）、words 区解析与 `updatedAt` 合并（125-265）、`readContent`/`writeContent`（297-323）、150ms 防抖 `scheduleSaveWords`（325-358）
- `src/views/ReadingArea.vue`：`segments["article"]` 直接访问（571-575）、`processContent` 正则 DOM 后处理（896-964）、选词交互 mobile click / desktop pointerdown+pointerup（1145-1199）、悬停释义（988-1143）、`langr-video`（132-144 及 346 起 watchEffect）、`langr-audio`（484-530）、翻页写 `langr-pos`（822-860）
- `src/plugin.ts`：`FRONT_MATTER_KEY`（56）、`notifyWordStorageChanged`（261-263）、`registerReadingToggle`（718-798）、全局 `processContent`/`fetchData`（1685-1801）、`setMarkdownView`/`setReadingView`（477-495）、`parserAllFM` 缓存（145-147、1620 附近）
- `src/utils/frontmatter.ts` 全文：`FrontMatterManager` 的整块 YAML 重序列化（42-60）

## 硬性格式与入口事实

- 笔记正文必须含 `^^^article` 分节标记行（`^^^words`、`^^^notes` 可选），`ReadingView.divide()` 按行切三段；缺失 `^^^article` 时 ReadingArea.vue setup 阶段访问 `segments["article"].start` 直接抛 TypeError——这就是「挂载即白屏」的根因（AGENTS.md 第 5 节已记载同一问题）
- frontmatter 必须含 `langr` 键（`FRONT_MATTER_KEY`，plugin.ts:56）才会出现阅读模式入口
- words 区条目格式：`+ **[[word]]** : meaning <!--langr:{"source":"device-xx","updatedAt":"ISO"}-->`（`use_fileDB` 开时带 `[[]]` 链接，ReadingView.ts:166-171）；多设备合并按 `updatedAt` 新者胜、平局比 `source`（ReadingView.ts:200-213）
- 已知 bug：`onPaneMenu` patch 访问 TFile 不存在的 `file.cache` 属性（plugin.ts:725；TFile 只有 `stat/basename/extension`，见 obsidian.d.ts:3494-3508），菜单项从不出现。**实际生效入口是 `setViewState` patch 加的标题栏按钮**（plugin.ts:755-798）。不要去修菜单项时误以为按钮路径是死代码

## 状态映射：4 处平行定义必须同步

`0=ignore / 1=learning / 2=familiar / 3=known / 4=learned`；`new` 不是 status 值，仅表示 DB 未收录。改命名/顺序需同步全量四处：

1. `src/views/parser.ts:13` — `STATUS_MAP`
2. `src/views/ReadingView.ts:377` — refresh 里的 `statusMap`
3. `src/views/LearnPanel.vue:349` — status 下拉样式数组
4. `src/views/DataPanel.vue:86` — `statusLabels`

## 关键约束与高风险误区

- **短语包裹 offset 精确相等**：`wrapWord2Phrase` 要求 db 返回的 `phrase.offset` 与 AST token 的 `position.start.offset` 完全相等（parser.ts:241-251）。`getStoredWords({article})` 之后、`processor.parse(text)` 之前任何改动文本长度的逻辑（哪怕加一个字符）都会让短语包裹**静默失效**
- **refresh 是就地改 class，不重新 parse**（性能设计）：LearnPanel 提交 → dispatch `obsidian-langr-refresh`（LearnPanel.vue:864-875）→ ReadingView.refresh 用 `el.textContent.toLowerCase() === expression` 全文匹配改 className（ReadingView.ts:384）。因此改 parser 输出结构（嵌套 span、给 word 加子元素）会使 textContent 匹配失效，高亮就不更新
- **多层缓存，失效走统一入口**：TextParser 的 `htmlCache`/`countCache`（LRU 30，parser.ts:25-27）+ plugin 层 `parserAllFMCache`/`reviewLogsCache`（plugin.ts:145-147、254-259）由 `notifyWordStorageChanged()`（plugin.ts:261-263）统一失效；db 层 phrase/simple 缓存在各写方法内部自清（local_db.ts:404-405、460-461、492-493；file_db.ts:454-455）。绕过 `postExpression` 等写入口直接改数据时，记得手动调 `notifyWordStorageChanged()`，只清一层会读到脏数据
- **markdown 渲染两层**：unified 管线只处理 `**粗体**`/`*斜体*`（parser.ts:280-332）；标题/图片/`__`/`_`/`~~` 是渲染后由**两份近似复制的正则 DOM 改写**完成——ReadingArea.vue `processContent`（910-959）与 plugin.ts 全局 `processContent`（1693-1741）。改渲染规则必须两处同步改，漏一处表现为「切换视图后样式回退」
- **retext-english 只处理英文单词**：数字与 CJK 字符输出 `span.other` 不计词数（parser.ts:425-427、101），不要把这条链路用于中文阅读场景
- **langr-pos 写回即翻页即写盘**：走 `FrontMatterManager.setFrontMatter`，整块 YAML `stringifyYaml` 重序列化（frontmatter.ts:42-60），可能重排用户手写 frontmatter 格式
- **TextParser 实例状态跨 parse 共享且无锁**：`pIdx`/`phrases`/`words`/`audioEmbeds` 是实例字段，`text2HTML` 开头才重置（parser.ts:132-134）；并发 parse 会互相污染

## 推荐执行流程

1. 读上列必读文件，定位改动落在哪一层（parser 管线 / ReadingView DOM 刷新 / ReadingArea 交互与后处理 / plugin 入口 patch / frontmatter 写回）
2. 涉及状态值：先查四处平行定义，确认是否都要改
3. 涉及渲染输出结构：同步检查 ReadingView.refresh 的 textContent 匹配与两份 processContent 的正则是否仍然成立
4. 涉及词库数据写入路径：确认缓存失效走 `notifyWordStorageChanged()`
5. `npm run build`（先 tsc -noEmit 再打包）
6. 按「验证」一节在 Obsidian 实机过一遍

## 常用命令

- `npm run build`：TypeScript 检查 + 生产打包到 `.build/plugin/`，改完必跑
- `npx tsc -noEmit -skipLibCheck`：仅类型检查，快速反馈
- `npm run dev`：esbuild watch，实机联调时挂着
- 仓库无测试框架、无 lint 一等命令；回归靠 build + Obsidian 实机（详见 local-build-debug skill）

## 可复用模块与事件

- 自定义事件 `obsidian-langr-refresh`（payload 见 src/constant.ts:29-36）：LearnPanel 提交后广播，ReadingView.refresh 改高亮、ReadingArea 刷词数
- `ReadingView.readContent(type, create)` / `writeContent(type, content)`：按 `^^^` 分节读写笔记的标准入口，不要自己再 split
- `TextParser.getWordsPhrases(text)`：取当前页 status>0 的词与短语（ReadingView.saveWords / getLearnWords 都靠它）
- `FrontMatterManager`（plugin.frontManager）：langr-pos 等 frontmatter 读写唯一入口
- `plugin.queryWord(text, el, position)`：选词后弹查词窗的统一入口（ReadingArea 选词交互调用处）

## 禁止事项

- 不要在 `getStoredWords` 与 `parse` 之间改文本长度（短语包裹静默失效）
- 不要只改四处状态定义之一
- 不要只改两份 processContent 之一
- 不要绕过 `notifyWordStorageChanged()` 手动清缓存或不清缓存
- 不要假设 onPaneMenu 菜单项能用（`file.cache` bug 未修）；验证入口一律用标题栏按钮
- 不要给 word/phrase span 加嵌套结构或属性，除非同步改 refresh 的匹配逻辑

## 完成后的验证

1. `npm run build` 通过
2. Obsidian 实机：含 `langr` frontmatter 的笔记标题栏出现阅读按钮，去掉 `langr` 后按钮消失
3. 阅读模式中改一个词的状态：高亮 class 即时变化（不重新 parse）、words 区约 150ms 防抖后写入（带 `<!--langr:...-->` 元数据）
4. 翻页后 frontmatter 的 `langr-pos` 更新
5. 涉及短语/渲染改动：额外确认短语高亮正常、markdown↔阅读视图来回切换后标题/图片/粗斜体样式不回退
