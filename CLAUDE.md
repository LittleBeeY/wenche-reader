# 文澈阅读

本项目正式名称为“文澈AI深度阅读系统”，品牌名“文澈阅读”。它是本地优先的 Node.js/Express AI 阅读器。前端为原生 ES modules，数据存储为 `node:sqlite`，不使用前端框架或构建步骤。

## 命令

```powershell
npm.cmd install
npm.cmd start
npm.cmd run dev
npm.cmd test
npm.cmd run test:e2e
npm.cmd run test:desktop
npm.cmd run desktop:dev
npm.cmd run desktop:make
npm.cmd run test:packaged
npm.cmd run open
npm.cmd run config:ai
```

运行环境需要 Node.js 22.13.0+。默认服务地址是 `http://localhost:3000`。

## 代码边界

- `public/`：浏览器 UI 和纯前端辅助模块。
- `src/server.js`：HTTP 路由和上传文件生命周期。
- `src/cli.js` / `src/runtime.js`：CLI 与 Electron utility process 共用的启动运行时。
- `src/lib/documentParser.js`：所有文档解析、HTML/CSS 清洗。
- `src/lib/aiSettingsStore.js`：AI 设置存储接口（Env 与桌面 IPC 两种实现）。
- `src/lib/storage.js`：SQLite schema、迁移和事务。
- `src/lib/aiProvider.js`：AI provider adapter 和提示词。
- `src/lib/markdownExport.js`：阅读标注和 AI 回答沉淀的 Markdown 导出。
- `src/lib/selectionContext.js`：选区及全文上下文裁剪。
- `test/`：Node test runner 测试，服务 API 使用临时数据目录。
- `e2e/`：Playwright 跨浏览器流程，使用隔离临时数据目录和 Mock provider。
- `desktop/`：Electron main、utility process、`app://` 协议、preload、配置仓库与更新器；业务代码不反向依赖 Electron。

## 必须保持的约束

- 不要提交 `.env`、`data/`、`uploads/`、日志或 `node_modules/`。
- 桌面版本地服务只监听 `127.0.0.1` 随机端口，所有 API 必须携带每次启动随机生成的会话令牌；main 只向自己的协议代理写入令牌。
- AI Key 在桌面版只经 `safeStorage` 加密保存于 `%LOCALAPPDATA%\Wenche Reader\secrets`，不得写入 `.env`、SQLite、日志或备份；启动环境中的 `AI_API_KEY` 等只允许作为当前会话只读回退（不落盘、不回显），见 `docs/desktop/DATA_AND_SECURITY.md` §6.4。
- SQLite 只能由 utility process 持有；main、renderer、preload 和更新器不得打开数据库。
- 生产窗口必须保持 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`，并拒绝未授权的 window.open、导航与权限请求。
- 新文件格式必须通过 `documentParser.js` 接入，并补解析与安全测试；不要在路由或前端另写解析器。
- DOCX 的 AI 文本继续由 Mammoth 和 `documentParser.js` 生成；视觉页面由 `public/docxPreview.js` 调用 docx-preview 渲染。原文件读取必须验证路径仍位于 `uploads/`。
- 任何写入 `innerHTML` 的模型或文档内容都必须先清洗。AI Markdown 继续使用 `marked` + DOMPurify。
- 删除原文件前必须验证解析后的路径仍位于 `uploads/`。
- SQLite schema 变化必须兼容现有数据库，并补迁移测试。
- 备份必须排除 `.env` 和 API Key；恢复数据库提交成功后不得再删除新恢复文件。
- AI 业务代码只依赖 provider adapter；不要把 DeepSeek 或其他厂商逻辑散落到路由和前端。
- AI 流式输出继续使用 provider adapter；完整回答结束后才写入历史，引用定位只能使用上下文中真实存在的页码或段落标记。
- 直接解析、深入解析和自定义问题必须保持不同提示词结构并基于原文；直接解析和深入解析都只解释文字意思，深入解析比直接解析更完整，不添加其他分析栏目。
- 侧栏开合和阅读排版设置保存在浏览器本地；划词 AI 操作必须自动展开右侧面板。
- 只做单机可信环境假设。加入公网能力前必须先设计认证、用户隔离和隐私授权。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `AI_PROVIDER` | 预设名（`deepseek`/`openai`/`kimi`/`zhipu`/`qwen`/`ollama`/`anthropic`/`gemini`）、传输层类型（`openai-compatible`/`anthropic`/`gemini`）或 `mock`；预设自动带入默认根地址与模型 |
| `AI_API_KEY` | 模型密钥（Ollama 等本地服务可留空） |
| `AI_API_BASE` | API 根地址，可覆盖预设默认值 |
| `AI_MODEL` | 模型标识，可覆盖预设默认值 |
| `PORT` | HTTP 端口，默认 `3000` |
| `HOST` | 监听地址，默认 `127.0.0.1` |

AI 接口主要在应用内配置：点击 AI 面板顶部的状态栏打开设置对话框，读写 `/api/ai/settings`，保存后立即重建 provider 实例并同步给 RSS 服务，无需重启。`.env` 是这些设置的事实来源，手动修改后需重启。

桌面版不读取仓库 `.env`；同名 `AI_API_KEY`/`AI_PROVIDER`/`AI_API_BASE`/`AI_MODEL` 由启动环境提供时，仅用于当前会话且不落盘（见 `docs/desktop/DATA_AND_SECURITY.md` §6.4）。

## 文档

- `README.md`：用户入口和当前能力。
- `docs/ARCHITECTURE.md`：数据流、数据模型、API 与安全边界。
- `docs/RUNBOOK.md`：运行、配置、备份和排障。
- `docs/RSS_DESIGN.md`：已实现的内嵌资讯版块设计基线。
- `docs/superpowers/`：历史设计与实施记录，不是现行待办。

修改行为、路由、环境变量、数据模型或运维方式时，同步更新对应现行文档。历史记录不要追加到本文件。
