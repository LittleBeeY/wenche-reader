# 运行、备份与排障

## 环境要求

- Windows 10/11
- Node.js 22.13.0 或更高版本（项目使用 `node:sqlite`，开发依赖也要求该版本）
- npm

## 安装与启动

```powershell
npm.cmd install
npm.cmd start
```

默认地址是 `http://127.0.0.1:3000`。开发时可以运行：

```powershell
npm.cmd run dev
```

首次执行跨浏览器测试时安装 Playwright Firefox：

```powershell
npm.cmd run test:e2e:install
npm.cmd run test:e2e
```

端到端测试使用临时目录和 Mock provider，不会读写正式文章库。

`release:check` 的安全审计固定使用 npm 官方注册表，因为部分镜像不提供 audit 接口。

Windows 一键入口：

```powershell
scripts\open-reader.cmd
scripts\config-ai.cmd
```

配置脚本会隐藏 API Key 输入，并在保存后请求 provider 的 `/models` 接口。连接检查失败不会删除配置；部分兼容服务不提供该接口，需要启动应用后再实际测试。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AI_PROVIDER` | `mock` | 使用 `openai-compatible` 调用真实模型 |
| `AI_API_KEY` | 空 | 模型 API Key |
| `AI_API_BASE` | `https://api.openai.com/v1` | OpenAI-compatible API 根地址 |
| `AI_MODEL` | `gpt-4.1-mini` | 模型标识；一键脚本默认写入 `deepseek-v4-flash` |
| `PORT` | `3000` | HTTP 端口 |
| `HOST` | `127.0.0.1` | HTTP 监听地址；保持默认值可避免无意暴露到局域网 |

服务启动时读取项目根目录 `.env`，且不会覆盖已经存在的进程环境变量。修改配置后需要重启服务。

## 冒烟检查

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/ai/status
Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/health
Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/documents
npm.cmd test
npm.cmd run test:e2e
npm.cmd run release:check
```

`/api/ai/status` 只返回 provider、模型和是否配置，不会返回 API Key。

## 备份与恢复

页面左栏底部的“备份”会下载一个 `wenche-backup-YYYY-MM-DD.json` 文件，包含文章原文件、归档、阅读标注、AI 历史和已沉淀回答。备份明确不包含 `.env` 和 API Key，但仍包含私人文章内容，应妥善保管。

点击“恢复”并选择文澈备份后，应用会替换当前全部文章和阅读数据。恢复前应先下载一份当前备份；恢复完成后无需手工搬运数据库路径。

Markdown 导出与完整备份用途不同：沉淀视图中的“导出当前文章/导出全部”只导出阅读标注和已沉淀的 AI 回答，适合放入笔记软件。

也可以在停止服务后进行目录级备份：

- `data/reader.sqlite`
- `uploads/`
- `.env`（单独保管，不要上传公开仓库）

数据库中的原文件路径是本机绝对路径。恢复到不同目录后，现有标准化文本仍可读取，但依赖原文件重新解析的旧格式升级可能找不到文件；优先恢复到原路径。

## 常见问题

### 端口被占用

```powershell
$env:PORT="3127"
npm.cmd start
```

或在 `.env` 中修改 `PORT` 后重启。

### 页面显示 Mock 模式

运行 `npm.cmd run config:ai`，确认 `.env` 中存在 `AI_PROVIDER=openai-compatible` 和有效的 `AI_API_KEY`，然后重启服务。

### AI 返回 401/403

检查 API Key、账户余额和服务商权限。DeepSeek 的默认地址应为 `https://api.deepseek.com`，模型名必须是服务商当前支持的标识。

### AI 返回 404

通常是 API 根地址或模型名错误。应用会自动在根地址后调用 `/chat/completions`，不要把该路径重复写进 `AI_API_BASE`。

### HTML 样式或链接不完整

主动脚本、远程 CSS 导入、CSS `url()` 和危险链接会被移除。相对 HTML 链接只有在目标文件也已导入且位于同一归档时才能映射到应用内文档。

HTML 首次打开会测量原布局宽度并缩放到阅读区内；`Aa` 中的内容宽度和字号会在这个自适应比例上继续调整。调整窗口或收起侧栏时会自动重新计算比例。

### Word 排版与原文不完全一致

DOCX 默认通过 docx-preview 按 Word 页面展示，可保留页眉页脚、颜色、页面尺寸、表格、图片和大多数文字样式。应用会保留文档内的分页信息，再以每张纸的页脚为边界，把超长版式段的正文块重新装入独立纸页，并复制页眉页脚、补齐动态页码。这个阅读页数是浏览器近似结果，不是 Word 实时分页算法的印刷页数；超高表格、复杂 SmartArt、浮动对象和宏仍不会完整模拟。

阅读区分页栏左侧的 `Aa` 可调节字号和明亮、护眼、夜间主题。Word 模式会统一缩放整页，普通阅读模式还可调节内容宽度和行距。设置保存在浏览器本地；如需恢复初始排版，打开该菜单并点击“恢复默认”。

`Aa` 右侧的沉浸按钮会收起左右侧栏和顶部工具栏。按 `Esc` 或右上角关闭按钮可退出；在沉浸状态下划词解析时，应用会自动恢复工作区并打开 AI 面板。

AI 回答生成时会逐步显示。生成完成后，回答才会进入历史记录；回答下方出现“原文定位”时，点击页码或段落可回到对应正文并短暂高亮。模型没有使用上下文里的位置标记时，应用只会在能够可靠确定选区页面时提供定位，不会猜测来源。

当阅读区窄于 Word 纸张时，应用会先把整页缩放到可用宽度；用户在 `Aa` 中主动放大后可以横向滚动查看细节。中等宽度下顶部搜索和翻页控制会自动换到第二行。

## 生产前检查

当前服务没有认证、用户隔离、限流或后台任务。不要把 `HOST` 改成 `0.0.0.0` 后直接暴露到公网；产品化前至少需要认证、用户隔离、隐私授权、请求限流、备份策略和大文件异步解析。
