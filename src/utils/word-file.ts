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

function splitWordFileText(text: string): WordFileParts {
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
