import { Notice, requestUrl } from "obsidian";
import { t } from "@/lang/helper";

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
        // 如果已存在，先删除
        if (this.memCache.has(key)) {
            this.memCache.delete(key);
        }
        // 如果超出大小，删除最旧的（第一个）
        if (this.memCache.size >= this.maxSize) {
            const firstKey = this.memCache.keys().next().value;
            this.memCache.delete(firstKey);
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

// 辅助函数：延迟
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 判断是否可重试的状态码
function isRetryableStatus(status: number): boolean {
    return [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
}

// 格式化错误信息
function formatAIError(status: number, responseText?: string): string {
    const trimmed = (responseText || '').trim();
    if (status === 401) return t("Invalid API key or missing (401)");
    if (status === 403) return t("API key lacks permission or the account is restricted (403)");
    if (status === 404) return t("API endpoint was not found. Please check the API URL (404)");
    if (status === 408) return `${t("Request timed out (408). Please check your network connection")}${trimmed ? `\n${trimmed}` : ''}`;
    if (status === 429) return `${t("Too many requests (429). Please try again later")}${trimmed ? `\n${trimmed}` : ''}`;
    if (status >= 500 && status <= 599) return `${t("Server error. Please try again later")}` + ` (${status})${trimmed ? `\n${trimmed}` : ''}`;
    return `${t("AI API error")} (${status})${trimmed ? `: ${trimmed}` : ''}`;
}

export async function search(text: string, settings: any) {
    // 检查缓存
    const cacheKey = `${text}_${settings.ai.model}_${settings.ai.prompt}`;
    const cached = queryCache.get(cacheKey);
    if (cached) {
        console.log(`AI Query cache hit for: ${text}`);
        return cached;
    }

    // 获取设置
    const { api_key, api_url, model, prompt } = settings.ai;

    if (!api_key) throw new Error(t("Please configure an API key in settings"));

    // 构建请求体（适配 OpenAI 格式）
    const body = {
        model: model,
        messages: [
            { role: "system", content: prompt },
            { role: "user", content: text }
        ],
        max_tokens: 200,
        temperature: 0.3
    };

    // 重试机制
    const maxRetries = 3;
    let lastStatus: number | null = null;
    let lastText: string | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
            const delayMs = Math.min(15000, 1000 * Math.pow(2, attempt - 1));
            console.log(`AI 请求重试 ${attempt}/${maxRetries}，等待 ${delayMs}ms...`);
            await sleep(delayMs);
        }

        try {
            const response = await requestUrl({
                url: api_url,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${api_key}`
                },
                body: JSON.stringify(body),
                throw: false
            });

            if (response.status === 200) {
                // 缓存结果
                queryCache.set(cacheKey, response.json);
                return response.json;
            }

            lastStatus = response.status;
            lastText = response.text;

            // 判断是否可重试
            const shouldRetry = isRetryableStatus(response.status) && attempt < maxRetries;
            if (!shouldRetry) {
                throw new Error(formatAIError(response.status, response.text));
            }
        } catch (e: any) {
            // 网络错误等
            if (e.message && !e.message.includes('API')) {
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

// 增加翻译功能供例句使用
export async function translate(text: string, settings: any) {
    const { api_key, api_url, model, trans_prompt } = settings.ai;
    if (!api_key) throw new Error(t("Please configure an API key in settings"));

    // 替换占位符
    const finalPrompt = trans_prompt.replace("{sentence}", text);

    const body = {
        model: model,
        messages: [
            { role: "user", content: finalPrompt }
        ],
        max_tokens: 150,
        temperature: 0.3
    };

    // 重试机制
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
                    "Authorization": `Bearer ${api_key}`
                },
                body: JSON.stringify(body),
                throw: false
            });

            if (response.status === 200) {
                return response.json.choices[0].message.content.trim();
            }

            lastStatus = response.status;
            lastText = response.text;

            const shouldRetry = isRetryableStatus(response.status) && attempt < maxRetries;
            if (!shouldRetry) {
                throw new Error(formatAIError(response.status, response.text));
            }
        } catch (e: any) {
            if (e.message && !e.message.includes('API')) {
                lastText = e.message;
                if (attempt >= maxRetries) {
                    throw new Error(`${t("Translation request failed")}: ${e.message}`);
                }
            } else {
                throw e;
            }
        }
    }

    throw new Error(formatAIError(lastStatus ?? 0, lastText));
}
