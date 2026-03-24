import fs from "fs/promises";
import path from "path";
import process from "process";

const pluginPathArg = process.argv[2];
if (!pluginPathArg) {
    console.error("Usage: npm run link:obsidian -- \"D:\\path\\to\\.obsidian\\plugins\\obsidian-language-learner\"");
    process.exit(1);
}

const rootDir = process.cwd();
const buildDir = path.resolve(rootDir, ".build", "plugin");
const pluginPath = path.resolve(pluginPathArg);

function timestamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return [
        now.getFullYear(),
        pad(now.getMonth() + 1),
        pad(now.getDate()),
        "-",
        pad(now.getHours()),
        pad(now.getMinutes()),
        pad(now.getSeconds()),
    ].join("");
}

async function pathExists(targetPath) {
    try {
        await fs.lstat(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function ensureDir(targetPath) {
    await fs.mkdir(targetPath, { recursive: true });
}

async function main() {
    await ensureDir(buildDir);
    await ensureDir(path.dirname(pluginPath));

    const buildRealPath = await fs.realpath(buildDir).catch(() => buildDir);
    let backupPath = null;
    let preservedDataPath = null;

    if (await pathExists(pluginPath)) {
        const currentStat = await fs.lstat(pluginPath);
        if (currentStat.isSymbolicLink()) {
            const currentRealPath = await fs.realpath(pluginPath).catch(() => pluginPath);
            if (path.resolve(currentRealPath) === path.resolve(buildRealPath)) {
                console.log(`Junction already points to ${buildDir}`);
                return;
            }
        }

        backupPath = `${pluginPath}.backup-${timestamp()}`;
        await fs.rename(pluginPath, backupPath);

        const candidateDataPath = path.join(backupPath, "data.json");
        if (await pathExists(candidateDataPath)) {
            preservedDataPath = candidateDataPath;
        }
    }

    await fs.symlink(buildDir, pluginPath, "junction");

    if (preservedDataPath) {
        await fs.copyFile(preservedDataPath, path.join(pluginPath, "data.json"));
    }

    console.log(`Junction created: ${pluginPath} -> ${buildDir}`);
    if (backupPath) {
        console.log(`Backup created: ${backupPath}`);
    }
    if (preservedDataPath) {
        console.log("Existing data.json was copied into the build directory.");
    }
}

await main().catch((error) => {
    console.error("Failed to create Obsidian plugin junction.");
    console.error(error);
    process.exit(1);
});
