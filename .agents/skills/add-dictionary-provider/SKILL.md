---
name: add-dictionary-provider
description: 给查词面板新增词典/翻译 provider（engine.ts + View.vue），或修改现有词典（youdao/cambridge/google/ai）的抓取与解析逻辑时使用。排查词典面板不显示、显隐异常、排序不对、loading 状态失效等查词面板问题也用这个 skill。
---

# 新增 / 修改词典 provider

## 何时使用

- 给查词面板新增一个词典或翻译源（新 provider = `engine.ts` + `View.vue`）
- 修改 youdao / cambridge / google / ai 的请求构造或结果解析（如站点改版导致选择器失效、返回空）
- 排查词典面板问题：面板不出现、无结果不隐藏、优先级排序不对、loading 转圈不消失

## 必读文件（动手前先读）

| 文件 | 看什么 |
| --- | --- |
| `src/dictionary/list.ts` | 词典注册表 `dicts` 与 `DictMeta`。`nameKey`/`descriptionKey` 的类型是 `Parameters<typeof t>[0]`（`list.ts:8-9`），key 不在 `en.ts` 里会直接编译报错——这是文案遗漏的类型兜底 |
| `src/dictionary/uses.ts:5-17` | `useLoading` 的完整实现，loading 协议的唯一权威 |
| `src/views/SearchPanel.vue:58-95` | 面板渲染数据流：从 `settings.dictionaries` 取 key、过滤 enable、按 priority 排序、`map[id]` 定位 |
| `src/views/SearchPanel.vue:174-186` | `getComponentProps`：决定每个词典组件收到哪些 props |
| `src/settings.ts` 的 `DEFAULT_SETTINGS.dictionaries`（约 158-163 行） | 新词典的默认 `{enable, priority}` 必须加在这里 |
| `src/dictionary/helpers.ts` | 移植自 ext-saladict 的抓取工具箱（详见下文"可复用 helper"） |
| `src/lang/locale/en.ts` | nameKey/descriptionKey 文案；en 是 locale 类型的权威来源 |
| `src/stalin.css:22-36` | `.dict-icon.<id>` base64 图标（含 jukuu/hjdict/deepl 三个已下线词典的残留，勿当作现存 provider） |

范例：JSON 接口照抄 `src/dictionary/google/`（最简，engine 用 `requestUrl` 拿 JSON，View 渲染字段）；HTML 抓取照抄 `src/dictionary/cambridge/`（`fetchDirtyDOM` + 选择器解析 + `getInnerHTML`）。`youdao/` 是更复杂的 HTML 抓取 + 多区块拼装参考。

## 执行流程（新增词典）

1. **新建 provider 目录** `src/dictionary/<id>/`：
   - `engine.ts`：负责网络请求和结果解析，导出 `search()`（以及 HTML 抓取需要的 `getSrcPage()`）。
   - `View.vue`：负责渲染结果、调用 `useLoading` 挂入面板。
2. **`src/dictionary/list.ts`** 的 `dicts` 注册：`{ nameKey, descriptionKey, Cp: View组件 }`，注册 key 即词典 id。
3. **`src/settings.ts`** 的 `DEFAULT_SETTINGS.dictionaries` 加 `"<id>": { enable: true, priority: N }`。
   原因：`normalizeSettings`（`settings.ts:296-315`）对 `dictionaries` 只做"默认值在前、用户已保存值在后"的浅合并，SearchPanel 以 `settings.dictionaries` 的 key 为渲染源头——**漏加这一项，已保存过设置的老用户完全看不到新词典**（新用户/重置设置才可见）。
4. **`src/lang/locale/en.ts`** 加 nameKey 和 descriptionKey 两条文案（缺失会在 `npx tsc` 编译期报错）；`zh.ts`、`zh-TW.ts` 建议同步翻译，缺省时回退英文显示。
5. （可选）**`src/stalin.css`** 加 `.dict-icon.<id>` base64 图标。class 名必须等于 dict id——`DictItem.vue:4` 渲染 `['dict-icon', props.id]`，名字对不上就没有图标（不报错）。

设置 UI **不要手写**：`settings.ts:1953-1956` 用 `Object.keys(dicts)` 自动遍历生成每个词典的开关 + 优先级（1-10）下拉，注册完就出现。

## loading 协议（View 与 SearchPanel 的契约）

View.vue 挂入方式（照抄现有 provider）：

```ts
const emits = defineEmits<{
    (event: "loading", status: { id: string, loading: boolean, result: boolean }): void
}>();

async function onSearch(): Promise<boolean> {
    const res = await search(props.word);
    result.value = res.result;
    return true;   // 有结果 true；无结果/网络错误让异常抛出去
}

useLoading(() => props.word, "<id>", onSearch, emits);
```

- `id` 字符串必须与 `list.ts` 注册 key **完全一致**。SearchPanel 用 `map[id]` 定位写入 `loadings`/`shows`（`SearchPanel.vue:92-95`）；不一致时 `map[id]` 为 undefined，loading 与显隐**静默失效，无任何报错**——排查"面板一直转圈/永远不显示"先核对这个 id。
- `onSearch` 返回 boolean；无结果、网络错误**不要自己 catch 吞掉**，让异常抛给 `useLoading` 的 catch，它会转成 `result=false`（`uses.ts:12-14`），面板随之隐藏。
- 发出的状态是 `{id, loading, result}`：loading=true 表示查询中，result=false 表示最终无结果要隐藏。

## 可复用 helper（`src/dictionary/helpers.ts`）

- `fetchDirtyDOM(url, config?)`（17-35 行）：Obsidian `request` + 伪装 UA 拿 HTML，**先 `replace` 删掉响应中全部 `<img>`**，再 `sanitizeHTMLToDom`。因此解析逻辑不要依赖 `<img>` 节点，选择器也不要指向图片。
- `handleNoResult()` / `handleNetWorkError()`（241-250 行）：以 `NO_RESULT` / `NETWORK_ERROR` rejected promise 传播，配合 `.catch(handleNetWorkError).then(...).catch(handleNoResult)` 链式使用（见 cambridge/youdao engine）。
- `getInnerHTML(host, parent, selectorOrConfig)`（215-226 行）：**HTML 输出必须经它**——host 参数把相对链接/src 补全为绝对地址，内部再 sanitize 一遍。直接 v-html 原始片段会有相对链接失效与 XSS 风险。
- `getText(parent, selector)`：取节点 textContent，找不到返回空串。
- `getFullLink` / `getStaticSpeaker` / `externalLink` / `removeChild` / `removeChildren`：链接补全、发音喇叭、外链、节点清理。
- `DictSearchResult<T>`：统一返回结构 `{ result, audio?, catalog? }`，`audio.uk/us` 会接到发音链路。
- JSON 类接口不走 helpers，直接用 obsidian 的 `requestUrl`（见 `google/engine.ts`）。

## 行为要点与高频坑

- `useLoading` 的 `watch` **无 immediate**（`uses.ts:6-16`）：组件挂载时不发请求；会话中途在设置里启用一个词典，要等下一次查询词变化才真正发起请求。验证"刚启用查不到"时先换个词再试。
- DictItem 的 `v-for` **无 `:key`**，且组件包在 `KeepAlive` + `v-show` 里（`SearchPanel.vue:22-30`）：优先级重排按数组索引复用组件实例，无结果的面板是隐藏而非销毁。调试时别假设组件随排序重建。
- 只有 `id === "ai"` 的组件收到 `sentenceText`/`origin` 上下文 props（`SearchPanel.vue:174-186` 的 `getComponentProps` 硬编码）；其他词典要上下文必须改这个函数。AI 的 watchee 是 `[word, sentenceText, origin]` 三元组（`ai/View.vue:101`），因为同一单词换例句也要重查。
- 渲染源是 `settings.dictionaries` 与 `dicts` 注册表的**交集**：settings 里有但 `dicts` 没注册的 key 只打 console.warn `Dictionary not found` 然后跳过（`SearchPanel.vue:62-65`）。
- 语言联动各不相同：cambridge 的目标语言跟插件 UI 语言（`window.localStorage.getItem("language")`，见 `cambridge/engine.ts:21-27`）；google 的目标语言用 `settings.native`（`google/engine.ts:14`）；youdao 不读任何语言设置。
- 启用开关/优先级变更通过翻转 `plugin.store.dictsChange` 触发 SearchPanel 重算列表（`settings.ts:1930,1947` 与 `SearchPanel.vue:58` 的 watch）。

## 常用命令

```bash
npx tsc -noEmit -skipLibCheck   # 类型检查；nameKey/descriptionKey 缺失在此报错
npm run build                   # tsc 检查 + 生产构建到 .build/plugin/
npm run dev                     # esbuild watch，实机联调时用
```

## 完成后的验证

1. `npx tsc -noEmit -skipLibCheck` 通过（文案 key、props 类型在此把关）。
2. `npm run build` 通过。
3. 在 Obsidian 中加载插件后划词/搜索验证：
   - 面板按 priority 顺序显示新词典；
   - 无结果时该面板隐藏（不是显示空白）；
   - 设置页 Dictionaries 分区出现新词典的开关与优先级下拉；
   - **用已有旧设置的用户 profile 验证一次**（确认 DEFAULT_SETTINGS 补齐生效）。
4. 抓取类词典（HTML 解析）至少测三种 case：常见词（主分支）、词组/短语（连字符或 idiom 分支）、拼写错误词（兜底/related 分支）。

## 禁止事项

- 不要为新词典手写设置 UI——注册完 `dicts` 会自动生成。
- 不要依赖响应里的 `<img>`（`fetchDirtyDOM` 已剥除），选择器不要指向图片节点。
- HTML 片段不要直接 v-html——必须经 `getInnerHTML`（host 补全 + sanitize）。
- 不要在 View 里 catch 掉查询异常——异常是 `useLoading` 转 `result=false` 的信号。
- 不要复用/拼错 loading id，也不要让两个词典共用同一个 id。
