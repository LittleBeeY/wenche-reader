# 参与贡献

感谢参与文澈阅读。提交代码前请先确认改动聚焦于一个明确问题，并保留本地优先、单机可信环境和 provider adapter 的现有边界。

## 开发流程

```powershell
npm.cmd install
npm.cmd test
npm.cmd run dev
```

提交 Pull Request 前运行：

```powershell
npm.cmd run release:check
```

## 代码要求

- 新文件格式统一通过 `src/lib/documentParser.js` 接入，并补解析与恶意输入测试。
- 文档或模型生成的 HTML 在写入 `innerHTML` 前必须清洗。
- 数据库结构变化必须兼容现有数据，并补迁移测试。
- AI 厂商差异应留在 provider adapter，不要散落到路由和前端。
- 不要提交 `.env`、API Key、用户文档、`data/`、`uploads/`、日志或 `node_modules/`。

提交贡献即表示你同意按项目的 Apache License 2.0 提供该贡献。
