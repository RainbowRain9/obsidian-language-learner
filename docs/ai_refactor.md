# AI 配置服务重构计划（参考 obsidian-yolo，保留当前 provider 范围）

## Summary

- 把当前扁平的 settings.ai 重构为“provider 注册 + model 注册 + 路由选择 +
    prompt 配置”的完整 AI 配置服务。
- provider 范围只保留并增强现有体系：openai / gemini / deepseek /
    siliconflow / custom，不在这次重构里扩展到 Anthropic/OpenRouter/Ollama。
- 模型路由采用“全局默认 + 场景覆盖”：查词、翻译、卡片自动填充都可单独指定模
    型，不指定时回退到全局默认模型。
- 继续沿用现有基于 requestUrl 的 OpenAI-compatible Chat Completions 请求路径，  
    不引入多 SDK provider 分叉；YOLO 的能力映射只借鉴到“配置建模、能力开关、请求  
    体适配”这一层。

## Key Changes

- 设置结构
  - 把 ai 改为 version: 2 的新结构：
    - providers: AIProviderConfig[]
    - models: AIModelConfig[]
    - routing: { defaultModelId, searchModelId, translateModelId,
            cardModelId }
    - prompts: { search, contextSearch, translate, card }
  - AIProviderConfig 固定字段：id、preset、label、enabled、baseUrl、apiKey、  
        customHeaders、capabilityMode
  - AIModelConfig 固定字段：id、providerId、model、name、enabled、
        temperature、topP、maxOutputTokens、reasoning、thinking、
        customParameters
  - reasoning 采用 enabled + reasoningEffort；thinking 采用 enabled +
        budgetTokens/thinkingBudget，与 YOLO 的能力建模保持同方向
  - customParameters 采用强类型条目：text | number | boolean | json
- Provider / Model 设计
  - 内置 provider 记录按 preset 预置生成并长期存在；内置 provider 可编辑、可  
        禁用，但不可删除
  - custom provider 可新增、编辑、删除；其 capabilityMode 明确可选，避免无法  
        判断“思考/推理”参数应该映射成哪种请求字段
  - provider 的“推荐模型列表”只保存在 preset 元数据里，不直接写入用户设置；
        用户模型列表采用“预置候选 + 手动 CRUD”
  - model 使用稳定内部 ID，不直接拿原始模型名当主键；格式固定为
        providerId::slug(model)，冲突时追加 -2、-3
  - 因为现有模型名可能带 /，内部 ID 不复用 provider/model 这种不稳定格式
- 请求解析与能力适配
  - 新增统一的 AI 配置解析服务，负责把“场景 -> 路由 -> provider/model -> 请
        求参数 -> prompt”解析成最终请求配置
  - 三条现有 AI 调用链全部改走这个统一解析层：
    - AI 查词
    - LearnPanel 的 AI 句子翻译
    - 卡片自动填充
  - 场景模型解析顺序固定为：
    - 场景 override 且模型启用、provider 启用
    - 否则全局默认模型
    - 否则首个可用启用模型
    - 否则抛出明确配置错误
  - 请求体能力适配按 provider/baseUrl 规则统一处理：
    - OpenAI-compatible 默认模式：支持 reasoning_effort / reasoning
    - 兼容模式支持 thinking_config
    - siliconflow 显式映射 enable_thinking
    - custom provider 使用用户选择的 capabilityMode
  - customParameters 在标准字段应用之后合并进请求体，但禁止覆盖保留字段：
        model、messages、temperature、top_p、max_tokens、reasoning*、thinking*、  
        stream
  - 缓存 key 改为包含：场景、resolved provider/model、prompt、采样参数、
        thinking/reasoning 开关、自定义参数，避免旧缓存串用
- 迁移与加载
  - 不能再依赖当前对 ai 的浅合并；需要在设置加载阶段加一个显式的 normalize/
        migrate 过程
  - 旧版扁平 ai 字段迁移规则固定为：
    - 先生成 v2 默认结构和内置 provider 列表
    - 把旧的 provider/api_key/api_url 合并进匹配的内置 provider；若是非内
            置值，则落到一个 custom provider 记录
    - 把旧的 model 迁移成一个实际 model 记录
    - 把旧的 prompt/context_prompt/trans_prompt/card_prompt 迁移到 prompts  
    - routing.defaultModelId 指向迁移生成的那个模型
  - 迁移后不保留“旧字段继续写回”的双写逻辑；运行时只认 v2 结构
- 设置 UI
  - AI 设置页拆成 5 个区块：Providers、Models、Routing、Prompts、Connection
        Test
  - 继续使用仓库现有的 Obsidian Setting + 简单 Modal 风格，不引入 React/Vue
        设置页重写
  - Provider Modal 负责：基础信息、启用状态、Base URL、API Key、自定义
        Header、Capability Mode
  - Model Modal 负责：provider 绑定、模型名、显示名、启用状态、采样参数、
        thinking/reasoning、自定义参数
  - Routing 区块提供 4 个选择器：
    - 全局默认模型
    - 查词模型（可选“Follow default”）
    - 翻译模型（可选“Follow default”）
    - 卡片模型（可选“Follow default”）
  - Prompt 区块保留现有 4 份 prompt 语义，不改成 per-model prompt
  - 连接测试放在 Model Modal 内，测试“当前模型 + 当前 provider”的最小请求，
        不做全局单一测试按钮

## Test Plan

- npm run build 通过
- 旧用户配置首次加载时自动迁移，无需手动重填，并且原本可用的默认 AI 调用仍能工  
    作
- AI 查词在设置了 searchModelId 时使用覆盖模型；清空后回退到全局默认模型
- LearnPanel 的 AI 翻译在设置了 translateModelId 时使用覆盖模型；当该模型或
    provider 被禁用后，正确回退
- 卡片自动填充在设置了 cardModelId 时使用覆盖模型，且仍保持当前 JSON 输出契约
- 打开/关闭 thinking、reasoning、customParameters 后，设置持久化正确，请求体字  
    段映射符合 provider 能力模式
- siliconflow 的 thinking 开关发送 enable_thinking；其它 OpenAI-compatible
    provider 发送兼容字段
- provider/model 的新增、编辑、禁用、删除（仅 custom provider）在设置页表现正
    确，路由下拉只显示当前可用模型
- 连接测试对缺少 API Key、非法 Base URL、不可用模型返回明确错误提示

## Assumptions

- 这次只重构 AI 配置服务与相关调用链，不扩展新的 AI 产品能力
- provider 范围保持现有增强，不做 YOLO 全量 provider 生态搬运
- 模型列表采用“预置候选 + 手动维护”，不实现从远端 /models 自动拉取
- prompt 仍然是“按场景全局配置”，不是“按 provider/model 单独配置”
- 仓库没有现成测试框架，这次不新增测试基础设施；回归验证以构建检查和 Obsidian
    手动验证为准
