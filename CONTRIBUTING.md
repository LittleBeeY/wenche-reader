# 参与贡献

感谢参与文澈阅读。提交代码前请先确认改动聚焦于一个明确问题，并保留本地优先、单机可信环境和 provider adapter 的现有边界。

## 开发流程

```powershell
npm.cmd install
npm.cmd test
npm.cmd run test:e2e:install
npm.cmd run test:e2e
npm.cmd run dev
```

提交 Pull Request 前运行：

```powershell
npm.cmd run release:check
```

## GitHub 发布流程

推荐使用 [GitHub CLI](https://cli.github.com/) 完成登录、推送和 Pull Request 创建。首次使用时运行：

```powershell
gh auth login --git-protocol ssh --web
gh auth status
```

创建独立分支并完成提交后，可以用下面两条命令完成发布：

```powershell
git push -u origin <branch-name>
gh pr create --draft --fill
```

如果终端提示找不到 `gh`，请先安装 GitHub CLI，再重新打开终端或开发工具，使新的用户 `PATH` 生效。

## 代码要求

- 新文件格式统一通过 `src/lib/documentParser.js` 接入，并补解析与恶意输入测试。
- 文档或模型生成的 HTML 在写入 `innerHTML` 前必须清洗。
- 数据库结构变化必须兼容现有数据，并补迁移测试。
- 阅读器交互变化应补 Playwright 用例，并至少验证 Chrome、Edge 和 Firefox。
- AI 厂商差异应留在 provider adapter，不要散落到路由和前端。
- 不要提交 `.env`、API Key、用户文档、`data/`、`uploads/`、日志或 `node_modules/`。

提交贡献即表示你同意按项目的 Apache License 2.0 提供该贡献。
