import { requestUrl } from "obsidian";
import { t } from "@/lang/helper";
import type { SearchContext } from "@/constant";
import type {
    AISettingsV2,
    AIScenario,
    AICustomParameter,
    AIModelConfig,
    AIProviderConfig,
} from "@/ai/config";
import { resolveAIModelForScenario } from "@/ai/config";

const tr = (key: string) => t(key as any);

type ChatRole = "system" | "user" | "assistant";

type ChatMessage = {
    role: ChatRole;
    content: string;
};

type ChatCompletionResponse = {
    choices?: Array<{
        message?: {
            content?: string;
        };
    }>;
};

type AISettingsLike = {
    ai: AISettingsV2;
};

type AISearchContext = SearchContext & {
    nativeLanguage?: string;
    foreignLanguage?: string;
};

type AIAutofillInput = {
    expression: string;
    surface?: string;
    type?: string;
    sentenceText?: string;
    origin?: string;
    existingMeaning?: string;
    existingAliases?: string[];
    existingTags?: string[];
    existingNotes?: string[];
    nativeLanguage?: string;
    foreignLanguage?: string;
};

type AIAutofillResult = {
    meaning: string;
    aliases: string[];
    tags: string[];
    notes: string[];
};

type RequestChatOptions = {
    scenario: AIScenario;
    cacheKey?: string;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    modelIdOverride?: string;
    hasContext?: boolean;
    bypassCache?: boolean;
};

type ResolvedRequestConfig = {
    provider: AIProviderConfig;
    model: AIModelConfig;
    prompt: string;
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
};

class PersistentCache<V> {
    private memCache = new Map<string, V>();
    private storageKey: string;
    private maxSize: number;

    constructor(storageKey: string, maxSize: number = 200) {
        this.storageKey = storageKey;
        this.maxSize = maxSize;
        this.loadFromStorage();
    }

    private loadFromStorage(): void {
        try {
            const data = localStorage.getItem(this.storageKey);
            if (data) {
                const parsed = JSON.parse(data);
                Object.entries(parsed).forEach(([k, v]) => {
                    this.memCache.set(k, v as V);
                });
            }
        } catch (e) {
            console.warn("Failed to load AI cache from storage", e);
        }
    }

    private saveToStorage(): void {
        try {
            const obj: Record<string, V> = {};
            this.memCache.forEach((v, k) => { obj[k] = v; });
            localStorage.setItem(this.storageKey, JSON.stringify(obj));
        } catch (e) {
            console.warn("Failed to save AI cache to storage", e);
        }
    }

    get(key: string): V | undefined {
        if (!this.memCache.has(key)) return undefined;
        const value = this.memCache.get(key)!;
        this.memCache.delete(key);
        this.memCache.set(key, value);
        return value;
    }

    set(key: string, value: V): void {
        if (this.memCache.has(key)) {
            this.memCache.delete(key);
        }

        if (this.memCache.size >= this.maxSize) {
            const firstKey = this.memCache.keys().next().value;
            if (firstKey !== undefined) {
                this.memCache.delete(firstKey);
            }
        }

        this.memCache.set(key, value);
        this.saveToStorage();
    }
}

const queryCache = new PersistentCache<any>("langr-ai-cache", 200);
const RESERVED_BODY_FIELDS = new Set([
    "model",
    "messages",
    "temperature",
    "top_p",
    "max_tokens",
    "stream",
]);

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
    return [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
}

function formatAIError(status: number, responseText?: string): string {
    const trimmed = (responseText || "").trim();
    if (status === 401) return t("Invalid API key or missing (401)");
    if (status === 403) return t("API key lacks permission or the account is restricted (403)");
    if (status === 404) return t("API endpoint was not found. Please check the API URL (404)");
    if (status === 408) return `${t("Request timed out (408). Please check your network connection")}${trimmed ? `\n${trimmed}` : ""}`;
    if (status === 429) return `${t("Too many requests (429). Please try again later")}${trimmed ? `\n${trimmed}` : ""}`;
    if (status >= 500 && status <= 599) return `${t("Server error. Please try again later")} (${status})${trimmed ? `\n${trimmed}` : ""}`;
    return `${t("AI API error")} (${status})${trimmed ? `: ${trimmed}` : ""}`;
}

function normalizeStringList(value: unknown, separator = /[\n,，;；]+/): string[] {
    const rawList = Array.isArray(value)
        ? value
        : typeof value === "string"
            ? value.split(separator)
            : [];

    const seen = new Set<string>();
    const normalized: string[] = [];

    rawList.forEach((item) => {
        if (typeof item !== "string") {
            return;
        }

        const trimmed = item.trim();
        const dedupeKey = trimmed.toLowerCase();
        if (!trimmed || seen.has(dedupeKey)) {
            return;
        }

        seen.add(dedupeKey);
        normalized.push(trimmed);
    });

    return normalized;
}

function stripMarkdownCodeFence(text: string): string {
    const trimmed = text.trim();
    const matched = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return matched?.[1]?.trim() || trimmed;
}

function extractJsonObjectText(text: string): string {
    const cleaned = stripMarkdownCodeFence(text);
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        throw new Error(t("AI autofill returned invalid JSON"));
    }
    return cleaned.slice(firstBrace, lastBrace + 1);
}

function extractResponseContent(response: ChatCompletionResponse | null | undefined): string {
    return response?.choices?.[0]?.message?.content?.trim?.() || "";
}

function buildCacheKey(kind: string, payload: Record<string, unknown>): string {
    return JSON.stringify({ kind, ...payload });
}

function assertUsableProvider(provider: AIProviderConfig): void {
    if (!provider.apiKey) {
        throw new Error(t("Please configure an API key in settings"));
    }
    if (!provider.baseUrl) {
        throw new Error(tr("Please configure an API URL in settings"));
    }
    try {
        new URL(provider.baseUrl);
    } catch (_error) {
        throw new Error(t("Invalid API URL (404)"));
    }
}

function parseCustomParameterValue(parameter: AICustomParameter): unknown {
    switch (parameter.type) {
        case "number":
            return typeof parameter.value === "number" ? parameter.value : Number(parameter.value);
        case "boolean":
            return typeof parameter.value === "boolean"
                ? parameter.value
                : String(parameter.value).toLowerCase() === "true";
        case "json":
            if (typeof parameter.value !== "string") {
                return parameter.value;
            }
            try {
                return JSON.parse(parameter.value);
            } catch (error: any) {
                throw new Error(`${tr("Invalid custom parameter JSON")}: ${parameter.key}`);
            }
        case "text":
        default:
            return String(parameter.value ?? "");
    }
}

function isReservedBodyField(key: string): boolean {
    if (RESERVED_BODY_FIELDS.has(key)) {
        return true;
    }
    return /^reasoning/i.test(key) || /^thinking/i.test(key);
}

function applyCapabilityFields(body: Record<string, unknown>, provider: AIProviderConfig, model: AIModelConfig): void {
    if (provider.capabilityMode === "openai-reasoning") {
        if (model.reasoning.enabled) {
            body.reasoning = true;
            body.reasoning_effort = model.reasoning.reasoningEffort;
        }
        if (model.thinking.enabled) {
            body.reasoning = true;
            if (!body.reasoning_effort) {
                body.reasoning_effort = model.reasoning.reasoningEffort || "medium";
            }
            if (typeof model.thinking.budgetTokens === "number") {
                body.reasoning_max_tokens = model.thinking.budgetTokens;
            }
            if (typeof model.thinking.thinkingBudget === "number") {
                body.reasoning_budget = model.thinking.thinkingBudget;
            }
        }
        return;
    }

    if (provider.capabilityMode === "thinking-config") {
        if (model.reasoning.enabled) {
            body.reasoning_effort = model.reasoning.reasoningEffort;
        }
        if (model.thinking.enabled) {
            body.thinking_config = {
                enabled: true,
                ...(typeof model.thinking.budgetTokens === "number"
                    ? { budget_tokens: model.thinking.budgetTokens }
                    : {}),
                ...(typeof model.thinking.thinkingBudget === "number"
                    ? { thinking_budget: model.thinking.thinkingBudget }
                    : {}),
            };
        }
        return;
    }

    if (provider.capabilityMode === "siliconflow-thinking") {
        if (model.reasoning.enabled) {
            body.reasoning_effort = model.reasoning.reasoningEffort;
        }
        if (model.thinking.enabled) {
            body.enable_thinking = true;
            if (typeof model.thinking.thinkingBudget === "number") {
                body.thinking_budget = model.thinking.thinkingBudget;
            }
        }
    }
}

function applyCustomParameters(body: Record<string, unknown>, parameters: AICustomParameter[]): void {
    parameters.forEach((parameter) => {
        if (!parameter.key || isReservedBodyField(parameter.key)) {
            return;
        }
        body[parameter.key] = parseCustomParameterValue(parameter);
    });
}

function buildRequestConfig(
    settings: AISettingsLike,
    messages: ChatMessage[],
    options: RequestChatOptions
): ResolvedRequestConfig {
    const resolved = resolveAIModelForScenario(settings.ai, options.scenario, {
        modelIdOverride: options.modelIdOverride,
        hasContext: options.hasContext,
    });

    assertUsableProvider(resolved.provider);

    const body: Record<string, unknown> = {
        model: resolved.model.model,
        messages,
        max_tokens: options.maxTokens ?? resolved.model.maxOutputTokens ?? 200,
        temperature: options.temperature ?? resolved.model.temperature ?? 0.3,
    };

    const topP = options.topP ?? resolved.model.topP;
    if (typeof topP === "number") {
        body.top_p = topP;
    }

    applyCapabilityFields(body, resolved.provider, resolved.model);
    applyCustomParameters(body, resolved.model.customParameters);

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${resolved.provider.apiKey}`,
    };

    resolved.provider.customHeaders.forEach((header) => {
        if (header.key) {
            headers[header.key] = header.value;
        }
    });

    return {
        provider: resolved.provider,
        model: resolved.model,
        prompt: resolved.prompt,
        url: resolved.provider.baseUrl,
        headers,
        body,
    };
}

async function requestChatCompletion(
    settings: AISettingsLike,
    messages: ChatMessage[],
    options: RequestChatOptions
): Promise<ChatCompletionResponse> {
    const requestConfig = buildRequestConfig(settings, messages, options);

    if (options.cacheKey && !options.bypassCache) {
        const cached = queryCache.get(options.cacheKey);
        if (cached) {
            return cached;
        }
    }

    const maxRetries = 3;
    let lastStatus: number | null = null;
    let lastText: string | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
            const delayMs = Math.min(15000, 1000 * Math.pow(2, attempt - 1));
            await sleep(delayMs);
        }

        try {
            const response = await requestUrl({
                url: requestConfig.url,
                method: "POST",
                headers: requestConfig.headers,
                body: JSON.stringify(requestConfig.body),
                throw: false,
            });

            if (response.status === 200) {
                if (options.cacheKey && !options.bypassCache) {
                    queryCache.set(options.cacheKey, response.json);
                }
                return response.json as ChatCompletionResponse;
            }

            lastStatus = response.status;
            lastText = response.text;

            const shouldRetry = isRetryableStatus(response.status) && attempt < maxRetries;
            if (!shouldRetry) {
                throw new Error(formatAIError(response.status, response.text));
            }
        } catch (e: any) {
            if (e.message && !e.message.includes("API")) {
                lastText = e.message;
                if (attempt >= maxRetries) {
                    throw new Error(`${t("Network request failed")}: ${e.message}`);
                }
            } else {
                throw e;
            }
        }
    }

    throw new Error(formatAIError(lastStatus ?? 0, lastText));
}

function buildContextualSearchMessages(
    text: string,
    prompt: string,
    context?: AISearchContext
): ChatMessage[] {
    if (!context?.sentenceText) {
        return [
            { role: "system", content: prompt },
            { role: "user", content: text },
        ];
    }

    const expressionType = text.includes(" ") ? "PHRASE" : "WORD";
    const userContent = [
        `Selected expression: ${text}`,
        `Expression type: ${expressionType}`,
        `Context sentence: ${context.sentenceText}`,
        context.origin ? `Source: ${context.origin}` : "",
        context.foreignLanguage ? `Learning language: ${context.foreignLanguage}` : "",
        context.nativeLanguage ? `Preferred explanation language: ${context.nativeLanguage}` : "",
        "Please explain the meaning in this exact context first, then give a concise general meaning and one short usage note. Use markdown.",
    ].filter(Boolean).join("\n");

    return [
        { role: "system", content: prompt },
        { role: "user", content: userContent },
    ];
}

function buildAutofillMessages(
    input: AIAutofillInput,
    prompt: string
): ChatMessage[] {
    const userContent = [
        `Expression: ${input.expression}`,
        input.surface ? `Surface: ${input.surface}` : "",
        input.type ? `Type: ${input.type}` : "",
        input.sentenceText ? `Context sentence: ${input.sentenceText}` : "",
        input.origin ? `Source: ${input.origin}` : "",
        input.foreignLanguage ? `Learning language: ${input.foreignLanguage}` : "",
        input.nativeLanguage ? `Preferred explanation language: ${input.nativeLanguage}` : "",
        input.existingMeaning ? `Existing meaning: ${input.existingMeaning}` : "",
        input.existingAliases?.length ? `Existing aliases: ${input.existingAliases.join(", ")}` : "",
        input.existingTags?.length ? `Existing tags: ${input.existingTags.join(", ")}` : "",
        input.existingNotes?.length ? `Existing notes: ${input.existingNotes.join(" | ")}` : "",
        "Return only valid JSON with the shape {\"meaning\":\"string\",\"aliases\":[\"string\"],\"tags\":[\"string\"],\"notes\":[\"string\"]}.",
    ].filter(Boolean).join("\n");

    return [
        { role: "system", content: prompt },
        { role: "user", content: userContent },
    ];
}

function parseAutofillResponse(content: string): AIAutofillResult {
    try {
        const parsed = JSON.parse(stripMarkdownCodeFence(content));
        return normalizeAutofillResult(parsed);
    } catch (_error) {
        try {
            const parsed = JSON.parse(extractJsonObjectText(content));
            return normalizeAutofillResult(parsed);
        } catch (_nestedError) {
            throw new Error(t("AI autofill returned invalid JSON"));
        }
    }
}

function normalizeAutofillResult(value: any): AIAutofillResult {
    return {
        meaning: typeof value?.meaning === "string" ? value.meaning.trim() : "",
        aliases: normalizeStringList(value?.aliases),
        tags: normalizeStringList(value?.tags),
        notes: normalizeStringList(value?.notes, /[\n;；]+/),
    };
}

export async function search(
    text: string,
    settings: AISettingsLike,
    context?: AISearchContext
): Promise<ChatCompletionResponse> {
    const resolved = resolveAIModelForScenario(settings.ai, "search", {
        hasContext: !!context?.sentenceText,
    });
    const messages = buildContextualSearchMessages(text, resolved.prompt, context);
    const cacheKey = buildCacheKey("search", {
        scenario: "search",
        text,
        providerId: resolved.provider.id,
        modelId: resolved.model.id,
        model: resolved.model.model,
        prompt: resolved.prompt,
        temperature: resolved.model.temperature ?? 0.3,
        topP: resolved.model.topP ?? null,
        maxOutputTokens: resolved.model.maxOutputTokens ?? (context?.sentenceText ? 280 : 200),
        reasoning: resolved.model.reasoning,
        thinking: resolved.model.thinking,
        customParameters: resolved.model.customParameters,
        sentenceText: context?.sentenceText || "",
        origin: context?.origin || "",
        nativeLanguage: context?.nativeLanguage || "",
        foreignLanguage: context?.foreignLanguage || "",
    });

    return requestChatCompletion(settings, messages, {
        scenario: "search",
        cacheKey,
        hasContext: !!context?.sentenceText,
        maxTokens: context?.sentenceText ? 280 : 200,
        temperature: 0.3,
    });
}

export async function translate(text: string, settings: AISettingsLike): Promise<string> {
    const resolved = resolveAIModelForScenario(settings.ai, "translate");
    const finalPrompt = resolved.prompt.replace("{sentence}", text);
    const response = await requestChatCompletion(settings, [
        { role: "user", content: finalPrompt },
    ], {
        scenario: "translate",
        maxTokens: 150,
        temperature: 0.3,
    });

    return extractResponseContent(response);
}

export async function autofillExpression(
    input: AIAutofillInput,
    settings: AISettingsLike
): Promise<AIAutofillResult> {
    const resolved = resolveAIModelForScenario(settings.ai, "card");
    const messages = buildAutofillMessages(input, resolved.prompt);
    const cacheKey = buildCacheKey("card-autofill", {
        scenario: "card",
        providerId: resolved.provider.id,
        modelId: resolved.model.id,
        model: resolved.model.model,
        expression: input.expression,
        surface: input.surface || "",
        type: input.type || "",
        sentenceText: input.sentenceText || "",
        origin: input.origin || "",
        existingMeaning: input.existingMeaning || "",
        existingAliases: (input.existingAliases || []).join("|"),
        existingTags: (input.existingTags || []).join("|"),
        existingNotes: (input.existingNotes || []).join("|"),
        nativeLanguage: input.nativeLanguage || "",
        foreignLanguage: input.foreignLanguage || "",
        prompt: resolved.prompt,
        temperature: resolved.model.temperature ?? 0.2,
        topP: resolved.model.topP ?? null,
        maxOutputTokens: resolved.model.maxOutputTokens ?? 260,
        reasoning: resolved.model.reasoning,
        thinking: resolved.model.thinking,
        customParameters: resolved.model.customParameters,
    });

    const response = await requestChatCompletion(settings, messages, {
        scenario: "card",
        cacheKey,
        maxTokens: 260,
        temperature: 0.2,
    });

    const content = extractResponseContent(response);
    if (!content) {
        throw new Error(t("No response content"));
    }

    return parseAutofillResponse(content);
}

export async function testModelConnection(
    settings: AISettingsLike,
    modelId: string
): Promise<void> {
    await requestChatCompletion(settings, [
        { role: "user", content: "Ping" },
    ], {
        scenario: "search",
        modelIdOverride: modelId,
        maxTokens: 5,
        temperature: 0,
        bypassCache: true,
    });
}

export type {
    AISearchContext,
    AIAutofillInput,
    AIAutofillResult,
    ChatCompletionResponse,
};
