# AI 设置使用指南

本文档说明 **Language Learner for Obsidian** 当前版本中 AI 设置系统的使用方式。

这份说明对应的是仓库里已经实现的 **AI settings v2**，不是早期扁平的 `settings.ai` 结构。

---

## 1. 总览

插件现在使用的是由四部分组成的 AI 配置结构：

- **Providers**
- **Models**
- **Routing**
- **Prompts**

在设置页中，你会看到这些区块：

- `Providers`
- `Models`
- `Routing`
- `Prompts`
- `Connection Test`

这套结构允许你：

- 同时保存多个 AI 接口配置
- 为每个 provider 绑定多个模型
- 设定一个全局默认模型
- 为不同使用场景单独覆盖模型
- 分场景配置 prompt

---

## 2. 核心概念

### 2.1 Provider

**Provider** 表示 API 接口与认证层。

每个 provider 包含这些字段：

- `preset`
- `label`
- `enabled`
- `baseUrl`
- `apiKey`
- `customHeaders`
- `capabilityMode`

可以这样理解：

- **preset**：这个 provider 属于哪个内置类型
- **label**：设置页里显示的名称
- **enabled**：这个 provider 是否可用
- **baseUrl**：聊天补全接口地址
- **apiKey**：认证密钥
- **customHeaders**：额外请求头
- **capabilityMode**：决定 reasoning / thinking 相关字段如何映射到请求体

### 2.2 Model

**Model** 必须挂在某一个 provider 下面。

每个 model 包含这些字段：

- `providerId`
- `model`
- `name`
- `enabled`
- `temperature`
- `topP`
- `maxOutputTokens`
- `reasoning`
- `thinking`
- `customParameters`

可以这样理解：

- **model**：真正发给 API 的原始模型名
- **name**：设置页里显示的友好名称
- **enabled**：这个模型是否可参与路由
- **temperature / topP / maxOutputTokens**：生成参数
- **reasoning**：推理开关和推理强度
- **thinking**：思考开关及预算相关字段
- **customParameters**：附加到请求体的额外字段

### 2.3 Routing

**Routing** 用来决定：某个 AI 功能最终到底用哪个模型。

插件当前支持的场景有：

- `search`
- `translate`
- `card`

在设置页里对应为：

- `Default Model`
- `Search Model`
- `Translate Model`
- `Card Model`

### 2.4 Prompts

Prompt 是按**场景**配置的，不是按 provider，也不是按 model 单独配置的。

当前有四个 prompt 槽位：

- `Search Prompt`
- `Context Search Prompt`
- `Translation Prompt`
- `Card Prompt`

---

## 3. 内置 Provider 类型

当前内置的 provider preset 有：

- `openai`
- `gemini`
- `deepseek`
- `siliconflow`

此外还有：

- `custom`

### 重要行为

- 内置 provider 会一直存在于设置中
- 内置 provider **可以编辑**
- 内置 provider **可以禁用**
- 内置 provider **不能删除**
- custom provider **可以新增、编辑、禁用、删除**

---

## 4. 推荐配置顺序

最实用的配置顺序是：

1. 先配置一个 provider
2. 再为这个 provider 加一个可用 model
3. 把这个 model 设为 `Default Model`
4. 先做一次连接测试
5. 确认可用后，再根据需要配置场景覆盖模型

对于大多数用户来说：

- 一个 provider
- 一个 model
- 默认 routing

就已经足够使用。

---

## 5. Providers 区块

### 要配置什么

每个 provider 主要配置这些内容：

- **Label**
- **Enabled**
- **Base URL**
- **API Key**
- **Capability Mode**
- **Custom Headers**（如果需要）

### Base URL

这里应该填写一个合法的 `http://` 或 `https://` 聊天补全接口地址。

例如：

- OpenAI：
  - `https://api.openai.com/v1/chat/completions`
- Gemini OpenAI-compatible endpoint：
  - `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
- DeepSeek：
  - `https://api.deepseek.com/chat/completions`
- SiliconFlow：
  - `https://api.siliconflow.cn/v1/chat/completions`

### API Key

插件会把 API Key 作为如下请求头发送：

- `Authorization: Bearer <apiKey>`

设置页会对空值给出提示。  
即使空 key 在某些情况下不一定阻止保存，它仍然会影响：

- 连接测试
- 实际 AI 请求

### Custom Headers

只有在你的 provider 确实需要额外请求头时才需要填写。

格式如下：

```text
Header-Name: value
Another-Header: value
```

如果格式不合法，设置页会直接提示错误。

---

## 6. Models 区块

每个 model 都必须绑定到某个 provider。

### 主要字段

- **Provider**
- **Recommended model**
- **Model Name**
- **Display Name**
- **Enabled**
- **Temperature**
- **Top P**
- **Max Output Tokens**
- **Reasoning**
- **Thinking**
- **Custom Parameters**

### Recommended model 和 Model Name 的区别

- **Recommended model** 只是一个快捷选择器，用来快速填充值
- **Model Name** 才是真正发给 API 的模型名

如果你的 provider 支持的模型不在推荐列表里，直接在 `Model Name` 里手填即可。

### Enabled

只有同时满足以下条件的 model 才会参与路由：

- model 自己是启用状态
- 它所属的 provider 也是启用状态

### 内部模型 ID

插件不会直接拿原始模型名作为稳定主键。

内部会生成类似这样的 ID：

```text
providerId::slug(model-name)
```

如果发生冲突，会自动追加 `-2`、`-3` 之类的后缀。

这主要影响：

- 迁移稳定性
- routing 的稳定引用

---

## 7. Routing 区块

Routing 用来决定每个功能场景最终使用哪个模型。

### 支持的路由项

- **Default Model**
- **Search Model**
- **Translate Model**
- **Card Model**

### 实际解析顺序

对于任意一个场景，模型解析顺序是：

1. 先尝试场景 override model
2. 否则使用全局 default model
3. 否则使用第一个可用启用模型
4. 如果都没有，则报错

这里的“可用”指的是：

- model 是 enabled
- provider 也是 enabled

### 实际含义

- `Search Model` 为空时，查词使用 `Default Model`
- `Translate Model` 为空时，翻译使用 `Default Model`
- `Card Model` 为空时，卡片自动填充使用 `Default Model`

如果某个 override 模型后来不可用了，插件会自动回退。

---

## 8. 哪些功能对应哪些 Route

### Search route

用于：

- AI 词典查词
- 带句子上下文的 AI 语境解释

### Translate route

用于：

- LearnPanel 中的 AI 句子翻译

### Card route

用于：

- AI 卡片自动填充
- expression autofill

---

## 9. Prompts 区块

Prompt 是按场景全局配置的。

### Search Prompt

用于没有句子上下文时的普通 AI 查词。

### Context Search Prompt

用于带句子上下文的 AI 查词。

这也是 AI 语境解释能力的核心 prompt。

### Translation Prompt

用于句子翻译。

请保留这个占位符：

```text
{sentence}
```

插件会在发送请求前自动替换它。

### Card Prompt

用于 AI 卡片自动填充。

这个 prompt 应该能够输出插件可解析的 JSON 结果。

---

## 10. Capability Mode

Capability Mode 用来决定 reasoning / thinking 相关设置如何转换成 API 请求字段。

当前支持的模式有：

- `openai-reasoning`
- `thinking-config`
- `siliconflow-thinking`

### 10.1 openai-reasoning

用于 OpenAI-compatible 的 reasoning 风格映射。

可能会发送这些字段：

- `reasoning`
- `reasoning_effort`
- 与 reasoning 预算相关的字段

### 10.2 thinking-config

用于要求如下结构的 provider：

- `thinking_config`

当前 Gemini preset 默认走的是这个方向。

### 10.3 siliconflow-thinking

用于 SiliconFlow 风格的 thinking 字段映射。

可能会发送这些字段：

- `enable_thinking`
- `thinking_budget`

### 经验建议

- 如果你使用的是内置 preset，默认 capability mode 通常就是正确的
- 如果你使用的是 custom provider，就需要根据目标接口要求手动选择匹配的 capability mode

---

## 11. Reasoning 和 Thinking

它们都是 **model 级别** 的配置。

### Reasoning

Reasoning 包含：

- `enabled`
- `reasoningEffort`

支持的强度有：

- `low`
- `medium`
- `high`

### Thinking

Thinking 包含：

- `enabled`
- `budgetTokens`（可选）
- `thinkingBudget`（可选）

这些字段最终是否发送、以及用什么字段名发送，取决于 provider 的 capability mode。

---

## 12. Custom Parameters

Custom Parameters 用来在标准请求字段之后，继续向请求体追加额外字段。

支持的类型有：

- `text`
- `number`
- `boolean`
- `json`

### 结构化编辑器

设置页现在提供的是结构化编辑方式：

- 一次新增一条参数
- 设置 `Key`
- 选择 `Type`
- 填写 `Value`

你不需要再手写完整 JSON 数组。

### JSON 类型

如果你选择的是 `json`：

- 值必须是合法 JSON
- 非法 JSON 会立刻高亮提示
- 保存前会阻止错误配置

### 保留字段

Custom Parameters 会在标准字段应用之后再合并进请求体，但**不能覆盖保留字段**，例如：

- `model`
- `messages`
- `temperature`
- `top_p`
- `max_tokens`
- `stream`
- `reasoning*`
- `thinking*`

因此，custom parameters 的用途是：

- 增加额外字段

而不是：

- 覆盖核心请求字段

---

## 13. 连接测试

连接测试是在 **Model 编辑框内部** 进行的，不是一个全局统一按钮。

这样设计的原因是：

- 测试时会直接以当前 **provider + model** 组合作为目标

### 测试做了什么

测试会发送一个最小请求，使用：

- 当前选中的 provider
- 当前选中的 model
- 很小的请求体

### 什么时候适合测试

建议在这些场景后测试一次：

- 修改 Base URL
- 修改 API Key
- 修改 Capability Mode
- 新增 model

### 测试失败时怎么排查

建议按这个顺序检查：

1. Base URL
2. API Key
3. model name
4. provider 是否启用
5. model 是否启用
6. capability mode 是否正确
7. custom headers 是否正确

---

## 14. 从旧版设置迁移

旧版插件使用的是扁平的 `settings.ai` 结构，字段可能包括：

- `provider`
- `api_key`
- `api_url`
- `model`
- `prompt`
- `context_prompt`
- `trans_prompt`
- `card_prompt`

现在插件会自动迁移这些旧字段。

### 迁移行为

迁移时会：

- 先创建内置 provider 列表
- 把旧的 provider / key / URL 合并进对应的内置 provider
- 如果旧 provider 不是内置值，就落到一个 `custom` provider
- 把旧 model 迁移成一个真正的 model 记录
- 把旧 prompt 迁移到 `prompts`
- 把 `routing.defaultModelId` 指向迁移后的 model

迁移完成后，运行时只认新的 v2 结构。

---

## 15. 全新安装时的默认行为

当前默认 AI 配置是：

- 自动创建内置 provider：
  - OpenAI
  - Gemini
  - DeepSeek
  - SiliconFlow
- 默认只启用 OpenAI provider
- 自动创建一个默认 model：
  - `gpt-4o-mini`
- `Default Model` 指向这个 model
- 各场景 override 默认是空

所以一个全新配置的初始表现是：

- 所有 AI 场景默认都走同一个默认模型

---

## 16. 示例配置

### 16.1 最简单配置：一个 provider 负责所有场景

如果你想最快搭起来，可以这样配：

- 启用一个 provider，比如 OpenAI
- 填 Base URL 和 API Key
- 新增一个 model，比如 `gpt-4o-mini`
- 把它设为 `Default Model`
- 保持：
  - `Search Model`
  - `Translate Model`
  - `Card Model`
 为空

效果：

- 查词、翻译、卡片自动填充全都使用同一个默认模型

### 16.2 给翻译单独用便宜模型

如果你想控制成本，可以这样配：

- 保留一个相对更强的默认模型，负责 search 和 card
- 再加一个更快 / 更便宜的模型
- 把这个模型设到 `Translate Model`

效果：

- 查词和卡片继续走默认模型
- 句子翻译走单独的便宜模型

### 16.3 使用自定义兼容端点

- 新增 `Custom Provider`
- 填：
  - Label
  - Base URL
  - API Key
  - Capability Mode
- 再新增一个绑定到这个 provider 的 model
- 最后把一个或多个 route 指向它

---

## 17. 常见问题排查

### 问题：model 明明存在，但始终没被使用

请检查：

- model 是否 enabled
- 它所属的 provider 是否 enabled
- routing 是否指向它
- 如果它只是 override model，对应场景是否真的在使用这个 route

### 问题：查词始终没有用到我选的模型

请检查：

- `Search Model`
- 如果它为空，则看 `Default Model`
- 被选中的 model / provider 是否都已启用

### 问题：翻译意外回退到默认模型

通常是下面两种原因之一：

- `Translate Model` 本身就是空的
- 指定的 translate model 当前不可用，于是自动回退到 default

### 问题：卡片自动填充失败

请检查：

- `Card Model`
- `Card Prompt`
- model / provider 是否启用
- custom parameters 是否有效

### 问题：JSON 类型 custom parameter 无法保存

请检查：

- JSON 是否完整
- 花括号、逗号是否正确
- 是否能被正常 `JSON.parse(...)`

---

## 18. 给维护者的提示

如果未来又调整了 AI 设置实现，请记得同步检查这份文档是否仍然准确。

主要对照这些文件：

- `src/ai/config.ts`
- `src/settings.ts`
- `src/dictionary/ai/engine.ts`

尤其要重点复查这些点：

- provider preset
- routing fallback 顺序
- capability mode 的映射规则
- custom parameter 的保留字段限制
- connection test 的行为

