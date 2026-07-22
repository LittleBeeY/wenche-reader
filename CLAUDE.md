# AI Deep Reader

本项目是本地优先的 Node.js/Express AI 阅读器。前端为原生 ES modules，数据存储为 `node:sqlite`，不使用前端框架或构建步骤。

## 命令

```powershell
npm.cmd install
npm.cmd start
npm.cmd run dev
npm.cmd test
npm.cmd run open
npm.cmd run config:ai
```

运行环境需要 Node.js 22.13.0+。默认服务地址是 `http://localhost:3000`。

## 代码边界

- `public/`：浏览器 UI 和纯前端辅助模块。
- `src/server.js`：HTTP 路由和上传文件生命周期。
- `src/lib/documentParser.js`：所有文档解析、HTML/CSS 清洗。
- `src/lib/storage.js`：SQLite schema、迁移和事务。
- `src/lib/aiProvider.js`：AI provider adapter 和提示词。
- `src/lib/selectionContext.js`：选区及全文上下文裁剪。
- `test/`：Node test runner 测试，服务 API 使用临时数据目录。

## 必须保持的约束

- 不要提交 `.env`、`data/`、`uploads/`、日志或 `node_modules/`。
- 新文件格式必须通过 `documentParser.js` 接入，并补解析与安全测试；不要在路由或前端另写解析器。
- 任何写入 `innerHTML` 的模型或文档内容都必须先清洗。AI Markdown 继续使用 `marked` + DOMPurify。
- 删除原文件前必须验证解析后的路径仍位于 `uploads/`。
- SQLite schema 变化必须兼容现有数据库，并补迁移测试。
- AI 业务代码只依赖 provider adapter；不要把 DeepSeek 或其他厂商逻辑散落到路由和前端。
- 直接解析、深入解析和自定义问题必须保持不同提示词结构，并以原文依据为核心。
- 侧栏开合状态保存在浏览器本地；划词 AI 操作必须自动展开右侧面板。
- 只做单机可信环境假设。加入公网能力前必须先设计认证、用户隔离和隐私授权。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `AI_PROVIDER` | `mock` 或 `openai-compatible` |
| `AI_API_KEY` | 模型密钥 |
| `AI_API_BASE` | OpenAI-compatible API 根地址 |
| `AI_MODEL` | 模型标识 |
| `PORT` | HTTP 端口，默认 `3000` |

## 文档

- `README.md`：用户入口和当前能力。
- `docs/ARCHITECTURE.md`：数据流、数据模型、API 与安全边界。
- `docs/RUNBOOK.md`：运行、配置、备份和排障。
- `docs/superpowers/`：历史设计与实施记录，不是现行待办。

修改行为、路由、环境变量、数据模型或运维方式时，同步更新对应现行文档。历史记录不要追加到本文件。
