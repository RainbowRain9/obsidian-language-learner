/**
 * src/utils/word-file.ts 的零依赖回归测试。
 *
 * 运行：node scripts/test-merge-wordfile.mjs
 *
 * 不引入新依赖：用仓库已有的 esbuild 把纯函数模块转译为 ESM 后直接调用，
 * YAML 序列化/解析使用下方与 js-yaml 行对齐的 fixture 实现（只覆盖本模块
 * 会遇到的值形态：标量与字符串数组；未知键走「原文保留」，不经过 codec）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { transform } from "esbuild";

// ---------- 载入被测模块 ----------
const srcPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../src/utils/word-file.ts");
const { code } = await transform(readFileSync(srcPath, "utf8"), { loader: "ts", format: "esm" });
const tmpModule = path.join(tmpdir(), `word-file-${process.pid}-${Date.now()}.mjs`);
writeFileSync(tmpModule, code);
const { buildWordFrontMatter, mergeWordFile, formatUnixTimestamp,
    normalizeNextReview, parseReviewLog, parseReviewLogTables, aggregateReviewStats,
} = await import(pathToFileURL(tmpModule).href);

// ---------- fixture YAML codec（js-yaml 子集行为） ----------
const SPECIAL_LEAD = /^[-?:,[\]{}#&*!|>'"%@`\s]/;
const AMBIGUOUS = /^(?:~|null|true|false|yes|no|on|off|-?\d+(?:\.\d+)?)$/i;

function scalar(value) {
    if (typeof value === "number") return String(value);
    const s = String(value);
    const needsQuote = s === "" || SPECIAL_LEAD.test(s) || /\s$/.test(s)
        || /: /.test(s) || /:$/.test(s) || / #/.test(s)
        || AMBIGUOUS.test(s) || /[\n\r]/.test(s);
    return needsQuote ? `'${s.replace(/'/g, "''")}'` : s;
}

function fixtureStringify(obj) {
    let out = "";
    for (const [k, v] of Object.entries(obj)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) {
            out += v.length === 0 ? `${k}: []\n` : `${k}:\n${v.map(i => `  - ${scalar(i)}`).join("\n")}\n`;
        } else {
            out += `${k}: ${scalar(v)}\n`;
        }
    }
    return out;
}

// 只解析 fixture codec 自己产出的形态：顶层标量键、字符串块列表、透传的原始缩进行
function fixtureParse(fmText) {
    const obj = {};
    let current = null;
    for (const line of fmText.split("\n")) {
        if (line === "") continue;
        if (line.startsWith("  - ")) {
            if (current) current.push(unscalar(line.slice(4)));
            continue;
        }
        if (line.startsWith("  ") || line.startsWith("\t")) {
            if (current) current.push(`<raw>${line.trim()}`);
            continue;
        }
        const m = line.match(/^([^:]+):(?:\s+(.*))?$/);
        if (!m) continue;
        const value = m[2] === undefined ? [] : unscalar(m[2]);
        obj[m[1]] = value;
        current = Array.isArray(value) ? value : null;
    }
    return obj;
}

function unscalar(s) {
    if (/^-?\d+$/.test(s)) return Number(s);
    if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
    return s;
}

// ---------- 断言工具 ----------
let passed = 0, failed = 0;
function check(name, cond, extra) {
    if (cond) { passed++; console.log(`  ok  ${name}`); }
    else { failed++; console.error(`  FAIL ${name}${extra !== undefined ? `\n       ${String(extra)}` : ""}`); }
}
function section(name) { console.log(`\n# ${name}`); }

const fixedDate = () => "2026-09-15 12:00:00";
const cont = (over = {}) => ({
    expression: "acquaintance", surface: undefined, meaning: "n. 熟人",
    status: 1, t: "WORD", tags: [], notes: [], aliases: [],
    date: 1757928000, sentences: [], ...over,
});
const fmOf = (over) => buildWordFrontMatter(cont(over), fixedDate);
const fmBody = (text) => {
    const m = text.match(/^---\n([\s\S]*)\n---(?:\n|$)/);
    if (!m) throw new Error("no frontmatter in output:\n" + text);
    return m[1];
};

// ---------- T1 未知键保留（含中文键名）＋ payload 白名单键覆盖 ----------
section("T1 未知键保留（含中文键名）＋ payload 覆盖");
{
    const existing = `---
expression: acquaintance
meaning: n. 旧相识
date: 2026-03-31 15:34:36
status: 1
type: WORD
复习次数: 3
下次复习: 2026-09-20
复习记录:
  - 日期: 2026-09-01
    结果: Good
---
`;
    const payload = fmOf({
        status: 2,
        aliases: ["acquaintances"],
        notes: ["note a"],
        sentences: [{ text: "For a social epidemic to occur.", trans: "然而，要形成社会流行潮。", origin: "《2010年英语一Test3》" }],
    });
    const out = mergeWordFile(existing, payload, fixtureStringify);
    check("复习次数原样保留", out.includes("复习次数: 3\n"), out);
    check("下次复习原样保留", out.includes("下次复习: 2026-09-20\n"), out);
    check("复习记录（YAML 嵌套列表形态）逐字节透传",
        out.includes("复习记录:\n  - 日期: 2026-09-01\n    结果: Good\n"), out);
    check("status 被覆盖为 2", out.includes("status: 2\n") && !out.includes("status: 1\n"), out);
    check("meaning 被覆盖", out.includes("meaning: n. 熟人\n") && !out.includes("旧相识"), out);
    check("date 被覆盖（最后编辑时间语义）",
        out.includes("date: 2026-09-15 12:00:00\n") && !out.includes("2026-03-31"), out);
    check("输出以 --- 边界包裹", out.startsWith("---\n") && out.endsWith("---\n"), out);
    const parsed = fixtureParse(fmBody(out));
    check("合并结果仍是合法 YAML：expression 为标量", parsed["expression"] === "acquaintance", JSON.stringify(parsed));
    check("合并结果仍是合法 YAML：复习次数为数值 3", parsed["复习次数"] === 3, JSON.stringify(parsed));
    check("合并结果仍是合法 YAML：aliases 为数组", JSON.stringify(parsed["aliases"]) === JSON.stringify(["acquaintances"]), JSON.stringify(parsed));
    check("合并结果仍是合法 YAML：notes 为数组", JSON.stringify(parsed["notes"]) === JSON.stringify(["note a"]), JSON.stringify(parsed));
    check("sentence1/trans1/origin1 写入", parsed["sentence1"] === "For a social epidemic to occur." && parsed["origin1"] === "《2010年英语一Test3》", JSON.stringify(parsed));
}

// ---------- T1b 外部工具先建、插件后写的文件 ----------
section("T1b 纯外部键文件（ScoreFlow 先写、插件后写）");
{
    const existing = `---
复习次数: 3
下次复习: 2026-09-20
复习记录: [2026-09-01, 2026-09-05]
---
`;
    const out = mergeWordFile(existing, fmOf({ status: 1 }), fixtureStringify);
    check("复习记录（行内列表形态）原样透传", out.includes("复习记录: [2026-09-01, 2026-09-05]\n"), out);
    check("复习次数/下次复习原样保留", out.includes("复习次数: 3\n") && out.includes("下次复习: 2026-09-20\n"), out);
    check("插件白名单键追加写入", out.includes("expression: acquaintance\n") && out.includes("status: 1\n"), out);
}

// ---------- T2 例句随 payload 截断（删除例句后保存不复活） ----------
section("T2 例句随 payload 截断（已有 sentence2，payload 只带 1 条）");
{
    const existing = `---
expression: acquaintance
meaning: n. 熟人
date: 2026-03-31 15:34:36
status: 1
type: WORD
sentence1: old one
trans1: 旧翻译
origin1: 《旧》
sentence2: keep me
trans2: 保留翻译
origin2: 《保留》
---
`;
    const payload = fmOf({ sentences: [{ text: "new one", trans: "新翻译", origin: "《新》" }] });
    const out = mergeWordFile(existing, payload, fixtureStringify);
    check("sentence2/trans2/origin2 随删除移除",
        !out.includes("sentence2") && !out.includes("trans2") && !out.includes("origin2") && !out.includes("keep me"), out);
    check("sentence1 被覆盖为新例句", out.includes("sentence1: new one\n") && !out.includes("old one"), out);
    check("截断后仍是合法 YAML：仅剩第一组例句三元组",
        fixtureParse(fmBody(out))["sentence1"] === "new one"
        && !("sentence2" in fixtureParse(fmBody(out))), out);
}

// ---------- T3 payload 未携带的受管键移除；携带时块列表键整段替换 ----------
section("T3 受管键缺省即移除；已有块列表键整段替换");
{
    const existing = `---
expression: abide by
meaning: phr. 遵守
date: 2026-04-19 15:51:35
status: 1
type: PHRASE
surface: abide by
aliases:
  - abided by
  - abiding by
notes:
  - "'abide'与'by'搭配"
tags:
  - phrase
---
`;
    // payload 不带 surface/aliases/notes/tags（用户已清空，空数组按白名单规则不写入）→ 旧键移除
    const out = mergeWordFile(existing, fmOf({ status: 3, meaning: "phr. 遵守；信守" }), fixtureStringify);
    check("surface 移除", !out.includes("surface:"), out);
    check("aliases 块列表移除", !out.includes("aliases") && !out.includes("abided by") && !out.includes("abiding by"), out);
    check("notes 块列表移除", !out.includes("notes") && !out.includes("'abide'与'by'搭配"), out);
    check("tags 移除", !out.includes("tags") && !out.includes("phrase"), out);
    check("status 覆盖", out.includes("status: 3\n"), out);

    // 换成 payload 携带 aliases 时：旧块列表整段被替换，相邻键不受影响
    const out2 = mergeWordFile(existing, fmOf({ aliases: ["abides by"] }), fixtureStringify);
    check("已有 aliases 块列表被新值整段替换", out2.includes("aliases:\n  - abides by\n") && !out2.includes("abided by"), out2);
    check("payload 未携带的相邻受管键（surface/notes/tags）一并移除且无孤儿列表项",
        !out2.includes("surface:") && !out2.includes("notes") && !out2.includes("tags")
        && !out2.includes("'abide'与'by'搭配") && !out2.includes("phrase"), out2);
}

// ---------- T3b 不缩进块列表风格（js-yaml 3 形态） ----------
section("T3b 顶格块列表：整段替换与原样保留均不产生孤儿列表项");
{
    const existing = `---
expression: test
meaning: n. 测试
date: 2026-01-01 00:00:00
status: 1
type: WORD
aliases:
- old alias a
- old alias b
复习记录:
- 2026-09-01
- 2026-09-05
---
`;
    const out = mergeWordFile(existing, fmOf({ aliases: ["new alias"] }), fixtureStringify);
    check("顶格 aliases 列表整段替换、无孤儿项",
        out.includes("aliases:\n  - new alias\n") && !out.includes("old alias"), out);
    check("顶格 复习记录 列表原样保留",
        out.includes("复习记录:\n- 2026-09-01\n- 2026-09-05\n"), out);
    const parsed = fixtureParse(fmBody(out));
    check("顶格替换后 aliases 解析正确", JSON.stringify(parsed["aliases"]) === JSON.stringify(["new alias"]), out);
}

// ---------- T4 正文保留 ----------
section("T4 正文保留（FM＋正文 / FM＋空行＋正文 / 仅 FM / 无 FM）");
{
    const fm = fmOf({ status: 2 });
    const a = mergeWordFile(`---\nstatus: 1\n---\n# Title\n\ncontent line`, fm, fixtureStringify);
    check("FM＋正文：正文逐字节保留", a.includes("---\n# Title\n\ncontent line") && a.endsWith("content line"), a);

    const b = mergeWordFile("---\nstatus: 1\n---\n\nblank first", fm, fixtureStringify);
    check("FM＋空行＋正文：FM 与正文间空行保留", b.includes("---\n\nblank first"), b);

    const c = mergeWordFile("---\nstatus: 1\ntype: WORD\n---\n", fm, fixtureStringify);
    check("仅 FM：不凭空制造正文", c.endsWith("---\n") && !c.endsWith("---\n\n"), JSON.stringify(c));

    const d = mergeWordFile("# just body\nsecond line", fm, fixtureStringify);
    check("无 FM：frontmatter 前置、正文保留", d.startsWith("---\n") && d.includes("---\n\n# just body\nsecond line"), d);

    const e = mergeWordFile(`---
status: 1
---
`, fm, fixtureStringify);
    check("仅 FM（独立成行）：状态覆盖且无正文", e.includes("status: 2\n") && e.endsWith("---\n"), e);

    const bomNoFm = mergeWordFile("\uFEFF# just body\nsecond line", fm, fixtureStringify);
    check("BOM＋无 FM：BOM 保持在最前、frontmatter 紧随、正文开头不再残留 BOM",
        bomNoFm.startsWith("\uFEFF---\n")
        && bomNoFm.indexOf("\uFEFF", 1) === -1
        && bomNoFm.includes("---\n\n# just body\nsecond line"),
        JSON.stringify(bomNoFm));
    const bomWithFm = mergeWordFile("\uFEFF---\nstatus: 1\n---\nbody line", fm, fixtureStringify);
    check("BOM＋FM：BOM 保持在最前、状态覆盖、正文保留",
        bomWithFm.startsWith("\uFEFF---\n") && bomWithFm.includes("status: 2\n") && bomWithFm.endsWith("body line"),
        JSON.stringify(bomWithFm));
}

// ---------- T5 新建文件：与旧 createFM 输出逐字节一致（快照） ----------
section("T5 新建文件输出与旧逻辑逐字节一致（快照对比）");
{
    const snapCont = cont({
        expression: "apple",
        meaning: "n. 苹果",
        status: 1,
        t: "WORD",
        surface: "apples",
        aliases: ["apples"],
        tags: ["fruit"],
        notes: ["a note"],
        sentences: [{ text: "I ate an apple.", trans: "我吃了一个苹果。", origin: "《2010年英语一Test3》" }],
    });
    const payloadFm = buildWordFrontMatter(snapCont, fixedDate);
    // 旧逻辑的输出构造：`---\n${stringifyYaml(frontmatter)}---\n`，键序 = 白名单固定顺序
    const legacyShape = `---\n${fixtureStringify(payloadFm)}---\n`;
    const frozen = `---
expression: apple
meaning: n. 苹果
date: 2026-09-15 12:00:00
status: 1
type: WORD
surface: apples
aliases:
  - apples
tags:
  - fruit
notes:
  - a note
sentence1: I ate an apple.
trans1: 我吃了一个苹果。
origin1: 《2010年英语一Test3》
---
`;
    check("null（新建）输出 === 旧逻辑构造", mergeWordFile(null, payloadFm, fixtureStringify) === legacyShape);
    check("null（新建）输出 === 冻结快照", mergeWordFile(null, payloadFm, fixtureStringify) === frozen,
        JSON.stringify(mergeWordFile(null, payloadFm, fixtureStringify)));
    check("空字符串文件 === 同一快照", mergeWordFile("", payloadFm, fixtureStringify) === frozen);
    check("空白文件 === 同一快照", mergeWordFile("  \n ", payloadFm, fixtureStringify) === frozen);
}

// ---------- T8 受管键删除综合（LearnPanel 删例句/笔记/标签后保存不复活） ----------
section("T8 受管键删除综合（删例句/笔记/标签/别名/surface 后保存）");
{
    const existing = `---
expression: acquaintance
meaning: n. 熟人
date: 2026-03-31 15:34:36
status: 1
type: WORD
surface: Acquaintance
aliases:
  - acquaintances
tags:
  - n1
notes:
  - note a
sentence1: s one
trans1: t one
origin1: o one
sentence2: s two
trans2: t two
origin2: o two
复习次数: 3
下次复习: 2026-09-20
---
# note body
`;
    // 用户删光例句、笔记、标签、别名、surface 后保存（payload 仅剩必填五键）
    const out = mergeWordFile(existing, fmOf({ status: 2 }), fixtureStringify);
    const parsed = fixtureParse(fmBody(out));
    check("受管键全部移除（surface/aliases/tags/notes/sentenceN/transN/originN）",
        ["surface", "aliases", "tags", "notes",
            "sentence1", "trans1", "origin1", "sentence2", "trans2", "origin2"]
            .every((k) => !(k in parsed)), JSON.stringify(parsed));
    check("外部中文键原样保留", out.includes("复习次数: 3\n") && out.includes("下次复习: 2026-09-20\n"), out);
    check("正文保留", out.includes("---\n# note body\n"), out);
    check("白名单五键仍在且 status 已覆盖",
        parsed["expression"] === "acquaintance" && parsed["status"] === 2, JSON.stringify(parsed));

    // 保留 1 条例句、清空笔记：第一组三元组替换、第二组移除、notes 移除
    const out2 = mergeWordFile(existing, fmOf({
        status: 2,
        sentences: [{ text: "kept", trans: "留", origin: "《留》" }],
    }), fixtureStringify);
    const parsed2 = fixtureParse(fmBody(out2));
    check("保留 1 条例句时第二组三元组移除、第一组替换、notes 移除",
        parsed2["sentence1"] === "kept" && parsed2["trans1"] === "留" && parsed2["origin1"] === "《留》"
        && !("sentence2" in parsed2) && !("trans2" in parsed2) && !("origin2" in parsed2)
        && !("notes" in parsed2), JSON.stringify(parsed2));
}

// ---------- T6 buildWordFrontMatter 白名单规则 ----------
section("T6 buildWordFrontMatter 白名单与格式化规则");
{
    const fm = buildWordFrontMatter(cont(), fixedDate);
    check("仅必填五键且键序与旧实现一致",
        JSON.stringify(Object.keys(fm)) === JSON.stringify(["expression", "meaning", "date", "status", "type"]),
        JSON.stringify(Object.keys(fm)));
    check("date 使用注入的格式化器", fm.date === "2026-09-15 12:00:00");
    check("meaning 缺省为空串", buildWordFrontMatter(cont({ meaning: undefined }), fixedDate).meaning === "");
    const fmSen = buildWordFrontMatter(cont({
        sentences: [{ text: "a", trans: undefined, origin: "o" }, { text: "b", trans: "t2", origin: "o2" }],
    }), fixedDate);
    check("例句三元组按序号展开且空值补空串",
        fmSen.sentence1 === "a" && fmSen.trans1 === "" && fmSen.origin1 === "o"
        && fmSen.sentence2 === "b" && fmSen.trans2 === "t2", JSON.stringify(fmSen));

    const p = (n) => String(n).padStart(2, "0");
    for (const unix of [0, 1234567890, 1760000000]) {
        const d = new Date(unix * 1000);
        const expect = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        check(`formatUnixTimestamp(${unix}) 本地时间零填充`, formatUnixTimestamp(unix) === expect);
    }
}

// ---------- T7 外部复习共享字段的读取与聚合 ----------
section("T7 下次复习 / 复习记录 解析与留存聚合");
{
    check("下次复习：字符串原样", normalizeNextReview("2026-09-20") === "2026-09-20");
    // js-yaml 的 timestamp 类型按 Date.UTC 构造（零点 UTC），fixture 用 Date.UTC 忠实模拟
    check("下次复习：Date 归一为 YYYY-MM-DD",
        normalizeNextReview(new Date(Date.UTC(2026, 8, 20))) === "2026-09-20");
    check("下次复习：UTC 日内任意时刻不因主机时区回退",
        normalizeNextReview(new Date(Date.UTC(2026, 8, 20, 23, 59))) === "2026-09-20");
    check("下次复习：数字转字符串", normalizeNextReview(5) === "5");
    check("下次复习：缺失/空白容错为 undefined",
        normalizeNextReview(undefined) === undefined && normalizeNextReview(null) === undefined
        && normalizeNextReview("") === undefined && normalizeNextReview("   ") === undefined);

    check("复习记录：非列表返回空数组",
        parseReviewLog(undefined).length === 0 && parseReviewLog("nope").length === 0
        && parseReviewLog(null).length === 0);
    const log = parseReviewLog([
        { "日期": "2026-09-01", "结果": "Good", "备注": "首刷" },
        "2026-09-05",
        { date: new Date(Date.UTC(2026, 8, 7)), result: "Again" },
        { "结果": "无日期应跳过" },
    ]);
    check("复习记录：中/英键名、纯日期标量、Date 均可解析且无日期项跳过",
        log.length === 3
        && log[0].date === "2026-09-01" && log[0].result === "Good" && log[0].note === "首刷"
        && log[1].date === "2026-09-05" && log[1].result === undefined
        && log[2].date === "2026-09-07" && log[2].result === "Again",
        JSON.stringify(log));

    const body = `# 单词

## 📎 来源

| 日期 | 结果 | 备注 |
| --- | --- | --- |
| 2099-01-01 | 不该被解析 | 复习记录小节外的表格 |

## 📈 复习记录

| 日期 | 复习结果 | 备注 |
| ---- | -------- | ---- |
| 2026-09-01 | Good | 首刷 |
| 2026-09-05 | Again | 忘了 |
`;
    const tableLog = parseReviewLogTables(body);
    check("正文表格：只解析复习记录小节之后的表格",
        tableLog.length === 2 && tableLog[0].date === "2026-09-01" && tableLog[0].result === "Good"
        && tableLog[0].note === "首刷" && tableLog[1].result === "Again",
        JSON.stringify(tableLog));
    const enTable = parseReviewLogTables(`## Review Log\n\n| date | result |\n| --- | --- |\n| 2026-09-08 | Easy |\n`);
    check("正文表格：英文表头兼容", enTable.length === 1 && enTable[0].result === "Easy", JSON.stringify(enTable));
    check("正文表格：仅日期列也产出记录", parseReviewLogTables(`## 复习记录\n\n| 日期 |\n| --- |\n| 2026-09-09 |\n`).length === 1);
    check("正文表格：无复习记录小节返回空", parseReviewLogTables(`# t\n\n| a | b |\n| - | - |\n| 1 | 2 |\n`).length === 0);
    check("正文表格：重复表头行被跳过",
        parseReviewLogTables(`## 复习记录\n\n| 日期 | 复习结果 |\n| - | - |\n| 日期 | 复习结果 |\n| 2026-09-10 | Good |\n`).length === 1);

    const stats = aggregateReviewStats([
        { date: "2026-09-01", result: "Good" },
        { date: "2026-09-01", result: "Again" },
        { date: "2026-09-01", result: "未掌握" },
        { date: "2026-09-02 10:00", result: "🟡 初始" },
        { date: "2026-09-03", result: "Good" },
    ]);
    check("聚合：按日排序归并（含带时间的日期）",
        JSON.stringify(stats.dates) === JSON.stringify(["2026-09-01", "2026-09-02", "2026-09-03"])
        && JSON.stringify(stats.dailyCounts) === JSON.stringify([3, 1, 1]),
        JSON.stringify(stats));
    check("聚合：累计留存率，未识别档位不计入分母（33.3→33.3→50）",
        JSON.stringify(stats.cumulativeRetention) === JSON.stringify([33.3, 33.3, 50]),
        JSON.stringify(stats.cumulativeRetention));
    const emptyStats = aggregateReviewStats([]);
    check("聚合：空输入返回空序列",
        emptyStats.dates.length === 0 && emptyStats.dailyCounts.length === 0 && emptyStats.cumulativeRetention.length === 0);
    const mixedStats = aggregateReviewStats([
        { date: "2026/9/19", result: "Good" },
        { date: "2026-09-19", result: "Again" },
        { date: "9/18/2026", result: "Easy" },
        { date: "2026.9.20", result: "Good" },
    ]);
    check("聚合：非 ISO 日期归一化后同日同桶、轴顺序正确",
        JSON.stringify(mixedStats.dates) === JSON.stringify(["2026-09-18", "2026-09-19", "2026-09-20"])
        && JSON.stringify(mixedStats.dailyCounts) === JSON.stringify([1, 2, 1]),
        JSON.stringify(mixedStats));
}

// ---------- 汇总 ----------
console.log(`\n=${passed} passed, ${failed} failed=`);
process.exit(failed === 0 ? 0 : 1);
