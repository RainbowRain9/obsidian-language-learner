import process from "process";
import { runNpm } from "./run-npm.mjs";

const version = process.argv[2];

if (!version) {
    console.error("Usage: npm run release:version -- <version>");
    process.exit(1);
}

runNpm(["version", version, "-m", "chore(release): 发布 %s"]);
