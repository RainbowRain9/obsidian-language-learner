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
        finish_reason?: string;
        text?: string;
        message?: {
            content?: string | Array<{ type?: string; text?: string }>;
            reasoning_content?: string;
        };
    }>;
    usage?: {
        completion_tokens_details?: {
            reasoning_tokens?: number;
        };
    };
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
    requestedFields?: Array<"meaning" | "aliases" | "tags" | "notes">;
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

type AIDebugLogEntry = {
    id: string;
    timestamp: string;
    scenario: AIScenario;
    phase: "cache-hit" | "request" | "response" | "error" | "empty-response";
    providerId: string;
    providerLabel: string;
    modelId: string;
    modelName: string;
    modelValue: string;
    url: string;
    attempt?: number;
    cacheKey?: string;
    requestHeaders: Record<string, string>;
    requestBody: Record<string, unknown>;
    status?: number;
    responseText?: string;
    responseJson?: unknown;
    errorMessage?: string;
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
const AI_DEBUG_EVENT = "obsidian-langr-ai-debug";
const AI_DEBUG_MAX_LOGS = 20;
const DEFAULT_CARD_MAX_TOKENS = 512;
const RESERVED_BODY_FIELDS = new Set([
    "model",
    "messages",
    "temperature",
    "top_p",
    "max_tokens",
    "stream",
]);
const aiDebugLogs: AIDebugLogEntry[] = [];

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
    const firstChoice = response?.choices?.[0];
    const content = firstChoice?.message?.content;

    if (typeof content === "string") {
        return content.trim();
    }

    if (Array.isArray(content)) {
        return content
            .map((item) => typeof item?.text === "string" ? item.text : "")
            .join("")
            .trim();
    }

    if (typeof firstChoice?.text === "string") {
        return firstChoice.text.trim();
    }

    return "";
}

function extractReasoningContent(response: ChatCompletionResponse | null | undefined): string {
    return response?.choices?.[0]?.message?.reasoning_content?.trim?.() || "";
}

function isReasoningOnlyLengthResponse(response: ChatCompletionResponse | null | undefined): boolean {
    const firstChoice = response?.choices?.[0];
    const reasoningTokens = response?.usage?.completion_tokens_details?.reasoning_tokens || 0;
    return !extractResponseContent(response)
        && !!extractReasoningContent(response)
        && (firstChoice?.finish_reason === "length" || reasoningTokens > 0);
}

function redactHeaderValue(key: string, value: string): string {
    const normalizedKey = key.toLowerCase();
    if (
        normalizedKey.includes("authorization") ||
        normalizedKey.includes("api-key") ||
        normalizedKey.includes("apikey") ||
        normalizedKey.includes("token")
    ) {
        return value ? "***" : "";
    }
    return value;
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [key, redactHeaderValue(key, value)])
    );
}

function truncateDebugValue(value: unknown, maxLength = 2000): string | undefined {
    if (value == null) {
        return undefined;
    }

    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    if (!text) {
        return undefined;
    }

    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function addAIDebugLog(
    requestConfig: ResolvedRequestConfig,
    options: RequestChatOptions,
    payload: Partial<AIDebugLogEntry>
): AIDebugLogEntry {
    const entry: AIDebugLogEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        scenario: options.scenario,
        phase: payload.phase || "request",
        providerId: requestConfig.provider.id,
        providerLabel: requestConfig.provider.label || requestConfig.provider.id,
        modelId: requestConfig.model.id,
        modelName: requestConfig.model.name || requestConfig.model.model,
        modelValue: requestConfig.model.model,
        url: requestConfig.url,
        cacheKey: options.cacheKey,
        requestHeaders: sanitizeHeaders(requestConfig.headers),
        requestBody: JSON.parse(JSON.stringify(requestConfig.body)),
        ...payload,
    };

    aiDebugLogs.unshift(entry);
    if (aiDebugLogs.length > AI_DEBUG_MAX_LOGS) {
        aiDebugLogs.length = AI_DEBUG_MAX_LOGS;
    }

    console.info("[Language Learner][AI]", entry);
    globalThis.dispatchEvent?.(new CustomEvent(AI_DEBUG_EVENT, { detail: entry }));
    return entry;
}

function createEmptyContentError(scenario: AIScenario): Error {
    const scenarioLabelMap: Record<AIScenario, string> = {
        search: tr("AI dictionary"),
        translate: tr("AI translation"),
        card: tr("AI card autofill"),
    };
    return new Error(`${scenarioLabelMap[scenario] || tr("AI response")} ${tr("returned empty content")}`);
}

function createReasoningExhaustedError(scenario: AIScenario): Error {
    const scenarioLabelMap: Record<AIScenario, string> = {
        search: tr("AI dictionary"),
        translate: tr("AI translation"),
        card: tr("AI card autofill"),
    };
    return new Error(
        `${scenarioLabelMap[scenario] || tr("AI response")} ${tr("used all output tokens on reasoning before generating final content")} ${tr("Try capability mode thinking.type or increase Max Output Tokens")}`
    );
}

function createEmptyContentErrorForResponse(
    scenario: AIScenario,
    response: ChatCompletionResponse | null | undefined
): Error {
    return isReasoningOnlyLengthResponse(response)
        ? createReasoningExhaustedError(scenario)
        : createEmptyContentError(scenario);
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
        return;
    }

    if (provider.capabilityMode === "zhipu-thinking") {
        body.thinking = {
            type: model.thinking.enabled || model.reasoning.enabled ? "enabled" : "disabled",
        };
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
            addAIDebugLog(requestConfig, options, {
                phase: "cache-hit",
                responseJson: cached,
                responseText: truncateDebugValue(cached),
            });
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
            addAIDebugLog(requestConfig, options, {
                phase: "request",
                attempt,
            });
            const response = await requestUrl({
                url: requestConfig.url,
                method: "POST",
                headers: requestConfig.headers,
                body: JSON.stringify(requestConfig.body),
                throw: false,
            });

            if (response.status === 200) {
                addAIDebugLog(requestConfig, options, {
                    phase: "response",
                    attempt,
                    status: response.status,
                    responseJson: response.json,
                    responseText: truncateDebugValue(response.json),
                });
                if (options.cacheKey && !options.bypassCache) {
                    queryCache.set(options.cacheKey, response.json);
                }
                return response.json as ChatCompletionResponse;
            }

            lastStatus = response.status;
            lastText = response.text;
            addAIDebugLog(requestConfig, options, {
                phase: "error",
                attempt,
                status: response.status,
                responseText: truncateDebugValue(response.text),
                errorMessage: formatAIError(response.status, response.text),
            });

            const shouldRetry = isRetryableStatus(response.status) && attempt < maxRetries;
            if (!shouldRetry) {
                throw new Error(formatAIError(response.status, response.text));
            }
        } catch (e: any) {
            if (e.message && !e.message.includes("API")) {
                lastText = e.message;
                addAIDebugLog(requestConfig, options, {
                    phase: "error",
                    attempt,
                    status: lastStatus ?? undefined,
                    responseText: truncateDebugValue(lastText),
                    errorMessage: e.message,
                });
                if (attempt >= maxRetries) {
                    throw new Error(`${t("Network request failed")}: ${e.message}`);
                }
            } else {
                addAIDebugLog(requestConfig, options, {
                    phase: "error",
                    attempt,
                    status: lastStatus ?? undefined,
                    responseText: truncateDebugValue(lastText),
                    errorMessage: e?.message || String(e),
                });
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
    const requestedFields = input.requestedFields?.length
        ? input.requestedFields
        : ["meaning", "aliases", "tags", "notes"];
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
        `Requested fields: ${requestedFields.join(", ")}`,
        "Do not output reasoning, analysis, or markdown code fences.",
        "Return only compact valid JSON. Include only the requested keys from {\"meaning\":\"string\",\"aliases\":[\"string\"],\"tags\":[\"string\"],\"notes\":[\"string\"]}.",
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

    const content = extractResponseContent(response);
    if (!content) {
        const emptyContentError = createEmptyContentErrorForResponse("translate", response);
        const requestConfig = buildRequestConfig(settings, [
            { role: "user", content: finalPrompt },
        ], {
            scenario: "translate",
            maxTokens: 150,
            temperature: 0.3,
        });
        addAIDebugLog(requestConfig, {
            scenario: "translate",
            maxTokens: 150,
            temperature: 0.3,
        }, {
            phase: "empty-response",
            responseJson: response,
            responseText: truncateDebugValue(response),
            errorMessage: emptyContentError.message,
        });
        throw emptyContentError;
    }

    return content;
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
        requestedFields: (input.requestedFields || []).join("|"),
        prompt: resolved.prompt,
        temperature: resolved.model.temperature ?? 0.2,
        topP: resolved.model.topP ?? null,
        maxOutputTokens: resolved.model.maxOutputTokens ?? DEFAULT_CARD_MAX_TOKENS,
        reasoning: resolved.model.reasoning,
        thinking: resolved.model.thinking,
        customParameters: resolved.model.customParameters,
    });

    const response = await requestChatCompletion(settings, messages, {
        scenario: "card",
        cacheKey,
        maxTokens: DEFAULT_CARD_MAX_TOKENS,
        temperature: 0.2,
    });

    const content = extractResponseContent(response);
    if (!content) {
        const emptyContentError = createEmptyContentErrorForResponse("card", response);
        const requestConfig = buildRequestConfig(settings, messages, {
            scenario: "card",
            cacheKey,
            maxTokens: DEFAULT_CARD_MAX_TOKENS,
            temperature: 0.2,
        });
        addAIDebugLog(requestConfig, {
            scenario: "card",
            cacheKey,
            maxTokens: DEFAULT_CARD_MAX_TOKENS,
            temperature: 0.2,
        }, {
            phase: "empty-response",
            responseJson: response,
            responseText: truncateDebugValue(response),
            errorMessage: emptyContentError.message,
        });
        throw emptyContentError;
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

export function getLatestAIDebugLog(): AIDebugLogEntry | null {
    return aiDebugLogs[0] || null;
}

export function getAIDebugLogs(): AIDebugLogEntry[] {
    return [...aiDebugLogs];
}

export function clearAIDebugLogs(): void {
    aiDebugLogs.length = 0;
}

export function formatAIDebugLog(entry: AIDebugLogEntry | null | undefined): string {
    if (!entry) {
        return tr("No AI debug log yet");
    }

    const lines = [
        `[${entry.timestamp}] ${entry.phase}`,
        `${tr("Scenario")}: ${entry.scenario}`,
        `${tr("Provider")}: ${entry.providerLabel} (${entry.providerId})`,
        `${tr("Model")}: ${entry.modelName} (${entry.modelValue})`,
        `${tr("URL")}: ${entry.url}`,
        entry.attempt != null ? `${tr("Attempt")}: ${entry.attempt + 1}` : "",
        entry.status != null ? `${tr("Status")}: ${entry.status}` : "",
        entry.errorMessage ? `${tr("Error")}: ${entry.errorMessage}` : "",
        `${tr("Request Headers")}:`,
        JSON.stringify(entry.requestHeaders, null, 2),
        `${tr("Request Body")}:`,
        JSON.stringify(entry.requestBody, null, 2),
        entry.responseText ? `${tr("Response Preview")}:\n${entry.responseText}` : "",
    ].filter(Boolean);

    return lines.join("\n");
}

export type {
    AISearchContext,
    AIAutofillInput,
    AIAutofillResult,
    ChatCompletionResponse,
    AIDebugLogEntry,
};
