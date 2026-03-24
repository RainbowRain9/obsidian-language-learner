import child from "child_process";
import process from "process";

const version = process.argv[2];

if (!version) {
    console.error("Usage: npm run release:version -- <version>");
    process.exit(1);
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

child.execFileSync(
    npmCommand,
    ["version", version, "-m", "chore(release): 发布 %s"],
    { stdio: "inherit" }
);
