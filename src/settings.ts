import { App, Notice, PluginSettingTab, Setting, Modal, TextComponent, debounce } from "obsidian";

import { LocalDb } from "./db/local_db";
import { FileDb } from "./db/file_db";
import LanguageLearner from "./plugin";
import { t, type UiLanguage } from "./lang/helper";
import { WarningModal, OpenFileModal } from "./modals"
import { dicts } from "@dict/list";
import store from "./store";
import {
    AISettingsV2,
    AIProviderConfig,
    AIModelConfig,
    AIProviderHeader,
    AICustomParameter,
    AICustomParameterType,
    AICapabilityMode,
    AI_PROVIDER_PRESET_META,
    createCustomProviderId,
    createDefaultAISettings,
    createModelConfig,
    findAIProvider,
    getAvailableAIModels,
    getRecommendedModelsForProvider,
    isBuiltinProvider,
    normalizeAIModelConfig,
    normalizeAIProviderConfig,
    normalizeAISettings,
} from "./ai/config";
import {
    clearAIDebugLogs,
    formatAIDebugLog,
    getAIDebugLogs,
    getLatestAIDebugLog,
    testModelConnection,
} from "@dict/ai/engine";

// Import external CSS for settings panel
import "./styles/settings.css";

const tr = (key: string) => t(key as any);

export type MeaningAutofillMode =
    | "off"
    | "context-translation"
    | "youdao-basic"
    | "context-pos";

export type AIAutofillTriggerMode =
    | "off"
    | "manual"
    | "auto"
    | "manual-and-auto";

export type AIAutofillWriteMode =
    | "fill-empty"
    | "merge"
    | "overwrite";

export type AIAutofillFieldKey =
    | "meaning"
    | "aliases"
    | "tags"
    | "notes";

export interface AIAutofillFieldStrategy {
    triggerMode: AIAutofillTriggerMode;
    writeMode: AIAutofillWriteMode;
}

export interface AIAutofillFieldConfig {
    meaning: AIAutofillFieldStrategy;
    aliases: AIAutofillFieldStrategy;
    tags: AIAutofillFieldStrategy;
    notes: AIAutofillFieldStrategy;
}

export interface AIAutofillSettings {
    fields: AIAutofillFieldConfig;
}

export interface MyPluginSettings {
    use_server: boolean;
    port: number;
    self_server: boolean;
    self_port: number;
    // lang
    native: string;
    foreign: string;
    ui_language: UiLanguage;
    // search
    popup_search: boolean;
    auto_pron: boolean;
    function_key: "ctrlKey" | "altKey" | "metaKey" | "disable";
    meaning_autofill_mode: MeaningAutofillMode;
    dictionaries: { [K in string]: { enable: boolean, priority: number; } };
    dict_height: string;
    // reading
    word_count: boolean;
    default_paragraphs: string;
    font_size: string;
    font_family: string;
    line_height: string;
    use_machine_trans: boolean;
    hover_definition_enabled: boolean;
    hover_definition_lang: string;
    // indexed db
    db_name: string;
    // text db
    word_database: string;
    review_database: string;
    col_delimiter: "," | "\t" | "|";
    auto_refresh_db: boolean;
    // file db
    use_fileDB: boolean;
    word_folder: string;
    only_fileDB: boolean;
    // review
    review_prons: "0" | "1";
    review_delimiter: string;
    last_sync?: string;
    last_word_db_hash?: string;
    // ai
    ai: AISettingsV2;
    ai_autofill: AIAutofillSettings;
    // ui
    activeTab: string;
}

function createDefaultAIAutofillSettings(): AIAutofillSettings {
    return {
        fields: {
            meaning: { triggerMode: "manual", writeMode: "fill-empty" },
            aliases: { triggerMode: "manual", writeMode: "fill-empty" },
            tags: { triggerMode: "manual", writeMode: "merge" },
            notes: { triggerMode: "manual", writeMode: "merge" },
        },
    };
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
    use_server: false,
    port: 8086,
    self_server: false,
    self_port: 3002,
    // lang - 语言设置
    native: "zh",  // 母语：中文
    foreign: "en",  // 外语：英语
    ui_language: "en",
    // search - 查询设置（优化后的默认值）
    popup_search: true,  // ✅ 划词弹出翻译
    auto_pron: true,  // ✅ 自动发音
    function_key: "ctrlKey",  // Ctrl 键辅助选择
    meaning_autofill_mode: "context-translation",
    dictionaries: {
        "youdao": { enable: true, priority: 1 },  // 有道词典（中文友好）
        "cambridge": { enable: true, priority: 2 },  // 剑桥词典（权威）
        "ai": { enable: true, priority: 3 },  // AI 解释（智能）
        "google": { enable: true, priority: 4 },  // 谷歌翻译（通用）
    },
    dict_height: "300px",  // 增加弹窗高度，显示更多内容
    // indexed - IndexedDB 数据库
    db_name: "WordDB",
    // text db - 文本数据库
    word_database: "",
    review_database: "",
    col_delimiter: ",",
    auto_refresh_db: true,  // ✅ 自动刷新数据库
    // file db - 文件数据库
    use_fileDB: true,  // ✅ 默认使用文件数据库（便于备份和同步）
    word_folder: "03-Vocabulary",  // 生词本文件夹
    only_fileDB: false,  // 同时使用 IndexedDB 和文件数据库
    // reading - 阅读模式设置
    default_paragraphs: "4",  // 默认显示 4 段
    font_size: "16px",  // 增加字体大小（更易阅读）
    font_family: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif',  // 现代字体
    line_height: "1.8em",  // 行高 1.8（舒适阅读）
    use_machine_trans: true,  // ✅ 启用机器翻译
    word_count: true,  // ✅ 显示单词计数
    hover_definition_enabled: true,
    hover_definition_lang: "zh",
    // review - 复习设置
    review_prons: "0",  // 复习时发音次数
    review_delimiter: "?",  // 复习分隔符
    last_sync: "1970-01-01T00:00:00Z",
    last_word_db_hash: "",
    ai: createDefaultAISettings(),
    ai_autofill: createDefaultAIAutofillSettings(),
    activeTab: "general"
};

function isRecord(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAIAutofillTriggerMode(value: unknown): value is AIAutofillTriggerMode {
    return value === "off" || value === "manual" || value === "auto" || value === "manual-and-auto";
}

function isAIAutofillWriteMode(value: unknown): value is AIAutofillWriteMode {
    return value === "fill-empty" || value === "merge" || value === "overwrite";
}

function getLegacyAIAutofillWriteMode(
    field: AIAutofillFieldKey,
    preserveMeaningAndAliases: boolean | undefined,
    fallback: AIAutofillWriteMode
): AIAutofillWriteMode {
    switch (field) {
        case "meaning":
            return preserveMeaningAndAliases === false ? "overwrite" : "fill-empty";
        case "aliases":
            return preserveMeaningAndAliases === false ? "merge" : "fill-empty";
        case "tags":
        case "notes":
        default:
            return fallback;
    }
}

function normalizeAIAutofillFieldStrategy(
    field: AIAutofillFieldKey,
    value: unknown,
    fallback: AIAutofillFieldStrategy,
    legacyTriggerMode?: AIAutofillTriggerMode,
    legacyPreserveMeaningAndAliases?: boolean
): AIAutofillFieldStrategy {
    if (isRecord(value)) {
        return {
            triggerMode: isAIAutofillTriggerMode(value.triggerMode) ? value.triggerMode : fallback.triggerMode,
            writeMode: isAIAutofillWriteMode(value.writeMode) ? value.writeMode : fallback.writeMode,
        };
    }

    if (typeof value === "boolean") {
        return {
            triggerMode: value ? (legacyTriggerMode || fallback.triggerMode) : "off",
            writeMode: getLegacyAIAutofillWriteMode(field, legacyPreserveMeaningAndAliases, fallback.writeMode),
        };
    }

    return fallback;
}

function normalizeAIAutofillSettings(value: unknown): AIAutofillSettings {
    const defaults = createDefaultAIAutofillSettings();
    const source = isRecord(value) ? value : {};
    const fields = isRecord(source.fields) ? source.fields : {};
    const legacyTriggerMode = isAIAutofillTriggerMode(source.triggerMode) ? source.triggerMode : undefined;
    const legacyPreserveMeaningAndAliases = typeof source.preserveMeaningAndAliases === "boolean"
        ? source.preserveMeaningAndAliases
        : undefined;

    return {
        fields: {
            meaning: normalizeAIAutofillFieldStrategy(
                "meaning",
                fields.meaning,
                defaults.fields.meaning,
                legacyTriggerMode,
                legacyPreserveMeaningAndAliases
            ),
            aliases: normalizeAIAutofillFieldStrategy(
                "aliases",
                fields.aliases,
                defaults.fields.aliases,
                legacyTriggerMode,
                legacyPreserveMeaningAndAliases
            ),
            tags: normalizeAIAutofillFieldStrategy(
                "tags",
                fields.tags,
                defaults.fields.tags,
                legacyTriggerMode,
                legacyPreserveMeaningAndAliases
            ),
            notes: normalizeAIAutofillFieldStrategy(
                "notes",
                fields.notes,
                defaults.fields.notes,
                legacyTriggerMode,
                legacyPreserveMeaningAndAliases
            ),
        },
    };
}

export function normalizeSettings(data: unknown): MyPluginSettings {
    const source = isRecord(data) ? data : {};
    const defaults = DEFAULT_SETTINGS;
    const dictionaries = isRecord(source.dictionaries) ? source.dictionaries : {};

    return {
        ...defaults,
        ...source,
        dictionaries: {
            ...defaults.dictionaries,
            ...dictionaries,
        },
        ai: normalizeAISettings(source.ai),
        ai_autofill: normalizeAIAutofillSettings(source.ai_autofill),
        activeTab: typeof source.activeTab === "string" ? source.activeTab : defaults.activeTab,
    };
}

function parseProviderHeadersText(text: string): AIProviderHeader[] {
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const separatorIndex = line.indexOf(":");
            if (separatorIndex === -1) {
                return null;
            }

            const key = line.slice(0, separatorIndex).trim();
            const value = line.slice(separatorIndex + 1).trim();
            if (!key) {
                return null;
            }

            return { key, value } satisfies AIProviderHeader;
        })
        .filter((item): item is AIProviderHeader => Boolean(item));
}

function formatProviderHeadersText(headers: AIProviderHeader[]): string {
    return headers.map((header) => `${header.key}: ${header.value}`).join("\n");
}

function parseCustomParametersText(text: string): AICustomParameter[] {
    if (!text.trim()) {
        return [];
    }

    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
        throw new Error(tr("Custom parameters must be a JSON array"));
    }

    return parsed
        .map((item) => {
            if (!isRecord(item) || typeof item.key !== "string" || typeof item.type !== "string") {
                return null;
            }
            const type = item.type as AICustomParameterType;
            if (!["text", "number", "boolean", "json"].includes(type)) {
                return null;
            }
            return {
                key: item.key.trim(),
                type,
                value: item.value,
            } as AICustomParameter;
        })
        .filter((item): item is AICustomParameter => Boolean(item) && !!item.key);
}

function formatCustomParametersText(parameters: AICustomParameter[]): string {
    return JSON.stringify(parameters, null, 2);
}

function formatOptionalNumber(value?: number): string {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function parseOptionalNumber(value: string): number | undefined {
    if (!value.trim()) {
        return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function getCapabilityModeLabel(mode: AICapabilityMode): string {
    switch (mode) {
        case "thinking-config":
            return "thinking_config";
        case "siliconflow-thinking":
            return "enable_thinking";
        case "zhipu-thinking":
            return "thinking.type";
        case "openai-reasoning":
        default:
            return "reasoning / reasoning_effort";
    }
}

function getAIAutofillTriggerLabel(mode: AIAutofillTriggerMode): string {
    switch (mode) {
        case "off":
            return tr("Disabled");
        case "auto":
            return tr("Auto");
        case "manual-and-auto":
            return tr("Auto + Manual button");
        case "manual":
        default:
            return tr("Manual only");
    }
}

function getAIAutofillWriteModeLabel(mode: AIAutofillWriteMode): string {
    switch (mode) {
        case "overwrite":
            return tr("Overwrite existing");
        case "merge":
            return tr("Merge with existing");
        case "fill-empty":
        default:
            return tr("Fill empty only");
    }
}

function getProviderDisplayName(provider: AIProviderConfig): string {
    return provider.label || provider.id;
}

function getModelDisplayName(model: AIModelConfig): string {
    return model.name || model.model;
}

function createInfoCard(containerEl: HTMLElement, text: string, variant: "info" | "warning" | "danger" = "info"): HTMLElement {
    return containerEl.createDiv({
        cls: ["ll-info-card", variant === "info" ? "" : variant].filter(Boolean).join(" "),
        text,
    });
}

function createAISection(containerEl: HTMLElement, title: string, description?: string): HTMLElement {
    const section = containerEl.createDiv({ cls: "ll-ai-section" });
    section.createEl("h4", { text: title, cls: "ll-ai-section-title" });
    if (description) {
        section.createEl("p", { text: description, cls: "ll-ai-section-description" });
    }
    return section;
}

function summarizeRoutingTarget(ai: AISettingsV2, modelId: string): string {
    if (!modelId) {
        return tr("Follow default");
    }
    const model = ai.models.find((item) => item.id === modelId);
    return model ? getModelDisplayName(model) : tr("Missing model");
}

function getModelRoutingUsages(ai: AISettingsV2, model: AIModelConfig): string[] {
    const usages: string[] = [];
    if (ai.routing.defaultModelId === model.id) usages.push(tr("Default"));
    if (ai.routing.searchModelId === model.id) usages.push(tr("Search"));
    if (ai.routing.translateModelId === model.id) usages.push(tr("Translate"));
    if (ai.routing.cardModelId === model.id) usages.push(tr("Card"));
    return usages;
}

function getProviderModelCount(ai: AISettingsV2, providerId: string): number {
    return ai.models.filter((model) => model.providerId === providerId).length;
}

function getProviderRoutingSummary(ai: AISettingsV2, providerId: string): string[] {
    const routed = ai.models
        .filter((model) => model.providerId === providerId)
        .flatMap((model) => getModelRoutingUsages(ai, model));
    return [...new Set(routed)];
}

function addSettingBadges(setting: Setting, badges: Array<{ label: string; tone?: "accent" | "muted" | "warning" }>) {
    const nameEl = (setting as any).nameEl as HTMLElement | undefined;
    if (!nameEl || badges.length === 0) {
        return;
    }

    const badgeRow = nameEl.createDiv({ cls: "ll-setting-badges" });
    badges.forEach((badge) => {
        badgeRow.createSpan({
            cls: ["ll-setting-badge", badge.tone ? `is-${badge.tone}` : ""].filter(Boolean).join(" "),
            text: badge.label,
        });
    });
}

function isValidHttpUrl(value: string): boolean {
    if (!value.trim()) {
        return false;
    }
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch (_error) {
        return false;
    }
}

function validateHeaderLines(text: string): { valid: boolean; message: string } {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
        const separatorIndex = line.indexOf(":");
        if (separatorIndex <= 0 || separatorIndex === line.length - 1) {
            return {
                valid: false,
                message: tr("Each custom header must use the format Header-Name: value"),
            };
        }
    }
    return { valid: true, message: "" };
}

function setInputValidationState(
    inputEl: HTMLInputElement | HTMLTextAreaElement,
    stateEl: HTMLElement,
    validation: { valid: boolean; message: string }
) {
    inputEl.toggleClass("is-invalid", !validation.valid);
    stateEl.setText(validation.message);
    stateEl.toggleClass("is-visible", !validation.valid);
}

function describeModelDeletionImpact(ai: AISettingsV2, model: AIModelConfig): string {
    const usages = getModelRoutingUsages(ai, model);
    if (usages.length === 0) {
        return `${tr("Delete Model")}: ${getModelDisplayName(model)}?`;
    }

    const fallbackTarget = summarizeRoutingTarget(ai, ai.routing.defaultModelId);
    const details = usages.map((usage) => {
        if (usage === tr("Default")) {
            return `${usage} → ${tr("Will fall back to first available enabled model")}`;
        }
        return `${usage} → ${tr("Will follow default")}: ${fallbackTarget}`;
    });

    return `${tr("Delete Model")}: ${getModelDisplayName(model)}? ${tr("Impact")}: ${details.join(" | ")}`;
}

function describeProviderDeletionImpact(ai: AISettingsV2, provider: AIProviderConfig): string {
    const providerModels = ai.models.filter((model) => model.providerId === provider.id);
    const routeImpacts = providerModels.flatMap((model) => getModelRoutingUsages(ai, model));
    if (routeImpacts.length === 0) {
        return `${tr("Delete Provider")}: ${getProviderDisplayName(provider)}?`;
    }

    return `${tr("Delete Provider")}: ${getProviderDisplayName(provider)}? ${tr("This will also remove routed models for")}: ${[...new Set(routeImpacts)].join(", ")}`;
}

function createEmptyCustomParameter(): AICustomParameter {
    return {
        key: "",
        type: "text",
        value: "",
    };
}

function normalizeCustomParameterValueForType(
    value: string | number | boolean,
    type: AICustomParameterType
): string | number | boolean {
    switch (type) {
        case "number":
            return typeof value === "number" ? value : Number(value || 0);
        case "boolean":
            if (typeof value === "boolean") return value;
            return String(value).toLowerCase() === "true";
        case "json":
            return typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2);
        case "text":
        default:
            return typeof value === "string" ? value : String(value ?? "");
    }
}

function validateJsonParameterValue(value: string): { valid: boolean; message: string } {
    if (!value.trim()) {
        return {
            valid: false,
            message: tr("JSON parameters cannot be empty"),
        };
    }

    try {
        JSON.parse(value);
        return { valid: true, message: "" };
    } catch (error: any) {
        return {
            valid: false,
            message: `${tr("Invalid JSON")}: ${error?.message || tr("Please check the JSON syntax")}`,
        };
    }
}

class AIProviderModal extends Modal {
    private draft: AIProviderConfig;
    private readonly onSaveProvider: (provider: AIProviderConfig) => Promise<void>;
    private readonly readonlyPreset: boolean;

    constructor(app: App, provider: AIProviderConfig, onSaveProvider: (provider: AIProviderConfig) => Promise<void>) {
        super(app);
        this.draft = { ...provider, customHeaders: [...provider.customHeaders] };
        this.onSaveProvider = onSaveProvider;
        this.readonlyPreset = isBuiltinProvider(provider);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("ll-ai-modal");
        contentEl.createEl("h3", {
            text: this.readonlyPreset ? tr("Edit Provider") : tr("Create / Edit Provider"),
        });
        createInfoCard(
            contentEl,
            this.readonlyPreset
                ? tr("Built-in providers can be edited and disabled, but they cannot be deleted.")
                : tr("Custom providers are ideal for self-hosted or third-party OpenAI-compatible endpoints.")
        );

        const baseUrlState = contentEl.createDiv({ cls: "ll-input-validation" });
        const apiKeyState = contentEl.createDiv({ cls: "ll-input-validation" });
        const headersState = contentEl.createDiv({ cls: "ll-input-validation" });

        new Setting(contentEl)
            .setName(tr("Provider preset"))
            .setDesc(this.draft.preset)
            .setDisabled(true);

        new Setting(contentEl)
            .setName(tr("Label"))
            .addText((text) => text
                .setValue(this.draft.label)
                .onChange((value) => {
                    this.draft.label = value.trim() || this.draft.label;
                }));

        new Setting(contentEl)
            .setName(tr("Enabled"))
            .addToggle((toggle) => toggle
                .setValue(this.draft.enabled)
                .onChange((value) => {
                    this.draft.enabled = value;
                }));

        new Setting(contentEl)
            .setName(tr("Base URL"))
            .addText((text) => {
                text.setPlaceholder("https://.../chat/completions")
                    .setValue(this.draft.baseUrl)
                    .onChange((value) => {
                        this.draft.baseUrl = value.trim();
                        setInputValidationState(text.inputEl, baseUrlState, {
                            valid: isValidHttpUrl(this.draft.baseUrl),
                            message: isValidHttpUrl(this.draft.baseUrl) ? "" : tr("Enter a valid http(s) chat completions URL"),
                        });
                    });
                text.inputEl.style.width = "100%";
                setInputValidationState(text.inputEl, baseUrlState, {
                    valid: isValidHttpUrl(this.draft.baseUrl),
                    message: isValidHttpUrl(this.draft.baseUrl) ? "" : tr("Enter a valid http(s) chat completions URL"),
                });
            });

        new Setting(contentEl)
            .setName(t("API Key"))
            .addText((text) => {
                text.setValue(this.draft.apiKey).onChange((value) => {
                    this.draft.apiKey = value.trim();
                    const valid = !!this.draft.apiKey;
                    setInputValidationState(text.inputEl, apiKeyState, {
                        valid,
                        message: valid ? "" : tr("API Key is required for connection tests and live AI requests"),
                    });
                });
                text.inputEl.type = "password";
                text.inputEl.style.width = "100%";
                const valid = !!this.draft.apiKey;
                setInputValidationState(text.inputEl, apiKeyState, {
                    valid,
                    message: valid ? "" : tr("API Key is required for connection tests and live AI requests"),
                });
            });

        new Setting(contentEl)
            .setName(tr("Capability Mode"))
            .setDesc(tr("Controls how thinking / reasoning fields are mapped into the request body"))
            .addDropdown((dropdown) => dropdown
                .addOption("openai-reasoning", `OpenAI-compatible (${getCapabilityModeLabel("openai-reasoning")})`)
                .addOption("thinking-config", `Compatible (${getCapabilityModeLabel("thinking-config")})`)
                .addOption("siliconflow-thinking", `SiliconFlow (${getCapabilityModeLabel("siliconflow-thinking")})`)
                .addOption("zhipu-thinking", `Zhipu / GLM (${getCapabilityModeLabel("zhipu-thinking")})`)
                .setValue(this.draft.capabilityMode)
                .onChange((value: AICapabilityMode) => {
                    this.draft.capabilityMode = value;
                }));

        new Setting(contentEl)
            .setName(tr("Custom Headers"))
            .setDesc(tr("One header per line, in the format Header-Name: value"))
            .addTextArea((text) => {
                text.setPlaceholder("HTTP-Referer: https://example.com")
                    .setValue(formatProviderHeadersText(this.draft.customHeaders))
                    .onChange((value) => {
                        const validation = validateHeaderLines(value);
                        setInputValidationState(text.inputEl, headersState, validation);
                        if (validation.valid) {
                            this.draft.customHeaders = parseProviderHeadersText(value);
                        }
                    });
                text.inputEl.rows = 6;
                text.inputEl.style.width = "100%";
                setInputValidationState(text.inputEl, headersState, validateHeaderLines(formatProviderHeadersText(this.draft.customHeaders)));
            });

        new Setting(contentEl)
            .addButton((button) => button
                .setButtonText(tr("Save"))
                .setCta()
                .onClick(async () => {
                    const baseUrlValid = isValidHttpUrl(this.draft.baseUrl);
                    const headersValidation = validateHeaderLines(formatProviderHeadersText(this.draft.customHeaders));
                    if (!baseUrlValid || !headersValidation.valid) {
                        new Notice(tr("Please fix the provider validation errors before saving"));
                        return;
                    }
                    this.draft = normalizeAIProviderConfig(this.draft);
                    await this.onSaveProvider(this.draft);
                    this.close();
                }))
            .addButton((button) => button
                .setButtonText(tr("Cancel"))
                .onClick(() => this.close()));
    }

    onClose() {
        this.contentEl.empty();
    }
}

class AIModelModal extends Modal {
    private draft: AIModelConfig;
    private readonly providers: AIProviderConfig[];
    private readonly buildPreviewAiSettings: (draft: AIModelConfig) => AISettingsV2;
    private readonly onSaveModel: (model: AIModelConfig) => Promise<void>;
    private modelInput?: TextComponent;

    private renderCustomParametersEditor(containerEl: HTMLElement) {
        const section = containerEl.createDiv({ cls: "ll-custom-params-editor" });
        const header = section.createDiv({ cls: "ll-custom-params-header" });
        header.createEl("div", { text: tr("Custom Parameters"), cls: "ll-custom-params-title" });
        header.createEl("div", {
            text: tr("Add request body fields without writing raw JSON. Reserved fields are still protected."),
            cls: "ll-custom-params-description",
        });

        const listEl = section.createDiv({ cls: "ll-custom-params-list" });

        const renderRows = () => {
            listEl.empty();

            if (this.draft.customParameters.length === 0) {
                listEl.createDiv({
                    cls: "ll-custom-params-empty",
                    text: tr("No custom parameters yet. Add one if your provider requires extra request fields."),
                });
                return;
            }

            this.draft.customParameters.forEach((parameter, index) => {
                const row = listEl.createDiv({ cls: "ll-custom-param-row" });

                const keySetting = new Setting(row)
                    .setName(tr("Key"))
                    .setDesc(tr("Request body field name"));
                keySetting.addText((text) => text
                    .setPlaceholder("foo")
                    .setValue(parameter.key)
                    .onChange((value) => {
                        this.draft.customParameters[index].key = value.trim();
                    }));

                const typeSetting = new Setting(row)
                    .setName(tr("Type"))
                    .setDesc(tr("Controls how the value is serialized"));
                typeSetting.addDropdown((dropdown) => dropdown
                    .addOption("text", tr("Text"))
                    .addOption("number", tr("Number"))
                    .addOption("boolean", tr("Boolean"))
                    .addOption("json", tr("JSON"))
                    .setValue(parameter.type)
                    .onChange((value: AICustomParameterType) => {
                        const current = this.draft.customParameters[index];
                        current.type = value;
                        current.value = normalizeCustomParameterValueForType(current.value, value);
                        renderRows();
                    }));

                if (parameter.type === "boolean") {
                    const valueSetting = new Setting(row)
                        .setName(tr("Value"))
                        .setDesc(tr("Boolean value"));
                    valueSetting.addToggle((toggle) => toggle
                        .setValue(Boolean(parameter.value))
                        .onChange((value) => {
                            this.draft.customParameters[index].value = value;
                        }));
                } else {
                    const valueSetting = new Setting(row)
                        .setName(tr("Value"))
                        .setDesc(parameter.type === "json" ? tr("JSON object or array text") : tr("Parameter value"));
                    valueSetting.addTextArea((text) => {
                        const validationState = row.createDiv({ cls: "ll-input-validation" });
                        const currentValue = parameter.type === "json"
                            ? String(parameter.value ?? "")
                            : String(parameter.value ?? "");
                        text.setValue(currentValue).onChange((value) => {
                            if (parameter.type === "number") {
                                this.draft.customParameters[index].value = Number(value || 0);
                            } else {
                                this.draft.customParameters[index].value = value;
                            }

                            if (parameter.type === "json") {
                                setInputValidationState(
                                    text.inputEl,
                                    validationState,
                                    validateJsonParameterValue(String(this.draft.customParameters[index].value ?? ""))
                                );
                            } else {
                                setInputValidationState(text.inputEl, validationState, { valid: true, message: "" });
                            }
                        });
                        text.inputEl.rows = parameter.type === "json" ? 4 : 2;
                        text.inputEl.style.width = "100%";
                        if (parameter.type === "json") {
                            setInputValidationState(text.inputEl, validationState, validateJsonParameterValue(currentValue));
                        }
                    });
                }

                const actions = row.createDiv({ cls: "ll-custom-param-actions" });
                const removeButton = new Setting(actions);
                removeButton.addButton((button) => button
                    .setWarning()
                    .setButtonText(tr("Remove"))
                    .onClick(() => {
                        this.draft.customParameters.splice(index, 1);
                        renderRows();
                    }));
            });
        };

        new Setting(section)
            .setName(tr("Add Parameter"))
            .setDesc(tr("Create a new custom parameter entry"))
            .addButton((button) => button
                .setButtonText(tr("Add"))
                .onClick(() => {
                    this.draft.customParameters.push(createEmptyCustomParameter());
                    renderRows();
                }));

        renderRows();
    }

    private validateCustomParameters(): { valid: boolean; message: string } {
        for (const parameter of this.draft.customParameters) {
            if (parameter.type !== "json") {
                continue;
            }

            const validation = validateJsonParameterValue(String(parameter.value ?? ""));
            if (!validation.valid) {
                return {
                    valid: false,
                    message: `${tr("Custom Parameters")}: ${parameter.key || tr("Unnamed parameter")} — ${validation.message}`,
                };
            }
        }

        return { valid: true, message: "" };
    }

    constructor(
        app: App,
        model: AIModelConfig,
        providers: AIProviderConfig[],
        buildPreviewAiSettings: (draft: AIModelConfig) => AISettingsV2,
        onSaveModel: (model: AIModelConfig) => Promise<void>
    ) {
        super(app);
        this.draft = {
            ...model,
            reasoning: { ...model.reasoning },
            thinking: { ...model.thinking },
            customParameters: [...model.customParameters],
        };
        this.providers = providers;
        this.buildPreviewAiSettings = buildPreviewAiSettings;
        this.onSaveModel = onSaveModel;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("ll-ai-modal");
        contentEl.createEl("h3", { text: tr("Edit Model") });
        createInfoCard(
            contentEl,
            tr("Models can override sampling, reasoning, thinking, and custom body parameters per scenario.")
        );
        const selectedProvider = this.providers.find((provider) => provider.id === this.draft.providerId);
        if (selectedProvider && !selectedProvider.enabled) {
            createInfoCard(
                contentEl,
                tr("This model belongs to a disabled provider. It will not be routable until that provider is enabled."),
                "warning"
            );
        }

        new Setting(contentEl)
            .setName(tr("Provider"))
            .addDropdown((dropdown) => {
                this.providers.forEach((provider) => {
                    dropdown.addOption(provider.id, getProviderDisplayName(provider));
                });
                dropdown.setValue(this.draft.providerId).onChange((value) => {
                    this.draft.providerId = value;
                    const provider = this.providers.find((item) => item.id === value);
                    const recommended = provider ? getRecommendedModelsForProvider(provider) : [];
                    if (!this.draft.model && recommended[0]) {
                        this.draft.model = recommended[0];
                        this.modelInput?.setValue(this.draft.model);
                    }
                });
            });

        new Setting(contentEl)
            .setName(tr("Recommended model"))
            .setDesc(tr("Choose a preset model to quickly fill the model name, or keep your custom value"))
            .addDropdown((dropdown) => {
                const provider = this.providers.find((item) => item.id === this.draft.providerId);
                dropdown.addOption("", tr("Keep current"));
                (provider ? getRecommendedModelsForProvider(provider) : []).forEach((modelName) => {
                    dropdown.addOption(modelName, modelName);
                });
                dropdown.setValue("").onChange((value) => {
                    if (!value) return;
                    this.draft.model = value;
                    if (!this.draft.name) {
                        this.draft.name = value;
                    }
                    this.modelInput?.setValue(value);
                });
            });

        new Setting(contentEl)
            .setName(t("Model Name"))
            .addText((text) => {
                this.modelInput = text;
                text.setPlaceholder("gpt-4o-mini")
                    .setValue(this.draft.model)
                    .onChange((value) => {
                        this.draft.model = value.trim();
                    });
                text.inputEl.style.width = "100%";
            });

        new Setting(contentEl)
            .setName(tr("Display Name"))
            .addText((text) => text
                .setValue(this.draft.name)
                .onChange((value) => {
                    this.draft.name = value.trim();
                }));

        new Setting(contentEl)
            .setName(tr("Enabled"))
            .addToggle((toggle) => toggle
                .setValue(this.draft.enabled)
                .onChange((value) => {
                    this.draft.enabled = value;
                }));

        new Setting(contentEl)
            .setName(tr("Temperature"))
            .addText((text) => text
                .setPlaceholder("0.3")
                .setValue(formatOptionalNumber(this.draft.temperature))
                .onChange((value) => {
                    this.draft.temperature = parseOptionalNumber(value);
                }));

        new Setting(contentEl)
            .setName(tr("Top P"))
            .addText((text) => text
                .setPlaceholder("1")
                .setValue(formatOptionalNumber(this.draft.topP))
                .onChange((value) => {
                    this.draft.topP = parseOptionalNumber(value);
                }));

        new Setting(contentEl)
            .setName(tr("Max Output Tokens"))
            .addText((text) => text
                .setPlaceholder("200")
                .setValue(formatOptionalNumber(this.draft.maxOutputTokens))
                .onChange((value) => {
                    this.draft.maxOutputTokens = parseOptionalNumber(value);
                }));

        new Setting(contentEl)
            .setName(tr("Reasoning"))
            .setDesc(tr("Enable reasoning effort fields for compatible providers"))
            .addToggle((toggle) => toggle
                .setValue(this.draft.reasoning.enabled)
                .onChange((value) => {
                    this.draft.reasoning.enabled = value;
                }))
            .addDropdown((dropdown) => dropdown
                .addOption("low", tr("Low"))
                .addOption("medium", tr("Medium"))
                .addOption("high", tr("High"))
                .setValue(this.draft.reasoning.reasoningEffort)
                .onChange((value: "low" | "medium" | "high") => {
                    this.draft.reasoning.reasoningEffort = value;
                }));

        new Setting(contentEl)
            .setName(tr("Thinking"))
            .setDesc(tr("Enable provider-specific thinking fields"))
            .addToggle((toggle) => toggle
                .setValue(this.draft.thinking.enabled)
                .onChange((value) => {
                    this.draft.thinking.enabled = value;
                }));

        new Setting(contentEl)
            .setName(tr("Thinking budget tokens"))
            .addText((text) => text
                .setPlaceholder("Optional")
                .setValue(formatOptionalNumber(this.draft.thinking.budgetTokens))
                .onChange((value) => {
                    this.draft.thinking.budgetTokens = parseOptionalNumber(value);
                }));

        new Setting(contentEl)
            .setName(tr("Thinking budget"))
            .addText((text) => text
                .setPlaceholder("Optional")
                .setValue(formatOptionalNumber(this.draft.thinking.thinkingBudget))
                .onChange((value) => {
                    this.draft.thinking.thinkingBudget = parseOptionalNumber(value);
                }));

        this.renderCustomParametersEditor(contentEl);

        new Setting(contentEl)
            .setName(t("Test Connection"))
            .setDesc(tr("Test the current provider + model with a minimal request"))
            .addButton((button) => button
                .setButtonText(t("Test"))
                .onClick(async () => {
                    button.setButtonText(t("Testing..."));
                    button.setDisabled(true);
                    try {
                        const normalizedDraft = normalizeAIModelConfig(this.draft);
                        const previewSettings = this.buildPreviewAiSettings(normalizedDraft);
                        await testModelConnection({ ai: previewSettings }, normalizedDraft.id);
                        new Notice(t("Connection successful!"));
                    } catch (error: any) {
                        new Notice(error?.message || t("Connection failed"));
                    } finally {
                        button.setButtonText(t("Test"));
                        button.setDisabled(false);
                    }
                }));

        new Setting(contentEl)
            .addButton((button) => button
                .setButtonText(tr("Save"))
                .setCta()
                .onClick(async () => {
                    const customParameterValidation = this.validateCustomParameters();
                    if (!customParameterValidation.valid) {
                        new Notice(customParameterValidation.message);
                        return;
                    }
                    this.draft = normalizeAIModelConfig(this.draft);
                    await this.onSaveModel(this.draft);
                    this.close();
                }))
            .addButton((button) => button
                .setButtonText(tr("Cancel"))
                .onClick(() => this.close()));
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class SettingTab extends PluginSettingTab {
    plugin: LanguageLearner;
    private activeTab: string;

    constructor(app: App, plugin: LanguageLearner) {
        super(app, plugin);
        this.plugin = plugin;
        this.activeTab = plugin.settings.activeTab || "general";
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        // Add custom CSS
        this.addStyles(containerEl);

        // Main Container
        const mainContainer = containerEl.createDiv({ cls: "ll-settings-container" });

        // Title
        const header = mainContainer.createDiv({ cls: "ll-settings-header" });
        header.createEl("h1", { text: t("Language Learner") });
        header.createEl("p", { text: t("Make language learning an integral part of your knowledge base."), cls: "ll-settings-subtitle" });

        // Create tab container
        const tabContainer = mainContainer.createDiv({ cls: "ll-tab-container" });

        // Create tab headers
        const tabHeaders = tabContainer.createDiv({ cls: "ll-tab-headers" });
        this.createTabHeader(tabHeaders, "general", t("General"));
        this.createTabHeader(tabHeaders, "dictionaries", t("Dictionaries"));
        this.createTabHeader(tabHeaders, "database", t("Database"));
        this.createTabHeader(tabHeaders, "reading", t("Reading"));
        this.createTabHeader(tabHeaders, "ai", t("AI & Advanced"));

        // Create tab contents wrapper for card effect
        const contentWrapper = tabContainer.createDiv({ cls: "ll-content-wrapper" });
        const tabContents = contentWrapper.createDiv({ cls: "ll-tab-contents" });

        // Tab 1: General
        const generalTab = tabContents.createDiv({ cls: "ll-tab-content", attr: { "data-tab": "general" } });
        this.langSettings(generalTab);
        this.queryGeneralSettings(generalTab);
        this.configSettings(generalTab);

        // Tab 2: Dictionaries
        const dictsTab = tabContents.createDiv({ cls: "ll-tab-content", attr: { "data-tab": "dictionaries" } });
        this.dictionarySettings(dictsTab);

        // Tab 3: Database
        const dbTab = tabContents.createDiv({ cls: "ll-tab-content", attr: { "data-tab": "database" } });
        // Backend server feature removed
        this.indexedDBSettings(dbTab);
        this.textDBSettings(dbTab);
        this.fileDBSettings(dbTab);

        // Tab 4: Reading
        const readingTab = tabContents.createDiv({ cls: "ll-tab-content", attr: { "data-tab": "reading" } });
        this.readingSettings(readingTab);

        // Tab 5: AI & Advanced
        const aiTab = tabContents.createDiv({ cls: "ll-tab-content", attr: { "data-tab": "ai" } });
        this.aiSettings(aiTab);
        this.completionSettings(aiTab);
        this.reviewSettings(aiTab);
        // Self-server feature removed

        // Show active tab
        this.switchTab(this.activeTab);
    }

    private createTabHeader(container: HTMLElement, id: string, label: string, caption = "") {
        const tab = container.createDiv({ cls: "ll-tab-header" });
        const enSpan = tab.createSpan({ cls: "ll-tab-en" });
        enSpan.textContent = label;
        const zhSpan = tab.createSpan({ cls: "ll-tab-zh" });
        zhSpan.textContent = caption;

        tab.dataset.tab = id;

        tab.addEventListener("click", () => {
            this.switchTab(id);
        });
    }

    private switchTab(tabId: string) {
        this.activeTab = tabId;
        this.plugin.settings.activeTab = tabId;
        this.plugin.saveSettings();

        // Update headers
        const headers = this.containerEl.querySelectorAll(".ll-tab-header");
        headers.forEach(header => {
            if ((header as HTMLElement).dataset.tab === tabId) {
                header.addClass("active");
            } else {
                header.removeClass("active");
            }
        });

        // Update contents
        const contents = this.containerEl.querySelectorAll(".ll-tab-content");
        contents.forEach(content => {
            if ((content as HTMLElement).dataset.tab === tabId) {
                (content as HTMLElement).style.display = "block";
                (content as HTMLElement).addClass("active");
            } else {
                (content as HTMLElement).style.display = "none";
                (content as HTMLElement).removeClass("active");
            }
        });
    }

    private addStyles(containerEl: HTMLElement) {
        // CSS is now loaded from external file via import
        // Just ensure the container has proper class for styling
        containerEl.addClass("ll-settings-root");
    }

    aiSettings(containerEl: HTMLElement) {
        containerEl.createEl("h3", { text: t("AI Settings") });

        const ai = this.plugin.settings.ai;
        const availableModels = getAvailableAIModels(ai);
        const latestLog = getLatestAIDebugLog();
        const debugLogs = getAIDebugLogs();

        const refresh = async () => {
            this.plugin.settings.ai = normalizeAISettings(this.plugin.settings.ai);
            await this.plugin.saveSettings();
            this.display();
        };

        createInfoCard(
            containerEl,
            [
                `${tr("Providers")}: ${ai.providers.length}`,
                `${tr("Models")}: ${ai.models.length}`,
                `${tr("Available models")}: ${availableModels.length}`,
                `${tr("Default Model")}: ${summarizeRoutingTarget(ai, ai.routing.defaultModelId)}`,
            ].join("  •  ")
        );

        if (availableModels.length === 0) {
            createInfoCard(
                containerEl,
                tr("No enabled model is currently routable. Enable at least one provider and one model before using AI features."),
                "warning"
            );
        }

        const providersSection = createAISection(
            containerEl,
            tr("Providers"),
            tr("Manage API endpoints, credentials, headers, and provider-specific capability mapping.")
        );

        ai.providers.forEach((provider) => {
            const presetMeta = provider.preset !== "custom" ? AI_PROVIDER_PRESET_META[provider.preset] : null;
            const providerModelCount = getProviderModelCount(ai, provider.id);
            const providerRoutingUsage = getProviderRoutingSummary(ai, provider.id);
            const setting = new Setting(providersSection)
                .setName(getProviderDisplayName(provider))
                .setDesc([
                    provider.enabled ? tr("Enabled") : tr("Disabled"),
                    provider.baseUrl || tr("No Base URL"),
                    presetMeta ? `Preset: ${presetMeta.label}` : tr("Custom provider"),
                    `${tr("Models")}: ${providerModelCount}`,
                    providerRoutingUsage.length ? `${tr("Routes")}: ${providerRoutingUsage.join("/")}` : "",
                    `Capability: ${getCapabilityModeLabel(provider.capabilityMode)}`,
                ].filter(Boolean).join(" • "))
                .addToggle((toggle) => toggle
                    .setValue(provider.enabled)
                    .onChange(async (value) => {
                        provider.enabled = value;
                        await refresh();
                    }))
                .addButton((button) => button
                    .setButtonText(tr("Edit"))
                    .onClick(() => {
                        new AIProviderModal(this.app, provider, async (nextProvider) => {
                            const index = this.plugin.settings.ai.providers.findIndex((item) => item.id === provider.id);
                            if (index >= 0) {
                                this.plugin.settings.ai.providers[index] = nextProvider;
                            }
                            await refresh();
                        }).open();
                    }));
            addSettingBadges(setting, [
                ...(provider.enabled ? [{ label: tr("Enabled"), tone: "accent" as const }] : [{ label: tr("Disabled"), tone: "muted" as const }]),
                ...(providerRoutingUsage.length ? providerRoutingUsage.map((usage) => ({ label: usage, tone: "warning" as const })) : []),
            ]);
            if (providerRoutingUsage.length || ai.routing.defaultModelId && ai.models.some((model) => model.providerId === provider.id && ai.routing.defaultModelId === model.id)) {
                setting.settingEl.addClass("ll-setting-highlight");
            }
            if (!isBuiltinProvider(provider)) {
                setting.addExtraButton((button) => button
                    .setIcon("trash")
                    .setTooltip(tr("Delete"))
                    .onClick(async () => {
                        new WarningModal(
                            this.app,
                            describeProviderDeletionImpact(this.plugin.settings.ai, provider),
                            async () => {
                                this.plugin.settings.ai.providers = this.plugin.settings.ai.providers.filter((item) => item.id !== provider.id);
                                this.plugin.settings.ai.models = this.plugin.settings.ai.models.filter((model) => model.providerId !== provider.id);
                                await refresh();
                            }
                        ).open();
                    }));
            }
        });

        new Setting(providersSection)
            .setName(tr("Add Custom Provider"))
            .setDesc(tr("Create an additional OpenAI-compatible provider entry"))
            .addButton((button) => button
                .setButtonText(tr("Add"))
                .onClick(() => {
                    const provider = normalizeAIProviderConfig({
                        id: createCustomProviderId(this.plugin.settings.ai.providers.map((item) => item.id)),
                        preset: "custom",
                        label: "Custom",
                        enabled: true,
                        baseUrl: "",
                        apiKey: "",
                        customHeaders: [],
                        capabilityMode: "openai-reasoning",
                    });
                    new AIProviderModal(this.app, provider, async (nextProvider) => {
                        this.plugin.settings.ai.providers.push(nextProvider);
                        await refresh();
                    }).open();
                }));

        const modelsSection = createAISection(
            containerEl,
            tr("Models"),
            tr("Each model binds to a provider and can override temperature, top-p, token limits, thinking, reasoning, and custom parameters.")
        );
        ai.models.forEach((model) => {
            const provider = findAIProvider(ai, model.providerId);
            const routingUsages = getModelRoutingUsages(ai, model);
            const setting = new Setting(modelsSection)
                .setName(getModelDisplayName(model))
                .setDesc([
                    provider ? getProviderDisplayName(provider) : tr("Unknown provider"),
                    model.model,
                    model.enabled ? tr("Enabled") : tr("Disabled"),
                    routingUsages.length ? `${tr("In use")}: ${routingUsages.join("/")}` : tr("Not routed"),
                ].join(" • "))
                .addToggle((toggle) => toggle
                    .setValue(model.enabled)
                    .onChange(async (value) => {
                        model.enabled = value;
                        await refresh();
                    }))
                .addButton((button) => button
                    .setButtonText(tr("Edit"))
                    .onClick(() => {
                        new AIModelModal(
                            this.app,
                            model,
                            this.plugin.settings.ai.providers,
                            (draft) => {
                                const nextAi = normalizeAISettings({
                                    ...this.plugin.settings.ai,
                                    models: this.plugin.settings.ai.models.map((item) => item.id === model.id ? draft : item),
                                });
                                return nextAi;
                            },
                            async (nextModel) => {
                                const index = this.plugin.settings.ai.models.findIndex((item) => item.id === model.id);
                                if (index >= 0) {
                                    this.plugin.settings.ai.models[index] = nextModel;
                                }
                                await refresh();
                            }
                        ).open();
                    }))
                .addExtraButton((button) => button
                    .setIcon("trash")
                    .setTooltip(tr("Delete"))
                    .onClick(async () => {
                        new WarningModal(
                            this.app,
                            describeModelDeletionImpact(this.plugin.settings.ai, model),
                            async () => {
                                this.plugin.settings.ai.models = this.plugin.settings.ai.models.filter((item) => item.id !== model.id);
                                await refresh();
                            }
                        ).open();
                    }));
            addSettingBadges(setting, [
                ...(routingUsages.length
                    ? routingUsages.map((usage) => ({ label: usage, tone: usage === tr("Default") ? "accent" as const : "warning" as const }))
                    : [{ label: tr("Unused"), tone: "muted" as const }]),
                ...(model.enabled ? [] : [{ label: tr("Disabled"), tone: "muted" as const }]),
            ]);
            if (routingUsages.length) {
                setting.settingEl.addClass("ll-setting-highlight");
            }
        });

        new Setting(modelsSection)
            .setName(tr("Add Model"))
            .setDesc(tr("Add a model bound to one of the configured providers"))
            .addButton((button) => button
                .setButtonText(tr("Add"))
                .onClick(() => {
                    const defaultProviderId = this.plugin.settings.ai.providers[0]?.id || "openai";
                    const provider = findAIProvider(this.plugin.settings.ai, defaultProviderId);
                    const recommendedModel = provider ? getRecommendedModelsForProvider(provider)[0] : "gpt-4o-mini";
                    const nextModel = createModelConfig(
                        defaultProviderId,
                        recommendedModel || "gpt-4o-mini",
                        {},
                        this.plugin.settings.ai.models.map((item) => item.id)
                    );
                    nextModel.id = "";

                    new AIModelModal(
                        this.app,
                        nextModel,
                        this.plugin.settings.ai.providers,
                        (draft) => normalizeAISettings({
                            ...this.plugin.settings.ai,
                            models: [...this.plugin.settings.ai.models, draft],
                        }),
                        async (draft) => {
                            const normalized = normalizeAIModelConfig(
                                draft,
                                this.plugin.settings.ai.models.map((item) => item.id)
                            );
                            this.plugin.settings.ai.models.push(normalized);
                            await refresh();
                        }
                    ).open();
                }));

        const routingSection = createAISection(
            containerEl,
            tr("Routing"),
            tr("Choose one global default model and optional overrides for search, translation, and card autofill.")
        );
        const addModelOptions = (
            dropdown: import("obsidian").DropdownComponent,
            includeFollowDefault = false
        ) => {
            if (includeFollowDefault) {
                dropdown.addOption("", tr("Follow default"));
            }
            availableModels.forEach((model) => {
                const provider = findAIProvider(this.plugin.settings.ai, model.providerId);
                dropdown.addOption(model.id, `${getModelDisplayName(model)} (${provider ? getProviderDisplayName(provider) : model.providerId})`);
            });
        };

        createInfoCard(
            routingSection,
            [
                `${tr("Search Model")}: ${summarizeRoutingTarget(ai, ai.routing.searchModelId)}`,
                `${tr("Translate Model")}: ${summarizeRoutingTarget(ai, ai.routing.translateModelId)}`,
                `${tr("Card Model")}: ${summarizeRoutingTarget(ai, ai.routing.cardModelId)}`,
            ].join("  •  ")
        );

        new Setting(routingSection)
            .setName(tr("Default Model"))
            .setDesc(tr("Fallback model used when a scene-specific override is not available"))
            .addDropdown((dropdown) => {
                addModelOptions(dropdown);
                dropdown.setValue(this.plugin.settings.ai.routing.defaultModelId)
                    .onChange(async (value) => {
                        this.plugin.settings.ai.routing.defaultModelId = value;
                        await refresh();
                    });
            });

        new Setting(routingSection)
            .setName(tr("Search Model"))
            .setDesc(`${tr("Current")}: ${summarizeRoutingTarget(ai, ai.routing.searchModelId)}`)
            .addDropdown((dropdown) => {
                addModelOptions(dropdown, true);
                dropdown.setValue(this.plugin.settings.ai.routing.searchModelId)
                    .onChange(async (value) => {
                        this.plugin.settings.ai.routing.searchModelId = value;
                        await refresh();
                    });
            });

        new Setting(routingSection)
            .setName(tr("Translate Model"))
            .setDesc(`${tr("Current")}: ${summarizeRoutingTarget(ai, ai.routing.translateModelId)}`)
            .addDropdown((dropdown) => {
                addModelOptions(dropdown, true);
                dropdown.setValue(this.plugin.settings.ai.routing.translateModelId)
                    .onChange(async (value) => {
                        this.plugin.settings.ai.routing.translateModelId = value;
                        await refresh();
                    });
            });

        new Setting(routingSection)
            .setName(tr("Card Model"))
            .setDesc(`${tr("Current")}: ${summarizeRoutingTarget(ai, ai.routing.cardModelId)}`)
            .addDropdown((dropdown) => {
                addModelOptions(dropdown, true);
                dropdown.setValue(this.plugin.settings.ai.routing.cardModelId)
                    .onChange(async (value) => {
                        this.plugin.settings.ai.routing.cardModelId = value;
                        await refresh();
                    });
            });

        const promptsSection = createAISection(
            containerEl,
            tr("Prompts"),
            tr("Prompts stay scene-based, not per-model. Keep {sentence} in the translation prompt if you want sentence substitution.")
        );
        new Setting(promptsSection)
            .setName(tr("Search Prompt"))
            .setDesc(tr("Prompt used for normal AI dictionary lookups"))
            .addTextArea((text) => text
                .setValue(this.plugin.settings.ai.prompts.search)
                .onChange(async (value) => {
                    this.plugin.settings.ai.prompts.search = value;
                    await refresh();
                }));

        new Setting(promptsSection)
            .setName(tr("Context Search Prompt"))
            .setDesc(tr("Prompt used when sentence context is available"))
            .addTextArea((text) => text
                .setValue(this.plugin.settings.ai.prompts.contextSearch)
                .onChange(async (value) => {
                    this.plugin.settings.ai.prompts.contextSearch = value;
                    await refresh();
                }));

        new Setting(promptsSection)
            .setName(t("Translation Prompt"))
            .setDesc(tr("Use {sentence} as the placeholder"))
            .addTextArea((text) => text
                .setValue(this.plugin.settings.ai.prompts.translate)
                .onChange(async (value) => {
                    this.plugin.settings.ai.prompts.translate = value;
                    await refresh();
                }));

        new Setting(promptsSection)
            .setName(tr("Card Prompt"))
            .setDesc(tr("Prompt used for AI card autofill JSON output"))
            .addTextArea((text) => text
                .setValue(this.plugin.settings.ai.prompts.card)
                .onChange(async (value) => {
                    this.plugin.settings.ai.prompts.card = value;
                    await refresh();
                }));

        const autofillSection = createAISection(
            containerEl,
            tr("AI Autofill Settings"),
            tr("Control which fields AI card autofill writes, and whether it runs manually, automatically, or both.")
        );
        const autofillSettings = this.plugin.settings.ai_autofill;
        const autofillFieldMeta: Array<{
            key: AIAutofillFieldKey;
            label: string;
            strategyLabel: string;
            description: string;
            allowedWriteModes: AIAutofillWriteMode[];
        }> = [
            {
                key: "meaning",
                label: tr("Meaning"),
                strategyLabel: tr("Meaning Strategy"),
                description: tr("Control when and how AI writes the meaning field"),
                allowedWriteModes: ["fill-empty", "overwrite"],
            },
            {
                key: "aliases",
                label: tr("aliases"),
                strategyLabel: tr("Aliases Strategy"),
                description: tr("Control when and how AI writes aliases / inflections"),
                allowedWriteModes: ["fill-empty", "merge", "overwrite"],
            },
            {
                key: "tags",
                label: tr("Tags"),
                strategyLabel: tr("Tags Strategy"),
                description: tr("Control when and how AI writes suggested tags"),
                allowedWriteModes: ["merge", "overwrite"],
            },
            {
                key: "notes",
                label: tr("Notes"),
                strategyLabel: tr("Notes Strategy"),
                description: tr("Control when and how AI writes study notes"),
                allowedWriteModes: ["merge", "overwrite"],
            },
        ];
        const fieldSummaries = autofillFieldMeta.map(({ key, label }) => {
            const strategy = autofillSettings.fields[key];
            return `${label}: ${getAIAutofillTriggerLabel(strategy.triggerMode)} / ${getAIAutofillWriteModeLabel(strategy.writeMode)}`;
        });
        const saveAutofillSettings = async (redisplay = false) => {
            this.plugin.settings.ai_autofill = normalizeAIAutofillSettings(this.plugin.settings.ai_autofill);
            await this.plugin.saveSettings();
            window.dispatchEvent(new CustomEvent("obsidian-langr-ai-autofill-settings-change"));
            if (redisplay) {
                this.display();
            }
        };

        createInfoCard(
            autofillSection,
            fieldSummaries.join("  •  ")
        );
        createInfoCard(
            autofillSection,
            tr("Tip: if you want AI to take over meaning generation, set Meaning Autofill to Disable in General settings."),
            "warning"
        );
        autofillFieldMeta.forEach(({ key, strategyLabel, description, allowedWriteModes }) => {
            new Setting(autofillSection)
                .setName(strategyLabel)
                .setDesc(description)
                .addDropdown((dropdown) => dropdown
                    .addOption("off", tr("Disabled"))
                    .addOption("manual", tr("Manual only"))
                    .addOption("auto", tr("Auto"))
                    .addOption("manual-and-auto", tr("Auto + Manual button"))
                    .setValue(autofillSettings.fields[key].triggerMode)
                    .onChange(async (value: AIAutofillTriggerMode) => {
                        this.plugin.settings.ai_autofill.fields[key].triggerMode = value;
                        await saveAutofillSettings(true);
                    }))
                .addDropdown((dropdown) => {
                    allowedWriteModes.forEach((mode) => {
                        dropdown.addOption(mode, getAIAutofillWriteModeLabel(mode));
                    });
                    dropdown.setValue(autofillSettings.fields[key].writeMode)
                        .onChange(async (value: AIAutofillWriteMode) => {
                            this.plugin.settings.ai_autofill.fields[key].writeMode = value;
                            await saveAutofillSettings(true);
                        });
                });
        });

        const connectionSection = createAISection(
            containerEl,
            tr("Connection Test"),
            tr("Connection tests are run from each model editor so the selected provider and model are always tested together.")
        );
        createInfoCard(
            connectionSection,
            tr("Tip: if a model fails to connect, first verify the provider Base URL, API Key, and capability mode before changing prompts."),
            "warning"
        );

        const diagnosticsSection = createAISection(
            containerEl,
            tr("AI Diagnostics"),
            tr("Use this panel to inspect the latest in-memory AI request log when AI dictionary search, AI sentence translation, or AI card autofill appears to do nothing.")
        );

        createInfoCard(
            diagnosticsSection,
            latestLog
                ? [
                    `${tr("Latest")}: ${latestLog.phase}`,
                    `${tr("Scenario")}: ${latestLog.scenario}`,
                    `${tr("Provider")}: ${latestLog.providerLabel}`,
                    `${tr("Model")}: ${latestLog.modelName}`,
                    latestLog.status != null ? `${tr("Status")}: ${latestLog.status}` : "",
                ].filter(Boolean).join("  •  ")
                : tr("No AI debug log yet")
        );

        new Setting(diagnosticsSection)
            .setName(tr("Latest diagnostic log"))
            .setDesc(
                latestLog
                    ? tr("Copy the latest request and response snapshot for troubleshooting.")
                    : tr("No AI request has been recorded in this session yet.")
            )
            .addButton((button) => button
                .setButtonText(tr("Copy latest log"))
                .setDisabled(!latestLog)
                .onClick(async () => {
                    await navigator.clipboard.writeText(formatAIDebugLog(getLatestAIDebugLog()));
                    new Notice(tr("Copied to clipboard"));
                }))
            .addButton((button) => button
                .setButtonText(tr("Copy all logs"))
                .setDisabled(debugLogs.length === 0)
                .onClick(async () => {
                    const content = getAIDebugLogs()
                        .map((entry) => formatAIDebugLog(entry))
                        .join("\n\n----------------\n\n");
                    await navigator.clipboard.writeText(content || tr("No AI debug log yet"));
                    new Notice(tr("Copied to clipboard"));
                }))
            .addButton((button) => button
                .setButtonText(tr("Clear logs"))
                .setDisabled(debugLogs.length === 0)
                .onClick(() => {
                    clearAIDebugLogs();
                    new Notice(tr("AI debug logs cleared"));
                    this.display();
                }))
            .addButton((button) => button
                .setButtonText(tr("Refresh"))
                .onClick(() => this.display()));

        const logPreview = diagnosticsSection.createEl("pre", {
            cls: "ll-ai-debug-log-preview",
            text: formatAIDebugLog(latestLog),
        });
        if (!latestLog) {
            logPreview.addClass("is-empty");
        }
    }

    // Backend server feature removed

    langSettings(containerEl: HTMLElement) {
        containerEl.createEl("h3", { text: t("Language") });

        new Setting(containerEl)
            .setName(t("Interface Language"))
            .setDesc(t("Changes apply immediately to open plugin panels."))
            .addDropdown(dropdown => dropdown
                .addOption("zh", "中文")
                .addOption("en", "English")
                .setValue(this.plugin.settings.ui_language === "zh-TW" ? "zh" : this.plugin.settings.ui_language)
                .onChange(async (value: UiLanguage | "zh") => {
                    this.plugin.applyUiLanguage(value);
                    await this.plugin.saveSettings();
                    this.display();
                })
            );

        new Setting(containerEl)
            .setName(t("Native"))
            .addDropdown(native => native
                .addOption("zh", t("Chinese"))
                .addOption("en", t("English"))
                .addOption("ja", t("Japanese"))
                .addOption("ko", t("Korean"))
                .addOption("fr", t("French"))
                .addOption("de", t("Deutsch"))
                .addOption("es", t("Spanish"))
                .setValue(this.plugin.settings.native)
                .onChange(async (value) => {
                    this.plugin.settings.native = value;
                    await this.plugin.saveSettings();
                    this.display();
                })
            );

        new Setting(containerEl)
            .setName(t("Foreign"))
            .addDropdown(foreign => foreign
                .addOption("en", t("English"))
                .addOption("jp", t("Japanese"))
                .addOption("kr", t("Korean"))
                .addOption("fr", t("French"))
                .addOption("de", t("Deutsch"))
                .addOption("es", t("Spanish"))
                .setValue(this.plugin.settings.foreign)
                .onChange(async (value) => {
                    this.plugin.settings.foreign = value;
                    await this.plugin.saveSettings();
                    this.display();
                })
            );

    }

    queryGeneralSettings(containerEl: HTMLElement) {
        containerEl.createEl("h3", { text: t("Translate") });

        new Setting(containerEl)
            .setName(t("Popup Search Panel"))
            .setDesc(t("Use a popup search panel"))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.popup_search)
                .onChange(async (value) => {
                    this.plugin.settings.popup_search = value;
                    this.plugin.store.popupSearch = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("Auto pronounce"))
            .setDesc(t("Auto pronounce when searching"))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.auto_pron)
                .onChange(async (value) => {
                    this.plugin.settings.auto_pron = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("Word Select"))
            .setDesc(t("Press function key and select text to translate"))
            .addDropdown(funcKey => funcKey
                .addOption("ctrlKey", "Ctrl")
                .addOption("altKey", "Alt")
                .addOption("metaKey", "Meta")
                .addOption("disable", t("Disable"))
                .setValue(this.plugin.settings.function_key)
                .onChange(async (value: "ctrlKey" | "altKey" | "metaKey" | "disable") => {
                    this.plugin.settings.function_key = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("Meaning Autofill"))
            .setDesc(t("Choose how the meaning field is auto-filled when searching"))
            .addDropdown(dropdown => dropdown
                .addOption("off", t("Disable"))
                .addOption("context-translation", t("Closest context translation"))
                .addOption("youdao-basic", t("Dictionary POS summary"))
                .addOption("context-pos", t("Context-selected POS"))
                .setValue(this.plugin.settings.meaning_autofill_mode)
                .onChange(async (value: MeaningAutofillMode) => {
                    this.plugin.settings.meaning_autofill_mode = value;
                    await this.plugin.saveSettings();
                })
            );
    }

    configSettings(containerEl: HTMLElement) {
        containerEl.createEl("h3", { text: t("Configuration Management") });

        new Setting(containerEl)
            .setName(t("Export Settings"))
            .setDesc(t("Export current settings to a JSON file"))
            .addButton(button => button
                .setButtonText(t("Export"))
                .onClick(() => {
                    const data = JSON.stringify(this.plugin.settings, null, 2);
                    const blob = new Blob([data], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'language-learner-settings.json';
                    a.click();
                    URL.revokeObjectURL(url);
                }));

        new Setting(containerEl)
            .setName(t("Import Settings"))
            .setDesc(t("Import settings from a JSON file"))
            .addButton(button => button
                .setButtonText(t("Import"))
                .onClick(() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.json';
                    input.onchange = async (e: any) => {
                        const file = e.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = async (e) => {
                                try {
                                    const content = e.target?.result as string;
                                    const settings = normalizeSettings({
                                        ...this.plugin.settings,
                                        ...JSON.parse(content),
                                    });
                                    this.plugin.settings = settings;
                                    this.plugin.applyUiLanguage(this.plugin.settings.ui_language);
                                    await this.plugin.saveSettings();
                                    new Notice(t("Settings imported successfully!"));
                                    this.display();
                                } catch (error) {
                                    new Notice(t("Failed to import settings: Invalid JSON"));
                                    console.error('Import failed:', error);
                                }
                            };
                            reader.readAsText(file);
                        }
                    };
                    input.click();
                }));
    }

    dictionarySettings(containerEl: HTMLElement) {
        containerEl.createEl("h3", { text: t("Dictionaries") });

        let createDictSetting = (id: string, name: string, description: string) => {
            new Setting(containerEl)
                .setName(name)
                .setDesc(description)
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.dictionaries[id].enable)
                    .onChange((value) => {
                        this.plugin.settings.dictionaries[id].enable = value;
                        this.plugin.store.dictsChange = !this.plugin.store.dictsChange;
                        this.plugin.saveSettings();
                    }))
                .addDropdown(num => num
                    .addOption("1", "1")
                    .addOption("2", "2")
                    .addOption("3", "3")
                    .addOption("4", "4")
                    .addOption("5", "5")
                    .addOption("6", "6")
                    .addOption("7", "7")
                    .addOption("8", "8")
                    .addOption("9", "9")
                    .addOption("10", "10")
                    .setValue(this.plugin.settings.dictionaries[id].priority.toString())
                    .onChange(async (value: string) => {
                        this.plugin.settings.dictionaries[id].priority = parseInt(value);
                        this.plugin.store.dictsChange = !this.plugin.store.dictsChange;
                        await this.plugin.saveSettings();
                    })
                );
        };

        Object.keys(dicts).forEach((dict: keyof typeof dicts) => {
            createDictSetting(
                dict,
                t(dicts[dict].nameKey),
                t(dicts[dict].descriptionKey)
            );
        });

        new Setting(containerEl)
            .setName(t("Dictionary Height"))
            .addText(text => text
                .setValue(this.plugin.settings.dict_height)
                .onChange(debounce(async (value) => {
                    this.plugin.settings.dict_height = value;
                    store.dictHeight = value;
                    await this.plugin.saveSettings();
                }, 500))
            );
    }


    indexedDBSettings(containerEl: HTMLElement) {
        // Backend server removed - always show IndexedDB settings
        containerEl.createEl("h3", { text: t("IndexDB Database") });

        new Setting(containerEl)
            .setName(t("Database Name"))
            .setDesc(t("Reopen DB after changing database name"))
            .addText(text => text
                .setValue(this.plugin.settings.db_name)
                .onChange(debounce(async (name) => {
                    this.plugin.settings.db_name = name;
                    this.plugin.saveSettings();
                }, 1000, true))
            )
            .addButton(button => button
                .setButtonText(t("Reopen"))
                .onClick(async () => {
                    this.plugin.db.close();
                    this.plugin.db = new LocalDb(this.plugin);
                    await this.plugin.db.open();
                    new Notice(t("Database reopened"));
                })
            );


        // 导入导出数据库
        new Setting(containerEl)
            .setName(t("Import & Export"))
            .setDesc(t("Warning: Import will override current database"))
            .addButton(button => button
                .setButtonText(t("Import"))
                .onClick(async () => {
                    let modal = new OpenFileModal(this.plugin.app, async (file: File) => {
                        // let fr = new FileReader()
                        // fr.onload = async () => {
                        // let data = JSON.parse(fr.result as string)
                        await this.plugin.db.importDB(file);
                        new Notice(t("Imported"));
                        // }
                        // fr.readAsText(file)
                    });
                    modal.open();
                })
            )

            .addButton(button => button
                .setButtonText(t("Export"))
                .onClick(async () => {
                    await this.plugin.db.exportDB();
                    new Notice(t("Exported"));
                })
            );
        // 获取所有非无视单词
        new Setting(containerEl)
            .setName(t("Get all non-ignores"))
            .addButton(button => button
                .setButtonText(t("Export Word"))
                .onClick(async () => {
                    let words = await this.plugin.db.getAllExpressionSimple(true);
                    let ignores = words.filter(w => (w.status !== 0 && w.t !== "PHRASE")).map(w => w.expression);
                    await navigator.clipboard.writeText(ignores.join("\n"));
                    new Notice(t("Copied to clipboard"));
                }))
            .addButton(button => button
                .setButtonText(t("Export Word and Phrase"))
                .onClick(async () => {
                    let words = await this.plugin.db.getAllExpressionSimple(true);
                    let ignores = words.filter(w => w.status !== 0).map(w => w.expression);
                    await navigator.clipboard.writeText(ignores.join("\n"));
                    new Notice(t("Copied to clipboard"));
                })
            );

        // 获取所有无视单词
        new Setting(containerEl)
            .setName(t("Get all ignores"))
            .addButton(button => button
                .setButtonText(t("Export"))
                .onClick(async () => {
                    let words = await this.plugin.db.getAllExpressionSimple(true);
                    let ignores = words.filter(w => w.status === 0).map(w => w.expression);
                    await navigator.clipboard.writeText(ignores.join("\n"));
                    new Notice(t("Copied to clipboard"));
                })
            );

        // 销毁数据库
        new Setting(containerEl)
            .setName(t("Destroy Database"))
            .setDesc(t("Destroy all stuff and start over"))
            .addButton(button => button
                .setButtonText(t("Destroy"))
                .setWarning()
                .onClick(async (evt) => {
                    let modal = new WarningModal(
                        this.app,
                        t("Are you sure you want to destroy your database?"),
                        async () => {
                            await this.plugin.db.destroyAll();
                            new Notice(t("Cleared"));
                            this.plugin.db = new LocalDb(this.plugin);
                            this.plugin.db.open();
                        });
                    modal.open();
                })
            );
    }

    textDBSettings(containerEl: HTMLElement) {
        containerEl.createEl("h3", { text: t("Text Database") });

        new Setting(containerEl)
            .setName(t("Auto refresh"))
            .setDesc(t("Auto refresh database when submitting"))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.auto_refresh_db)
                .onChange(async (value) => {
                    this.plugin.settings.auto_refresh_db = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("Word Database Path"))
            .setDesc(t("Choose a md file as word database for auto-completion"))
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.word_database)
                    .onChange(async (path) => {
                        this.plugin.settings.word_database = path;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName(t("Review Database Path"))
            .setDesc(t("Choose a md file as review database for spaced-repetition"))
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.review_database)
                    .onChange(async (path) => {
                        this.plugin.settings.review_database = path;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName(t("Refresh Review Database"))
            .addButton((button) =>
                button
                    .setButtonText(t("Update"))
                    .onClick(async () => {
                        await this.plugin.refreshReviewDb();
                    })
            );


    }

    fileDBSettings(containerEl: HTMLElement) {
        containerEl.createEl("h3", { text: t("Word Files Database") });

        new Setting(containerEl)
            .setName(t("Word Files Database"))
            .setDesc(t("Use Word Files Database. Automatically write  non-ignored word information from the article into the corresponding word file after exiting reading mode"))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.use_fileDB)
                .onChange(async (value) => {
                    this.plugin.settings.use_fileDB = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("Word Files Database Path"))
            .setDesc(t("Choose a folder as word files for saving"))
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.word_folder)
                    .onChange(async (path) => {
                        this.plugin.settings.word_folder = path;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName(t("update Word Files Database"))
            .setDesc(t("Import all non-ignored word information from the indexDB database into the corresponding word file"))
            .addButton(button => button
                .setButtonText(t("Update"))
                .onClick(async (evt) => {
                    if (this.plugin.settings.only_fileDB) {
                        new Notice(t("Update unavailable while only word files database is enabled"));
                    } else {
                        await this.plugin.updateWordfiles();
                        new Notice(t("Updated"));
                    }
                })
            );

        new Setting(containerEl)
            .setName(t("Update IndexDB Database"))
            .setDesc(t("Update the indexDB database based on the frontmatter information of each word file (the ignored words will not be affected). Please operate with caution."))
            .addButton(button => button
                .setButtonText(t("Update"))
                .onClick(async (evt) => {
                    if (this.plugin.settings.only_fileDB) {
                        new Notice(t("Update unavailable while only word files database is enabled"));
                    } else {
                        await this.plugin.updateIndexDB();
                        new Notice(t("Updated"));
                    }
                })
            );

        new Setting(containerEl)
            .setName(t("ONLY Use Word Files Database"))
            .setDesc(t("System reads and writes non-ignored word information directly from the word file database, instead of the index database. Please operate with caution. (After activation, non-ignored word information in the index database will be deleted. After deactivation, non-ignored word information in the word file will be written to the index database.)"))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.only_fileDB)
                .onChange(async (only_fileDB) => {
                    this.plugin.settings.only_fileDB = only_fileDB;
                    if (only_fileDB) {
                        var ignorwords = (await this.plugin.db.getAllExpressionSimple(true))
                            .filter(item => item.status === 0)
                            .flatMap(item => [item.expression, ...item.aliases]);
                        this.plugin.db.destroyAll();
                        this.plugin.db = new FileDb(this.plugin);
                        this.plugin.db.open();
                        this.plugin.db.postIgnoreWords(ignorwords.filter(item => item !== ""));
                    } else {
                        this.plugin.db = new LocalDb(this.plugin);
                        this.plugin.db.open();
                        this.plugin.updateIndexDB();
                    }
                    await this.plugin.saveSettings();
                    this.display();
                })
            );

    }

    readingSettings(containerEl: HTMLElement) {
        containerEl.createEl("h3", { text: t("Reading Mode") });

        new Setting(containerEl)
            .setName(t("Font Size"))
            .setDesc(t("Like 15px or 1.5em"))
            .addText(text => text
                .setValue(this.plugin.settings.font_size)
                .onChange(debounce(async (value) => {
                    this.plugin.settings.font_size = value;
                    this.plugin.store.fontSize = value;
                    await this.plugin.saveSettings();
                }, 500))
            );

        new Setting(containerEl)
            .setName(t("Font Family"))
            .addText(text => text
                .setValue(this.plugin.settings.font_family)
                .onChange(debounce(async (value) => {
                    this.plugin.settings.font_family = value;
                    this.plugin.store.fontFamily = value;
                    await this.plugin.saveSettings();
                }, 500))
            );

        new Setting(containerEl)
            .setName(t("Line Height"))
            .addText(text => text
                .setValue(this.plugin.settings.line_height)
                .onChange(debounce(async (value) => {
                    this.plugin.settings.line_height = value;
                    this.plugin.store.lineHeight = value;
                    await this.plugin.saveSettings();
                }, 500))
            );

        new Setting(containerEl)
            .setName(t("Default Paragraphs"))
            .addDropdown(num => num
                .addOption("2", "1")
                .addOption("4", "2")
                .addOption("8", "4")
                .addOption("16", "8")
                .addOption("32", "16")
                .addOption("all", "All")
                .setValue(this.plugin.settings.default_paragraphs)
                .onChange(async (value: string) => {
                    this.plugin.settings.default_paragraphs = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("Use Machine Translation"))
            .setDesc(t("Auto translate sentences"))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.use_machine_trans)
                .onChange(async (use_machine_trans) => {
                    this.plugin.settings.use_machine_trans = use_machine_trans;
                    await this.plugin.saveSettings();
                })
            );
        new Setting(containerEl)
            .setName(t("Open count bar"))
            .setDesc(t("Count the word number of different type of article"))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.word_count)
                .onChange(async (value) => {
                    this.plugin.settings.word_count = value;
                    await this.plugin.saveSettings();
                })
            );

        containerEl.createEl("h3", { text: t("Hover Definition") });

        new Setting(containerEl)
            .setName(t("Show hover explanation"))
            .setDesc(t("Display a short explanation above the word when hovering"))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.hover_definition_enabled)
                .onChange(async (value) => {
                    this.plugin.settings.hover_definition_enabled = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("Explanation language"))
            .setDesc(t("Language code for hover definition (e.g., zh, en, ja)"))
            .addText(text => text
                .setPlaceholder("zh")
                .setValue(this.plugin.settings.hover_definition_lang)
                .onChange(debounce(async (value) => {
                    this.plugin.settings.hover_definition_lang = value.trim() || "zh";
                    await this.plugin.saveSettings();
                }, 300))
            );
    }

    completionSettings(containerEl: HTMLElement) {
        containerEl.createEl("h3", { text: t("Auto Completion") });

        new Setting(containerEl)
            .setName(t("Column delimiter"))
            .addDropdown(dilimiter => dilimiter
                .addOption(",", t("Comma"))
                .addOption("\t", t("Tab"))
                .addOption("|", t("Pipe"))
                .setValue(this.plugin.settings.col_delimiter)
                .onChange(async (value: "," | "\t" | "|") => {
                    this.plugin.settings.col_delimiter = value;
                    await this.plugin.saveSettings();
                })
            );

    }

    reviewSettings(containerEl: HTMLElement) {
        containerEl.createEl("h3", { text: t("Review") });

        new Setting(containerEl)
            .setName(t("Accent"))
            .setDesc(t("Choose your preferred accent"))
            .addDropdown(accent => accent
                .addOption("0", t("American"))
                .addOption("1", t("British"))
                .setValue(this.plugin.settings.review_prons)
                .onChange(async (value: "0" | "1") => {
                    this.plugin.settings.review_prons = value;
                    await this.plugin.saveSettings();
                })
            );
        new Setting(containerEl)
            .setName(t("Delimiter"))
            .addText(text => text
                .setValue(this.plugin.settings.review_delimiter)
                .onChange(async (value) => {
                    this.plugin.settings.review_delimiter = value;
                    await this.plugin.saveSettings();
                })
            );
    }

    // Self-server feature removed

}

