---
name: release-workflow
description: 发布插件新版本（patch/minor/指定版本号）、推送 release tag、或排查 GitHub Actions Release 工作流失败时使用。涉及「发版」「更新版本号」「打 tag」「推 release」「Release CI 挂了 / Release notes 不对 / 产物缺失」等诉求时触发。
---

# 版本发布与 Release CI

本仓库的发版是一条自动化链路：`npm version` 钩子驱动构建、版本同步、CHANGELOG 归档、commit + tag，CI 再做硬校验并产出 GitHub Release。任何一环手工介入（手改版本号、手打 tag）都会被 CI 校验拦下或制造出对不齐的四处版本。使用本 skill 时，先理解链路，再动手。

## 何时使用

- 用户要求发新版本：patch / minor / major / 指定版本号。
- 用户要求推送 release commit + tag 到 GitHub。
- GitHub Actions Release 工作流失败、Release notes 内容异常、Release 资产缺失，需要排查。

## 必须先读的关键文件

动手前逐个确认现状，不要凭记忆操作：

- `package.json` 的 scripts：`preversion`（先 `npm run build`，构建失败即中止发版）、`version`（执行 `node version-bump.mjs` 并 `git add manifest.json versions.json CHANGELOG.md`）、`release:*` 全家族与 `pub` 别名。
- `version-bump.mjs`：把 `manifest.json.version` 改为目标版本、写 `versions.json[新版本] = minAppVersion`、把 CHANGELOG 的 Unreleased 归档为 `## [x.y.z] - 日期` 并重置占位符；Unreleased 只有占位符 `- 暂无待发布更新。` 时不归档（这是 [0.5.5]、[0.6.1] 无版本节的原因，属正常机制）。
- `publish.mjs` 与 `scripts/release-and-push.mjs`：前者执行 `git push <remote> --follow-tags`（remote 默认 origin）；后者串起「bump + push」一键发版。
- `.github/workflows/release.yml`：CI 的硬校验、notes 提取与资产打包逻辑。
- `CHANGELOG.md` 头部：第 3 行写明了「发布前先把待发布改动写到 Unreleased，发布脚本自动归档」的约定；`## [Unreleased]` 节当前是否只有占位符，决定了这次能不能发版。

## 推荐执行流程

1. **前置检查**：确认待发布改动已合入 main 分支，且 `git status` 工作区干净（`npm version` 在工作区不干净时会直接拒绝执行）。
2. **写 CHANGELOG**：在 `CHANGELOG.md` 的 `## [Unreleased]` 节下写本次变更，替换占位符 `- 暂无待发布更新。`。条目用中文，按 `### Added` / `### Changed` / `### Fixed` 分组（参照已有版本节的写法），并单独 commit 推送。
3. **发版**（三选一）：
   - `npm run release:patch`（或 `release:minor` / `release:major`）
   - 指定版本号：`npm run release:version -- x.y.z`
   - 一键发版+推送：`npm run release:patch:push`（或 `release:minor:push` / `release:major:push` / `release:version:push -- x.y.z`）

   自动链路依次执行：preversion 钩子跑 `npm run build`（失败即中止）→ npm 更新 package.json 并创建 `chore(release): 发布 X.Y.Z` commit 与 **v 前缀** tag → version 钩子跑 version-bump.mjs 同步 manifest.json、versions.json 并归档 CHANGELOG。
4. **推送**（非 `:push` 一键路径时）：`npm run release:push`（即 `git push origin --follow-tags`，release commit 和 tag 一起上去；换远端用 `node publish.mjs <remote>`）。
5. **观察 CI**：tag 推送后 GitHub Actions 的 Release 工作流自动触发，等它跑绿。

## 常用命令速查

```bash
npm run release:patch              # 0.7.0 → 0.7.1
npm run release:minor              # 0.7.0 → 0.8.0
npm run release:version -- 0.8.5   # 指定版本号
npm run release:patch:push         # 发版 + 推送一步到位
npm run release:version:push -- 0.8.5
npm run release:push               # 只推 release commit + tag（pub 是它的别名）
node scripts/extract-changelog-section.mjs <版本> /tmp/notes.md   # 本地复现 CI 的 notes 提取
```

## 项目内可复用的模块

- `version-bump.mjs` / `scripts/extract-changelog-section.mjs` 共享同一套 CHANGELOG 解析约定（`## [标题]` 节、占位符 `- 暂无待发布更新。`、"有意义内容"判定）。改 CHANGELOG 格式时两个文件必须一起动。
- `scripts/run-npm.mjs`：子进程调用 npm 的 helper，`release-version.mjs` 和 `release-and-push.mjs` 都用它。

## 禁止事项与高风险误区

- **绝不手改** `manifest.json` / `versions.json` 的版本号、**不手打 tag**、**不手写** `chore(release)` 提交。CI 会硬校验 tag（去 v）== package.json.version == manifest.json.version 且 versions.json 含该条目，任何一处不符直接 fail；手改只会造出四处版本对不齐的现场。
- **Unreleased 只有占位符时不要发版**：version-bump.mjs 不会归档空节，CI 提取不到版本节，Release notes 会退化成 fallback 文案（「未找到 CHANGELOG.md 中对应的版本节」）。
- tag 必须带 **v 前缀**：仓库全部 17 个 tag 均为 v 前缀，裸版本号虽能触发 CI 但偏离仓库约定。
- `npm version` 只能在干净工作区、合入 main 后执行；有未提交改动时先处理改动。
- **调研、演示、测试时绝对不可运行** `npm version` / `release:*` / `release:*:push` / `pub` 系命令——它们真实修改仓库、创建 commit 和 tag，并可能推送到 GitHub。排查时只读文件、跑只读命令（`git log` / `git tag -l` / `extract-changelog-section.mjs`）。
- CHANGELOG 中 [0.5.5]、[0.6.1] 等无版本节是「空 Unreleased 不归档」机制的正常结果，不要试图补写历史版本节。

## 排查：Release 工作流失败

- **Validate release version 步骤 fail**：四处版本（tag、package.json、manifest.json、versions.json）有任一处不一致，通常是有人手改过版本号。修复方式是回到正确版本状态后重走 `npm version` 流程，不要手工对齐版本号掩盖问题。
- **Release notes 退化为 fallback 文案**：CHANGELOG 既无该版本节、Unreleased 也只剩占位符——说明发版前忘了写 Unreleased。事后补救：把该版本的变更补进 CHANGELOG 并单独提交（notes 提取顺序是版本节 → Unreleased → fallback，tag 已存在的场景下补 Unreleased 不会改变已生成的 Release，需手动编辑 GitHub Release 正文）。
- **产物缺失 / 构建失败**：CI 与本地跑同一条 `npm run build`，先在本地复现；`.build/` 被 gitignore，CI 是现场构建，产物异常先怀疑本地也能复现的构建问题。
- **本地复现 notes 提取**：`node scripts/extract-changelog-section.mjs <版本> /tmp/notes.md`，与 CI 用的是同一脚本、同一降级顺序。

## 完成后的验证

- `git log --oneline -3` 能看到 `chore(release): 发布 X.Y.Z` 提交；`git tag -l 'v*'` 含本次 `vX.Y.Z`，且 `git ls-remote --tags origin` 确认 tag 已推上去。
- GitHub Actions 的 **Release** 工作流对该 tag 跑绿。
- GitHub Release 页面：标题为版本号，正文来自 CHANGELOG 版本节（非 fallback 文案），资产恰好 4 件——`main.js`、`manifest.json`、`styles.css`、`obsidian-language-learner-<版本>.zip`（zip 内也只有这 3 个文件）。
- 仓库内四处版本一致：tag（去 v）、package.json、manifest.json 均为新版本号，versions.json 含该条目；CHANGELOG 出现 `## [X.Y.Z] - 日期` 节且 Unreleased 已重置为占位符。
