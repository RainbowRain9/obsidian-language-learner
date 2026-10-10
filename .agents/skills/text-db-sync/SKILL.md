---
name: text-db-sync
description: 改动 words.md / review.md 文本数据库导出格式、刷新时机（refreshWordDb / refreshReviewDb / scheduleRefreshTextDB）、LearnPanel 提交后的自动同步，或 Various Complements 联动时使用。只要涉及 word_database / review_database 设置、last_word_db_hash 去重、<!--SR--> 复习记录保留、auto_refresh_db 开关，都应触发本 skill。
---

# 文本数据库同步（words.md / review.md）

插件会把词条导出成两个 markdown 文本数据库：`words.md`（正反查表，供 Various Complements 等外部补全插件消费）和 `review.md`（#flashcards 卡片，供 spaced repetition 复习插件消费）。本 skill 覆盖这条同步链路的全部改动场景。

## 何时使用

- 改动 `refreshWordDb` / `refreshReviewDb` / `refreshTextDB` 的输出格式或触发时机
- LearnPanel 提交词条后自动同步行为异常（没刷新 / 刷新太早 / 重复刷新）
- 排查 review.md 中手写内容或 `<!--SR-->` 复习记录丢失
- 涉及 `various-complements` 外部插件联动（刷新尾部会执行其 reload 命令）
- 改动 `word_database` / `review_database` / `auto_refresh_db` / `last_word_db_hash` / `last_sync` 相关设置

## 必读文件（动手前先读）

- `src/plugin.ts:548-715` —— 同步核心：`refreshTextDB` → `scheduleRefreshTextDB` → `runRefreshTextDB` → `refreshWordDb` → `refreshReviewDb` 的全部实现
- `src/views/LearnPanel.vue:849-886` —— submit 成功后的触发路径
- `src/settings.ts:113-125` 与 `src/settings.ts:168-190` —— 相关设置字段与默认值（注意 `auto_refresh_db` 默认为 `true`）
- `src/plugin.ts:299-330` —— `ensureDefaultTextDbFiles()`，在 onload 早期被调用（`src/plugin.ts:168`）
- `src/plugin.ts:68` —— `STATUS_KEYS = ["Ignore", "Learning", "Familiar", "Known", "Learned"]`，正查表分节依据
- `src/db/base.ts:42` —— `getAllExpressionSimple(ignores?)` 抽象接口（`ignores=false` 时 `status > 0`，即过滤掉 Ignore，见 `src/db/local_db.ts:346-351`）

## 同步链路（已核实的行为）

```
LearnPanel 提交
  ├─ plugin.db.postExpression(data) 返回 statusCode !== 200 → Notice "Submit failed" 并 return，链路终止（LearnPanel.vue:849-854）
  ├─ （可选）带 sourceFilePath 时 appendExpressionToWordsSection 追加到来源笔记 —— 独立路径，与文本数据库同步无关（LearnPanel.vue:856-862）
  ├─ dispatch obsidian-langr-refresh / obsidian-langr-refresh-stat 事件
  └─ settings.auto_refresh_db 开启时 → plugin.scheduleRefreshTextDB(500)（LearnPanel.vue:878-881）

scheduleRefreshTextDB(500)
  ├─ 500ms 防抖：延迟是为了等 Obsidian metadataCache 更新；新调用会重置计时器（plugin.ts:556-564）
  └─ runRefreshTextDB：running / queued 双标志防重入 —— 正在跑时新请求只置 queued，跑完后再补一轮（plugin.ts:566-581，状态字段在 plugin.ts:149-151）

refreshTextDB（plugin.ts:548-554）
  ├─ await refreshWordDb()
  ├─ await refreshReviewDb()
  └─ 执行外部命令 various-complements:reload-custom-dictionaries —— 与 Various Complements 插件的隐性集成
```

## 两库行为不对称（高频踩坑点）

**refreshWordDb（`src/plugin.ts:583-635`）—— 增量跳过，格式固定**

- 正查表按状态分节：`#### Learning` / `#### Familiar` / `#### Known` / `#### Learned`（Ignore 词条已被过滤，`classified_texts.shift()` 丢掉的只是空的 Ignore 节），行格式 `` ${expression}${col_delimiter}    ${meaning}``（分隔符后 4 空格）
- 尾部拼 `#### Reverse Lookup` 反查表，行格式 `` ${meaning}  ${col_delimiter}  ${expression}``（前后各 2 空格）
- 用 `last_word_db_hash` 去重跳过写盘：hash 是 `` `${words.length}-${text.length}-${text.slice(0, 256)}-${text.slice(-256)}` `` 的拼接（**非加密哈希**，plugin.ts:627）。内容未变则提前 return，不写盘也不更新设置；写盘后才回写 `last_word_db_hash` 并 `saveSettings()`（plugin.ts:628-634）
- 路径无效（文件不存在或是文件夹）时 Notice 报错并中止（plugin.ts:592-595）

**refreshReviewDb（`src/plugin.ts:637-715`）—— 每次全量重建，无跳过逻辑**

- 先读旧文件，用两级正则提取既有 `<!--SR-->` 调度注释存入 `oldRecord`：外层 `/#word[\s\S]*?(<!--SR.*?-->)/g`，内层 `/#### (.+)[\s\S]+(<!--SR.*-->)/`（plugin.ts:653-660）
- 按 `getExpressionAfter("1970-01-01T00:00:00Z")` 取全部非无视词条，按 expression 去重、`localeCompare` 排序后**整文件重写**（plugin.ts:662-712）——文件里手写的任何非卡片内容都会丢失，唯一例外是上面提取的 SR 注释会按词条回填（先按 reviewPrompt 再按 expression 匹配，plugin.ts:702-704）
- 卡片格式：文件头 `#flashcards\n\n`，每卡片 `#word\n#### ${reviewPrompt}\n${review_delimiter}\n${answer}\n${notes}${sentences}${SR注释}\n`；reviewPrompt 优先用 surface（与 expression 大小写不敏感地不同时才额外加 `**Expression**` 行）
- 尾部更新 `settings.last_sync = moment.utc().toISOString()` 并持久化（plugin.ts:713-714）

**onload 兜底**：`ensureDefaultTextDbFiles()`（plugin.ts:299-330，onload 中 `src/plugin.ts:168` 调用）在 `word_database` / `review_database` 设置为空时自动创建 `words.md` / `review.md`（vault 中不存在则 `vault.create` 空文件），并把路径写回设置持久化。

## 推荐执行流程

1. 读上面"必读文件"，确认要改的环节在链路中的位置
2. 改动输出格式时，先在纸面上写出旧格式 → 新格式的映射，并确认 `oldRecord` 的 `<!--SR-->` 正则在新格式下仍能匹配（`#word` 与 `#### 标题` 的相对结构不能破坏）
3. 改动刷新时机时，保持经由 `scheduleRefreshTextDB` + `runRefreshTextDB` 的防抖 / 防重入路径，不要另起炉灶
4. `npm run build` 通过后，按下面的验证步骤实机确认

## 常用命令

```bash
npm run build   # tsc -noEmit -skipLibCheck + 生产打包；仓库无测试框架，这是唯一自动回归检查
```

Obsidian 命令面板（`src/plugin.ts:370-381` 注册）：

- `langr-refresh-word-database`（"Refresh Word Database"）—— 单独触发 refreshWordDb
- `langr-refresh-review-database`（"Refresh Review Database"）—— 单独触发 refreshReviewDb

## 禁止事项与高风险误区

- **不要绕过 `scheduleRefreshTextDB` 直接并发调 `refreshTextDB`**——会同时失去防抖与 running/queued 防重入保护，导致并发写同一文件
- **改输出格式 = 破坏用户数据**：review.md 的旧 `<!--SR-->` 记录靠正则提取回填，words.md 被 Various Complements 当字典消费。任何格式改动必须同步验证 oldRecord 正则提取在新旧格式下都工作
- **不要假设 review.md 里手写内容会保留**——refreshReviewDb 是全量重建不是增量，改代码时也别顺手把它"优化"成看起来像增量的逻辑而漏掉重排语义
- **不要把 `last_word_db_hash` 当加密哈希用**——它只是词数 + 长度 + 首尾 256 字符的拼接指纹，改判等逻辑前先理解它跳过的只是"生成文本完全没变"的情况
- 记住 `auto_refresh_db` 默认开启（settings.ts:171），提交路径默认就会走同步；调试"没刷新"问题时先确认设置项再查代码

## 完成后的验证

1. `npm run build` 通过
2. 在 Obsidian 中开启 `auto_refresh_db`，提交一个词条，diff `words.md` / `review.md`：
   - 正查表对应状态节新增词条、`#### Reverse Lookup` 同步更新
   - 既有词条的 `<!--SR-->` 注释原样保留在对应卡片里
3. 手动执行命令面板的 "Refresh Word Database" 与 "Refresh Review Database" 二次确认：连续执行两次，words.md 第二次不应产生新变更（hash 去重生效），review.md 内容保持幂等
