import type { ExpressionInfo } from "@/db/interface";

/**
 * 词条文件（word_folder/*.md）的保留式合并工具。
 *
 * 语义：以现有文件的 frontmatter 为基底，只覆盖本插件管理的白名单键，
 * 其余既有键（例如外部工具写入的「复习次数 / 下次复习 / 复习记录」等未知键）
 * 以及 frontmatter 之后的正文都按原文保留，不做整体重建。
 *
 * 本模块必须保持纯函数、不依赖 obsidian 运行时，便于在 node 中直接测试；
 * YAML 序列化通过 YamlStringifier 注入（运行时传 Obsidian 的 stringifyYaml）。
 */

export type YamlStringifier = (value: Record<string, unknown>) => string;

// moment.unix(unix).format('YYYY-MM-DD HH:mm:ss') 的纯 JS 等价实现（本地时区）
export function formatUnixTimestamp(unix: number): string {
    const d = new Date(unix * 1000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
        + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 按历史 createFM 的白名单规则构建 frontmatter 对象（键序保持与旧实现一致）
export function buildWordFrontMatter(
    cont: ExpressionInfo,
    formatDate: (unix: number) => string = formatUnixTimestamp,
): Record<string, unknown> {
    const frontmatter: Record<string, unknown> = {
        expression: cont.expression,
        meaning: cont.meaning ?? "",
        date: formatDate(cont.date),
        status: cont.status,
        type: cont.t,
    };

    if (cont.surface) {
        frontmatter.surface = cont.surface;
    }

    if (cont.aliases?.length) {
        frontmatter.aliases = cont.aliases;
    }

    if (cont.tags?.length) {
        frontmatter.tags = cont.tags;
    }

    if (cont.notes?.length) {
        frontmatter.notes = cont.notes;
    }

    cont.sentences?.forEach((sentence, index) => {
        const i = index + 1;
        frontmatter[`sentence${i}`] = sentence.text ?? "";
        frontmatter[`trans${i}`] = sentence.trans ?? "";
        frontmatter[`origin${i}`] = sentence.origin ?? "";
    });

    return frontmatter;
}

// frontmatter 必须位于文件起始（允许 BOM），结束标记后紧跟换行或文件末尾
const FRONTMATTER_BLOCK_REGEX = /^(\uFEFF?)---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/;

type WordFileParts = {
    bom: string;
    fmText: string | null;
    body: string;
};

export function splitWordFileText(text: string): WordFileParts {
    const match = text.match(FRONTMATTER_BLOCK_REGEX);
    if (!match) {
        return { bom: "", fmText: null, body: text };
    }
    // 结束标记所在行的换行属于 frontmatter 块，正文从下一行开始
    const body = text.slice(match[0].length).replace(/^(\r?\n)/, "");
    return { bom: match[1], fmText: match[2], body };
}

type FrontMatterPart =
    | { kind: "key"; key: string; text: string }
    | { kind: "raw"; text: string };

// 顶层的 `key: value` / `key:`；键名内不允许出现冒号和空白
const TOP_LEVEL_KEY_REGEX = /^([^:#\s][^:]*):(?:\s|$)/;

/**
 * 把 frontmatter 文本切成有序片段：顶层键（含其缩进的续行，如块状列表、
 * 嵌套映射）与不属于任何键的原始行（空行、注释等）。
 * 每个片段的 text 都以换行结尾。
 */
function segmentFrontMatterText(fmText: string): FrontMatterPart[] {
    const normalized = fmText.endsWith("\n") ? fmText : fmText + "\n";
    const lines = normalized.split("\n");
    lines.pop(); // 末尾因 split 产生的空元素

    const parts: FrontMatterPart[] = [];
    let current: { kind: "key"; key: string; lines: string[] } | null = null;
    const flush = () => {
        if (current) {
            parts.push({ kind: "key", key: current.key, text: current.lines.join("\n") + "\n" });
            current = null;
        }
    };

    for (const line of lines) {
        const content = line.endsWith("\r") ? line.slice(0, -1) : line;
        if (content.startsWith(" ") || content.startsWith("\t")) {
            // 缩进续行：归属当前顶层键；若无打开的键则按原文保留
            if (current) {
                current.lines.push(line);
            } else {
                parts.push({ kind: "raw", text: line + "\n" });
            }
            continue;
        }
        // 顶格的 "- item" 是当前键的块序列续行（如 js-yaml 3 的不缩进列表风格）
        if (current && /^-(?:\s|$)/.test(content)) {
            current.lines.push(line);
            continue;
        }
        const keyMatch = content.match(TOP_LEVEL_KEY_REGEX);
        if (keyMatch) {
            flush();
            current = { kind: "key", key: keyMatch[1], lines: [line] };
        } else {
            // 空行、注释等：不属于任何键，原样保留
            flush();
            parts.push({ kind: "raw", text: line + "\n" });
        }
    }
    flush();

    return parts;
}

/**
 * 合并生成完整词条文件文本。
 *
 * - existingFileText 为 null / 空白：等价于历史 createFM 的整文件输出
 *   `---\n${stringify(payloadFm)}---\n`（新建文件场景，行为不变）；
 * - 已有文件：payloadFm 中的白名单键原地替换（键不存在则按 payloadFm
 *   顺序追加到 frontmatter 末尾），其余片段与正文逐字节保留。
 */
export function mergeWordFile(
    existingFileText: string | null,
    payloadFm: Record<string, unknown>,
    stringify: YamlStringifier,
): string {
    if (existingFileText === null || existingFileText.trim() === "") {
        return `---\n${stringify(payloadFm)}---\n`;
    }

    const { bom, fmText, body } = splitWordFileText(existingFileText);

    if (fmText === null) {
        // 文件存在但没有 frontmatter：在文件头补一段，正文原样保留
        const fmBlock = `---\n${stringify(payloadFm)}---`;
        return body.trim() === "" ? `${bom}${fmBlock}\n` : `${bom}${fmBlock}\n\n${body}`;
    }

    const parts = segmentFrontMatterText(fmText);
    const replaced = new Set<string>();
    const chunks: string[] = [];
    for (const part of parts) {
        if (part.kind === "key" && part.key in payloadFm && !replaced.has(part.key)) {
            // 同名键出现多次时只替换第一处，其余按原文保留
            chunks.push(stringify({ [part.key]: payloadFm[part.key] }));
            replaced.add(part.key);
        } else {
            chunks.push(part.text);
        }
    }
    for (const [key, value] of Object.entries(payloadFm)) {
        if (!replaced.has(key)) {
            chunks.push(stringify({ [key]: value }));
        }
    }

    const fmBlock = `---\n${chunks.join("")}---`;
    return body === ""
        ? `${bom}${fmBlock}\n`
        : `${bom}${fmBlock}\n${body}`;
}

// ---------- 外部复习工具（ScoreFlow 等）共享字段的读取 ----------

export type ReviewLogEntry = {
    date: string;
    result?: string;
    note?: string;
};

// js-yaml 会把 "2026-09-20" 这类值解析为 Date 对象，显示层需要稳定的字符串
function toDisplayString(value: unknown): string | undefined {
    if (value instanceof Date && !isNaN(value.getTime())) {
        const p = (n: number) => String(n).padStart(2, "0");
        return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
    }
    if (typeof value === "string" && value.trim() !== "") {
        return value.trim();
    }
    if (typeof value === "number" && !isNaN(value)) {
        return String(value);
    }
    return undefined;
}

// 读取「下次复习」，键不存在或值形态未知时返回 undefined（容错省略）
export function normalizeNextReview(value: unknown): string | undefined {
    return toDisplayString(value);
}

// 「复习记录」的 YAML 列表形态：[{日期, 结果, 备注}] 或纯日期标量列表，兼容英文键名
export function parseReviewLog(value: unknown): ReviewLogEntry[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const entries: ReviewLogEntry[] = [];
    for (const item of value) {
        if (item !== null && typeof item === "object" && !(item instanceof Date)) {
            const rec = item as Record<string, unknown>;
            const date = toDisplayString(rec["日期"] ?? rec["date"]);
            if (date === undefined) {
                continue;
            }
            entries.push({
                date,
                result: toDisplayString(rec["结果"] ?? rec["result"]),
                note: toDisplayString(rec["备注"] ?? rec["note"]),
            });
        } else {
            const date = toDisplayString(item);
            if (date !== undefined) {
                entries.push({ date });
            }
        }
    }
    return entries;
}

// 「复习记录」的正文表格形态：只解析复习记录小节标题之后的 markdown 表格
function reviewTableHeaderIndex(cells: string[]): { date: number; result: number; note: number } | null {
    let date = -1, result = -1, note = -1;
    cells.forEach((cell, i) => {
        const key = cell.toLowerCase().replace(/\s/g, "");
        if (date < 0 && (key === "日期" || key === "date")) {
            date = i;
        } else if (result < 0 && (key === "复习结果" || key === "结果" || key === "result")) {
            result = i;
        } else if (note < 0 && (key === "备注" || key === "note")) {
            note = i;
        }
    });
    return date >= 0 ? { date, result, note } : null;
}

export function parseReviewLogTables(body: string): ReviewLogEntry[] {
    const entries: ReviewLogEntry[] = [];
    let inReviewSection = false;
    let header: { date: number; result: number; note: number } | null = null;

    for (const raw of body.split("\n")) {
        const line = raw.trim();
        if (line === "") {
            continue;
        }
        const heading = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
        if (heading) {
            inReviewSection = heading[1].includes("复习记录") || /review\s*log/i.test(heading[1]);
            header = null;
            continue;
        }
        if (!inReviewSection || !line.startsWith("|")) {
            header = null;
            continue;
        }
        const cells = line.replace(/^\|/, "").split("|").map((c) => c.trim());
        if (cells.length > 0 && cells[cells.length - 1] === "") {
            cells.pop();
        }
        // 表头下方的分隔行（| - | 或 | --- |，可带对齐冒号）
        if (cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c))) {
            continue;
        }
        if (!header) {
            header = reviewTableHeaderIndex(cells);
            continue;
        }
        const date = cells[header.date];
        if (!date || date === "日期" || date.toLowerCase() === "date") {
            continue;
        }
        entries.push({
            date,
            result: header.result >= 0 ? cells[header.result] || undefined : undefined,
            note: header.note >= 0 ? cells[header.note] || undefined : undefined,
        });
    }
    return entries;
}

export type ReviewStats = {
    dates: string[];
    dailyCounts: number[];
    cumulativeRetention: (number | null)[];
};

// 注意顺序：失败标记需先于成功标记匹配（如「未掌握」包含「掌握」）
const REVIEW_FAIL_MARKS = ["again", "重来", "忘了", "忘记", "未记住", "未掌握", "不记得", "不熟练", "不会", "🔴"];
const REVIEW_PASS_MARKS = ["easy", "good", "hard", "掌握", "记住", "记得", "熟练", "🟢", "绿", "✅"];

function classifyReviewResult(result: string | undefined): boolean | null {
    if (!result) {
        return null;
    }
    const value = result.toLowerCase();
    if (REVIEW_FAIL_MARKS.some((mark) => value.includes(mark))) {
        return false;
    }
    if (REVIEW_PASS_MARKS.some((mark) => value.includes(mark))) {
        return true;
    }
    return null;
}

// 汇总为复习留存统计：按日去重排序，留存率 = 累计(通过)/(累计(通过)+累计(失败))，
// 无法识别结果档位的记录计入当日复习次数但不参与留存率
export function aggregateReviewStats(entries: ReviewLogEntry[]): ReviewStats {
    const byDate = new Map<string, { total: number; pass: number; fail: number }>();
    for (const entry of entries) {
        if (!entry.date) {
            continue;
        }
        const day = entry.date.slice(0, 10);
        const agg = byDate.get(day) ?? { total: 0, pass: 0, fail: 0 };
        agg.total++;
        const classified = classifyReviewResult(entry.result);
        if (classified === true) {
            agg.pass++;
        } else if (classified === false) {
            agg.fail++;
        }
        byDate.set(day, agg);
    }

    const dates = [...byDate.keys()].sort();
    let pass = 0;
    let fail = 0;
    const dailyCounts: number[] = [];
    const cumulativeRetention: (number | null)[] = [];
    for (const date of dates) {
        const agg = byDate.get(date)!;
        pass += agg.pass;
        fail += agg.fail;
        dailyCounts.push(agg.total);
        cumulativeRetention.push(
            pass + fail > 0 ? Math.round((pass / (pass + fail)) * 1000) / 10 : null
        );
    }
    return { dates, dailyCounts, cumulativeRetention };
}
