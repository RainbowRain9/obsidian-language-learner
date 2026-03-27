export type AIProviderPreset = "openai" | "gemini" | "deepseek" | "siliconflow" | "custom";

export type AICapabilityMode =
    | "openai-reasoning"
    | "thinking-config"
    | "siliconflow-thinking"
    | "zhipu-thinking";

export type AIReasoningEffort = "low" | "medium" | "high";

export type AICustomParameterType = "text" | "number" | "boolean" | "json";

export type AIScenario = "search" | "translate" | "card";

export interface AIProviderHeader {
    key: string;
    value: string;
}

export interface AIReasoningConfig {
    enabled: boolean;
    reasoningEffort: AIReasoningEffort;
}

export interface AIThinkingConfig {
    enabled: boolean;
    budgetTokens?: number;
    thinkingBudget?: number;
}

export interface AICustomParameter {
    key: string;
    type: AICustomParameterType;
    value: string | number | boolean;
}

export interface AIProviderConfig {
    id: string;
    preset: AIProviderPreset;
    label: string;
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    customHeaders: AIProviderHeader[];
    capabilityMode: AICapabilityMode;
}

export interface AIModelConfig {
    id: string;
    providerId: string;
    model: string;
    name: string;
    enabled: boolean;
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    reasoning: AIReasoningConfig;
    thinking: AIThinkingConfig;
    customParameters: AICustomParameter[];
}

export interface AIRoutingConfig {
    defaultModelId: string;
    searchModelId: string;
    translateModelId: string;
    cardModelId: string;
}

export interface AIPromptConfig {
    search: string;
    contextSearch: string;
    translate: string;
    card: string;
}

export interface AISettingsV2 {
    version: 2;
    providers: AIProviderConfig[];
    models: AIModelConfig[];
    routing: AIRoutingConfig;
    prompts: AIPromptConfig;
}

type LegacyAISettings = {
    provider?: string;
    api_key?: string;
    api_url?: string;
    model?: string;
    prompt?: string;
    context_prompt?: string;
    trans_prompt?: string;
    card_prompt?: string;
};

type ProviderPresetMeta = {
    preset: Exclude<AIProviderPreset, "custom">;
    label: string;
    baseUrl: string;
    recommendedModels: string[];
    capabilityMode: AICapabilityMode;
};

export const AI_PROVIDER_PRESET_META: Record<Exclude<AIProviderPreset, "custom">, ProviderPresetMeta> = {
    openai: {
        preset: "openai",
        label: "OpenAI",
        baseUrl: "https://api.openai.com/v1/chat/completions",
        recommendedModels: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
        capabilityMode: "openai-reasoning",
    },
    gemini: {
        preset: "gemini",
        label: "Gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        recommendedModels: ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro"],
        capabilityMode: "thinking-config",
    },
    deepseek: {
        preset: "deepseek",
        label: "DeepSeek",
        baseUrl: "https://api.deepseek.com/chat/completions",
        recommendedModels: ["deepseek-chat", "deepseek-reasoner"],
        capabilityMode: "openai-reasoning",
    },
    siliconflow: {
        preset: "siliconflow",
        label: "SiliconFlow",
        baseUrl: "https://api.siliconflow.cn/v1/chat/completions",
        recommendedModels: [
            "Qwen/Qwen2.5-7B-Instruct",
            "deepseek-ai/DeepSeek-V3.1-Terminus",
            "deepseek-ai/DeepSeek-R1",
            "zai-org/GLM-4.6",
        ],
        capabilityMode: "siliconflow-thinking",
    },
};

const DEFAULT_AI_PROMPTS: AIPromptConfig = {
    search: "You are a helpful English learning assistant. Explain the meaning of words clearly and provide examples.",
    contextSearch: "You are a helpful English learning assistant. Explain the selected word or phrase in the given sentence. Focus on its meaning in this exact context, then give a concise general meaning and one short usage note. Use markdown.",
    translate: "Translate the following sentence into Chinese accurately and naturally: {sentence}",
    card: "You are a helpful English learning assistant. Fill a learner's vocabulary card from the selected expression and optional context. Return only valid JSON with the shape {\"meaning\":\"string\",\"aliases\":[\"string\"],\"tags\":[\"string\"],\"notes\":[\"string\"]}. Keep the meaning concise, aliases practical, tags short, and notes useful for study.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNonEmptyString(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value.trim() || fallback : fallback;
}

function toOptionalNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function toBoolean(value: unknown, fallback = false): boolean {
    return typeof value === "boolean" ? value : fallback;
}

function sanitizeHeaderList(value: unknown): AIProviderHeader[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((item) => {
            if (!isRecord(item)) {
                return null;
            }
            const key = toNonEmptyString(item.key);
            if (!key) {
                return null;
            }
            return {
                key,
                value: typeof item.value === "string" ? item.value : "",
            } satisfies AIProviderHeader;
        })
        .filter((item): item is AIProviderHeader => Boolean(item));
}

function sanitizeCustomParameters(value: unknown): AICustomParameter[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((item) => {
            if (!isRecord(item)) {
                return null;
            }

            const key = toNonEmptyString(item.key);
            const type = item.type;
            if (!key || !isCustomParameterType(type)) {
                return null;
            }

            let normalizedValue: string | number | boolean = "";
            switch (type) {
                case "number": {
                    const parsed = toOptionalNumber(item.value);
                    normalizedValue = parsed ?? 0;
                    break;
                }
                case "boolean":
                    normalizedValue = toBoolean(item.value);
                    break;
                case "json":
                    normalizedValue = typeof item.value === "string"
                        ? item.value
                        : JSON.stringify(item.value ?? {});
                    break;
                case "text":
                default:
                    normalizedValue = typeof item.value === "string" ? item.value : String(item.value ?? "");
                    break;
            }

            return {
                key,
                type,
                value: normalizedValue,
            } satisfies AICustomParameter;
        })
        .filter((item): item is AICustomParameter => Boolean(item));
}

export function isCustomParameterType(value: unknown): value is AICustomParameterType {
    return value === "text" || value === "number" || value === "boolean" || value === "json";
}

export function isBuiltinProviderPreset(value: unknown): value is Exclude<AIProviderPreset, "custom"> {
    return value === "openai" || value === "gemini" || value === "deepseek" || value === "siliconflow";
}

export function isProviderPreset(value: unknown): value is AIProviderPreset {
    return isBuiltinProviderPreset(value) || value === "custom";
}

export function isCapabilityMode(value: unknown): value is AICapabilityMode {
    return value === "openai-reasoning"
        || value === "thinking-config"
        || value === "siliconflow-thinking"
        || value === "zhipu-thinking";
}

function normalizeReasoningConfig(value: unknown): AIReasoningConfig {
    const source = isRecord(value) ? value : {};
    const effort = source.reasoningEffort;
    return {
        enabled: toBoolean(source.enabled),
        reasoningEffort: effort === "low" || effort === "high" ? effort : "medium",
    };
}

function normalizeThinkingConfig(value: unknown): AIThinkingConfig {
    const source = isRecord(value) ? value : {};
    return {
        enabled: toBoolean(source.enabled),
        budgetTokens: toOptionalNumber(source.budgetTokens),
        thinkingBudget: toOptionalNumber(source.thinkingBudget),
    };
}

export function slugifyModelName(model: string): string {
    const slug = model
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    return slug || "model";
}

export function createModelId(providerId: string, model: string, existingIds: Iterable<string> = []): string {
    const base = `${providerId}::${slugifyModelName(model)}`;
    const existing = new Set(existingIds);
    if (!existing.has(base)) {
        return base;
    }

    let suffix = 2;
    let candidate = `${base}-${suffix}`;
    while (existing.has(candidate)) {
        suffix += 1;
        candidate = `${base}-${suffix}`;
    }
    return candidate;
}

export function getProviderPresetMeta(preset: AIProviderPreset): ProviderPresetMeta | null {
    return isBuiltinProviderPreset(preset) ? AI_PROVIDER_PRESET_META[preset] : null;
}

export function createBuiltinProviderConfig(preset: Exclude<AIProviderPreset, "custom">): AIProviderConfig {
    const meta = AI_PROVIDER_PRESET_META[preset];
    return {
        id: preset,
        preset,
        label: meta.label,
        enabled: preset === "openai",
        baseUrl: meta.baseUrl,
        apiKey: "",
        customHeaders: [],
        capabilityMode: meta.capabilityMode,
    };
}

export function createModelConfig(
    providerId: string,
    model: string,
    partial: Partial<AIModelConfig> = {},
    existingIds: Iterable<string> = []
): AIModelConfig {
    return {
        id: partial.id?.trim() || createModelId(providerId, model, existingIds),
        providerId,
        model: model.trim(),
        name: partial.name?.trim() || model.trim(),
        enabled: partial.enabled ?? true,
        temperature: partial.temperature,
        topP: partial.topP,
        maxOutputTokens: partial.maxOutputTokens,
        reasoning: partial.reasoning ?? { enabled: false, reasoningEffort: "medium" },
        thinking: partial.thinking ?? { enabled: false },
        customParameters: partial.customParameters ?? [],
    };
}

export function createDefaultAISettings(): AISettingsV2 {
    const providers = [
        createBuiltinProviderConfig("openai"),
        createBuiltinProviderConfig("gemini"),
        createBuiltinProviderConfig("deepseek"),
        createBuiltinProviderConfig("siliconflow"),
    ];
    const defaultModel = createModelConfig("openai", "gpt-4o-mini");

    return {
        version: 2,
        providers,
        models: [defaultModel],
        routing: {
            defaultModelId: defaultModel.id,
            searchModelId: "",
            translateModelId: "",
            cardModelId: "",
        },
        prompts: { ...DEFAULT_AI_PROMPTS },
    };
}

function normalizeProviderConfig(value: unknown, fallback?: AIProviderConfig): AIProviderConfig | null {
    if (!isRecord(value)) {
        return fallback ?? null;
    }

    const preset = isProviderPreset(value.preset) ? value.preset : fallback?.preset ?? "custom";
    const meta = getProviderPresetMeta(preset);
    const id = toNonEmptyString(value.id, fallback?.id || (preset === "custom" ? "custom-1" : preset));

    return {
        id,
        preset,
        label: toNonEmptyString(value.label, fallback?.label || meta?.label || "Custom"),
        enabled: typeof value.enabled === "boolean" ? value.enabled : fallback?.enabled ?? preset === "openai",
        baseUrl: toNonEmptyString(value.baseUrl, fallback?.baseUrl || meta?.baseUrl || ""),
        apiKey: typeof value.apiKey === "string" ? value.apiKey : fallback?.apiKey || "",
        customHeaders: sanitizeHeaderList(value.customHeaders ?? fallback?.customHeaders ?? []),
        capabilityMode: isCapabilityMode(value.capabilityMode)
            ? value.capabilityMode
            : fallback?.capabilityMode || meta?.capabilityMode || "openai-reasoning",
    };
}

function normalizeModelConfig(value: unknown, existingIds: Set<string>): AIModelConfig | null {
    if (!isRecord(value)) {
        return null;
    }

    const providerId = toNonEmptyString(value.providerId);
    const modelName = toNonEmptyString(value.model);
    if (!providerId || !modelName) {
        return null;
    }

    const requestedId = toNonEmptyString(value.id);
    const id = requestedId && !existingIds.has(requestedId)
        ? requestedId
        : createModelId(providerId, modelName, existingIds);
    existingIds.add(id);

    return {
        id,
        providerId,
        model: modelName,
        name: toNonEmptyString(value.name, modelName),
        enabled: typeof value.enabled === "boolean" ? value.enabled : true,
        temperature: toOptionalNumber(value.temperature),
        topP: toOptionalNumber(value.topP),
        maxOutputTokens: toOptionalNumber(value.maxOutputTokens),
        reasoning: normalizeReasoningConfig(value.reasoning),
        thinking: normalizeThinkingConfig(value.thinking),
        customParameters: sanitizeCustomParameters(value.customParameters),
    };
}

function buildLegacyModel(providerId: string, model: string): AIModelConfig {
    return createModelConfig(providerId, model, {
        temperature: 0.3,
    });
}

function migrateLegacyAISettings(value: unknown): AISettingsV2 {
    const defaults = createDefaultAISettings();
    const legacy = isRecord(value) ? value as LegacyAISettings : {};

    const providerValue = toNonEmptyString(legacy.provider, "openai");
    const providerPreset = isBuiltinProviderPreset(providerValue) ? providerValue : "custom";

    let providerId = providerPreset === "custom" ? "custom-1" : providerPreset;
    const providers = defaults.providers.map((provider) => ({ ...provider }));

    if (providerPreset === "custom") {
        providers.push({
            id: providerId,
            preset: "custom",
            label: "Custom",
            enabled: true,
            baseUrl: toNonEmptyString(legacy.api_url),
            apiKey: toNonEmptyString(legacy.api_key),
            customHeaders: [],
            capabilityMode: "openai-reasoning",
        });
    } else {
        const target = providers.find((provider) => provider.id === providerPreset);
        if (target) {
            target.enabled = true;
            if (typeof legacy.api_key === "string") {
                target.apiKey = legacy.api_key;
            }
            if (typeof legacy.api_url === "string" && legacy.api_url.trim()) {
                target.baseUrl = legacy.api_url.trim();
            }
            providerId = target.id;
        }
    }

    const migratedModelName = toNonEmptyString(legacy.model, defaults.models[0].model);
    const migratedModel = buildLegacyModel(providerId, migratedModelName);

    return {
        version: 2,
        providers,
        models: [migratedModel],
        routing: {
            defaultModelId: migratedModel.id,
            searchModelId: "",
            translateModelId: "",
            cardModelId: "",
        },
        prompts: {
            search: toNonEmptyString(legacy.prompt, defaults.prompts.search),
            contextSearch: toNonEmptyString(legacy.context_prompt, defaults.prompts.contextSearch),
            translate: toNonEmptyString(legacy.trans_prompt, defaults.prompts.translate),
            card: toNonEmptyString(legacy.card_prompt, defaults.prompts.card),
        },
    };
}

export function normalizeAISettings(value: unknown): AISettingsV2 {
    if (!isRecord(value) || value.version !== 2) {
        return migrateLegacyAISettings(value);
    }

    const defaults = createDefaultAISettings();
    const providersById = new Map<string, AIProviderConfig>();

    defaults.providers.forEach((provider) => {
        providersById.set(provider.id, provider);
    });

    if (Array.isArray(value.providers)) {
        value.providers.forEach((entry) => {
            if (!isRecord(entry)) {
                return;
            }

            const requestedPreset = isProviderPreset(entry.preset) ? entry.preset : "custom";
            const fallback = requestedPreset !== "custom"
                ? providersById.get(requestedPreset)
                : undefined;
            const normalized = normalizeProviderConfig(entry, fallback);
            if (normalized) {
                providersById.set(normalized.id, normalized);
            }
        });
    }

    const providers = [
        ...Object.keys(AI_PROVIDER_PRESET_META)
            .map((preset) => providersById.get(preset))
            .filter((provider): provider is AIProviderConfig => Boolean(provider)),
        ...[...providersById.values()].filter((provider) => provider.preset === "custom"),
    ];

    const existingIds = new Set<string>();
    const providerIds = new Set(providers.map((provider) => provider.id));
    const models = Array.isArray(value.models)
        ? value.models
            .map((model) => normalizeModelConfig(model, existingIds))
            .filter((model): model is AIModelConfig => Boolean(model))
            .filter((model) => providerIds.has(model.providerId))
        : [];

    if (models.length === 0) {
        const fallbackModel = createModelConfig("openai", "gpt-4o-mini");
        models.push(fallbackModel);
    }

    const enabledModels = getAvailableAIModels({ ...defaults, providers, models });
    const defaultFallbackId = enabledModels[0]?.id || models[0].id;
    const routingSource = isRecord(value.routing) ? value.routing : {};

    const promptsSource = isRecord(value.prompts) ? value.prompts : {};

    return {
        version: 2,
        providers,
        models,
        routing: {
            defaultModelId: selectExistingModelId(routingSource.defaultModelId, models, defaultFallbackId),
            searchModelId: selectExistingModelId(routingSource.searchModelId, models, ""),
            translateModelId: selectExistingModelId(routingSource.translateModelId, models, ""),
            cardModelId: selectExistingModelId(routingSource.cardModelId, models, ""),
        },
        prompts: {
            search: toNonEmptyString(promptsSource.search, defaults.prompts.search),
            contextSearch: toNonEmptyString(promptsSource.contextSearch, defaults.prompts.contextSearch),
            translate: toNonEmptyString(promptsSource.translate, defaults.prompts.translate),
            card: toNonEmptyString(promptsSource.card, defaults.prompts.card),
        },
    };
}

function selectExistingModelId(value: unknown, models: AIModelConfig[], fallback: string): string {
    const id = toNonEmptyString(value);
    return id && models.some((model) => model.id === id) ? id : fallback;
}

export function normalizeAIProviderConfig(value: Partial<AIProviderConfig>): AIProviderConfig {
    const preset = isProviderPreset(value.preset) ? value.preset : "custom";
    const fallback = preset !== "custom" ? createBuiltinProviderConfig(preset) : undefined;
    return normalizeProviderConfig(value, fallback) || {
        id: "custom-1",
        preset: "custom",
        label: "Custom",
        enabled: true,
        baseUrl: "",
        apiKey: "",
        customHeaders: [],
        capabilityMode: "openai-reasoning",
    };
}

export function normalizeAIModelConfig(value: Partial<AIModelConfig>, existingIds: Iterable<string> = []): AIModelConfig {
    const ids = new Set(existingIds);
    return normalizeModelConfig(value, ids) || createModelConfig(
        toNonEmptyString(value.providerId, "openai"),
        toNonEmptyString(value.model, "gpt-4o-mini"),
        {
            name: typeof value.name === "string" ? value.name : undefined,
            enabled: value.enabled,
            temperature: value.temperature,
            topP: value.topP,
            maxOutputTokens: value.maxOutputTokens,
            reasoning: value.reasoning,
            thinking: value.thinking,
            customParameters: value.customParameters,
        },
        ids
    );
}

export function isBuiltinProvider(provider: AIProviderConfig): boolean {
    return provider.preset !== "custom" && provider.id === provider.preset;
}

export function getAvailableAIModels(ai: AISettingsV2): AIModelConfig[] {
    const enabledProviderIds = new Set(
        ai.providers.filter((provider) => provider.enabled).map((provider) => provider.id)
    );
    return ai.models.filter((model) => model.enabled && enabledProviderIds.has(model.providerId));
}

export function findAIProvider(ai: AISettingsV2, providerId: string): AIProviderConfig | undefined {
    return ai.providers.find((provider) => provider.id === providerId);
}

export function findAIModel(ai: AISettingsV2, modelId: string): AIModelConfig | undefined {
    return ai.models.find((model) => model.id === modelId);
}

export function getRoutingOverrideId(ai: AISettingsV2, scenario: AIScenario): string {
    switch (scenario) {
        case "search":
            return ai.routing.searchModelId;
        case "translate":
            return ai.routing.translateModelId;
        case "card":
            return ai.routing.cardModelId;
        default:
            return "";
    }
}

export function getPromptForScenario(ai: AISettingsV2, scenario: AIScenario, hasContext = false): string {
    switch (scenario) {
        case "search":
            return hasContext ? ai.prompts.contextSearch : ai.prompts.search;
        case "translate":
            return ai.prompts.translate;
        case "card":
            return ai.prompts.card;
        default:
            return ai.prompts.search;
    }
}

export function resolveAIModelForScenario(
    ai: AISettingsV2,
    scenario: AIScenario,
    options: { modelIdOverride?: string; hasContext?: boolean } = {}
): { provider: AIProviderConfig; model: AIModelConfig; prompt: string } {
    const available = getAvailableAIModels(ai);
    const availableIds = new Set(available.map((model) => model.id));
    const candidates = [
        toNonEmptyString(options.modelIdOverride),
        getRoutingOverrideId(ai, scenario),
        ai.routing.defaultModelId,
        available[0]?.id || "",
    ].filter(Boolean);

    const selectedId = candidates.find((candidate) => availableIds.has(candidate));
    const selectedModel = selectedId
        ? available.find((model) => model.id === selectedId)
        : undefined;

    if (!selectedModel) {
        throw new Error("No enabled AI model is available. Please enable a provider and model in settings.");
    }

    const provider = findAIProvider(ai, selectedModel.providerId);
    if (!provider || !provider.enabled) {
        throw new Error("The resolved AI provider is disabled or missing.");
    }

    return {
        provider,
        model: selectedModel,
        prompt: getPromptForScenario(ai, scenario, options.hasContext),
    };
}

export function createCustomProviderId(existingIds: Iterable<string>): string {
    const existing = new Set(existingIds);
    if (!existing.has("custom-1")) {
        return "custom-1";
    }

    let index = 2;
    let candidate = `custom-${index}`;
    while (existing.has(candidate)) {
        index += 1;
        candidate = `custom-${index}`;
    }
    return candidate;
}

export function getRecommendedModelsForProvider(provider: AIProviderConfig): string[] {
    return getProviderPresetMeta(provider.preset)?.recommendedModels || [];
}
