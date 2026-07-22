# AI Deep Reader

一个本地优先的 AI 深度阅读 Web 应用：批量导入文章，按页连续阅读，划词后直接解析、深入解析或自定义提问。

## 当前能力

- 支持批量导入 `.txt`、`.md/.markdown`、`.html/.htm`、`.pdf`、`.docx`、`.epub`。
- 支持命名归档、批量归档、自然排序、列表搜索、单篇和批量删除。
- 长文自动分页，可跨文档连续上一页/下一页，并保存阅读进度。
- 保留常见 HTML、Markdown 和 DOCX 结构，包括标题、列表、引用、表格和行内样式。
- HTML 原排版在禁用脚本的沙箱中展示，同一归档内的相对链接可跳转到已导入文档。
- 支持文内搜索、匹配跳转和高亮。
- 划词后可选择“解析”“深入解析”或“自定义问题”；未划词时也可围绕当前页或全文上下文提问。
- AI 回答按安全 Markdown 渲染，保留解析历史，并可取消正在进行的请求。
- 左侧文档栏和右侧 AI 面板可独立收起；划词解析时 AI 面板会自动展开。

## 快速启动

需要 Node.js 22.13.0 或更高版本。

```powershell
npm.cmd install
npm.cmd start
```

打开 `http://localhost:3000`。

Windows 一键入口：

- 双击 `scripts\open-reader.cmd`：安装缺失依赖、启动服务并打开网页。
- 双击 `scripts\config-ai.cmd`：交互式配置 DeepSeek 或其他 OpenAI-compatible API。
- 终端中也可以运行 `npm.cmd run open` 和 `npm.cmd run config:ai`。

如果端口 `3000` 被占用：

```powershell
$env:PORT="3127"
npm.cmd start
```

## 配置 AI

默认使用 Mock provider，方便在没有 API Key 时测试阅读和交互流程，但不会产生真实模型回答。

推荐直接运行：

```powershell
npm.cmd run config:ai
```

脚本默认配置 DeepSeek：

```dotenv
AI_PROVIDER=openai-compatible
AI_API_KEY=your_api_key
AI_API_BASE=https://api.deepseek.com
AI_MODEL=deepseek-v4-flash
PORT=3000
```

修改 `.env` 后需要重启服务。任何提供 `/chat/completions` 的 OpenAI-compatible 服务也可以使用。

## 本地数据与隐私

- 原始文件保存在 `uploads/`。
- 文档元数据、标准化文本块、归档和 AI 历史保存在 `data/reader.sqlite`。
- API Key 保存在本地 `.env`。
- `.env`、`data/`、`uploads/`、日志和 `node_modules/` 已被 Git 忽略。
- 使用真实云端模型时，选区及相关上下文会发送给配置的模型服务商。

## 测试

```powershell
npm.cmd test
```

## 文档

- [架构与 API](docs/ARCHITECTURE.md)
- [运行、备份与排障](docs/RUNBOOK.md)
- [文档索引](docs/README.md)

## 当前边界

这是单机 MVP，目前没有账号、多人隔离、云端部署、计费、OCR、持久化高亮/笔记和导出。若用于公网或多人环境，还需要补充认证、上传配额、隐私授权、限流和后台解析任务。
