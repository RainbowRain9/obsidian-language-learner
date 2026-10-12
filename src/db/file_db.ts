import {
    normalizePath,
    Platform,
    moment,
    MetadataCache,
    TFile,
} from "obsidian";
import { createAutomaton, Automaton } from "ac-auto";
import { exportDB, importInto } from "dexie-export-import";
import download from "downloadjs";
import {
    ArticleWords, Word, Phrase, WordsPhrase, Sentence,
    ExpressionInfo, ExpressionInfoSimple, CountInfo, WordCount, Span
} from "./interface";
import DbProvider from "./base";
import { WordDB, Expression } from "./idb";
import Plugin from "@/plugin";

// 保留调用方携带的日期：毫秒时间戳归一为秒（LearnPanel 传 Date.now()），NaN/缺失回退当前时间
// （updateIndexDB 经 parserFM 解析的 date 在文件缺 date 键时为 NaN，不能写入库/文件）
function preserveDate(date: number | undefined): number {
    if (!Number.isFinite(date)) return moment().unix();
    return date > 1e12 ? Math.floor(date / 1000) : date;
}

// 净化词条 expression 作为文件名：替换文件系统与 Obsidian 的非法字符
// （含 '/'，避免拼出嵌套子路径导致单词文件永远读不回或创建失败）
function sanitizeFileName(name: string): string {
    return name.replace(/[\\/:*?"<>|#^\[\]]/g, "-");
}

export class FileDb extends DbProvider {
    idb: WordDB;
    plugin: Plugin;

    // Alias 缓存优化
    private aliasCache: Map<string, Expression> | null = null;
    private aliasCacheTime: number = 0;
    private readonly ALIAS_CACHE_TTL = 300000; // 5分钟缓存
    // 缓存代数：invalidate 时递增，用于识别重建期间是否又发生了失效
    private aliasCacheGeneration = 0;
    private phraseCache: Map<string, number> | null = null;
    private phraseAutomaton: Automaton | null = null;
    private phraseCacheTime = 0;
    private phraseCacheGeneration = 0;
    private readonly PHRASE_CACHE_TTL = 300000;

    constructor(plugin: Plugin) {
        super();
        this.plugin = plugin;
        this.idb = new WordDB(plugin);
    }

    // 获取 alias 缓存，避免全表扫描
    private async getAliasCache(): Promise<Map<string, Expression>> {
        const now = Date.now();
        if (this.aliasCache && (now - this.aliasCacheTime) < this.ALIAS_CACHE_TTL) {
            return this.aliasCache;
        }

        // 记录重建前的代数：若重建期间发生失效（invalidate 递增代数），
        // 不把基于旧数据的 Map 回写为缓存，避免 invalidate 效果被覆盖
        const generation = this.aliasCacheGeneration;
        const aliasCache = new Map();
        await this.idb.expressions.each(expr => {
            if (expr.aliases?.length) {
                expr.aliases.forEach(alias => {
                    aliasCache.set(alias.toLowerCase(), expr);
                });
            }
        });
        if (generation === this.aliasCacheGeneration) {
            this.aliasCache = aliasCache;
            this.aliasCacheTime = now;
        }
        return aliasCache;
    }

    // 清除 alias 缓存（在数据变更时调用）
    public invalidateAliasCache(): void {
        this.aliasCacheGeneration++;
        this.aliasCache = null;
        this.aliasCacheTime = 0;
    }

    private async getPhraseCache(): Promise<Map<string, number>> {
        const now = Date.now();
        if (this.phraseCache && (now - this.phraseCacheTime) < this.PHRASE_CACHE_TTL) {
            return this.phraseCache;
        }
        const generation = this.phraseCacheGeneration;
        const phraseMap = new Map<string, number>();
        await this.idb.expressions
            .where("t").equals("PHRASE")
            .each(expr => {
                // 键统一小写：ac 自动机匹配的文本是小写文章，键保留原大小写会永不命中
                phraseMap.set(expr.expression.toLowerCase(), expr.status);
                if (expr.aliases) {
                    for (let item of expr.aliases) {
                        phraseMap.set(item.toLowerCase(), expr.status);
                    }
                }
            });

        const wordsinfo = await this.plugin.parserAllFM();
        wordsinfo
            .filter(word => word.t === "PHRASE")
            .forEach(word => {
                phraseMap.set(word.expression.toLowerCase(), word.status);
                if (word.aliases) {
                    for (let item of word.aliases) {
                        phraseMap.set(item.toLowerCase(), word.status);
                    }
                }
            });

        if (generation === this.phraseCacheGeneration) {
            this.phraseCache = phraseMap;
            this.phraseCacheTime = now;
            this.phraseAutomaton = null;
        }
        return phraseMap;
    }

    private async getPhraseAutomaton(): Promise<Automaton | null> {
        const phraseMap = await this.getPhraseCache();
        if (phraseMap.size === 0) {
            return null;
        }
        if (!this.phraseAutomaton) {
            this.phraseAutomaton = await createAutomaton([...phraseMap.keys()]);
        }
        return this.phraseAutomaton;
    }

    private invalidatePhraseCache(): void {
        this.phraseCacheGeneration++;
        this.phraseCache = null;
        this.phraseAutomaton = null;
        this.phraseCacheTime = 0;
    }

    async open() {
        await this.idb.open();
        this.markReady(); // 标记数据库已就绪
        return;
    }

    close() {
        this.idb.close();
    }

    async getFilesPath() {
        var filesPath = (await this.plugin.app.vault.adapter.list(normalizePath(this.plugin.settings.word_folder))).files;
        return filesPath;
    }

    // 寻找页面中已经记录过的单词和词组
    async getStoredWords(payload: ArticleWords): Promise<WordsPhrase> {
        let searchedPhrases: Phrase[] = [];
        if (payload.article?.trim()) {
            const phraseMap = await this.getPhraseCache();
            if (phraseMap.size > 0) {
                const ac = await this.getPhraseAutomaton();
                if (ac) {
                    searchedPhrases = (await ac.search(payload.article)).map(match => {
                        return { text: match[1], status: phraseMap.get(match[1]), offset: match[0] } as Phrase;
                    });
                }
            }
        }

        let storedWords: Word[] = [];
        if (payload.words?.length) {
            const wordMap = new Map<string, Word>();
            let storedWordsExpression = await this.idb.expressions
                .where("expression").anyOf(payload.words)
                .toArray();
            storedWordsExpression.forEach(expr => {
                const key = expr.expression.toLowerCase();
                if (!wordMap.has(key)) {
                    wordMap.set(key, { text: expr.expression, status: expr.status } as Word);
                }
                if (expr.surface) {
                    const surfaceKey = expr.surface.toLowerCase();
                    if (payload.words.includes(surfaceKey) && !wordMap.has(surfaceKey)) {
                        wordMap.set(surfaceKey, { text: expr.surface, status: expr.status } as Word);
                    }
                }
            });

            const aliasCache = await this.getAliasCache();
            for (const word of payload.words) {
                const expr = aliasCache.get(word.toLowerCase());
                if (expr) {
                    const key = word.toLowerCase();
                    if (!wordMap.has(key)) {
                        wordMap.set(key, { text: word, status: expr.status } as Word);
                    }
                }
            }

            const wordsinfo = await this.plugin.parserAllFM();
            wordsinfo.forEach(expr => {
                if (expr.aliases?.length) {
                    expr.aliases.forEach(word => {
                        const normalizedWord = word.toLowerCase();
                        if (payload.words.includes(normalizedWord)) {
                            if (!wordMap.has(normalizedWord)) {
                                wordMap.set(normalizedWord, { text: word, status: expr.status } as Word);
                            }
                        }
                    });
                }
                const normalizedExpression = expr.expression.toLowerCase();
                if (payload.words.includes(normalizedExpression)) {
                    if (!wordMap.has(normalizedExpression)) {
                        wordMap.set(normalizedExpression, { text: expr.expression, status: expr.status } as Word);
                    }
                }
                if (expr.surface) {
                    const normalizedSurface = expr.surface.toLowerCase();
                    if (payload.words.includes(normalizedSurface) && !wordMap.has(normalizedSurface)) {
                        wordMap.set(normalizedSurface, { text: expr.surface, status: expr.status } as Word);
                    }
                }
            });

            storedWords = [...wordMap.values()];
        }

        return { words: storedWords, phrases: searchedPhrases };
    }

    async getExpression(expression: string): Promise<ExpressionInfo> {
        expression = expression.toLowerCase();
        let expr = await this.idb.expressions
            .where("expression").equals(expression).first();

        if (!expr) {
            expr = await this.idb.expressions
                .filter(item => item.aliases?.includes(expression)).first();
            if (!expr) {
                const exprLower = expression.toLowerCase();
                var wordsinfo = await this.plugin.parserAllFM();
                return wordsinfo.find(word => {
                    const aliases = Array.isArray(word.aliases) ? word.aliases : [];
                    return word.expression?.toLowerCase() === exprLower ||
                        word.surface?.toLowerCase() === exprLower ||
                        aliases.some(alias => alias?.toLowerCase() === exprLower);
                }) || null;
            }
        }

        let sentences = await this.idb.sentences
            .where("id").anyOf([...expr.sentences.values()])
            .toArray();
        return {
            expression: expr.expression,
            surface: expr.surface,
            meaning: expr.meaning,
            status: expr.status,
            t: expr.t,
            notes: expr.notes,
            sentences,
            tags: [...expr.tags.keys()],
            aliases: expr.aliases,
            date: expr.date,
        };

    }

    async getExpressionsSimple(expressions: string[]): Promise<ExpressionInfoSimple[]> {
        expressions = expressions.map(e => e.toLowerCase());

        let exprs1 = (await this.idb.expressions
            .where("expression")
            .anyOf(expressions)
            .toArray())
            .map(v => {
                return {
                    expression: v.expression,
                    meaning: v.meaning,
                    status: v.status,
                    t: v.t,
                    tags: [...v.tags.keys()],
                    sen_num: v.sentences.size,
                    note_num: v.notes.length,
                    date: v.date,
                    aliases: v.aliases,
                };
            }) as ExpressionInfoSimple[];

        let exprs2 = (await this.plugin.parserAllFM())
            .filter(word => {
                const aliases = Array.isArray(word.aliases) ? word.aliases : [];
                return expressions.includes(word.expression.toLowerCase()) ||
                    (word.surface ? expressions.includes(word.surface.toLowerCase()) : false) ||
                    aliases.some(alias => expressions.includes(alias.toLowerCase()));
            })
            .map(v => {
                return {
                    expression: v.expression,
                    meaning: v.meaning,
                    status: v.status,
                    t: v.t,
                    tags: v.tags,
                    sen_num: v.sentences.length,
                    note_num: v.notes.length,
                    date: v.date,
                    aliases: v.aliases,
                    next_review: v.next_review,
                }
            }) as ExpressionInfoSimple[];

        return [...exprs1, ...exprs2];
    }

    async getExprall(expressions: string[]): Promise<ExpressionInfo[]> {
        expressions = expressions.map(expression => expression.toLowerCase());
        return (await this.plugin.parserAllFM())
            .filter(word => {
                const aliases = Array.isArray(word.aliases) ? word.aliases : [];
                return expressions.includes(word.expression.toLowerCase()) ||
                    (word.surface ? expressions.includes(word.surface.toLowerCase()) : false) ||
                    aliases.some(alias => expressions.includes(alias.toLowerCase()));
            });
    }



    async getExpressionAfter(time: string): Promise<ExpressionInfo[]> {
        let unixStamp = moment.utc(time).unix();
        let wordsAfter = await this.idb.expressions
            .where("status").above(0)
            .and(expr => expr.date > unixStamp)
            .toArray();

        let res: ExpressionInfo[] = [];
        for (let expr of wordsAfter) {
            let sentences = await this.idb.sentences
                .where("id").anyOf([...expr.sentences.values()])
                .toArray();

            res.push({
                expression: expr.expression,
                surface: expr.surface,
                meaning: expr.meaning,
                status: expr.status,
                t: expr.t,
                notes: expr.notes,
                sentences,
                tags: [...expr.tags.keys()],
                aliases: expr.aliases,
                date: expr.date,
            });
        }

        let exprs2 = (await this.plugin.parserAllFM())
            .filter(word => word.date > unixStamp);

        return [...res, ...exprs2];
    }

    async getAllExpressionSimple(ignores?: boolean): Promise<ExpressionInfoSimple[]> {
        //let exprs: ExpressionInfoSimple[];
        //let bottomStatus = ignores ? -1 : 0;

        let exprs1 = (await this.plugin.parserAllFM())
            .map(v => {
                return {
                    expression: v.expression,
                    meaning: v.meaning,
                    status: v.status,
                    t: v.t,
                    tags: v.tags,
                    sen_num: v.sentences.length,
                    note_num: v.notes.length,
                    date: v.date,
                    aliases: v.aliases,
                    next_review: v.next_review,
                }
            }) as ExpressionInfoSimple[];
        if (ignores) {
            let exprs2 = (await this.idb.expressions.toArray())
                .map((expr): ExpressionInfoSimple => {
                    return {
                        expression: expr.expression,
                        status: expr.status,
                        meaning: expr.meaning,
                        t: expr.t,
                        tags: [...expr.tags.keys()],
                        note_num: expr.notes.length,
                        sen_num: expr.sentences.size,
                        date: expr.date,
                        aliases: expr.aliases,
                    };
                }) as ExpressionInfoSimple[];
            return [...exprs1, ...exprs2];
        } else {
            return exprs1;
        }

    }

    async postExpression(payload: ExpressionInfo): Promise<number> {
        // 清除 alias 缓存，确保新数据生效
        this.invalidateAliasCache();
        this.invalidatePhraseCache();

        // 保留词条原日期（迁移/导入场景），不再一律覆盖为当前时间
        payload.date = preserveDate(payload.date);
        var stored = await this.idb.expressions
            .where("expression").equals(payload.expression)
            .first();
        var path = this.plugin.settings.word_folder;
        // 文件名净化：expression 含 '/' 会拼出嵌套子路径（目录列举不递归，文件读不回），
        // 含 Windows 非法字符则 vault.create 直接抛错
        var safeName = sanitizeFileName(payload.expression);
        if (path[path.length - 1] === '/') {
            var filePath = path + `${safeName}.md`;
        } else {
            var filePath = path + '/' + `${safeName}.md`;
        }
        await this.plugin.checkPath();
        if (payload.status) {
            const existingText = await this.plugin.readWordFileText(filePath);
            var fm = await this.plugin.createFM(payload, existingText);
            try {
                await app.vault.create(filePath, fm);
            } catch (err) {
                if (err.message.includes('File already exists')) {
                    const existingFile = this.plugin.app.vault.getAbstractFileByPath(filePath);
                    if (existingFile instanceof TFile) {
                        await this.plugin.app.vault.modify(existingFile, fm);
                    } else {
                        await this.plugin.app.vault.adapter.write(normalizePath(filePath), fm);
                    }
                } else {
                    throw err;
                }
            }
            if (stored) {
                await this.idb.expressions.delete(stored.id);
            }

        } else {
            let sentences = new Set<number>();
            for (let sen of payload.sentences) {
                let searched = await this.idb.sentences.where("text").equals(sen.text).first();
                if (searched) {
                    await this.idb.sentences.update(searched.id, sen);
                    sentences.add(searched.id);
                } else {
                    let id = await this.idb.sentences.add(sen);
                    sentences.add(id);
                }
            }

            let updatedWord = {
                expression: payload.expression,
                surface: payload.surface,
                meaning: payload.meaning,
                status: payload.status,
                t: payload.t,
                notes: payload.notes,
                sentences,
                tags: new Set<string>(payload.tags),
                aliases: payload.aliases,
                date: payload.date
            };
            if (stored) {
                await this.idb.expressions.update(stored.id, updatedWord);
            } else {
                await this.idb.expressions.add(updatedWord);
            }
            try {
                let file = app.vault.getAbstractFileByPath(filePath);
                if (file instanceof TFile) {
                    await app.vault.delete(file);
                }
            } catch (err) { }

        }

        this.plugin.notifyWordStorageChanged();
        this.plugin.parser?.invalidateCache?.();
        return 200;
    }

    async getTags(): Promise<string[]> {
        let allTags = new Set<string>();
        for (var exp of (await this.plugin.parserAllFM())) {
            for (var tag of exp.tags) { allTags.add(tag) }
        }
        await this.idb.expressions.each(expr => {
            for (let t of expr.tags.values()) {
                allTags.add(t);
            }
        });
        return [...allTags.values()];
    }

    async postIgnoreWords(payload: string[]): Promise<void> {
        // 先去重：bulkPut 的项不带主键时等价于 add，重复 expression 会违反 &expression 唯一索引
        const unique = [...new Set(payload)];
        if (unique.length === 0) return;
        // 查出已存在词条的 id 并随 bulkPut 带上主键，实现真正的 upsert（重复 ignore 不再抛 ConstraintError）
        const existing = await this.idb.expressions
            .where("expression").anyOf(unique).toArray();
        const existingIds = new Map(existing.map(expr => [expr.expression, expr.id]));
        await this.idb.expressions.bulkPut(
            unique.map(expr => {
                return {
                    ...(existingIds.has(expr) ? { id: existingIds.get(expr) } : {}),
                    expression: expr,
                    meaning: "",
                    status: 0,
                    t: "WORD",
                    notes: [] as string[],
                    sentences: new Set(),
                    tags: new Set(),
                    aliases: [] as string[],
                    date: moment().unix(),
                };
            })
        );
        this.invalidatePhraseCache();
        this.plugin.parser?.invalidateCache?.();
        return;
    }

    async tryGetSen(text: string): Promise<Sentence> {
        let stored = (await this.plugin.parserAllFM()).find(word => word.sentences.find(sentence => sentence.text === text));
        if (stored) {
            return stored.sentences.find(sentence => sentence.text === text);
        } else {
            let store = await this.idb.sentences.where("text").equals(text).first();
            return store;
        }
    }

    async getCount(): Promise<CountInfo> {
        let counts: { "WORD": number[], "PHRASE": number[]; } = {
            "WORD": new Array(5).fill(0),
            "PHRASE": new Array(5).fill(0),
        };
        (await this.plugin.parserAllFM()).forEach(word => {
            // word_folder 混入无 type 键的普通笔记（t=''）时跳过该条目，不让整个统计抛错
            const bucket = counts[word.t as "WORD" | "PHRASE"];
            if (bucket) {
                bucket[word.status]++;
            }
        });
        // await this.idb.expressions.each(expr => {
        //     counts[expr.t as "WORD" | "PHRASE"][expr.status]++;
        // });
        return {
            word_count: counts.WORD,
            phrase_count: counts.PHRASE
        };
    }

    async countSeven(): Promise<WordCount[]> {
        let spans: Span[] = [];
        spans = [0, 1, 2, 3, 4, 5, 6].map((i) => {
            let start = moment().subtract(6, "days").startOf("day");
            let from = start.add(i, "days");
            return {
                from: from.unix(),
                to: from.endOf("day").unix(),
            };
        });

        let res: WordCount[] = [];
        let word = await this.plugin.parserAllFM();
        // 对每一天计算
        for (let span of spans) {
            // 当日
            let today = new Array(5).fill(0);
            word.filter(expr => {
                return expr.t == "WORD" &&
                    expr.date >= span.from &&
                    expr.date <= span.to;
            }).forEach(expr => {
                today[expr.status]++;
            });
            // 累计
            let accumulated = new Array(5).fill(0);
            word.filter(expr => {
                return expr.t == "WORD" &&
                    expr.date <= span.to;
            }).forEach(expr => {
                accumulated[expr.status]++;
            });

            res.push({ today, accumulated });
        }

        return res;
    }

    async importDB(file: File) {
        await this.idb.delete();
        await this.idb.open();
        await importInto(this.idb, file, {
            acceptNameDiff: true
        });
        // 导入即整体换库：显式失效各层缓存，避免 TTL 内继续读到旧词库
        this.invalidateAliasCache();
        this.invalidatePhraseCache();
        this.plugin.notifyWordStorageChanged();
    }

    async exportDB() {
        let blob = await exportDB(this.idb);
        try {
            download(blob, `${this.idb.dbName}.json`, "application/json");
        } catch (e) {
            console.error("error exporting database");
        }
    }

    async destroyAll() {
        const res = await this.idb.delete();
        // 清库后显式失效各层缓存，避免 TTL 内继续读到旧词库
        this.invalidateAliasCache();
        this.invalidatePhraseCache();
        this.plugin.notifyWordStorageChanged();
        return res;
    }
}


