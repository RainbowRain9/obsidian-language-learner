import process from "process";
import { runNpm } from "./run-npm.mjs";

const arg = process.argv[2];
const releaseModes = new Set(["patch", "minor", "major"]);

if (!arg) {
    console.error("Usage: npm run release:version:push -- <version>");
    console.error("   or: npm run release:<patch|minor|major>:push");
    process.exit(1);
}

if (releaseModes.has(arg)) {
    runNpm(["run", `release:${arg}`]);
    runNpm(["run", "release:push"]);
    process.exit(0);
}

runNpm(["run", "release:version", "--", arg]);
runNpm(["run", "release:push"]);
