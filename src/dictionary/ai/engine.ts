import { requestUrl } from "obsidian";
import { t } from "@/lang/helper";
import type { SearchContext } from "@/constant";

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
    ai: {
        api_key: string;
        api_url: string;
        model: string;
        prompt: string;
        context_prompt?: string;
        trans_prompt: string;
        card_prompt?: string;
    };
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
    cacheKey?: string;
    maxTokens?: number;
    temperature?: number;
};

// 持久化缓存 (LRU + localStorage)
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
        // LRU: 移到末尾
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

    clear(): void {
        this.memCache.clear();
        localStorage.removeItem(this.storageKey);
    }
}

// 全局持久化缓存实例
const queryCache = new PersistentCache<any>("langr-ai-cache", 200);

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

async function requestChatCompletion(
    settings: AISettingsLike,
    messages: ChatMessage[],
    options: RequestChatOptions = {}
): Promise<ChatCompletionResponse> {
    const { api_key, api_url, model } = settings.ai;

    if (!api_key) {
        throw new Error(t("Please configure an API key in settings"));
    }

    if (options.cacheKey) {
        const cached = queryCache.get(options.cacheKey);
        if (cached) {
            return cached;
        }
    }

    const body = {
        model,
        messages,
        max_tokens: options.maxTokens ?? 200,
        temperature: options.temperature ?? 0.3,
    };

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
                url: api_url,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${api_key}`,
                },
                body: JSON.stringify(body),
                throw: false,
            });

            if (response.status === 200) {
                if (options.cacheKey) {
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
    settings: AISettingsLike,
    context?: AISearchContext
): ChatMessage[] {
    if (!context?.sentenceText) {
        return [
            { role: "system", content: settings.ai.prompt },
            { role: "user", content: text },
        ];
    }

    const expressionType = text.includes(" ") ? "PHRASE" : "WORD";
    const systemPrompt = settings.ai.context_prompt || settings.ai.prompt;
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
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
    ];
}

function buildAutofillMessages(
    input: AIAutofillInput,
    settings: AISettingsLike
): ChatMessage[] {
    const systemPrompt = settings.ai.card_prompt || settings.ai.prompt;
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
        { role: "system", content: systemPrompt },
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
    const messages = buildContextualSearchMessages(text, settings, context);
    const cacheKey = buildCacheKey("search", {
        text,
        prompt: context?.sentenceText ? (settings.ai.context_prompt || settings.ai.prompt) : settings.ai.prompt,
        model: settings.ai.model,
        sentenceText: context?.sentenceText || "",
        origin: context?.origin || "",
        nativeLanguage: context?.nativeLanguage || "",
        foreignLanguage: context?.foreignLanguage || "",
    });

    return requestChatCompletion(settings, messages, {
        cacheKey,
        maxTokens: context?.sentenceText ? 280 : 200,
        temperature: 0.3,
    });
}

export async function translate(text: string, settings: AISettingsLike): Promise<string> {
    const finalPrompt = settings.ai.trans_prompt.replace("{sentence}", text);
    const response = await requestChatCompletion(settings, [
        { role: "user", content: finalPrompt },
    ], {
        maxTokens: 150,
        temperature: 0.3,
    });

    return extractResponseContent(response);
}

export async function autofillExpression(
    input: AIAutofillInput,
    settings: AISettingsLike
): Promise<AIAutofillResult> {
    const messages = buildAutofillMessages(input, settings);
    const cacheKey = buildCacheKey("card-autofill", {
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
        prompt: settings.ai.card_prompt || settings.ai.prompt,
        model: settings.ai.model,
    });

    const response = await requestChatCompletion(settings, messages, {
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

export type {
    AISearchContext,
    AIAutofillInput,
    AIAutofillResult,
    ChatCompletionResponse,
};
