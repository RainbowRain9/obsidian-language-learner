import child from "child_process";

const remote = process.argv[2] || "origin";

child.execSync(`git push ${remote} --follow-tags`, {
    stdio: "inherit",
});

console.log("> Pushed commits and tags.");
