---
name: word-query-flow
description: 排查「划词不弹窗 / 弹窗位置不对 / 查词不触发词典」类问题、新增取词入口（编辑器事件、外部视图 postMessage、命令面板）、或新增/修改 obsidian-langr-* 自定义事件时使用。
---

# 查词链路与自定义事件

## 何时使用

- 划词查词不弹窗、弹窗位置不对、词典不触发、LearnPanel 不预填
- 新增取词入口：新的编辑器事件、外部视图（如 PDF viewer）postMessage、命令面板命令
- 新增或修改 `obsidian-langr-*` 系列跨组件自定义事件

## 必读文件（动手前先读）

- `src/plugin.ts`
  - `queryWord()`（src/plugin.ts:1254）——统一查词入口，所有取词路径最终汇到这里
  - `sanitizeSentenceContext()`（src/plugin.ts:805）——句子上下文清洗正则
  - `buildSearchContext()`（src/plugin.ts:1055）/ `createSearchContextFromSentence()`（src/plugin.ts:1043）——提取 sentenceText / origin / sourceFilePath
  - `getActiveSearchRequest()`（src/plugin.ts:853）——命令取词：DOM 选区 → 编辑器选区 → 光标单词，三级回退
  - `registerMouseup()`（src/plugin.ts:1328）——pointerup 划词入口
  - `registerContextMenu()`（src/plugin.ts:1289）——editor-menu（编辑模式）+ contextmenu（预览模式）
  - `registerLeftClick()`（src/plugin.ts:1349）——注意：这不是查词入口，是词典结果弹窗（`.sr-modal-content` 内 H4）的点击发音
  - `replacePDF()` 的 message 监听（src/plugin.ts:345）——PDF viewer postMessage 入口
- `src/constant.ts:20-46`——`EventMap` 接口，集中声明 5 个事件：search / refresh / refresh-stat / language-change / toast
- `src/utils/use.ts`——`useEvent`（onMounted 绑定 / onBeforeUnmount 解绑，按 `EventMap` 索引类型约束）
- 三个 search 消费者：
  - `src/views/Global.vue:77`——定位并显示弹窗
  - `src/views/SearchPanel.vue:190`——维护搜索历史、触发词典（注意：这里用的是裸 `addEventListener`/`removeEventListener` 手动管理，不是 `useEvent`）
  - `src/views/LearnPanel.vue:1363`——预填新词表单、取已有词条
- `src/store.ts`——`popupSearch` / `searchPinned` / `dictsChange` 等跨组件状态

## 事件流全貌

```
入口                                    副作用/说明
pointerup 划词     (registerMouseup)    function_key 判定 + searchPinned 豁免 + stopImmediatePropagation
contextmenu 右键   (registerContextMenu) 编辑模式 editor-menu + 预览模式 .markdown-preview-view
命令面板           (addCommands)        "Translate Select"（getActiveSearchRequest，无选区时查光标单词）
                                        "Translate Input"（InputModal 手动输入）
PDF postMessage    (replacePDF)         evt.data.type === "search" 时 queryWord(evt.data.selection)
        │
        ▼
queryWord(word, target?, evtPosition?, searchContextOverride?)
  1. sanitizeSentenceContext 清洗选中文本，空则直接 return
  2. buildSearchContext 提取 sentenceText/origin/sourceFilePath（可被第 4 参覆盖）
  3. 副作用：!popup_search 时激活 SEARCH_PANEL_VIEW（左侧）；
     有 sentenceText 且桌面端时激活 LEARN_PANEL_VIEW（右侧）；
     auto_pron 开启时发起有道 dictvoice 发音请求
  4. dispatchEvent('obsidian-langr-search', detail: {selection, target, evtPosition, sentenceText, origin, sourceFilePath})
        │
        ├─▶ Global.vue:77      有 evtPosition 时 optimizedPos 计算弹窗坐标；无 evtPosition 仍显示但不移动坐标
        ├─▶ SearchPanel.vue:190 追加搜索历史 → 按设置排序渲染词典 provider
        └─▶ LearnPanel.vue:1363 预填表单 → db.getExpression 取已有词条 → 补词形/翻译 → postExpression 保存
```

## 排查清单（按顺序）

1. `store.popupSearch` 是否 true——`popup_search=false` 时 PopupSearch 因 `v-if` 根本不渲染（Global.vue:3），查词走左侧 SearchPanel 路径。「弹窗不出现」先查它，不要先怀疑事件监听。
2. `settings.function_key` 触发键配置——registerMouseup 按 `funcKey === "disable" || evt[funcKey] === false` 判定。
3. `store.searchPinned` 豁免——pin 状态下点击 `#langr-search,#langr-learn-panel` 之外的区域不触发。
4. `evtPosition` 是否传入——决定弹窗定位；Global.vue 只在有 evtPosition 时更新坐标。
5. 记住 `queryWord()` 副作用很大：激活面板 + 有道发音网络请求。调用它不等于只发一个事件；新增入口时评估这些副作用是否合意。

## 新增/修改 obsidian-langr-* 事件

流程：

1. `src/constant.ts` 的 `EventMap` 声明事件名与 detail 类型（.ts 文件里 `useEvent`/`dispatchEvent` 才有类型提示）
2. 派发方：`window.dispatchEvent(new CustomEvent(...))`
3. 消费方：`useEvent(window, name, handler)`（自动随组件卸载清理；SearchPanel 式裸 addEventListener 也可，但须手动在 onUnmounted 解绑）

**关键陷阱**：`EventMap` 是纯声明合并（constant.ts:18 注释自述），且 `shims.d.ts` 把 `*.vue` 泛化为通用 `ComponentOptions`，tsc 不深检 `.vue` 内部脚本——漏改消费者、事件名拼错**都不会有编译错误**。既有先例：`obsidian-langr-ai-autofill-settings-change`（settings.ts:1621 派发、LearnPanel.vue:620 监听）就未注册进 EventMap，一直无声运行。所以改完必须 grep 核对派发/消费成对。

## 全局提示约定

用 `obsidian-langr-toast`（Global.vue:95 自绘渲染，info/success/error 三样式），不要混用 Obsidian `Notice`。注意：当前仓库内**没有任何派发方**（UI 处于待命状态），要弹 toast 必须自己 `dispatchEvent` 该事件。

## 禁区

- 不要绕过 `queryWord()` 直接触发查词 UI——会丢失上下文提取、面板激活、发音等整条链路行为。
- 不要修改 `sanitizeSentenceContext` 的正则而不跑「Debug: Copy Cleaned Sentence」命令（id: `langr-debug-copy-cleaned-sentence`）对照——该命令会 console.debug 输出 raw/normalized/cleaned 三态并复制到剪贴板（plugin.ts:1224）。

## 常用命令与可复用模块

- `npm run build`：tsc 检查 + 生产打包（详见 local-build-debug skill）
- `grep -rn "<事件名>" src/`：核对事件派发/消费成对；注意会命中遗留备份文件（如 `ReadingArea.vue.backup-*`），属噪音须人工排除
- 可复用 helper：`useEvent`（事件绑定生命周期）、`sanitizeSentenceContext`（文本清洗，公开方法可直接调用）、`getActiveSearchRequest`（新命令取词的标准姿势，含光标单词回退）

## 完成后的验证

1. `npm run build` 通过
2. 在 Obsidian 中实测三条入口：划词（含 function_key 各档位）/ 右键菜单 / 命令面板 Translate Select（含无选区时光标取词）
3. 新增/修改事件后：`grep -rn "<事件名>" src/` 确认派发与消费成对出现，且 EventMap 声明已更新
