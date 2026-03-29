import {
    Notice,
    Plugin,
    Menu,
    WorkspaceLeaf,
    ViewState,
    MarkdownView,
    Editor,
    TFile,
    MetadataCache,
    DataAdapter,
    normalizePath,
    Platform,
    TextFileView,
} from 'obsidian';
import { App as VueApp, createApp } from 'vue';
import { state } from "./parser";
import LanguageLearner from '@/plugin';
import ReadingArea from 'ReadingArea.vue';
import { t } from "@/lang/helper";
import DbProvider from "../db/base";
import { WordDB, Expression } from "../db/idb";
import {
    ArticleWords, Word, Phrase, WordsPhrase, Sentence,
    ExpressionInfo, ExpressionInfoSimple, CountInfo, WordCount, Span
} from "../db/interface";
export const READING_VIEW_TYPE: string = 'langr-reading';
export const READING_ICON: string = 'highlight-glyph';
const WORD_ENTRY_META_PREFIX = "<!--langr:";
const WORD_ENTRY_META_SUFFIX = "-->";
const WORD_ENTRY_DEVICE_ID_KEY = "langr-reading-device-id";

type WordEntryMeta = {
    source?: string;
    updatedAt?: string;
};

type ParsedWordSectionEntry = {
    key: string;
    line: string;
    meta: WordEntryMeta;
};

export class ReadingView extends TextFileView {
    plugin: LanguageLearner;
    text: string;
    actionButtons: Record<string, HTMLElement> = {};
    vueapp: VueApp;
    firstInit: boolean;
    lastPos: number;
    private saveWordsTimer: number | null = null;
    private saveWordsRunning = false;
    private saveWordsQueued = false;
    //MetadataCache=new MetadataCache;
    constructor(leaf: WorkspaceLeaf, plugin: LanguageLearner) {
        super(leaf);
        this.plugin = plugin;
        this.firstInit = true;
    }

    getIcon() {
        return READING_ICON;
    }

    getViewData(): string {
        return this.data;
    }

    //这段代码的主要作用是在 setViewData 方法被调用时，设置视图数据，
    //如果是第一次初始化 (firstInit 为 true)，则会异步获取特定的元数据 (langr-pos)，并创建一个 Vue 应用实例 (vueapp) 并挂载到指定的 DOM 元素上。
    async setViewData(data: string, clear?: boolean) {
        this.text = data;

        if (this.firstInit) {
            let lastPos = await this.plugin.frontManager.getFrontMatter(this.file, "langr-pos");
            this.lastPos = parseInt(lastPos);

            this.vueapp = createApp(ReadingArea);
            this.vueapp.config.globalProperties.plugin = this.plugin;
            this.vueapp.config.globalProperties.view = this;
            this.vueapp.mount(this.contentEl);

            this.firstInit = false;
        }
        //this.plugin.setMarkdownView(this.leaf, false)
    }

    getViewType(): string {
        return READING_VIEW_TYPE;
    }


    onPaneMenu(menu: Menu): void {
        menu
            .addItem((item) => {
                item
                    .setTitle(t("Return to Markdown"))
                    .setIcon("document")
                    .onClick(() => {
                        this.backToMarkdown();
                    });
            })
            .addSeparator();
        super.onPaneMenu(menu, "");
    }

    async backToMarkdown() {
        this.plugin.setMarkdownView(this.leaf);
        if ((await this.readContent("words")) === null) {
            return;
        }
        if (this.plugin.settings.use_fileDB && !this.plugin.settings.only_fileDB) {
            await this.plugin.createWordfiles(await this.getLearnWords());
        }

    }

    async getLearnWords() {
        var data = await this.readContent("article");
        var words = (await this.plugin.parser.getWordsPhrases(data))
            .map(w => `${w.expression}`); //单词列表
        return words
    }

    private normalizeWordEntryKey(expression?: string | null): string {
        return (expression || "").trim().toLowerCase();
    }

    private getWordEntryDeviceId(): string {
        const existing = localStorage.getItem(WORD_ENTRY_DEVICE_ID_KEY);
        if (existing?.trim()) {
            return existing.trim();
        }

        const generated = `device-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(WORD_ENTRY_DEVICE_ID_KEY, generated);
        return generated;
    }

    private serializeWordEntryMeta(meta: WordEntryMeta): string {
        const payload = {
            source: meta.source || this.getWordEntryDeviceId(),
            updatedAt: meta.updatedAt || new Date().toISOString(),
        };
        return `${WORD_ENTRY_META_PREFIX}${JSON.stringify(payload)}${WORD_ENTRY_META_SUFFIX}`;
    }

    private parseWordEntryMeta(line: string): { content: string; meta: WordEntryMeta } {
        const trimmed = line.trim();
        const metaMatch = new RegExp(`${WORD_ENTRY_META_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(.*?)${WORD_ENTRY_META_SUFFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`).exec(trimmed);
        if (!metaMatch) {
            return { content: trimmed, meta: {} };
        }

        const content = trimmed.slice(0, metaMatch.index).trimEnd();
        try {
            return {
                content,
                meta: JSON.parse(metaMatch[1]) as WordEntryMeta,
            };
        } catch {
            return { content: trimmed, meta: {} };
        }
    }

    private formatWordEntry(entry: ExpressionInfoSimple, meta?: WordEntryMeta): string {
        const content = this.plugin.settings.use_fileDB
            ? `+ **[[${entry.expression}]]** : ${entry.meaning}`
            : `+ **${entry.expression}** : ${entry.meaning}`;
        return `${content} ${this.serializeWordEntryMeta(meta || {})}`;
    }

    private parseWordSectionEntry(line: string): ParsedWordSectionEntry | null {
        const { content, meta } = this.parseWordEntryMeta(line);
        if (!content) {
            return null;
        }

        const linkedMatch = /^\+\s+\*\*\[\[([^\]]+)\]\]\*\*\s*:\s*(.+)$/.exec(content);
        if (linkedMatch) {
            return {
                key: this.normalizeWordEntryKey(linkedMatch[1]),
                line: line.trim(),
                meta,
            };
        }

        const plainMatch = /^\+\s+\*\*([^*]+)\*\*\s*:\s*(.+)$/.exec(content);
        if (plainMatch) {
            return {
                key: this.normalizeWordEntryKey(plainMatch[1]),
                line: line.trim(),
                meta,
            };
        }

        return null;
    }

    private compareWordEntryMeta(a: WordEntryMeta, b: WordEntryMeta): number {
        const aTime = a.updatedAt ? Date.parse(a.updatedAt) : Number.NaN;
        const bTime = b.updatedAt ? Date.parse(b.updatedAt) : Number.NaN;

        const safeATime = Number.isFinite(aTime) ? aTime : -1;
        const safeBTime = Number.isFinite(bTime) ? bTime : -1;
        if (safeATime !== safeBTime) {
            return safeATime - safeBTime;
        }

        const aSource = a.source || "";
        const bSource = b.source || "";
        return aSource.localeCompare(bSource);
    }

    private appendWordSectionContent(
        generatedEntries: ExpressionInfoSimple[],
        existingContent: string
    ): string {
        const existingLines = [] as string[];
        const existingKeys = new Set<string>();
        const existingEntries = new Map<string, ParsedWordSectionEntry>();
        existingContent.split(/\r?\n/).forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed) {
                return;
            }

            const parsedEntry = this.parseWordSectionEntry(trimmed);
            if (parsedEntry) {
                const previous = existingEntries.get(parsedEntry.key);
                if (!previous) {
                    existingEntries.set(parsedEntry.key, parsedEntry);
                    existingKeys.add(parsedEntry.key);
                    existingLines.push(parsedEntry.line);
                } else if (this.compareWordEntryMeta(previous.meta, parsedEntry.meta) < 0) {
                    existingEntries.set(parsedEntry.key, parsedEntry);
                    const existingIndex = existingLines.findIndex((existingLine) => {
                        const parsedExistingLine = this.parseWordSectionEntry(existingLine);
                        return parsedExistingLine?.key === parsedEntry.key;
                    });
                    if (existingIndex >= 0) {
                        existingLines[existingIndex] = parsedEntry.line;
                    }
                }
                return;
            }

            existingLines.push(trimmed);
        });

        const appendedLines = [] as string[];
        generatedEntries.forEach((entry) => {
            const key = this.normalizeWordEntryKey(entry.expression);
            if (!key || existingKeys.has(key)) {
                return;
            }
            existingKeys.add(key);
            appendedLines.push(this.formatWordEntry(entry, {
                source: this.getWordEntryDeviceId(),
                updatedAt: new Date().toISOString(),
            }));
        });

        return [...existingLines, ...appendedLines].join("\n");
    }

    //将获取到的单词和短语列表格式化为 Markdown 格式，并写入名为 "words" 的内容中
    async saveWords() {
        const existingWordsContent = await this.readContent("words");
        if (existingWordsContent === null) {
            return;
        }
        let data = await this.readContent("article");
        const entries = await this.plugin.parser.getWordsPhrases(data);
        const exprs = this.appendWordSectionContent(entries, existingWordsContent);
        await this.writeContent("words", exprs);
    }

    //将md拆分为三部分
    divide(lines: string[]) {
        let positions = [] as [string, number][];
        positions.push(["article", lines.indexOf("^^^article")],
            ["words", lines.indexOf("^^^words")],
            ["notes", lines.indexOf("^^^notes")]);
        positions.sort((a, b) => a[1] - b[1]);
        positions = positions.filter((v) => v[1] !== -1);
        positions.push(["eof", lines.length]);

        let segments = {} as { [K in string]: { start: number, end: number; } };
        for (let i = 0; i < positions.length - 1; i++) {
            segments[`${positions[i][0]}`] = { start: positions[i][1] + 1, end: positions[i + 1][1] };
        }
        return segments;
    }

    //用于读type内容
    async readContent(type: string, create: boolean = false): Promise<string> {
        let oldText = await this.plugin.app.vault.read(this.file);
        let lines = oldText.split("\n");
        let seg = this.divide(lines);
        if (!seg[type]) {
            if (create) {
                await this.plugin.app.vault.modify(this.file, oldText + `\n^^^${type}\n\n`);
                return "";
            }
            return null;
        }
        return lines.slice(seg[type].start, seg[type].end).join("\n");
    }

    //用于写type内容
    async writeContent(type: string, content: string): Promise<void> {
        let oldText = await this.plugin.app.vault.read(this.file);
        let lines = oldText.split("\n");
        let seg = this.divide(lines);
        if (!seg[type]) {
            return;
        }
        let newText = lines.slice(0, seg[type].start).join("\n") +
            "\n" + content.trim() + "\n\n" +
            lines.slice(seg[type].end, lines.length).join("\n");
        await this.plugin.app.vault.modify(this.file, newText);
    }

    scheduleSaveWords(delay = 150) {
        if (this.saveWordsTimer !== null) {
            window.clearTimeout(this.saveWordsTimer);
        }
        this.saveWordsTimer = window.setTimeout(() => {
            this.saveWordsTimer = null;
            void this.runSaveWords();
        }, delay);
    }

    private async runSaveWords() {
        if (this.saveWordsRunning) {
            this.saveWordsQueued = true;
            return;
        }
        this.saveWordsRunning = true;
        try {
            await this.saveWords();
        } finally {
            this.saveWordsRunning = false;
            if (this.saveWordsQueued) {
                this.saveWordsQueued = false;
                await this.runSaveWords();
            }
        }
    }

    async flushSaveWords() {
        if (this.saveWordsTimer !== null) {
            window.clearTimeout(this.saveWordsTimer);
            this.saveWordsTimer = null;
        }
        await this.runSaveWords();
    }

    clear(): void {

    }

    // 新词面板中提交后，刷新阅读页面中单词的状态
    refresh = (evt?: CustomEvent) => {
        let expression: string = evt.detail.expression.toLowerCase().trim();
        let surface: string = (evt.detail.surface || "").toLowerCase().trim();
        let type: string = evt.detail.type;
        let status: number = evt.detail.status;
        let meaning: string = evt.detail.meaning;
        let aliases: string[] = (evt.detail.aliases || [])
            .map((alias: string) => alias?.toLowerCase().trim())
            .filter((alias: string) => alias);
        if (surface && !aliases.includes(surface)) {
            aliases.push(surface);
        }
        const statusMap = ["ignore", "learning", "familiar", "known", "learned"];
        if (type === "WORD") {
            let wordEls = this.contentEl.querySelectorAll(".word"); //全文中的word元素
            if (wordEls.length === 0) {
                return;
            }
            wordEls.forEach((el) => {
                if (el.textContent.toLowerCase() === expression) {
                    el.className = `word ${statusMap[status]}`;
                }
            });
            wordEls.forEach((el) => {
                const textContent = el.textContent?.trim().toLowerCase(); // 获取元素的文本内容并转换为小写
                if (textContent && aliases.includes(textContent)) { // 检查是否匹配到括号中的单词
                    el.className = `word ${statusMap[status]}`; // 更新元素的类名以反映新的状态
                }
            });
            this.removeSelect();
            this.scheduleSaveWords();
        } else if (type === "PHRASE") {
            let phraseEls = this.contentEl.querySelectorAll(".phrase");
            let isExist = false;
            if (phraseEls.length > 0) {
                phraseEls.forEach((el) => {
                    if (el.textContent.toLowerCase() === expression || aliases.includes(el.textContent.toLowerCase())) {
                        isExist = true;
                        el.className = `phrase ${statusMap[status]}`;
                    }
                });
            }

            this.removeSelect();
            if (isExist) {
                this.scheduleSaveWords();
                return;
            }

            // 词组拆分成单词和空格
            let words: string[] = [];
            expression.split(" ").forEach((w) => {
                if (w !== "") {
                    words.push(w, " ");
                }
            });
            words.pop();//移除最后一个空格
            words.push(",");
            for (let aliase of aliases) {
                aliase.split(" ").forEach((w) => {
                    if (w !== "") {
                        words.push(w, " ");
                    }
                });
                words.pop();//移除最后一个空格
                words.push(",");
            }

            let isMatch = (startEl: Element, words: string[]) => {
                let phrases: string[][] = [];
                let currentPhrase: string[] = [];

                // 将 words 数组拆分成短语
                words.forEach(word => {
                    if (word === ",") {
                        if (currentPhrase.length > 0) {
                            phrases.push(currentPhrase);
                            currentPhrase = [];
                        }
                    } else {
                        currentPhrase.push(word);
                    }
                });
                // 将最后一个短语添加到 phrases 中
                if (currentPhrase.length > 0) {
                    phrases.push(currentPhrase);
                }

                // 尝试匹配每个短语
                for (let phrase of phrases) {
                    let el = startEl as any;
                    let container: Element[] = [];
                    let matched = true;

                    for (let word of phrase) {
                        if (!el || el.textContent.toLowerCase() !== word) {
                            matched = false;
                            break;
                        }
                        container.push(el);
                        el = el.nextSibling;
                    }

                    // 如果成功匹配到某个短语，返回匹配的元素
                    if (matched) {
                        return container;
                    }
                }

                // 如果没有匹配到任何短语，返回 null
                return null;
            };

            // 在匹配词组的单词元素外面包一个span.phrase
            let sentencesEls = this.containerEl.querySelectorAll(".stns");
            sentencesEls.forEach((senEl) => {
                let children = senEl.children;
                let idx = -1;
                while (idx++ < children.length) {
                    let container;
                    if (container = isMatch(children[idx], words)) {

                        let phraseEl = createSpan({ cls: `phrase ${statusMap[status]}` });
                        senEl.insertBefore(phraseEl, children[idx]);
                        container.forEach((el) => {
                            el.remove();
                            phraseEl.appendChild(el);
                        });
                        idx += words.length - 1;
                    }
                }
            });
            this.scheduleSaveWords();
        }
    };

    //元素包裹在一个新的 <span> 元素中，并设置其类名为 select。
    wrapSelect(elStart: HTMLElement, elEnd: HTMLElement) {
        this.removeSelect();
        if (!elStart.matchParent(".stns") ||
            !elEnd.matchParent(".stns") ||
            elStart.parentElement !== elEnd.parentElement) {
            return null;
        }
        let parent = elStart.parentNode;
        let selectSpan = document.body.createSpan({ cls: "select" });
        parent.insertBefore(selectSpan, elStart);
        for (let el: Node = elStart; el !== elEnd;) {
            let next = el.nextSibling;
            selectSpan.appendChild(el);
            el = next;
        }
        selectSpan.appendChild(elEnd);
        return selectSpan;
    }

    removeSelect() {
        //把span.select里面的东西拿出来
        let selects = this.contentEl.querySelectorAll("span.select");
        selects.forEach((el: HTMLElement) => {
            let parent = el.parentElement;
            let children: Node[] = [];
            el.childNodes.forEach((child) => {
                children.push(child);
            });
            for (let c of children) {
                parent.insertBefore(c, el);
            }
            el.remove();
        });
    }

    initHeaderButtons() {
        // 检查 addAction 方法是否存在
        if (typeof this.addAction === 'function') {
            this.addAction("book", t("Return to Markdown"), () => {
                this.backToMarkdown();
            });
        } else {
            console.warn("addAction method not available in ReadingView");
        }
    }

    //添加一个自定义事件 "obsidian-langr-refresh" 的监听器，并将其绑定到 this.refresh 方法。当该事件被触发时，会执行 this.refresh 方法
    async onOpen() {
        addEventListener("obsidian-langr-refresh", this.refresh);
        this.initHeaderButtons();

        // const contentEl = this.contentEl.createEl("div", {
        //     cls: "langr-reading",
        // })

    }

    async onClose() {
        removeEventListener("obsidian-langr-refresh", this.refresh);
        this.vueapp.unmount();
        await this.flushSaveWords();
    }

}
