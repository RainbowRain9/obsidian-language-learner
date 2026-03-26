import { App, TFile, parseYaml, stringifyYaml } from "obsidian";

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

export class FrontMatterManager {
    app: App;

    constructor(app: App) {
        this.app = app;
    }

    // 解析
    async loadFrontMatter(file: TFile): Promise<FrontMatter> {
        let res = {} as FrontMatter;
        let text = await this.app.vault.read(file);

        const block = extractFrontMatterBlock(text);
        if (block) {
            try {
                res = parseYaml(block.body) || {};
            } catch (error) {
                console.warn("[Language Learner] Failed to parse frontmatter", file.path, error);
            }
        }

        return res;
    }

    async storeFrontMatter(file: TFile, fm: FrontMatter) {
        if (Object.keys(fm).length === 0) {
            return;
        }

        let text = await this.app.vault.read(file);
        const block = extractFrontMatterBlock(text);

        let newText = "";
        let newFront = stringifyYaml(fm);
        const serializedFrontMatter = `---\n${newFront}---`;
        if (block) {
            newText = text.replace(block.fullMatch, serializedFrontMatter);
        } else {
            newText = `${serializedFrontMatter}\n\n${text}`;
        }

        this.app.vault.modify(file, newText);
    }

    // 读取值
    async getFrontMatter(file: TFile, key: string): Promise<string> {
        let frontmatter = await this.loadFrontMatter(file);

        return frontmatter[key];
    }

    // 修改
    async setFrontMatter(file: TFile, key: string, value: string) {
        let fm = await this.loadFrontMatter(file);

        fm[key] = value;

        this.storeFrontMatter(file, fm);
    }
}
