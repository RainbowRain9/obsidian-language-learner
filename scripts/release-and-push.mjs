import process from "process";
import { runNpm } from "./run-npm.mjs";

const mode = process.argv[2];
const extraArgs = process.argv.slice(3);

if (!mode) {
    const version = extraArgs[0];
    if (!version) {
        console.error("Usage: npm run release:version:push -- <version>");
        process.exit(1);
    }

    runNpm(["run", "release:version", "--", version]);
    runNpm(["run", "release:push"]);
    process.exit(0);
}

if (!["patch", "minor", "major"].includes(mode)) {
    console.error(`Unsupported release mode: ${mode}`);
    process.exit(1);
}

runNpm(["run", `release:${mode}`]);
runNpm(["run", "release:push"]);
