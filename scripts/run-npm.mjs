import child from "child_process";
import process from "process";

function resolveNpmRunner() {
    const npmExecPath = process.env.npm_execpath;
    if (npmExecPath) {
        return {
            command: process.execPath,
            argsPrefix: [npmExecPath],
            options: { stdio: "inherit" },
        };
    }

    return {
        command: process.platform === "win32" ? "npm.cmd" : "npm",
        argsPrefix: [],
        options: {
            stdio: "inherit",
            shell: process.platform === "win32",
        },
    };
}

export function runNpm(args) {
    const runner = resolveNpmRunner();
    child.execFileSync(
        runner.command,
        [...runner.argsPrefix, ...args],
        runner.options
    );
}
