import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

const CHANGELOG_PATH = "CHANGELOG.md";
const CHANGELOG_EMPTY_PLACEHOLDER = "- 暂无待发布更新。";

function normalizeLineEndings(text) {
    return text.replace(/\r\n/g, "\n");
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSection(changelog, heading) {
    const headingPattern = escapeRegExp(heading);
    const regex = new RegExp(
        `^## \\[${headingPattern}\\](?: - .+)?\\n([\\s\\S]*?)(?=^## \\[|\\Z)`,
        "m"
    );
    const match = changelog.match(regex);
    if (!match) {
        return "";
    }

    return match[1].trim();
}

function hasMeaningfulContent(section) {
    return section
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .some((line) => line !== CHANGELOG_EMPTY_PLACEHOLDER);
}

function buildFallbackReleaseNotes(version) {
    return [
        `## ${version}`,
        "",
        `- 未找到 ${CHANGELOG_PATH} 中对应的版本节。`,
        "- 本次 Release 继续生成，详细变更请参考下方 GitHub 自动生成的 release notes。",
    ].join("\n");
}

function extractReleaseNotes(changelog, version) {
    const versionSection = extractSection(changelog, version);
    if (hasMeaningfulContent(versionSection)) {
        return versionSection;
    }

    const unreleasedSection = extractSection(changelog, "Unreleased");
    if (hasMeaningfulContent(unreleasedSection)) {
        console.warn(
            `No changelog section found for version ${version}; falling back to [Unreleased].`
        );
        return unreleasedSection;
    }

    console.warn(
        `No changelog section found for version ${version}; using fallback release notes.`
    );
    return buildFallbackReleaseNotes(version);
}

const version = process.argv[2];
const outputPath = process.argv[3];

if (!version || !outputPath) {
    console.error("Usage: node scripts/extract-changelog-section.mjs <version> <outputPath>");
    process.exit(1);
}

const changelog = normalizeLineEndings(readFileSync(CHANGELOG_PATH, "utf8"));
const content = extractReleaseNotes(changelog, version);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${content}\n`);
