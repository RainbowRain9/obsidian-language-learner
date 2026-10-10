import { App, Notice, TFile, parseYaml, stringifyYaml } from "obsidian";

type FrontMatter = { [K in string]: string };
const FRONTMATTER_BLOCK_REGEX = /^(?:\uFEFF)?(?:\r?\n)*---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/;

function extractFrontMatterBlock(text: string) {
    const match = text.match(FRONTMATTER_BLOCK_REGEX);
    if (!match) {
        return null;
    }

    return {
        fullMatch: match[0],
        body: match[1],
    };
}

// 返回 null 表示 frontmatter 块存在但 YAML 畸形，原有键值不可信，调用方不得据此整体重写
function parseFrontMatterBody(filePath: string, body: string): FrontMatter | null {
    try {
        const parsed = parseYaml(body);
        if (parsed === null || parsed === undefined) {
            return {};
        }
        if (typeof parsed !== "object") {
            console.warn("[Language Learner] Malformed frontmatter", filePath, parsed);
            return null;
        }
        return parsed as FrontMatter;
    } catch (error) {
        console.warn("[Language Learner] Failed to parse frontmatter", filePath, error);
        return null;
    }
}

export class FrontMatterManager {
    app: App;
    private writeQueues = new Map<string, Promise<unknown>>();

    constructor(app: App) {
        this.app = app;
    }

    // 串行化对同一文件的读-改-写，避免并发的整文件写互相覆盖；失败不会阻塞后续排队
    runExclusive<T>(file: TFile, fn: () => Promise<T>): Promise<T> {
        const previous = this.writeQueues.get(file.path) ?? Promise.resolve();
        const run = previous.then(fn, fn);
        this.writeQueues.set(file.path, run.then(
            (): undefined => undefined,
            (): undefined => undefined
        ));
        return run;
    }

    // 解析；frontmatter 存在但 YAML 畸形时返回 null
    async loadFrontMatter(file: TFile): Promise<FrontMatter | null> {
        let text = await this.app.vault.read(file);

        const block = extractFrontMatterBlock(text);
        if (!block) {
            return {};
        }
        return parseFrontMatterBody(file.path, block.body);
    }

    // 不加锁的写入核心，仅在 runExclusive 内部调用（避免嵌套等待导致死锁）
    private async writeFrontMatter(file: TFile, fm: FrontMatter): Promise<void> {
        if (Object.keys(fm).length === 0) {
            return;
        }

        let text = await this.app.vault.read(file);
        const block = extractFrontMatterBlock(text);

        if (block && parseFrontMatterBody(file.path, block.body) === null) {
            // 原 frontmatter 畸形，中止写入，防止仅含新键的内容清空原有键值
            new Notice(`[Language Learner] ${file.path}: malformed frontmatter, skip writing`);
            return;
        }

        let newFront = stringifyYaml(fm);
        const serializedFrontMatter = `---\n${newFront}---`;
        // 替换串以函数形式传入，按字面量使用，避免 frontmatter 值中的 $$/$& 等被当作替换模式
        let newText = block
            ? text.replace(block.fullMatch, () => serializedFrontMatter)
            : `${serializedFrontMatter}\n\n${text}`;

        await this.app.vault.modify(file, newText);
    }

    async storeFrontMatter(file: TFile, fm: FrontMatter) {
        await this.runExclusive(file, () => this.writeFrontMatter(file, fm));
    }

    // 读取值
    async getFrontMatter(file: TFile, key: string): Promise<string> {
        let frontmatter = await this.loadFrontMatter(file);

        return frontmatter ? frontmatter[key] : undefined;
    }

    // 修改
    async setFrontMatter(file: TFile, key: string, value: string) {
        await this.runExclusive(file, async () => {
            let fm = await this.loadFrontMatter(file);
            if (!fm) {
                new Notice(`[Language Learner] ${file.path}: malformed frontmatter, skip writing`);
                return;
            }

            fm[key] = value;
            await this.writeFrontMatter(file, fm);
        });
    }
}
