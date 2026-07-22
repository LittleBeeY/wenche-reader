# 文澈阅读

文澈阅读是一款免费、开源、本地优先的 AI 深度阅读器。它支持批量导入文章、按页连续阅读，并可对选中文本直接解析、深入解析或自定义提问。

正式软件名称：**文澈AI深度阅读系统 V1.0**。

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

服务默认只监听 `127.0.0.1`，不会主动向局域网或公网开放。

Windows 一键入口：

- 双击 `scripts\open-reader.cmd`：安装缺失依赖、启动服务并打开网页。
- 双击 `scripts\config-ai.cmd`：交互式配置 DeepSeek 或其他 OpenAI-compatible API，并检查模型连接。
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

脚本默认配置 DeepSeek，API Key 输入时不会在终端回显；保存后会通过 `/models` 检查连接和模型名称：

```dotenv
AI_PROVIDER=openai-compatible
AI_API_KEY=your_api_key
AI_API_BASE=https://api.deepseek.com
AI_MODEL=deepseek-v4-flash
PORT=3000
HOST=127.0.0.1
```

修改 `.env` 后需要重启服务。任何提供 `/chat/completions` 的 OpenAI-compatible 服务也可以使用。

## 本地数据与隐私

- 原始文件保存在 `uploads/`。
- 文档元数据、标准化文本块、归档和 AI 历史保存在 `data/reader.sqlite`。
- API Key 保存在本地 `.env`。
- `.env`、`data/`、`uploads/`、日志和 `node_modules/` 已被 Git 忽略。
- 使用真实云端模型时，选区及相关上下文会发送给配置的模型服务商。

## 导入限制

- 单次最多导入 50 个文件。
- 单文件最大 25 MB，单批文件解码后合计最大 60 MB。
- EPUB 会检查条目数量、解压后大小和异常压缩率，以避免压缩炸弹。
- PDF、DOCX 和 EPUB 会校验基础文件签名；扩展名与内容不匹配时会拒绝导入。

## 测试

```powershell
npm.cmd test
npm.cmd run release:check
```

## 文档

- [架构与 API](docs/ARCHITECTURE.md)
- [运行、备份与排障](docs/RUNBOOK.md)
- [文档索引](docs/README.md)
- [安全问题报告](SECURITY.md)
- [参与贡献](CONTRIBUTING.md)
- [版本记录](CHANGELOG.md)

## 当前边界

这是面向可信单机环境的 V1.0，目前没有账号、多人隔离、云端部署、OCR、持久化高亮/笔记和导出。不要直接暴露到公网；公网或多人环境还需要认证、用户隔离、隐私授权、限流和后台解析任务。

## 开源许可

项目采用 [Apache License 2.0](LICENSE) 开源，可免费使用、修改和分发。
