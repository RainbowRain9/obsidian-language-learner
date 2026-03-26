import { unified, Processor } from "unified";
import retextEnglish from "retext-english";
import { Root, Content, Literal, Parent, Sentence } from "nlcst";
import { modifyChildren } from "unist-util-modify-children";
import { visit } from "unist-util-visit";
import { toString } from "nlcst-to-string";
import { TFile } from "obsidian";

import { Phrase, Word } from "@/db/interface";
import { t } from "@/lang/helper";
import Plugin from "@/plugin";

const STATUS_MAP = ["ignore", "learning", "familiar", "known", "learned"];
type AnyNode = Root | Content | Content[];
export var state = { loading_flag: false, };

export class TextParser {
    // 记录短语位置
    phrases: Phrase[] = [];
    // 记录单词状态
    words: Map<string, Word> = new Map<string, Word>();
    // 记录音频嵌入
    audioEmbeds: Map<string, string> = new Map();
    // 渲染缓存（HTML + 统计结果）
    private htmlCache: Map<string, string> = new Map();
    private countCache: Map<string, [number, number, number]> = new Map();
    private readonly maxCacheSize = 30;
    pIdx: number = 0;
    plugin: Plugin;
    processor: Processor;
    constructor(plugin: Plugin) {
        this.plugin = plugin;
        this.processor = unified()
            .use(retextEnglish)
            .use(this.addPhrases())
            .use(this.addMarkdown())
            .use(this.stringfy2HTML());
    }

    invalidateCache() {
        this.htmlCache.clear();
        this.countCache.clear();
    }

    private touchCache<T>(cache: Map<string, T>, key: string, value: T) {
        if (cache.has(key)) {
            cache.delete(key);
        }
        cache.set(key, value);
        if (cache.size > this.maxCacheSize) {
            const oldestKey = cache.keys().next().value;
            cache.delete(oldestKey);
        }
    }

    async parse(data: string) {
        const trimmed = data.trim();
        if (!trimmed) {
            return "";
        }
        const cached = this.htmlCache.get(trimmed);
        if (cached) {
            this.touchCache(this.htmlCache, trimmed, cached);
            return cached;
        }
        const newHTML = await this.text2HTML(trimmed);
        this.touchCache(this.htmlCache, trimmed, newHTML);
        return newHTML;
    }

    async countWords(text: string): Promise<[number, number, number]> {
        const cleanText = text
            .replace(/!\[\[([^\]]+\.(?:mp3|wav|m4a|ogg|webm|flac))\]\]/gi, "")
            .trim();
        if (!cleanText) {
            return [0, 0, 0];
        }
        const cached = this.countCache.get(cleanText);
        if (cached) {
            this.touchCache(this.countCache, cleanText, cached);
            return cached;
        }
        // 等待数据库就绪，超时 5 秒
        const timeout = new Promise<boolean>((resolve) =>
            setTimeout(() => resolve(false), 5000)
        );
        const ready = new Promise<boolean>((resolve) =>
            this.plugin.db.waitForReady().then(() => resolve(true))
        );

        const isReady = await Promise.race([ready, timeout]);
        if (!isReady) {
            console.warn("Database not ready for countWords, returning default values");
            return [0, 0, 0];
        }

        const ast = this.processor.parse(cleanText);
        let wordSet: Set<string> = new Set();
        visit(ast, "WordNode", (word) => {
            let text = toString(word).toLowerCase();
            if (/[0-9\u4e00-\u9fa5]/.test(text)) return;
            wordSet.add(text);
        });
        await this.plugin.checkPath();
        let stored = await this.plugin.db.getStoredWords({
            article: "",
            words: [...wordSet],
        });
        let ignore = 0;
        stored.words.forEach((word) => {
            if (word.status === 0) ignore++;
        });
        let learn = stored.words.length - ignore;
        let unknown = wordSet.size - stored.words.length;
        const result: [number, number, number] = [unknown, learn, ignore];
        this.touchCache(this.countCache, cleanText, result);
        return result;
    }

    processAudioEmbeds(text: string): string {
        this.audioEmbeds.clear();
        // 匹配 ![[filename.ext]] 格式的音频文件
        const audioRegex = /!\[\[([^\]]+\.(?:mp3|wav|m4a|ogg|webm|flac))\]\]/gi;
        return text.replace(audioRegex, (match, filename) => {
            // 使用一个特殊的占位符，确保它被解析为一个单词
            const placeholder = `AUDIOEMBEDMARKER${this.audioEmbeds.size}`;
            this.audioEmbeds.set(placeholder, filename);
            return placeholder;
        });
    }

    async text2HTML(text: string) {
        this.pIdx = 0;
        this.words.clear();
        await this.plugin.checkPath();

        // 处理音频嵌入，替换为占位符
        text = this.processAudioEmbeds(text);

        // 查找已知短语，用于构造ast中的PhraseNode
        this.phrases = (
            await this.plugin.db.getStoredWords({
                article: text.toLowerCase(), //文章
                words: [],
            })
        ).phrases;

        const ast = this.processor.parse(text); //将文本 text 解析为抽象语法树（AST）

        // 遍历 AST，标记音频嵌入是 inline 还是 block
        visit(ast, "SentenceNode", (sentence: Sentence) => {
            const children = sentence.children;
            const audioNodes: Content[] = [];
            let hasText = false;

            children.forEach(child => {
                if (child.type === "WordNode") {
                    const text = toString(child);
                    if (this.audioEmbeds.has(text)) {
                        audioNodes.push(child);
                    } else {
                        hasText = true;
                    }
                } else if (child.type !== "WhiteSpaceNode") {
                    // 只要有非空白字符（包括标点），就视为有文本内容，音频应当 inline
                    hasText = true;
                }
            });

            audioNodes.forEach(node => {
                if (!node.data) node.data = {};
                node.data.inline = hasText;
            });
        });

        // 获得文章中去重后的单词
        let wordSet: Set<string> = new Set();
        visit(ast, "WordNode", (word) => {
            let wordText = toString(word);
            // 如果是音频占位符，不计入单词集合
            if (this.audioEmbeds.has(wordText)) return;
            wordSet.add(wordText.toLowerCase());
        });
        // 查询这些单词的status
        let stored = await this.plugin.db.getStoredWords({
            article: "",
            words: [...wordSet],
        });

        stored.words.forEach((w) => this.words.set(w.text, w));
        let HTML = this.processor.stringify(ast) as any as string;
        return HTML;
    }

    async getWordsPhrases(text: string) {
        const ast = this.processor.parse(text);
        let words: Set<string> = new Set();
        visit(ast, "WordNode", (word) => {
            words.add(toString(word).toLowerCase());
        });
        let wordsPhrases = await this.plugin.db.getStoredWords({
            article: text.toLowerCase(),
            words: [...words],
        });

        let payload = [] as string[];
        wordsPhrases.phrases.forEach((word) => {
            if (word.status > 0) payload.push(word.text);
        });
        wordsPhrases.words.forEach((word) => {
            if (word.status > 0) payload.push(word.text);
        });
        await this.plugin.checkPath();
        let res = await this.plugin.db.getExpressionsSimple(payload);
        return res;
    }

    // Plugin：在retextEnglish基础上，把AST上一些单词包裹成短语
    addPhrases() {
        let selfThis = this;
        return function (option = {}) {
            const proto = this.Parser.prototype;
            proto.useFirst("tokenizeParagraph", selfThis.phraseModifier);
        };
    }

    phraseModifier = modifyChildren(this.wrapWord2Phrase.bind(this));

    wrapWord2Phrase(node: Content, index: number, parent: Parent) {
        if (!node.hasOwnProperty("children")) return;

        if (
            this.pIdx >= this.phrases.length ||
            node.position.end.offset <= this.phrases[this.pIdx].offset
        )
            return;

        let children = (node as Sentence).children;

        let p: number;
        while (
            (p = children.findIndex(
                (child) =>
                    child.position.start.offset ===
                    this.phrases[this.pIdx].offset
            )) !== -1
        ) {
            let q = children.findIndex(
                (child) =>
                    child.position.end.offset ===
                    this.phrases[this.pIdx].offset +
                    this.phrases[this.pIdx].text.length
            );

            if (q === -1) {
                this.pIdx++;
                return;
            }
            let phrase = children.slice(p, q + 1);
            children.splice(p, q - p + 1, {
                type: "PhraseNode",
                children: phrase,
                position: {
                    start: { ...phrase.first().position.start },
                    end: { ...phrase.last().position.end },
                },
            } as any);

            this.pIdx++;

            if (
                this.pIdx >= this.phrases.length ||
                node.position.end.offset <= this.phrases[this.pIdx].offset
            )
                return;
        }
    }

    // Plugin: 处理 Markdown 格式 (粗体和斜体)
    addMarkdown() {
        let selfThis = this;
        return () => {
            return (tree: Root) => {
                // 第一遍：处理粗体 (**)
                visit(tree, 'SentenceNode', (node: Sentence) => {
                    selfThis.wrapDelimiters(node, '**', 'StrongNode');
                });

                // 第二遍：处理斜体 (*)
                // 需要同时遍历 SentenceNode 和 StrongNode，因为斜体可能嵌套在粗体中
                visit(tree, ['SentenceNode', 'StrongNode'], (node: any) => {
                    selfThis.wrapDelimiters(node, '*', 'EmphasisNode');
                });
            };
        };
    }

    wrapDelimiters(node: Parent, delimiter: string, nodeType: string) {
        let children = node.children;
        let i = 0;
        while (i < children.length) {
            if (children[i].type === 'SymbolNode' && (children[i] as Literal).value === delimiter) {
                // 找到开始定界符
                let j = i + 1;
                let foundEnd = false;
                while (j < children.length) {
                    if (children[j].type === 'SymbolNode' && (children[j] as Literal).value === delimiter) {
                        foundEnd = true;
                        break;
                    }
                    j++;
                }

                if (foundEnd) {
                    // 提取内容
                    let content = children.slice(i + 1, j);
                    // 移除定界符并用新节点替换内容
                    let newNode = {
                        type: nodeType,
                        children: content
                    };
                    children.splice(i, j - i + 1, newNode as any);
                    // 继续处理新节点之后的内容
                    i++;
                } else {
                    i++;
                }
            } else {
                i++;
            }
        }
    }

    // Compiler部分: 在AST转换为string时包裹上相应标签
    stringfy2HTML() {
        let selfThis = this;

        return function () {
            Object.assign(this, {
                Compiler: selfThis.compileHTML.bind(selfThis),
            });
        };
    }

    compileHTML(tree: Root): string {
        return this.toHTMLString(tree);
    }

    toHTMLString(node: AnyNode): string {
        if (node.hasOwnProperty("value")) {
            return (node as Literal).value;
        }
        if (node.hasOwnProperty("children")) {
            let n = node as Parent;
            switch (n.type) {
                case "WordNode": {
                    let text = toString(n.children);

                    // 检查是否为音频嵌入占位符
                    if (this.audioEmbeds.has(text)) {
                        const filename = this.audioEmbeds.get(text);
                        const file = this.plugin.app.metadataCache.getFirstLinkpathDest(filename, "");
                        if (file instanceof TFile) {
                            const src = this.plugin.app.vault.getResourcePath(file);
                            // 检查是否为人工录音（Scribe 或 Recording_ 开头）
                            const isHumanRecording = filename.toLowerCase().includes('scribe') ||
                                filename.toLowerCase().startsWith('recording_') ||
                                filename.toLowerCase().includes('/recording_');
                            const audioType = isHumanRecording ? 'human' : 'ai';
                            const title = isHumanRecording
                                ? t("Play Recording (Human Voice)")
                                : t("Play Audio (AI Voice)");

                            // 人工录音总是使用图标模式，其他音频根据 inline 属性决定
                            if (isHumanRecording) {
                                // 为 Scribe 录音使用人像图标 (Human Voice)
                                const icon = `<svg class="play-icon" viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor">
                                    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                                </svg>`;

                                // 如果是块级，添加包装器
                                if (n.data && n.data.inline) {
                                    return `<span class="langr-audio-inline-marker langr-audio-human" data-src="${src}" title="${title}">
                                        ${icon}
                                        <svg class="pause-icon" viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor">
                                            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                                        </svg>
                                    </span>`;
                                } else {
                                    return `<div class="langr-audio-block-wrapper">
                                        <span class="langr-audio-inline-marker langr-audio-human" data-src="${src}" title="${title}">
                                            ${icon}
                                            <svg class="pause-icon" viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor">
                                                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                                            </svg>
                                        </span>
                                    </div>`;
                                }
                            } else {
                                // AI 语音根据 inline 属性决定渲染样式
                                if (n.data && n.data.inline) {
                                    const icon = `<svg class="play-icon" viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor">
                                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                                    </svg>`;

                                    return `<span class="langr-audio-inline-marker langr-audio-ai" data-src="${src}" title="${title}">
                                        ${icon}
                                        <svg class="pause-icon" viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor">
                                            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                                        </svg>
                                    </span>`;
                                } else {
                                    return `<div class="langr-audio-block-wrapper"><audio controls src="${src}"></audio></div>`;
                                }
                            }
                        }
                        return `<span class="error" style="color: red;">${t("Audio file not found")}: ${filename}</span>`;
                    }

                    let textLower = text.toLowerCase();
                    let status = this.words.has(textLower)
                        ? STATUS_MAP[this.words.get(textLower).status]
                        : "new";

                    return /[0-9\u4e00-\u9fa5]/.test(text) // 不把数字当做单词
                        ? `<span class="other">${text}</span>`
                        : `<span class="word ${status}">${text}</span>`;
                }
                case "PhraseNode": {
                    let childText = toString(n.children);
                    let text = this.toHTMLString(n.children);
                    // 获取词组的status
                    let phrase = this.phrases.find(
                        (p) => p.text === childText.toLowerCase()
                    );
                    let status = STATUS_MAP[phrase.status];

                    return `<span class="phrase ${status}">${text}</span>`;
                }
                case "StrongNode": {
                    return `<b>${this.toHTMLString(n.children)}</b>`;
                }
                case "EmphasisNode": {
                    return `<i>${this.toHTMLString(n.children)}</i>`;
                }
                case "SentenceNode": {
                    return `<span class="stns">${this.toHTMLString(
                        n.children
                    )}</span>`;
                }
                case "ParagraphNode": {
                    return `<p>${this.toHTMLString(n.children)}</p>`;
                }
                default: {
                    return `<div class="article">${this.toHTMLString(
                        n.children
                    )}</div>`;
                }
            }
        }
        if (Array.isArray(node)) {
            let nodes = node as Content[];
            return nodes.map((n) => this.toHTMLString(n)).join("");
        }
    }
}

