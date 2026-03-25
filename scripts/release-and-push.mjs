import child from "child_process";
import process from "process";

const mode = process.argv[2];
const extraArgs = process.argv.slice(3);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args) {
    child.execFileSync(command, args, { stdio: "inherit" });
}

if (!mode) {
    const version = extraArgs[0];
    if (!version) {
        console.error("Usage: npm run release:version:push -- <version>");
        process.exit(1);
    }

    run(npmCommand, ["run", "release:version", "--", version]);
    run(npmCommand, ["run", "release:push"]);
    process.exit(0);
}

if (!["patch", "minor", "major"].includes(mode)) {
    console.error(`Unsupported release mode: ${mode}`);
    process.exit(1);
}

run(npmCommand, ["run", `release:${mode}`]);
run(npmCommand, ["run", "release:push"]);
