import { App, Notice, PluginSettingTab, Setting, Modal, moment, debounce, requestUrl } from "obsidian";

import { LocalDb } from "./db/local_db";
import { FileDb } from "./db/file_db";
import LanguageLearner from "./plugin";
import { t, type UiLanguage } from "./lang/helper";
import { WarningModal, OpenFileModal } from "./modals"
import { dicts } from "@dict/list";
import store from "./store";

// Import external CSS for settings panel
import "./styles/settings.css";

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
    ai: {
        provider: string;
        api_key: string;
        api_url: string;
        model: string;
        prompt: string;
        context_prompt: string;
        trans_prompt: string;
        card_prompt: string;
    };
    // ui
    activeTab: string;
}

const AI_PROVIDERS: Record<string, { label: string; url: string; models: string[] }> = {
    openai: { label: "OpenAI", url: "https://api.openai.com/v1/chat/completions", models: ["gpt-3.5-turbo", "gpt-4", "gpt-4o", "gpt-4o-mini"] },
    gemini: { label: "Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", models: ["gemini-2.0-flash", "gemini-2.0-pro-exp", "gemini-3.0-pro", "gemini-1.5-pro", "gemini-1.5-flash"] },
    deepseek: { label: "DeepSeek", url: "https://api.deepseek.com/chat/completions", models: ["deepseek-chat", "deepseek-coder"] },
    siliconflow: { label: "硅基流动", url: "https://api.siliconflow.cn/v1/chat/completions", models: ["Qwen/Qwen2.5-7B-Instruct", "deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-V3.1-Terminus", "deepseek-ai/DeepSeek-R1", "deepseek-ai/DeepSeek-V2.5", "zai-org/GLM-4.6", "moonshotai/Kimi-K2-Thinking"] },
    custom: { label: "Custom", url: "", models: [] }
};

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
    ai: {
        provider: "openai",  // OpenAI（质量最好）
        api_key: "",  // ⚠️ 需要用户配置（或使用 OB English Learner 的密钥）
        api_url: "https://api.openai.com/v1/chat/completions",
        model: "gpt-4o-mini",  // 使用 GPT-4o-mini（更快、更便宜）
        prompt: "You are a helpful English learning assistant. Explain the meaning of words clearly and provide examples.",
        context_prompt: "You are a helpful English learning assistant. Explain the selected word or phrase in the given sentence. Focus on its meaning in this exact context, then give a concise general meaning and one short usage note. Use markdown.",
        trans_prompt: "Translate the following sentence into Chinese accurately and naturally: {sentence}",
        card_prompt: "You are a helpful English learning assistant. Fill a learner's vocabulary card from the selected expression and optional context. Return only valid JSON with the shape {\"meaning\":\"string\",\"aliases\":[\"string\"],\"tags\":[\"string\"],\"notes\":[\"string\"]}. Keep the meaning concise, aliases practical, tags short, and notes useful for study."
    },
    activeTab: "general"
};

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

        new Setting(containerEl)
            .setName(t("AI Provider"))
            .setDesc(t("Select AI provider"))
            .addDropdown(dropdown => {
                Object.keys(AI_PROVIDERS).forEach(key => {
                    dropdown.addOption(key, AI_PROVIDERS[key as keyof typeof AI_PROVIDERS].label);
                });
                dropdown.setValue(this.plugin.settings.ai.provider)
                    .onChange(async (value) => {
                        this.plugin.settings.ai.provider = value;
                        const provider = AI_PROVIDERS[value as keyof typeof AI_PROVIDERS];
                        if (value !== 'custom') {
                            this.plugin.settings.ai.api_url = provider.url;
                            if (provider.models.length > 0) {
                                this.plugin.settings.ai.model = provider.models[0];
                            }
                        }
                        await this.plugin.saveSettings();
                        this.display();
                    });
            });

        new Setting(containerEl)
            .setName(t("API URL"))
            .setDesc(t("API endpoint URL"))
            .addText(text => text
                .setValue(this.plugin.settings.ai.api_url)
                .onChange(async (value) => {
                    this.plugin.settings.ai.api_url = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("API Key"))
            .setDesc(t("Enter your API key (supports OpenAI, Gemini, and DeepSeek formats)"))
            .addText(text => {
                text.setPlaceholder("sk-... / AIza...")
                    .setValue(this.plugin.settings.ai.api_key)
                    .onChange(async (value) => {
                        // API Key 格式校验提示
                        const inputEl = text.inputEl;
                        const trimmed = value.trim();
                        if (trimmed && !trimmed.startsWith("sk-") && !trimmed.startsWith("AIza") && trimmed.length < 20) {
                            inputEl.style.borderColor = "var(--text-error)";
                            inputEl.title = t("API key format may be invalid");
                        } else {
                            inputEl.style.borderColor = "var(--background-modifier-border)";
                            inputEl.title = "";
                        }
                        this.plugin.settings.ai.api_key = trimmed;
                        await this.plugin.saveSettings();
                    });
                // 密码模式隐藏 API Key
                text.inputEl.type = "password";
                text.inputEl.style.width = "300px";
            });

        // Add dropdown for model selection if provider has models
        const currentProvider = AI_PROVIDERS[this.plugin.settings.ai.provider as keyof typeof AI_PROVIDERS];
        if (currentProvider && currentProvider.models.length > 0) {
            new Setting(containerEl)
                .setName(t("Select Model"))
                .setDesc(t("Choose from available models"))
                .addDropdown(dropdown => {
                    currentProvider.models.forEach(model => {
                        dropdown.addOption(model, model);
                    });
                    // Handle case where current model is not in the list
                    if (!currentProvider.models.includes(this.plugin.settings.ai.model)) {
                        // If current model is valid but not in list, maybe add it or reset?
                        // For now let's just keep it if possible, but dropdown usually requires value to be in options
                        // If we want to support custom models in dropdown, we need an editable combo box which Setting doesn't support natively easily.
                        // So we default to first model if invalid, or just let it be.
                        // If user switched provider, model was reset in onChange above.
                    }

                    dropdown.setValue(this.plugin.settings.ai.model)
                        .onChange(async (value) => {
                            this.plugin.settings.ai.model = value;
                            await this.plugin.saveSettings();
                        });
                });
        } else {
            new Setting(containerEl)
                .setName(t("Model Name"))
                .setDesc(t("Enter the model name"))
                .addText(text => text
                    .setValue(this.plugin.settings.ai.model)
                    .onChange(async (value) => {
                        this.plugin.settings.ai.model = value;
                        await this.plugin.saveSettings();
                    })
                );
        }

        new Setting(containerEl)
            .setName(t("System Prompt"))
            .setDesc(t("Prompt for dictionary definition"))
            .addTextArea(text => text
                .setValue(this.plugin.settings.ai.prompt)
                .onChange(async (value) => {
                    this.plugin.settings.ai.prompt = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("Translation Prompt"))
            .setDesc(t("Prompt for sentence translation. Use {sentence} as the placeholder."))
            .addTextArea(text => text
                .setValue(this.plugin.settings.ai.trans_prompt)
                .onChange(async (value) => {
                    this.plugin.settings.ai.trans_prompt = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("Context Prompt"))
            .setDesc(t("Prompt for contextual explanation when sentence context is available."))
            .addTextArea(text => text
                .setValue(this.plugin.settings.ai.context_prompt)
                .onChange(async (value) => {
                    this.plugin.settings.ai.context_prompt = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("Test Connection"))
            .setDesc(t("Test whether the current API configuration works"))
            .addButton(button => button
                .setButtonText(t("Test"))
                .onClick(async () => {
                    button.setButtonText(t("Testing..."));
                    button.setDisabled(true);
                    try {
                        const { api_url, api_key, model, provider } = this.plugin.settings.ai;

                        if (!api_key) {
                            new Notice(t("Please enter API key first"));
                            return;
                        }

                        // Construct request based on provider
                        let url = api_url;
                        let headers: Record<string, string> = {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${api_key}`
                        };
                        let body: any = {
                            model: model,
                            messages: [{ role: "user", content: "Hi" }],
                            max_tokens: 5
                        };

                        // Special handling for Gemini
                        if (provider === 'gemini') {
                            // Gemini uses query param for key if using Google's endpoint, 
                            // but here we are using OpenAI compatible endpoint?
                            // The settings default for Gemini is: https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
                            // This endpoint requires key in header or query param? 
                            // Usually OpenAI compatible endpoints use Authorization header.
                            // Let's assume standard OpenAI format as per previous implementation.
                        }

                        const response = await requestUrl({
                            url: url,
                            method: "POST",
                            headers: headers,
                            body: JSON.stringify(body)
                        });

                        if (response.status === 200) {
                            new Notice(t("Connection successful!"));
                        } else {
                            new Notice(`${t("Connection failed")}: ${response.status}`);
                        }
                    } catch (error: any) {
                        console.error(error);
                        let msg = t("Connection failed");
                        if (error.status) {
                            switch (error.status) {
                                case 401: msg = t("Invalid API key (401)"); break;
                                case 403: msg = t("Permission denied (403)"); break;
                                case 404: msg = t("Invalid API URL (404)"); break;
                                case 429: msg = t("Rate limit exceeded (429)"); break;
                                case 500: msg = t("Server error (500)"); break;
                                case 503: msg = t("Service unavailable (503)"); break;
                            }
                        } else if (error.message) {
                            msg += `: ${error.message}`;
                        }
                        new Notice(msg);
                    } finally {
                        button.setButtonText(t("Test"));
                        button.setDisabled(false);
                    }
                })
            );
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
                                    const settings = JSON.parse(content);
                                    this.plugin.settings = Object.assign({}, this.plugin.settings, settings);
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

