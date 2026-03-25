import {
    Notice,
    Plugin,
    Menu,
    WorkspaceLeaf,
    ViewState,
    MarkdownView,
    Editor,
    TFile,
    normalizePath,
    Platform,
    moment,
    MetadataCache,
} from "obsidian";
import { around } from "monkey-around";
import { createApp, App as VueApp, getCurrentInstance } from "vue";

import { SearchPanelView, SEARCH_ICON, SEARCH_PANEL_VIEW } from "./views/SearchPanelView";
import { READING_VIEW_TYPE, READING_ICON, ReadingView } from "./views/ReadingView";
import { LearnPanelView, LEARN_ICON, LEARN_PANEL_VIEW } from "./views/LearnPanelView";
import { StatView, STAT_ICON, STAT_VIEW_TYPE } from "./views/StatView";
import { DataPanelView, DATA_ICON, DATA_PANEL_VIEW } from "./views/DataPanelView";
import { PDFView, PDF_FILE_EXTENSION, VIEW_TYPE_PDF } from "./views/PDFView";

import { t } from "./lang/helper";
import DbProvider from "./db/base";
import { LocalDb } from "./db/local_db";
import { FileDb } from "./db/file_db";
import { TextParser, state } from "./views/parser";
import { FrontMatterManager } from "./utils/frontmatter";

import { DEFAULT_SETTINGS, MyPluginSettings, SettingTab } from "./settings";
import store from "./store";
import { playAudio } from "./utils/helpers";
import type { Position, SearchContext } from "./constant";
import { InputModal } from "./modals"

import Global from "./views/Global.vue";

import {
    ArticleWords, Word, Phrase, WordsPhrase, Sentence,
    ExpressionInfo, ExpressionInfoSimple, CountInfo, WordCount, Span
} from "./db/interface";
import { ignorableWatch } from "@vueuse/core";

export const FRONT_MATTER_KEY: string = "langr";

export var imgnum: string = localStorage.getItem('imgnum') || '';


const statusMap = [
    t("Ignore"),
    t("Learning"),
    t("Familiar"),
    t("Known"),
    t("Learned"),
];

export default class LanguageLearner extends Plugin {
    constants: { basePath: string; platform: "mobile" | "desktop"; };
    settings: MyPluginSettings;
    appEl: HTMLElement;
    vueApp: VueApp;
    db: DbProvider;
    // server field removed - self-server feature no longer available
    parser: TextParser;
    markdownButtons: Record<string, HTMLElement> = {};
    frontManager: FrontMatterManager;
    store: typeof store = store;
    private parserAllFMCache: ExpressionInfo[] | null = null;
    private parserAllFMDirty = true;
    private parserAllFMFolder = "";
    private refreshTextDbTimer: number | null = null;
    private refreshTextDbRunning = false;
    private refreshTextDbQueued = false;
    async onload() {
        // 读取设置
        await this.loadSettings();
        await this.ensureDefaultTextDbFiles();
        this.addSettingTab(new SettingTab(this.app, this));

        this.registerConstants();

        // 打开数据库
        this.db = await this.openDB();
        // this.settings.use_server
        //     ? new WebDb(this.settings.port)
        //     : new LocalDb(this);
        await this.db.open();

        // 设置解析器
        this.parser = new TextParser(this);
        this.frontManager = new FrontMatterManager(this.app);

        // Self-server feature removed - no longer initializing server

        // test
        // this.addCommand({
        // 	id: "langr-test",
        // 	name: "Test for langr",
        // 	callback: () => new Notice("hello!")
        // })

        await this.replacePDF();

        this.initStore();

        this.addCommands();
        this.registerCustomViews();
        this.registerReadingToggle();
        this.registerContextMenu();
        this.registerLeftClick();
        this.registerMouseup();
        this.registerWordFolderWatchers();
        this.registerEvent(
            this.app.workspace.on("css-change", () => {
                store.dark = document.body.hasClass("theme-dark");
                store.themeChange = !store.themeChange;
            })
        );

        // 创建全局app用于各种浮动元素
        this.appEl = document.body.createDiv({ cls: "langr-app" });
        this.vueApp = createApp(Global);
        this.vueApp.config.globalProperties.plugin = this;
        this.vueApp.mount(this.appEl);
    }

    private registerWordFolderWatchers() {
        const invalidate = (filePath?: string) => {
            if (!filePath) return;
            if (this.isWordFilePath(filePath)) {
                this.invalidateParserAllFMCache();
            }
        };
        this.registerEvent(
            this.app.vault.on("create", (file) => invalidate((file as any)?.path))
        );
        this.registerEvent(
            this.app.vault.on("modify", (file) => invalidate((file as any)?.path))
        );
        this.registerEvent(
            this.app.vault.on("delete", (file) => invalidate((file as any)?.path))
        );
        this.registerEvent(
            this.app.vault.on("rename", (file, oldPath) => {
                invalidate((file as any)?.path);
                invalidate(oldPath);
            })
        );
    }

    private isWordFilePath(filePath: string): boolean {
        if (!this.settings.word_folder) {
            return false;
        }
        const folder = normalizePath(this.settings.word_folder);
        const normalized = normalizePath(filePath);
        if (!normalized.endsWith(".md")) {
            return false;
        }
        return normalized === folder || normalized.startsWith(`${folder}/`);
    }

    private invalidateParserAllFMCache() {
        this.parserAllFMDirty = true;
        this.parserAllFMCache = null;
    }

    async openDB() {
        // Backend server feature removed - only support FileDb and LocalDb
        if (this.settings.only_fileDB) {
            return new FileDb(this);
        } else {
            return new LocalDb(this);
        }
    }

    async onunload() {
        this.app.workspace.detachLeavesOfType(SEARCH_PANEL_VIEW);
        this.app.workspace.detachLeavesOfType(LEARN_PANEL_VIEW);
        this.app.workspace.detachLeavesOfType(DATA_PANEL_VIEW);
        this.app.workspace.detachLeavesOfType(STAT_VIEW_TYPE);
        this.app.workspace.detachLeavesOfType(READING_VIEW_TYPE);

        this.db.close();
        // Self-server feature removed - no server to close
        if (await app.vault.adapter.exists(".obsidian/plugins/obsidian-language-learner/pdf/web/viewer.html")) {
            this.registerExtensions([PDF_FILE_EXTENSION], "pdf");
        }

        this.vueApp.unmount();
        this.appEl.remove();
        this.appEl = null;
    }

    registerConstants() {
        this.constants = {
            basePath: normalizePath((this.app.vault.adapter as any).basePath),
            platform: Platform.isMobile ? "mobile" : "desktop",
        };
    }

    async ensureDefaultTextDbFiles() {
        const defaults: Array<{
            key: "word_database" | "review_database";
            path: string;
        }> = [
            { key: "word_database", path: "words.md" },
            { key: "review_database", path: "review.md" },
        ];

        let settingsUpdated = false;

        for (const item of defaults) {
            if (this.settings[item.key]) {
                continue;
            }

            if (!this.app.vault.getAbstractFileByPath(item.path)) {
                try {
                    await this.app.vault.create(item.path, "");
                } catch (error) {
                    console.error("Failed to create default db file:", item.path, error);
                }
            }

            this.settings[item.key] = item.path;
            settingsUpdated = true;
        }

        if (settingsUpdated) {
            await this.saveSettings();
        }
    }

    async replacePDF() {
        if (await app.vault.adapter.exists(
            ".obsidian/plugins/obsidian-language-learner/pdf/web/viewer.html"
        )) {
            this.registerView(VIEW_TYPE_PDF, (leaf) => {
                return new PDFView(leaf);
            });

            (this.app as any).viewRegistry.unregisterExtensions([
                PDF_FILE_EXTENSION,
            ]);
            this.registerExtensions([PDF_FILE_EXTENSION], VIEW_TYPE_PDF);

            this.registerDomEvent(window, "message", (evt) => {
                if (evt.data.type === "search") {
                    // if (evt.data.funckey || this.store.searchPinned)
                    this.queryWord(evt.data.selection);
                }
            });
        }
    }

    initStore() {
        this.store.dark = document.body.hasClass("theme-dark");
        this.store.themeChange = false;
        this.store.fontSize = this.settings.font_size;
        this.store.fontFamily = this.settings.font_family;
        this.store.lineHeight = this.settings.line_height;
        this.store.popupSearch = this.settings.popup_search;
        this.store.searchPinned = false;
        this.store.dictsChange = false;
        this.store.dictHeight = this.settings.dict_height;
    }

    addCommands() {
        // 注册刷新单词数据库命令
        this.addCommand({
            id: "langr-refresh-word-database",
            name: t("Refresh Word Database"),
            callback: this.refreshWordDb,
        });

        // 注册刷新复习数据库命令
        this.addCommand({
            id: "langr-refresh-review-database",
            name: t("Refresh Review Database"),
            callback: this.refreshReviewDb,
        });

        // 注册查词命令
        this.addCommand({
            id: "langr-search-word-select",
            name: t("Translate Select"),
            callback: () => {
                let selection = this.getActiveSelectionText();
                this.queryWord(selection);
            },
        });
        this.addCommand({
            id: "langr-search-word-input",
            name: t("Translate Input"),
            callback: () => {
                const modal = new InputModal(this.app, (text) => {
                    this.queryWord(text);
                });
                modal.open();
            },
        });
        this.addCommand({
            id: "langr-debug-copy-cleaned-sentence",
            name: "Debug: Copy Cleaned Sentence",
            callback: async () => {
                await this.debugCopyCleanedSentence();
            },
        });

        this.addCommand({
            id: "langr-mark-learning-completed",
            name: t("Mark as Learning Completed"),
            callback: async () => {
                const file = this.app.workspace.getActiveFile();
                if (!file) {
                    new Notice(t("No active file"));
                    return;
                }
                await this.markLearningCompleted(file);
            },
        });
    }

    registerCustomViews() {
        // 注册查词面板视图
        this.registerView(
            SEARCH_PANEL_VIEW,
            (leaf) => new SearchPanelView(leaf, this)
        );
        this.addRibbonIcon(SEARCH_ICON, t("Open word search panel"), (evt) => {
            this.activateView(SEARCH_PANEL_VIEW, "left");
        });

        // 注册新词面板视图
        this.registerView(
            LEARN_PANEL_VIEW,
            (leaf) => new LearnPanelView(leaf, this)
        );
        this.addRibbonIcon(LEARN_ICON, t("Open new word panel"), (evt) => {
            this.activateView(LEARN_PANEL_VIEW, "right");
        });

        // 注册阅读视图
        this.registerView(
            READING_VIEW_TYPE,
            (leaf) => new ReadingView(leaf, this)
        );

        //注册统计视图
        this.registerView(STAT_VIEW_TYPE, (leaf) => new StatView(leaf, this));
        this.addRibbonIcon(STAT_ICON, t("Open statistics"), async (evt) => {
            this.activateView(STAT_VIEW_TYPE, "right");
        });

        //注册单词列表视图
        this.registerView(
            DATA_PANEL_VIEW,
            (leaf) => new DataPanelView(leaf, this)
        );
        this.addRibbonIcon(DATA_ICON, t("Data Panel"), async (evt) => {
            this.activateView(DATA_PANEL_VIEW, "tab");
        });
    }




    async setMarkdownView(leaf: WorkspaceLeaf, focus: boolean = true) {
        await leaf.setViewState(
            {
                type: "markdown",
                state: leaf.view.getState(),
                //popstate: true,
            } as ViewState,
            { focus }
        );
    }

    async setReadingView(leaf: WorkspaceLeaf) {
        await leaf.setViewState({
            type: READING_VIEW_TYPE,
            state: leaf.view.getState(),
            //popstate: true,
        } as ViewState);

    }

    private extractArticleContent(content: string): string {
        const withoutFrontmatter = content.replace(/^\n*---\n[\s\S]+?\n---\n?/, "");
        const lines = withoutFrontmatter.split("\n");
        const articleStart = lines.indexOf("^^^article");
        if (articleStart === -1) {
            return withoutFrontmatter;
        }

        const sectionEndCandidates = [lines.indexOf("^^^words"), lines.indexOf("^^^notes")]
            .filter((index) => index > articleStart);
        const articleEnd = sectionEndCandidates.length > 0
            ? Math.min(...sectionEndCandidates)
            : lines.length;

        return lines.slice(articleStart + 1, articleEnd).join("\n");
    }

    async getWordsCountForFile(filePath: string): Promise<number> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) {
            return 0;
        }

        const content = await this.app.vault.cachedRead(file);
        const articleContent = this.extractArticleContent(content).trim();
        if (!articleContent) {
            return 0;
        }

        const expressions = await this.parser.getWordsPhrases(articleContent);
        return expressions.filter((expr) => expr.status === 1 || expr.status === 2).length;
    }

    async markLearningCompleted(file: TFile): Promise<void> {
        try {
            const wordsCollected = await this.getWordsCountForFile(file.path);
            const frontmatter = await this.frontManager.loadFrontMatter(file);
            const completedDate = new Date().toISOString().split("T")[0];

            frontmatter.status = "completed";
            frontmatter.completed = completedDate;
            frontmatter.words_collected = String(wordsCollected);

            await this.frontManager.storeFrontMatter(file, frontmatter);
            new Notice(`${t("Marked as completed")} (${wordsCollected})`);
        } catch (error) {
            console.error("Failed to update status:", error);
            new Notice(`${t("Failed to update status")}: ${(error as Error).message}`);
        }
    }

    async refreshTextDB() {
        await this.refreshWordDb();
        await this.refreshReviewDb();
        (this.app as any).commands.executeCommandById(
            "various-complements:reload-custom-dictionaries"
        );
    }

    scheduleRefreshTextDB(delay = 500) {
        if (this.refreshTextDbTimer !== null) {
            window.clearTimeout(this.refreshTextDbTimer);
        }
        this.refreshTextDbTimer = window.setTimeout(() => {
            this.refreshTextDbTimer = null;
            this.runRefreshTextDB();
        }, delay);
    }

    private async runRefreshTextDB() {
        if (this.refreshTextDbRunning) {
            this.refreshTextDbQueued = true;
            return;
        }
        this.refreshTextDbRunning = true;
        try {
            await this.refreshTextDB();
        } finally {
            this.refreshTextDbRunning = false;
            if (this.refreshTextDbQueued) {
                this.refreshTextDbQueued = false;
                this.runRefreshTextDB();
            }
        }
    }

    refreshWordDb = async () => {
        if (!this.settings.word_database) {
            return;
        }

        let dataBase = this.app.vault.getAbstractFileByPath(
            this.settings.word_database
        );
        if (!dataBase || dataBase.hasOwnProperty("children")) {
            new Notice("Invalid refresh database path");
            return;
        }
        // 获取所有非无视单词的简略信息
        let words = await this.db.getAllExpressionSimple(false);

        let classified: number[][] = Array(5)
            .fill(0)
            .map((): number[] => []);
        words.forEach((word, i) => {
            classified[word.status].push(i);
        });


        let del = this.settings.col_delimiter;

        // 正向查询
        let classified_texts = classified.map((w, idx) => {
            return (
                `#### ${statusMap[idx]}\n` +
                w.map((i) => `${words[i].expression}${del}    ${words[i].meaning}`)
                    .join("\n") + "\n"
            );
        });
        classified_texts.shift();
        let word2Meaning = classified_texts.join("\n");

        // 反向查询
        let meaning2Word = classified
            .flat()
            .map((i) => `${words[i].meaning}  ${del}  ${words[i].expression}`)
            .join("\n");

        let text = word2Meaning + "\n\n" + "#### 反向查询\n" + meaning2Word;
        const hash = `${words.length}-${text.length}-${text.slice(0, 256)}-${text.slice(-256)}`;
        if (this.settings.last_word_db_hash === hash) {
            return;
        }
        let db = dataBase as TFile;
        this.app.vault.modify(db, text);
        this.settings.last_word_db_hash = hash;
        this.saveSettings();
    };

    refreshReviewDb = async () => {
        if (!this.settings.review_database) {
            return;
        }

        let dataBase = this.app.vault.getAbstractFileByPath(
            this.settings.review_database
        );
        if (!dataBase || "children" in dataBase) {
            new Notice("Invalid word database path");
            return;
        }

        let db = dataBase as TFile;
        let text = await this.app.vault.read(db);
        let oldRecord = {} as { [K in string]: string };
        const recordRegex = /#word[\s\S]*?(<!--SR.*?-->)/g;
        let match: RegExpExecArray | null;
        while ((match = recordRegex.exec(text)) !== null) {
            const record = /#### (.+)[\s\S]+(<!--SR.*-->)/.exec(match[0]);
            if (record) {
                oldRecord[record[1]] = record[2];
            }
        }

        // 每次都按当前全部非无视词条全量重建，避免增量刷新时覆盖掉旧内容。
        let data = await this.db.getExpressionAfter("1970-01-01T00:00:00Z");
        const wordsByExpression = new Map<string, typeof data[number]>();
        data.forEach((word) => {
            wordsByExpression.set(word.expression, word);
        });
        data = [...wordsByExpression.values()];

        data.sort((a, b) => a.expression.localeCompare(b.expression));

        let newText = data.map((word) => {
            let notes = word.notes.length === 0
                ? ""
                : "**Notes**:\n" + word.notes.join("\n").trim() + "\n";
            let sentences = word.sentences.length === 0
                ? ""
                : "**Sentences**:\n" +
                word.sentences.map((sen) => {
                    return (
                        `*${sen.text.trim()}*` + "\n" +
                        (sen.trans ? sen.trans.trim() + "\n" : "") +
                        (sen.origin ? sen.origin.trim() : "")
                    );
                }).join("\n").trim() + "\n";

            return (
                `#word\n` +
                `#### ${word.expression}\n` +
                `${this.settings.review_delimiter}\n` +
                `${word.meaning}\n` +
                `${notes}` +
                `${sentences}` +
                (oldRecord[word.expression] ? oldRecord[word.expression] + "\n" : "")
            );
        }).join("\n");

        if (newText) {
            newText += "\n";
        }
        newText = "#flashcards\n\n" + newText;
        await this.app.vault.modify(db, newText);
        this.settings.last_sync = moment.utc().toISOString();
        await this.saveSettings();
    };

    // 在MardownView的扩展菜单加一个转为Reading模式的选项
    registerReadingToggle = () => {
        const pluginSelf = this;
        pluginSelf.register(
            around(MarkdownView.prototype, {
                onPaneMenu(next) {
                    return function (m: Menu) {
                        const file = this.file;
                        const cache = file.cache
                            ? pluginSelf.app.metadataCache.getFileCache(file)
                            : null;

                        if (!file ||
                            !cache?.frontmatter ||
                            !cache?.frontmatter[FRONT_MATTER_KEY]
                        ) {
                            return next.call(this, m);
                        }

                        m.addItem((item) => {
                            item.setTitle(t("Open as Reading View"))
                                .setIcon(READING_ICON)
                                .onClick(async () => {
                                    processContent();
                                    await pluginSelf.setReadingView(this.leaf);
                                    await fetchData();
                                    processContent();
                                });

                        });

                        next.call(this, m);
                    };
                },
            })
        );

        // 增加标题栏切换阅读模式和mardown模式的按钮
        pluginSelf.register(
            around(WorkspaceLeaf.prototype, {
                setViewState(next) {
                    return function (state: ViewState, ...rest: any[]): Promise<void> {
                        return (next.apply(this, [state, ...rest]) as Promise<void>).then(() => {
                            if (state.type === "markdown" && state.state?.file) {
                                const cache = pluginSelf.app.metadataCache
                                    .getCache(state.state.file);
                                if (cache?.frontmatter && cache.frontmatter[FRONT_MATTER_KEY]) {
                                    if (!pluginSelf.markdownButtons["reading"]) {
                                        // 检查 addAction 方法是否存在
                                        const view = this.view as MarkdownView;
                                        if (typeof view.addAction === 'function') {
                                            pluginSelf.markdownButtons["reading"] =
                                                view.addAction(
                                                    "view",
                                                    t("Open as Reading View"),
                                                    async () => {
                                                        processContent();
                                                        await pluginSelf.setReadingView(this);
                                                        await fetchData();
                                                        processContent();
                                                    }
                                                );
                                            pluginSelf.markdownButtons["reading"].addClass("change-to-reading");
                                        }
                                    }
                                } else {
                                    const actionsEl = (this.view as any).actionsEl;
                                    if (actionsEl) {
                                        actionsEl.querySelectorAll(".change-to-reading")
                                            .forEach((el: HTMLElement) => el.remove());
                                    }
                                    // pluginSelf.markdownButtons["reading"]?.remove();
                                    pluginSelf.markdownButtons["reading"] = null;
                                }
                            } else {
                                pluginSelf.markdownButtons["reading"] = null;
                            }
                        });
                    };
                },
            })
        );
    };

    private normalizeContextText(text?: string | null): string {
        return (text || "").replace(/\s+/g, " ").trim();
    }

    sanitizeSentenceContext(text?: string | null): string {
        let cleaned = text || "";
        if (!cleaned) {
            return "";
        }

        cleaned = cleaned
            .replace(/<[^>]+>/g, " ")
            .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
            .replace(/\[\[([^\]]+)\]\]/g, "$1")
            .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
            .replace(/\\([\\`*_{}\[\]()#+.!|>~-])/g, "$1")
            .replace(/[*_~#>`]/g, " ")
            .replace(/\|/g, " ");

        cleaned = cleaned
            .replace(/[（(]([^()（）]*[\u4e00-\u9fff][^()（）]*)[）)]/g, (_match, inner: string) => {
                const preserved = inner
                    .replace(/[\u4e00-\u9fff，。；：！？、【】《》「」『』“”‘’…·\s]+/g, " ")
                    .replace(/\s+([,.;:!?])/g, "$1")
                    .trim();
                return /[A-Za-z0-9]/.test(preserved) ? ` ${preserved} ` : " ";
            })
            .replace(/\s*[-—–:：]\s*[\u4e00-\u9fff，。；：！？、（）【】《》「」『』“”‘’…·.\s]+(?:\s*[-—–:：]\s*)?(?=[A-Za-z(])/g, " ")
            .replace(/\s*[-—–:：]\s*[\u4e00-\u9fff，。；：！？、（）【】《》「」『』“”‘’\s]+(?=$|[.,;!?])/g, " ");

        if (/[A-Za-z]/.test(cleaned)) {
            cleaned = cleaned
                .replace(/[\u4e00-\u9fff]+/g, " ")
                .replace(/[，。；：！？、（）【】《》「」『』“”‘’]/g, " ");
        }

        return this.normalizeContextText(cleaned)
            .replace(/(?<=[A-Za-z])\s*(?:\.{2,}|…+)\s*(?=[A-Za-z])/g, " ")
            .replace(/[（(]\s*[）)]/g, " ")
            .replace(/\s*[-—–:：]\s*(?=$|[.,;!?])/g, " ")
            .replace(/\s+([,.;:!?])/g, "$1")
            .replace(/([(\[{])\s+/g, "$1")
            .replace(/\s+([)\]}])/g, "$1");
    }

    private getActiveSelectionText(): string {
        const domSelection = this.sanitizeSentenceContext(window.getSelection()?.toString());
        if (domSelection) {
            return domSelection;
        }

        const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
        return this.sanitizeSentenceContext(editor?.getSelection() || "");
    }

    private getSearchOrigin(): string | null {
        const reading = this.app.workspace.getActiveViewOfType(ReadingView);
        const file = reading?.file || this.app.workspace.getActiveFile();
        if (!file) {
            return null;
        }

        const presetOrigin = this.app.metadataCache.getFileCache(file)?.frontmatter?.["langr-origin"];
        return presetOrigin ? presetOrigin : file.name;
    }

    private shouldSplitSentenceAt(text: string, index: number): boolean {
        const char = text[index];
        if (!/[.!?。！？]/.test(char)) {
            return false;
        }

        // 避免在 "...", ".." 这类省略号或注释片段中误断句。
        if (char === ".") {
            const prev = text[index - 1] || "";
            const next = text[index + 1] || "";
            if (prev === "." || next === ".") {
                return false;
            }
        }

        let cursor = index + 1;
        while (cursor < text.length && /\s/.test(text[cursor])) {
            cursor++;
        }
        if (cursor >= text.length) {
            return true;
        }

        const rest = text.slice(cursor);
        return /^[\"'“‘(\[]?[A-Z0-9]/.test(rest) || /^[\"'“‘(\[]?[\u4e00-\u9fff]/.test(rest);
    }

    private splitSentenceCandidates(text: string): string[] {
        const segments: string[] = [];
        let start = 0;

        for (let index = 0; index < text.length; index++) {
            const char = text[index];
            if (char === "\n") {
                const segment = this.normalizeContextText(text.slice(start, index));
                if (segment) {
                    segments.push(segment);
                }
                start = index + 1;
                continue;
            }

            if (!this.shouldSplitSentenceAt(text, index)) {
                continue;
            }

            const segment = this.normalizeContextText(text.slice(start, index + 1));
            if (segment) {
                segments.push(segment);
            }

            start = index + 1;
            while (start < text.length && /\s/.test(text[start])) {
                start++;
            }
            index = start - 1;
        }

        const tail = this.normalizeContextText(text.slice(start));
        if (tail) {
            segments.push(tail);
        }

        return segments;
    }

    private extractSentenceFromText(text: string, selection: string): string {
        const normalizedText = this.sanitizeSentenceContext(text);
        const normalizedSelection = this.sanitizeSentenceContext(selection);
        if (!normalizedText) {
            return "";
        }
        if (!normalizedSelection) {
            return normalizedText;
        }

        const loweredSelection = normalizedSelection.toLowerCase();
        const segments = this.splitSentenceCandidates(normalizedText);

        const matched = segments.find((segment) =>
            segment.toLowerCase().includes(loweredSelection)
        );

        return matched || normalizedText;
    }

    private getSentenceFromDomSelection(selection: string, target?: HTMLElement): string {
        const blockSelector = ".stns, p, li, blockquote, td, th, h1, h2, h3, h4, h5, h6, .cm-line";
        const targetBlock = target?.closest?.(blockSelector);
        const targetText = this.sanitizeSentenceContext(targetBlock?.textContent || "");
        if (targetText) {
            return this.extractSentenceFromText(targetText, selection);
        }

        const domSelection = window.getSelection();
        if (!domSelection || domSelection.rangeCount === 0) {
            return "";
        }

        const range = domSelection.getRangeAt(0);
        const node = range.commonAncestorContainer;
        const element = node instanceof HTMLElement ? node : node.parentElement;
        const block = element?.closest?.(blockSelector);
        const blockText = this.sanitizeSentenceContext(block?.textContent || "");
        return blockText ? this.extractSentenceFromText(blockText, selection) : "";
    }

    private getSentenceFromEditorSelection(selection: string): string {
        const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        const editor = markdownView?.editor;
        if (!editor) {
            return "";
        }

        const editorSelection = this.sanitizeSentenceContext(editor.getSelection());
        if (!editorSelection || editorSelection !== selection) {
            return "";
        }

        const from = editor.getCursor("from");
        const to = editor.getCursor("to");
        const lines: string[] = [];
        for (let line = from.line; line <= to.line; line++) {
            lines.push(editor.getLine(line));
        }

        return this.extractSentenceFromText(lines.join(" "), selection);
    }

    private buildSearchContext(selection: string, target?: HTMLElement): SearchContext {
        const normalizedSelection = this.sanitizeSentenceContext(selection);
        if (!normalizedSelection) {
            return {};
        }

        const sentenceText =
            this.getSentenceFromDomSelection(normalizedSelection, target) ||
            this.getSentenceFromEditorSelection(normalizedSelection);

        if (!sentenceText) {
            return {};
        }

        return {
            sentenceText,
            origin: this.getSearchOrigin(),
        };
    }

    private async debugCopyCleanedSentence(): Promise<void> {
        const domSelection = window.getSelection()?.toString() || "";
        const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
        const editorSelection = editor?.getSelection() || "";
        const rawSelection = domSelection.trim() ? domSelection : editorSelection;
        const normalizedSelection = this.sanitizeSentenceContext(rawSelection);

        if (!normalizedSelection) {
            new Notice("No active selection");
            return;
        }

        const context = this.buildSearchContext(normalizedSelection);
        const cleanedSentence = context.sentenceText || normalizedSelection;
        console.debug("[Language Learner] sanitize debug", {
            rawSelection,
            normalizedSelection,
            cleanedSentence,
            origin: context.origin || null,
        });

        try {
            await navigator.clipboard.writeText(cleanedSentence);
            new Notice("已复制清洗后的例句");
        } catch (error) {
            console.warn("[Language Learner] Failed to copy cleaned sentence", error);
            new Notice("复制失败，请查看控制台");
        }
    }

    async queryWord(word: string, target?: HTMLElement, evtPosition?: Position): Promise<void> {
        const normalizedWord = this.sanitizeSentenceContext(word);
        if (!normalizedWord) return;
        const searchContext = this.buildSearchContext(normalizedWord, target);

        if (!this.settings.popup_search) {
            await this.activateView(SEARCH_PANEL_VIEW, "left");
        }

        if (searchContext.sentenceText && Platform.isDesktopApp) {
            await this.activateView(LEARN_PANEL_VIEW, "right");
        }

        dispatchEvent(new CustomEvent('obsidian-langr-search', {
            detail: { selection: normalizedWord, target, evtPosition, ...searchContext }
        }));

        if (this.settings.auto_pron) {
            let accent = this.settings.review_prons;
            let wordUrl =
                `http://dict.youdao.com/dictvoice?type=${accent}&audio=` +
                encodeURIComponent(normalizedWord);
            playAudio(wordUrl);
        }
    }

    // 管理所有的右键菜单
    registerContextMenu() {
        let addMemu = (mu: Menu, selection: string) => {
            mu.addItem((item) => {
                item.setTitle(t("Search word"))
                    .setIcon("info")
                    .onClick(async () => {
                        this.queryWord(selection);
                    });
            });
        };
        // markdown 编辑模式 右键菜单
        this.registerEvent(
            this.app.workspace.on(
                "editor-menu",
                (menu: Menu, editor: Editor, view: MarkdownView) => {
                    let selection = editor.getSelection();
                    if (selection || selection.trim().length === selection.length) {
                        addMemu(menu, selection);
                    }
                }
            )
        );
        // markdown 预览模式 右键菜单
        this.registerDomEvent(document.body, "contextmenu", (evt) => {
            if ((evt.target as HTMLElement).matchParent(".markdown-preview-view")) {
                const selection = window.getSelection().toString().trim();
                if (!selection) return;

                evt.preventDefault();
                let menu = new Menu();

                addMemu(menu, selection);

                menu.showAtMouseEvent(evt);
            }
        });
    }

    // 管理所有的左键抬起
    registerMouseup() {
        this.registerDomEvent(document.body, "pointerup", (evt) => {
            const target = evt.target as HTMLElement;
            if (!target.matchParent(".stns")) {
                // 处理普通模式
                const funcKey = this.settings.function_key;
                if ((funcKey === "disable" || evt[funcKey] === false)
                    && !(this.store.searchPinned && !target.matchParent("#langr-search,#langr-learn-panel"))
                ) return;

                let selection = window.getSelection().toString().trim();
                if (!selection) return;

                evt.stopImmediatePropagation();
                this.queryWord(selection, target, { x: evt.pageX, y: evt.pageY });
                return;
            }
        });
    }

    // 管理所有的鼠标左击
    registerLeftClick() {
        this.registerDomEvent(document.body, "click", (evt) => {
            let target = evt.target as HTMLElement;
            if (
                target.tagName === "H4" &&
                target.matchParent(".sr-modal-content")
            ) {
                let word = target.textContent;
                let accent = this.settings.review_prons;
                let wordUrl =
                    `http://dict.youdao.com/dictvoice?type=${accent}&audio=` +
                    encodeURIComponent(word);
                playAudio(wordUrl);
            }
        });
    }

    async loadSettings() {
        let settings: { [K in string]: any } = Object.assign(
            {},
            DEFAULT_SETTINGS
        );
        let data = (await this.loadData()) || {};
        for (let key in DEFAULT_SETTINGS) {
            let k = key as keyof typeof DEFAULT_SETTINGS;
            if (data[k] === undefined) {
                continue;
            }

            if (typeof DEFAULT_SETTINGS[k] === "object") {
                Object.assign(settings[k], data[k]);
            } else {
                settings[k] = data[k];
            }
        }
        (this.settings as any) = settings;
        // this.settings = Object.assign(
        //     {},
        //     DEFAULT_SETTINGS,
        //     await this.loadData()
        // );
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async activateView(VIEW_TYPE: string, side: "left" | "right" | "tab") {
        if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length === 0) {
            let leaf;
            switch (side) {
                case "left":
                    leaf = this.app.workspace.getLeftLeaf(false);
                    break;
                case "right":
                    leaf = this.app.workspace.getRightLeaf(false);
                    break;
                case "tab":
                    leaf = this.app.workspace.getLeaf("tab");
                    break;
            }
            await leaf.setViewState({
                type: VIEW_TYPE,
                active: true,
            });
        }
        this.app.workspace.revealLeaf(
            this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]
        );
    }


    async checkPath() {
        if (this.settings.word_folder && this.settings.use_fileDB) {
            try {
                await app.vault.createFolder(this.settings.word_folder);
            } catch (err) { };
        }
    }

    async createWordfiles(words: string[]) {
        await this.checkPath();
        var path = this.settings.word_folder;
        let info = await this.db.getExprall(words); //单词所有信息
        //this.createMd(exprs,this.plugin.settings.word_folder,cont); 
        for (const str of words) {
            if (path[path.length - 1] === '/') {
                var filePath = path + `${str}.md`;
            } else {
                var filePath = path + '/' + `${str}.md`;
            }
            var ExpressionInfo = info.find(info => info.expression === str);
            var fm = await this.createFM(ExpressionInfo);
            try {
                await app.vault.create(filePath, fm);
            } catch (err) {
                if (err.message.includes('File already exists')) {
                    this.app.vault.adapter.write(normalizePath(filePath), fm);
                }
            }
        }
    }

    //直接生成frontmatter文本
    async createFM(cont: ExpressionInfo) {
        const status = statusMap[cont.status];
        const formattedDate = moment.unix(cont.date).format('YYYY-MM-DD HH:mm:ss');

        // 使用数组构建，确保每行没有前导/尾随空格
        const lines: string[] = [];

        // 开始 frontmatter
        lines.push("---");
        lines.push(`expression: ${cont.expression}`);
        lines.push(`meaning: '${cont.meaning}'`);

        // 添加 aliases（如果有）
        if (cont.aliases && cont.aliases.length > 0) {
            lines.push("aliases:");
            cont.aliases.forEach(alias => lines.push(`- ${alias}`));
        }

        // 添加基本字段
        lines.push(`date: ${formattedDate}`);
        lines.push(`status: ${status}`);
        lines.push(`type: ${cont.t}`);

        // 添加 tags（如果有）
        if (cont.tags && cont.tags.length > 0) {
            lines.push("tags:");
            cont.tags.forEach(tag => lines.push(`- ${tag}`));
        }

        // 添加 notes（如果有）
        if (cont.notes && cont.notes.length > 0) {
            lines.push("notes:");
            cont.notes.forEach(note => lines.push(`- '${note}'`));
        }

        // 添加句子（如果有）
        if (cont.sentences && cont.sentences.length > 0) {
            cont.sentences.forEach((sentence, index) => {
                const i = index + 1;
                lines.push(`sentence${i}: '${sentence.text.replace(/'/g, "''")}'`);
                lines.push(`trans${i}: '${sentence.trans ? sentence.trans.replace(/'/g, "''") : ""}'`);
                lines.push(`origin${i}: '${sentence.origin ? sentence.origin.replace(/'/g, "''") : ""}'`);
            });
        }

        // 结束 frontmatter
        lines.push("---");

        // 返回joined字符串，确保使用 \n 换行符
        return lines.join("\n") + "\n";
    }



    async updateWordfiles() {
        let wordsinfo = await this.db.getAllExpressionSimple(false);
        let words: string[] = wordsinfo.map(item => item.expression);
        await this.createWordfiles(words);
    }

    async updateIndexDB() {
        let folderpath = this.settings.word_folder;
        await this.checkPath();
        var words = (await this.app.vault.adapter.list(normalizePath(folderpath))).files;
        
        // 进度提示
        const total = words.length;
        const notice = new Notice(`正在同步数据库 (0/${total})...`, 0);
        
        var ignorwords = (await this.db.getAllExpressionSimple(true))
            .filter(item => item.status === 0)
            .flatMap(item => [item.expression, ...item.aliases]);

        await this.db.destroyAll();
        await this.db.open();

        // 分批处理，避免阻塞 UI
        let expressionInfos: ExpressionInfo[] = [];
        const batchSize = 50;
        let processed = 0;

        for (let i = 0; i < words.length; i += batchSize) {
            const batch = words.slice(i, i + batchSize);
            const batchResults = await Promise.all(
                batch.map(async (wordpath) => {
                    try {
                        const info = await this.parserFM(wordpath);
                        return info;
                    } catch (e) {
                        console.warn(`Failed to parse ${wordpath}`, e);
                        return null;
                    }
                })
            );

            for (const info of batchResults) {
                if (info) {
                    // Normalize expression
                    (info as any).expression = (info as any).expression.trim().toLowerCase();
                    expressionInfos.push(info);

                    // Filter ignore words
                    const currentWords = [info.expression, ...info.aliases];
                    ignorwords = ignorwords.filter(item => !currentWords.includes(item));
                }
            }

            processed += batch.length;
            notice.setMessage(`正在同步数据库 (${processed}/${total})...`);
            
            // 让出主线程，避免 UI 卡顿
            await new Promise(r => setTimeout(r, 0));
        }

        notice.setMessage(`正在写入数据库...`);

        if (expressionInfos.length > 0) {
            if (this.db instanceof LocalDb) {
                await this.db.bulkPostExpressions(expressionInfos);
            } else {
                // Fallback for FileDb or other providers if they don't support bulk
                for (const info of expressionInfos) {
                    await this.db.postExpression(info);
                }
            }
        }

        this.db.postIgnoreWords(ignorwords.filter(item => item !== ""));
        
        notice.hide();
        new Notice(`✅ 同步完成，共 ${expressionInfos.length} 条记录`);
    }

    //解析某个单词文件的fm信息
    async parserFM(file_path: string) {
        const cache = this.app.metadataCache.getCache(file_path);
        if (!cache || !cache.frontmatter) {
            console.warn(`No cache or frontmatter found for file: ${file_path}`);
            return null;
        }

        var fm = cache.frontmatter;
        const {
            expression = '',
            meaning = '',
            status = '',
            type = '',
            tags = [],
            notes = [],
            aliases = [],
            date = ''
        } = fm;
        var sentences: Sentence[] = [];
        for (var i = 1; i < Object.keys(fm).length; i++) {
            var key = `sentence${i}`;

            if (key in fm) {
                let newSentence: Sentence = {
                    text: fm[key],
                    trans: fm[`trans${i}`],
                    origin: fm[`origin${i}`]
                };
                sentences.push(newSentence);
            } else { break; }
        }
        var expressioninfo: ExpressionInfo = {
            expression: expression,
            meaning: meaning,
            status: statusMap.indexOf(status),
            t: type,
            tags: tags,
            notes: notes,
            aliases: aliases,
            date: moment.utc(date).unix(),
            sentences: sentences,
        }
        return expressioninfo;
    }

    //解析所有单词文件的fm信息
    async parserAllFM() {
        const currentFolder = normalizePath(this.settings.word_folder || "");
        if (this.parserAllFMFolder !== currentFolder) {
            this.parserAllFMFolder = currentFolder;
            this.invalidateParserAllFMCache();
        }
        if (!this.parserAllFMDirty && this.parserAllFMCache) {
            return this.parserAllFMCache;
        }
        this.checkPath();
        var filesPath = (await this.app.vault.adapter.list(normalizePath(this.settings.word_folder))).files;
        var wordsinfo: ExpressionInfo[] = [];
        for (var filepath of filesPath) {
            var expressioninfo = await this.parserFM(filepath);
            if (expressioninfo) {
                wordsinfo.push(expressioninfo);
            }
        }
        this.parserAllFMCache = wordsinfo;
        this.parserAllFMDirty = false;
        return wordsinfo;
    }



}



export function processContent() {
    // 获取包含特定class的元素

    let textArea = document.querySelector('.text-area');

    if (textArea) {
        let htmlContent = textArea.innerHTML;
        //使用正则表达式匹配同时包含特定符号的 <p> 标签元素，并去除所有标签保留文本
        htmlContent = htmlContent.replace(/<p>(?=.*!)(?=.*\[)(?=.*\])(?=.*\()(?=.*\)).*<\/p>/g, function (match) {
            var pattern = /!\[(.*?)\]\((.*?)\)/;
            var str = match.replace(/<[^>]+>/g, '');
            var tq = pattern.exec(str);
            var img = document.createElement('img');
            var imgContainer = document.createElement('div');
            imgContainer.style.textAlign = 'center';  // 设置文本居中对齐
            var imgWrapper = document.createElement('div');
            imgWrapper.style.textAlign = 'center';  // 设置为内联块元素，使其水平居中

            if (tq) {
                var altText = tq[1];
                var srcUrl = tq[2];

                if (/^https?:\/\//.test(srcUrl)) {
                    img.alt = altText;
                    img.src = srcUrl;
                    imgWrapper.appendChild(img);
                    imgContainer.appendChild(imgWrapper);
                    return imgContainer.innerHTML;
                }
                else {
                    img.alt = altText;
                    img.src = mergeStrings(imgnum, srcUrl);
                    imgWrapper.appendChild(img);
                    imgContainer.appendChild(imgWrapper);
                    return imgContainer.innerHTML;
                }
            }

        });
        // 渲染多级标题
        htmlContent = htmlContent.replace(/(<span class="stns">)# (.*?)(<\/span>)(?=\s*<\/p>)/g, '<h1>$1$2$3</h1>');
        htmlContent = htmlContent.replace(/(<span class="stns">)## (.*?)(<\/span>)(?=\s*<\/p>)/g, '<h2>$1$2$3</h2>');
        htmlContent = htmlContent.replace(/(<span class="stns">)### (.*?)(<\/span>)(?=\s*<\/p>)/g, '<h3>$1$2$3</h3>');
        htmlContent = htmlContent.replace(/(<span class="stns">)#### (.*?)(<\/span>)(?=\s*<\/p>)/g, '<h4>$1$2$3</h4>');
        htmlContent = htmlContent.replace(/(<span class="stns">)##### (.*?)(<\/span>)(?=\s*<\/p>)/g, '<h5>$1$2$3</h5>');
        htmlContent = htmlContent.replace(/(<span class="stns">)###### (.*?)(<\/span>)(?=\s*<\/p>)/g, '<h6>$1$2$3</h6>');

        //渲染粗体
        htmlContent = htmlContent.replace(/(?<!\\)\*(?<!\\)\*(<span.*?>.*?<\/span>)(?<!\\)\*(?<!\\)\*/g, '<b>$1</b>');
        htmlContent = htmlContent.replace(/(?<!\\)\_(?<!\\)\_(<span.*?>.*?<\/span>)(?<!\\)\_(?<!\\)\_/g, '<b>$1</b>');

        //渲染斜体
        htmlContent = htmlContent.replace(/(?<!\\)\*(<span.*?>.*?<\/span>)(?<!\\)\*/g, '<i>$1</i>');
        htmlContent = htmlContent.replace(/(?<!\\)\_(<span.*?>.*?<\/span>)(?<!\\)\_/g, '<i>$1</i>');


        htmlContent = htmlContent.replace(/(?<!\\)\~(?<!\\)\~(<span.*?>.*?<\/span>)(?<!\\)\~(?<!\\)\~/g, '<del>$1</del>');

        textArea.innerHTML = htmlContent;
    } else {
        // 查找页面中的 img 元素并提取 imgnum 并存储到 localStorage 中
        var imgElements = document.getElementsByTagName('img');
        for (var i = 0; i < imgElements.length; i++) {
            if (imgElements[i].getAttribute('src')) {
                imgnum = imgElements[i].getAttribute('src');

                if (!imgnum.includes('http')) {
                    localStorage.setItem('imgnum', imgnum); // 存储到本地存储中
                    break; // 如果找到了，可以选择跳出循环
                }
            }
        }
    }
}

function mergeStrings(str1: string, str2: string) {
    // 获取 str2 的前 3 个字符
    let prefix = str2.substring(0, 3);
    // 在 str1 中查找 prefix 的位置
    let index = str1.indexOf(prefix);

    // 如果找到匹配的前缀
    if (index !== -1 && index !== 0 && str1.charAt(index - 1) === '/') {
        // 截断 str1 并与 str2 相连
        let firstPart = str1.substring(0, index);
        return firstPart + str2;
    } else {
        // 如果没有找到匹配的前缀，则返回 str1 和 str2 原样相连
        return str1 + str2;
    }
}

async function fetchData() {
    let previousContent = ''; // 上一次抓取到的内容
    return new Promise((resolve, reject) => {
        let intervalId = setInterval(() => {
            let textArea = document.querySelector('.text-area');

            if (textArea) {
                let currentContent = textArea.innerHTML.trim();

                // 检查 textArea 中是否包含 class 为 'article' 的元素
                let hasArticleClass = textArea.querySelector('.article') !== null;

                if (hasArticleClass) {
                    clearInterval(intervalId); // 内容无变化时清除定时器
                    resolve(currentContent); // 解析 Promise，传递最终内容
                } else {
                    previousContent = currentContent; // 更新上一次抓取的内容
                }
            } else {
                clearInterval(intervalId); // 内容无变化时清除定时器
                console.warn('.text-area element not found');
            }
        }, 100);
    });
}
