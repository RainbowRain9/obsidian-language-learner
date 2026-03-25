import { existsSync, readFileSync, writeFileSync } from "fs";

const CHANGELOG_PATH = "CHANGELOG.md";
const CHANGELOG_EMPTY_PLACEHOLDER = "- 暂无待发布更新。";

function normalizeLineEndings(text) {
    return text.replace(/\r\n/g, "\n");
}

function hasMeaningfulUnreleasedContent(section) {
    return section
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .some((line) => line !== CHANGELOG_EMPTY_PLACEHOLDER);
}

function promoteChangelog(targetVersion) {
    if (!existsSync(CHANGELOG_PATH)) {
        return;
    }

    const raw = normalizeLineEndings(readFileSync(CHANGELOG_PATH, "utf8"));
    if (raw.includes(`## [${targetVersion}]`)) {
        return;
    }

    const unreleasedRegex = /## \[Unreleased\]\n([\s\S]*?)(?=\n## \[|$)/;
    const match = raw.match(unreleasedRegex);
    if (!match) {
        return;
    }

    const unreleasedBody = match[1].trim();
    if (!hasMeaningfulUnreleasedContent(unreleasedBody)) {
        return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const archivedSection = `## [${targetVersion}] - ${today}\n\n${unreleasedBody}\n`;
    const replacement = `## [Unreleased]\n\n${CHANGELOG_EMPTY_PLACEHOLDER}\n\n${archivedSection}`;
    const updated = raw.replace(unreleasedRegex, replacement);
    writeFileSync(CHANGELOG_PATH, updated.endsWith("\n") ? updated : `${updated}\n`);
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const targetVersion = process.env.npm_package_version || packageJson.version;

if (!targetVersion) {
    throw new Error("Cannot determine target version.");
}

// read minAppVersion from manifest.json and bump version to target version
let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

// update versions.json with target version and minAppVersion from manifest.json
let versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));

promoteChangelog(targetVersion);
