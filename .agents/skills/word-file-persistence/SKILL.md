---
name: word-file-persistence
description: 修改词条文件（word_folder/*.md）的 frontmatter 写入/读取、外部复习字段（下次复习/复习记录）、例句合并逻辑，或修复丢字段 bug 时使用。只要改动会重写用户词库 markdown、涉及与外部复习工具共享的中文键、或触碰 word-file.ts / createFM / parserFM / collectReviewLogs，就用这个 skill。
---

# 词条文件持久化（word_folder/*.md 保留式合并）

## 何时使用

- 新增/调整词条 frontmatter 字段、改导出格式、或修复「保存词条丢字段 / 丢正文」类 bug。
- 涉及「复习次数」「下次复习」「复习记录」这些与外部复习工具（ScoreFlow 等）共享的字段——写入侧或读取/统计侧（Stat 图表）任一侧。
- 改例句合并逻辑（sentence{i}/trans{i}/origin{i} 的只增不丢语义）。
- 改动任何会重写 `word_folder` 下 markdown 的路径：FileDb 保存、LearnPanel 提交、阅读视图收集单词、设置页刷新。

## 动手前必读

1. `src/utils/word-file.ts` 全文——纯函数模块，头部注释（3-14 行）写明模块契约：以现有 frontmatter 为基底，只覆盖白名单键，未知键与正文逐字节保留。
2. `scripts/test-merge-wordfile.mjs` 全文——T1-T7 断言组就是合并契约的机器可读版；改行为前先读懂现有断言在锁什么。
3. `src/plugin.ts` 中的运行时接线：
   - `createFM`（1470-1476）：`buildWordFrontMatter` + `mergeWordFile`，注入 Obsidian 的 `stringifyYaml`。
   - `readWordFileText`（1452-1467）：读词条文件原文，文件不存在返回 null（新建场景）。
   - `createWordfiles`（1412-1450）：批量写入，先读 `existingText` 再 `createFM`。
   - `parserFM`（1559-1617）：读取侧，从 metadataCache 解析白名单键 + 中文复习键。
   - `collectReviewLogs`（1643-1677）：汇总所有词条的复习记录供统计。

## 数据流全景

**写入**（全部汇入 `plugin.createFM`，无一例外）：

- `src/db/file_db.ts:394-410`（FileDb.postExpression）：`readWordFileText` → `createFM` → `vault.create`，已存在则 `vault.modify` / `adapter.write`。
- `src/plugin.ts:1412-1450`（createWordfiles）：同样模式；调用方是 `ReadingView.ts:113`（阅读视图收集）和 `settings.ts:2168` → `updateWordfiles`（plugin.ts:1480-1484）。

**读取**：

- `parserFM`（plugin.ts:1559-1617）用 `metadataCache` 读白名单键；`fm["下次复习"]` 过 `normalizeNextReview`（word-file.ts:212）、`fm["复习记录"]` 过 `parseReviewLog`（word-file.ts:217），挂到 `ExpressionInfo.next_review / review_log`（`src/db/interface.ts:42-43`）。
- `collectReviewLogs`（plugin.ts:1645-1677）：frontmatter YAML 列表形态优先（`splitWordFileText` + `parseYaml` + `parseReviewLog`），为空时解析正文表格兜底（`parseReviewLogTables`，word-file.ts:260）。
- 消费方：`Stat.vue:248-249`（`collectReviewLogs` → `aggregateReviewStats` 出复习留存图表）、`LearnPanel.vue:1336` 与 `DataPanel.vue:103,119`（展示「下次复习」）。
- 缓存：`reviewLogsCache` 与 `parserAllFM` 缓存一起由 `invalidateParserAllFMCache`（plugin.ts:254-258）失效；word_folder 下文件的 create/modify/delete/rename 都会触发（`registerWordFolderWatchers`，plugin.ts:218-240）。改缓存逻辑时记得两条缓存必须同步失效，否则统计图表读旧数据。

## 核心契约（不可破坏）

1. **写入一律走 `buildWordFrontMatter` 白名单 + `mergeWordFile` 保留式合并**。白名单键：`expression/meaning/date/status/type` 必写，`surface/aliases/tags/notes` 非空才写，例句展开为 `sentence{i}/trans{i}/origin{i}`（word-file.ts:25-61）。合并时白名单键原地替换（不存在则按 payload 顺序追加到 FM 末尾），其余键与正文逐字节保留（word-file.ts:147-186）。0.7.0 之前的整体重建会丢未知键与正文，commit `32ad5b9` 修复并随 v0.7.0 发布——别把这笔账还回去。
2. **「下次复习」「复习记录」中文键是与外部复习工具的共享契约，绝不能改名、不能换英文键**。写入侧根本不碰它们（不在白名单里，天然透传）；读取侧按键名精确匹配。
3. **例句只增不丢**：payload 只带 sentence1 时，既有 sentence2/trans2/origin2 必须原样保留（测试 T2 锁定）。注意读取侧 `parserFM` 的例句循环从 1 起连续编号、遇缺口即 break（plugin.ts:1580-1591），所以合并保持连续编号至关重要。
4. `word-file.ts` 保持纯函数：不 import obsidian / js-yaml / DOM，YAML 序列化经 `YamlStringifier` 参数注入（word-file.ts:14）——这是测试脚本能用 node 直接转译加载它的前提，引入任何运行时依赖都会打破回归测试。
5. 两个 frontmatter 提取正则语义不同，**不可混用**：`word-file.ts:64` 要求 FM 在文件最前（仅容 BOM）；`src/utils/frontmatter.ts:4` 容许前置空行。
6. `src/utils/frontmatter.ts` 的 `FrontMatterManager.storeFrontMatter`（42-60 行）是整段重建式（parseYaml→stringifyYaml 会重排格式、丢注释），只用于 `langr-pos`（`ReadingArea.vue:851`）和阅读完成标记（`plugin.ts:530-541`）。词条文件写入不经它，也不要让它染指词条文件。

## 推荐执行流程

1. 读上面「必读」清单，确认要改的行为落在哪个环节（构建 payload / 合并 / 读取 / 聚合）。
2. 先在 `scripts/test-merge-wordfile.mjs` 里仿照 `section()`/`check()` 风格补断言场景（复用文件头的 `cont()`/`fmOf()`/`fixtureStringify` fixture），跑红或跑通确认现状。
3. 改实现。写入行为改 `word-file.ts`，接线改 `plugin.ts`，两侧对齐（键名、键序、格式化）。
4. 跑完整验证（见下），全绿才算完成。

## 常用命令与验证

```bash
node scripts/test-merge-wordfile.mjs   # 期望末行 =57 passed, 0 failed=，exit 0
npx tsc -noEmit -skipLibCheck           # 类型检查
npm run build                            # 生产构建兜底
```

改完必跑测试脚本——仓库没有 `npm test` 入口、CI 也不跑它（见 AGENTS.md「测试与 lint 现状」），漏跑不会有任何提示。三个命令都通过后，若改动影响实际写文件行为，再在 Obsidian 里加载插件实测一次保存词条→重开验证外部键仍在（AGENTS.md 认可的回归方式）。

## 可复用的模块与 helper（都在 `src/utils/word-file.ts`）

- `buildWordFrontMatter(cont, formatDate?)`：白名单 payload 构建；日期格式化器可注入，默认 `formatUnixTimestamp`（本地时区 `YYYY-MM-DD HH:mm:ss`）。
- `mergeWordFile(existingText, payloadFm, stringify)`：核心合并；`existingText` 为 null/空白时输出等价于旧 createFM 的整文件快照（测试 T5 锁定逐字节一致）。
- `splitWordFileText(text)`：切出 `{bom, fmText, body}`，`collectReviewLogs` 也用它。
- `normalizeNextReview` / `parseReviewLog` / `parseReviewLogTables` / `aggregateReviewStats`：外部复习字段的读取与聚合全家桶，新增统计需求直接组合它们，不要另起解析逻辑。

## 禁止事项与高风险误区

- **禁止** `parseYaml` 全量解析 → `stringifyYaml` 全量重建词条文件：会丢未知键、注释、键序和正文格式，正是 v0.7.0 之前那个丢字段 bug 的根源。
- **禁止**改动 `mergeWordFile` 的「未知键逐字节保留」语义，或往 `word-file.ts` 引入 obsidian / js-yaml 依赖。
- **禁止**重命名中文键「下次复习」「复习记录」——外部工具按字面读它们。
- **易错点：js-yaml 会把 `2026-09-20` 解析为 Date 对象**。任何从 YAML 读出的值直接当 string 用都会出错，必须过 `normalizeNextReview` / `parseReviewLog`（内部 `toDisplayString` 归一，word-file.ts:196-209）。
- **易错点：`aggregateReviewStats` 的失败标记词表必须先于成功标记匹配**——「未掌握」包含「掌握」，顺序反了留存率会算错（word-file.ts:311-327，`classifyReviewResult` 先查 `REVIEW_FAIL_MARKS`）。
- **易错点：两个 FM 提取正则不可互换**（见核心契约第 5 条）。给 `word-file.ts` 用宽松版会误吃前置空行后的正文；给 frontmatter.ts 用严格版会漏掉容许空行的文件。
