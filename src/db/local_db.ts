import { moment, Notice } from "obsidian";
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


export class LocalDb extends DbProvider {
    idb: WordDB;
    plugin: Plugin;
    private phraseCache: Map<string, number> | null = null;
    private phraseAutomaton: Automaton | null = null;
    private phraseCacheTime = 0;
    private readonly PHRASE_CACHE_TTL = 300000;
    private expressionsSimpleCache: Map<string, { ts: number; data: ExpressionInfoSimple[] }> = new Map();
    private readonly EXPRESSIONS_SIMPLE_TTL = 30000;
    private readonly EXPRESSIONS_SIMPLE_MAX = 50;
    constructor(plugin: Plugin) {
        super();
        this.plugin = plugin;
        this.idb = new WordDB(plugin);
    }

    private async getPhraseCache(): Promise<Map<string, number>> {
        const now = Date.now();
        if (this.phraseCache && (now - this.phraseCacheTime) < this.PHRASE_CACHE_TTL) {
            return this.phraseCache;
        }
        const phraseMap = new Map<string, number>();
        await this.idb.expressions
            .where("t").equals("PHRASE")
            .each(expr => {
                phraseMap.set(expr.expression, expr.status);
                if (expr.aliases) {
                    for (let item of expr.aliases) {
                        phraseMap.set(item, expr.status);
                    }
                }
            });
        this.phraseCache = phraseMap;
        this.phraseCacheTime = now;
        this.phraseAutomaton = null;
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

    private invalidatePhraseCache() {
        this.phraseCache = null;
        this.phraseAutomaton = null;
        this.phraseCacheTime = 0;
    }

    private getExpressionsSimpleCache(key: string): ExpressionInfoSimple[] | null {
        const cached = this.expressionsSimpleCache.get(key);
        if (!cached) return null;
        if (Date.now() - cached.ts > this.EXPRESSIONS_SIMPLE_TTL) {
            this.expressionsSimpleCache.delete(key);
            return null;
        }
        this.expressionsSimpleCache.delete(key);
        this.expressionsSimpleCache.set(key, cached);
        return cached.data;
    }

    private setExpressionsSimpleCache(key: string, data: ExpressionInfoSimple[]) {
        if (this.expressionsSimpleCache.has(key)) {
            this.expressionsSimpleCache.delete(key);
        }
        this.expressionsSimpleCache.set(key, { ts: Date.now(), data });
        if (this.expressionsSimpleCache.size > this.EXPRESSIONS_SIMPLE_MAX) {
            const oldestKey = this.expressionsSimpleCache.keys().next().value;
            this.expressionsSimpleCache.delete(oldestKey);
        }
    }

    private invalidateExpressionsSimpleCache() {
        this.expressionsSimpleCache.clear();
    }

    async open() {
        await this.idb.open();
        this.markReady(); // 标记数据库已就绪
        return;
    }

    close() {
        this.idb.close();
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
            let storedWordsExpression = await this.idb.expressions
                .where("expression").anyOf(payload.words)
                .toArray();

            let storedWordsMeaning = await this.idb.expressions
                .where("aliases").anyOf(payload.words)
                .toArray()
                .then(expressions => {
                    return expressions.flatMap(expr => {
                        return expr.aliases
                            .filter(alias => payload.words.includes(alias))
                            .map(alias => ({
                                expression: alias,
                                status: expr.status
                            }));
                    });
                });

            const wordMap = new Map<string, Word>();
            storedWordsExpression.forEach(expr => {
                const key = expr.expression.toLowerCase();
                if (!wordMap.has(key)) {
                    wordMap.set(key, { text: expr.expression, status: expr.status } as Word);
                }
            });
            storedWordsMeaning.forEach(expr => {
                const key = expr.expression.toLowerCase();
                if (!wordMap.has(key)) {
                    wordMap.set(key, { text: expr.expression, status: expr.status } as Word);
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
            // 使用 aliases 索引查询
            expr = await this.idb.expressions.where("aliases").equals(expression).first();
            if (!expr) { return null; }
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

        const cacheKey = expressions.slice().sort().join("|");
        const cached = this.getExpressionsSimpleCache(cacheKey);
        if (cached) {
            return cached;
        }

        let exprs = await this.idb.expressions
            .where("expression")
            .anyOf(expressions)
            .toArray();

        const result = exprs.map(v => {
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
        });
        this.setExpressionsSimpleCache(cacheKey, result);
        return result;
    }

    async getExprall(expressions: string[]): Promise<ExpressionInfo[]> {
        expressions = expressions.map(expression => expression.toLowerCase());

        // 查询所有表达式的 expressions 和 aliases
        let exprMap = new Map<string, Expression>();
        let aliasesMap = new Map<string, Expression>();

        // const promises = [
        //     this.idb.expressions.where("expression").anyOf(expressions).each(expr => {
        //         exprMap.set(expr.expression.toLowerCase(), expr);
        //     })
        // ];
        // // 检查是否有别名
        // const hasAliases = await this.idb.expressions.filter(item => item.aliases && item.aliases.length > 0).count();

        // if (hasAliases > 0) {
        //     promises.push(
        //         this.idb.expressions.filter(item => item.aliases.some(alias => expressions.includes(alias))).each(expr => {
        //             expr.aliases.forEach(alias => {
        //                 aliasesMap.set(alias.toLowerCase(), expr);
        //             });
        //         })
        //     );
        // }

        // // 等待所有 Promise 完成
        // await Promise.all(promises);
        //         await Promise.all([
        //             this.idb.expressions.where("expression").anyOf(expressions).each(expr => {
        //                 exprMap.set(expr.expression.toLowerCase(), expr);
        //             }),
        //             this.idb.expressions.filter(item => item.aliases.some(alias => expressions.includes(alias))).each(expr => {
        //                 expr.aliases.forEach(alias => {
        //                     aliasesMap.set(alias.toLowerCase(), expr);
        //                 });
        //             })
        //         ]);
        await Promise.all([
            this.idb.expressions.where("expression").anyOf(expressions).each(expr => {
                exprMap.set(expr.expression.toLowerCase(), expr);
            }),
            // 使用 aliases 索引查询
            this.idb.expressions.where("aliases").anyOf(expressions).each(expr => {
                expr.aliases.forEach(alias => {
                    if (expressions.includes(alias)) {
                        aliasesMap.set(alias.toLowerCase(), expr);
                    }
                });
            })
        ]);
        // 组装结果
        let expressionInfos: ExpressionInfo[] = [];

        for (let expression of expressions) {
            let expr = exprMap.get(expression);
            if (!expr) {
                expr = aliasesMap.get(expression);
            }

            if (!expr) {
                expressionInfos.push(null); // 如果没有找到匹配项，添加 null 到结果数组
                continue; // 继续下一个表达式的处理
            }

            let sentences = await this.idb.sentences
                .where("id").anyOf([...expr.sentences.values()])
                .toArray();

            expressionInfos.push({
                expression: expr.expression,
                surface: expr.surface,
                meaning: expr.meaning,
                status: expr.status,
                t: expr.t,
                notes: expr.notes,
                sentences,
                tags: [...expr.tags],
                aliases: expr.aliases,
                date: expr.date,
            });
        }

        return expressionInfos;
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
        return res;
    }
    async getAllExpressionSimple(ignores?: boolean): Promise<ExpressionInfoSimple[]> {
        let exprs: ExpressionInfoSimple[];
        let bottomStatus = ignores ? -1 : 0;
        exprs = (await this.idb.expressions
            .where("status").above(bottomStatus)
            .toArray()
        ).map((expr): ExpressionInfoSimple => {
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
        });

        return exprs;
    }

    async postExpression(payload: ExpressionInfo): Promise<number> {
        let stored = await this.idb.expressions
            .where("expression").equals(payload.expression)
            .first();

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
            date: moment().unix()
        };
        if (stored) {
            await this.idb.expressions.update(stored.id, updatedWord);
        } else {
            await this.idb.expressions.add(updatedWord);
        }

        this.invalidatePhraseCache();
        this.invalidateExpressionsSimpleCache();
        this.plugin.parser?.invalidateCache?.();

        return 200;
    }

    async bulkPostExpressions(payloads: ExpressionInfo[]): Promise<void> {
        // 1. Collect all unique sentences
        let sentenceMap = new Map<string, Sentence>();

        for (let payload of payloads) {
            for (let sen of payload.sentences) {
                if (!sentenceMap.has(sen.text)) {
                    sentenceMap.set(sen.text, sen);
                }
            }
        }

        let uniqueSentences = [...sentenceMap.values()];

        // 2. Bulk add sentences and get IDs
        // allKeys: true ensures we get the array of generated keys
        let ids = await this.idb.sentences.bulkAdd(uniqueSentences, { allKeys: true });

        // 3. Create a map of text -> id
        let textToId = new Map<string, number>();
        uniqueSentences.forEach((sen, index) => {
            textToId.set(sen.text, ids[index] as number);
        });

        // 4. Prepare expressions
        let expressions = payloads.map(payload => {
            let sentenceIds = new Set<number>();
            for (let sen of payload.sentences) {
                let id = textToId.get(sen.text);
                if (id !== undefined) sentenceIds.add(id);
            }

            return {
                expression: payload.expression,
                surface: payload.surface,
                meaning: payload.meaning,
                status: payload.status,
                t: payload.t,
                notes: payload.notes,
                sentences: sentenceIds,
                tags: new Set<string>(payload.tags),
                aliases: payload.aliases,
                date: moment().unix()
            };
        });

        // 5. Bulk add expressions
        await this.idb.expressions.bulkAdd(expressions);

        this.invalidatePhraseCache();
        this.invalidateExpressionsSimpleCache();
        this.plugin.parser?.invalidateCache?.();
    }

    async getTags(): Promise<string[]> {
        let allTags = new Set<string>();
        await this.idb.expressions.each(expr => {
            for (let t of expr.tags.values()) {
                allTags.add(t);
            }
        });

        return [...allTags.values()];
    }

    async postIgnoreWords(payload: string[]): Promise<void> {
        await this.idb.expressions.bulkPut(
            payload.map(expr => {
                return {
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
        this.invalidateExpressionsSimpleCache();
        this.plugin.parser?.invalidateCache?.();
        return;
    }

    async tryGetSen(text: string): Promise<Sentence> {
        let stored = await this.idb.sentences.where("text").equals(text).first();
        return stored;
    }

    async getCount(): Promise<CountInfo> {
        let counts: { "WORD": number[], "PHRASE": number[]; } = {
            "WORD": new Array(5).fill(0),
            "PHRASE": new Array(5).fill(0),
        };
        await this.idb.expressions.each(expr => {
            counts[expr.t as "WORD" | "PHRASE"][expr.status]++;
        });

        return {
            word_count: counts.WORD,
            phrase_count: counts.PHRASE
        };
    }

    async countSeven(): Promise<WordCount[]> {
        let spans: Span[] = [];
        // Calculate spans for the last 7 days
        let startOfPeriod = moment().subtract(6, "days").startOf("day");
        let endOfPeriod = moment().endOf("day");

        spans = [0, 1, 2, 3, 4, 5, 6].map((i) => {
            let from = moment(startOfPeriod).add(i, "days");
            return {
                from: from.unix(),
                to: from.endOf("day").unix(),
            };
        });

        let res: WordCount[] = [];

        // Optimization: Fetch all WORDs once instead of querying for each day
        // This reduces database scans from 14 (7 days * 2 types) to 1
        // We fetch all words because 'accumulated' counts need historical data
        let allWords = await this.idb.expressions
            .where("t").equals("WORD")
            .toArray();

        // Process in memory
        for (let span of spans) {
            let today = new Array(5).fill(0);
            let accumulated = new Array(5).fill(0);

            for (let expr of allWords) {
                // Count for 'today' (newly modified/created on that day)
                if (expr.date >= span.from && expr.date <= span.to) {
                    today[expr.status]++;
                }

                // Count for 'accumulated' (total up to end of that day)
                if (expr.date <= span.to) {
                    accumulated[expr.status]++;
                }
            }

            res.push({ today, accumulated });
        }

        return res;
    }

    async importDB(file: File) {
        // 导入前自动备份当前数据库
        try {
            const backupBlob = await exportDB(this.idb);
            const timestamp = moment().format('YYYYMMDD_HHmmss');
            download(backupBlob, `backup_before_import_${timestamp}.json`, "application/json");
            new Notice("✅ 已自动备份当前数据库");
        } catch (e) {
            console.warn("备份失败，继续导入", e);
            new Notice("⚠️ 备份失败，但将继续导入");
        }

        await this.idb.delete();
        await this.idb.open();
        await importInto(this.idb, file, {
            acceptNameDiff: true
        });
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
        return this.idb.delete();
    }
}


