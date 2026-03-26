import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

const CHANGELOG_PATH = "CHANGELOG.md";

function normalizeLineEndings(text) {
    return text.replace(/\r\n/g, "\n");
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractVersionSection(changelog, version) {
    const versionPattern = escapeRegExp(version);
    const regex = new RegExp(
        `^## \\[${versionPattern}\\](?: - .+)?\\n([\\s\\S]*?)(?=^## \\[|\\Z)`,
        "m"
    );
    const match = changelog.match(regex);
    if (!match) {
        throw new Error(`Cannot find changelog section for version ${version}.`);
    }

    const body = match[1].trim();
    if (!body) {
        throw new Error(`Changelog section for version ${version} is empty.`);
    }

    return body;
}

const version = process.argv[2];
const outputPath = process.argv[3];

if (!version || !outputPath) {
    console.error("Usage: node scripts/extract-changelog-section.mjs <version> <outputPath>");
    process.exit(1);
}

const changelog = normalizeLineEndings(readFileSync(CHANGELOG_PATH, "utf8"));
const content = extractVersionSection(changelog, version);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${content}\n`);
