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
```

## 桌面版安装与使用

- 运行 `npm.cmd run desktop:make` 生成 `out/make/squirrel.windows/x64/` 下的 `WencheReader-Setup.exe`；桌面 E2E 用 `npm.cmd run test:desktop`，产物检查用 `npm.cmd run test:packaged`。
- 本地构建若仓库路径含非 ASCII 字符（如 `D:\项目\...`），`electron-winstaller` 的 `rcedit` 可能报 `Unable to load file`；此时设置 `WENCHE_FORGE_OUT` 指向纯 ASCII 临时目录（如 `C:\Users\<用户>\AppData\Local\Temp\wenche-out`）再执行 `npm.cmd run desktop:make`，产物检查同样传入该变量。
- 安装位置固定为 `%LOCALAPPDATA%\wenche_reader`（Squirrel 按包 ID 决定用户级安装目录，不支持自定义安装位置）；如需可选安装目录只能换 NSIS/MSIX 安装器，并会失去 Squirrel 自动更新能力。
- 安装后数据位于 `%LOCALAPPDATA%\Wenche Reader`；日志在 `logs/`（按日轮转，保留 7 天、单文件 5 MiB）。
- 安装/卸载/开始菜单快捷方式显示名为「文澈阅读」；可执行文件与包 ID 保持英文 `WencheReader.exe`/`wenche_reader`。卸载入口在统一「设置」对话框的「关于与更新」区段（本地侧栏「更多 → 设置」、RSS 页脚或 RSS 文章「更多」菜单均可打开），也可直接 `Update.exe --uninstall`；Web/CLI 数据迁移到桌面版使用 V2 备份导出/恢复，桌面版不会自动读取仓库数据目录。
- 更新：侧栏「更多 → 关于与更新」。仅打包版且配置 `WENCHE_UPDATE_BASE_URL` 后启用，频道由 `config/settings.json` 的 `updates.channel` 决定（`stable`/`beta`）。
- 首次启动会在版本变更时自动把 `data/reader.sqlite` 备份到 `backups/pre-upgrade-*.sqlite`（保留最近 3 份）；存在 `reader.sqlite-wal`/`reader.sqlite-shm` 时会拒绝启动并显示错误页。
- AI Key 保存在 `secrets/ai-key.bin`（safeStorage 加密），不再写入 `.env`；升级后 Key 仍可用但页面不回显。
- 若启动前已设置环境变量 `AI_API_KEY`（可搭配 `AI_PROVIDER`/`AI_API_BASE`/`AI_MODEL`），桌面版会作为当前会话的 Key 自动使用、不落盘；AI 设置对话框会显示来源并可随时改用保存的 Key。修改环境变量后需重启应用生效。
- 排障：清空 `cache/` 不会丢数据；`data/`、`uploads/`、`config/`、`secrets/`、`backups/` 不要手动删除；卸载不会删除 `%LOCALAPPDATA%\Wenche Reader`。

## 配置 AI 接口（应用内）

打开应用后点击 AI 面板顶部的「AI 接口」状态栏（本地文档视图）或资讯首页标题栏的 AI 按钮，即可进入设置对话框：选择接口、填写 API Key、按需调整根地址和模型，先「测试连接」再「保存设置」。保存后立即生效，无需重启服务，AI 初评等后台任务也会自动使用新配置。连接测试按接口类型发起：OpenAI-compatible 服务请求 `/models`，Anthropic 请求 `/v1/models`，Gemini 请求 `/v1beta/models`，本地 Ollama 请求 `/api/tags`；部分服务不提供对应接口时测试会失败，但配置仍可保存，以实际问答为准。

Key 保存在本地 `.env` 中，设置页面只显示“已配置/未配置”，不回显 Key；留空保存表示保留原 Key。历史版本提供的 `scripts\config-ai.cmd` 仍可使用，但不是必需入口。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AI_PROVIDER` | `mock` | 厂商预设名 `deepseek`/`openai`/`kimi`/`zhipu`/`qwen`/`ollama`/`anthropic`/`gemini`，或传输层类型 `openai-compatible`/`anthropic`/`gemini`；预设自动带入根地址与模型 |
| `AI_API_KEY` | 空 | 模型 API Key；Ollama 等本地服务可留空 |
| `AI_API_BASE` | 随 provider 而异 | API 根地址，可覆盖预设默认值；`openai-compatible` 类型默认 `https://api.openai.com/v1` |
| `AI_MODEL` | 随 provider 而异 | 模型标识，可覆盖预设默认值 |
| `PORT` | `3000` | HTTP 端口 |
| `HOST` | `127.0.0.1` | HTTP 监听地址；保持默认值可避免无意暴露到局域网 |

服务启动时读取项目根目录 `.env`，且不会覆盖已经存在的进程环境变量。环境变量通常由应用内设置页面写入（保存后立即生效）；手动编辑 `.env` 后需要重启服务。`AI_PROVIDER` 必须为上述已知值之一，拼写错误会在启动时直接报错，而不是静默退回 Mock 模式。

## 冒烟检查

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/ai/status
Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/health
Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/documents
npm.cmd test
npm.cmd run test:ai
npm.cmd run test:e2e
npm.cmd run test:desktop
npm.cmd run test:packaged
npm.cmd run release:check
```

`/api/ai/status` 只返回 provider、模型和是否配置，不会返回 API Key。`test:ai` 使用 Mock provider 和固定中英文样本检查选区锚点、FTS5 检索命中率、上下文预算、模式差异和引用校验，不会调用真实模型或产生费用。

## 备份与恢复

页面左栏底部打开“更多 → 备份与恢复”，点击“下载备份”会生成一个 `wenche-backup-YYYY-MM-DD.json` 文件（V2 格式），包含文章原文件、归档、阅读标注、AI 历史和已沉淀回答，以及订阅源、订阅分组、资讯阅读状态（收藏、稍后读、已读）、兴趣偏好和今日精选。普通已读资讯的正文缓存默认不进入备份，可用 `/api/backup?includeRssCache=1` 包含。V2 恢复兼容 V1 备份。备份明确不包含 `.env` 和 API Key，但仍包含私人文章内容，应妥善保管。

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

点击 AI 面板顶部的「AI 接口」状态栏，在设置对话框中选择真实接口、填写 API Key 并保存，保存后立即生效。也可手动确认 `.env` 中 `AI_PROVIDER` 为预设名或传输层类型且 `AI_API_KEY` 有效，再重启服务。`AI_PROVIDER` 拼写错误会在启动时报错。

### AI 返回 401/403

检查 API Key、账户余额和服务商权限。DeepSeek 的默认地址应为 `https://api.deepseek.com`；Anthropic 需要 `https://api.anthropic.com`；Gemini 需要 `https://generativelanguage.googleapis.com`。模型名必须是服务商当前支持的标识。可在设置对话框中用「测试连接」快速定位密钥或地址问题。

### AI 返回 404

通常是 API 根地址或模型名错误。`openai-compatible` 会自动在根地址后调用 `/chat/completions`，不要把该路径重复写进 `AI_API_BASE`；Anthropic 和 Gemini 的根地址应填域名根（不带 `/v1`、`/v1beta`），应用会自行追加对应路径。切换接口时，如果设置对话框中根地址留空，会使用所选接口的默认地址；`AI_API_BASE`/`AI_MODEL` 中残留的旧值仍会覆盖新预设默认值。

### 切换不同的 AI 接口

在设置对话框中选择其他接口并保存即可，保存后立即生效、无需重启。使用厂商预设时只需填 API Key（Ollama 除外）；自定义服务选择 `openai-compatible` 并自备根地址与模型。AI 历史记录中的 provider 字段会显示预设名（如 `deepseek`）而非传输层类型。

### 订阅源抓取失败

资讯模式左下角的“上次更新”会提示失败来源数量，管理订阅源对话框中每个失败来源会显示可读错误和“重试”按钮。连续失败的来源按指数退避自动重试（最长 24 小时），不影响其他来源。指向本机或内网的地址会被安全策略拒绝，这是预期行为。

页面中的“立即刷新”会检查所有未暂停订阅，不受下一次调度时间限制；后台调度仍只刷新到期订阅。资讯设置中的默认刷新间隔用于之后新增或重新订阅的来源，每个来源可在“管理订阅源”中单独调整刷新间隔、正文获取方式和是否参与 AI 初评。

正文图片通过本站代理按需缓存到 `data/rss-image-cache/`，不直接暴露阅读者的浏览器给来源站点。旧版本导入且图片地址已被清洗掉的文章，会在首次打开时尝试重新提取原网页；来源已删除、需要登录或拒绝抓取时，正文文字仍可正常阅读，但对应图片无法恢复。

“提取全文”成功后，如果当前阅读快照还没有标注或 AI 记录，页面会原地更新为提取后的正文；已有阅读资产时会保留原快照并显示提示，避免引用和标注位置错位。提取失败不会清空现有 Feed 正文。

### 今日精选没有变化

同一天内简报保持稳定；点击“重新生成”才会重新分诊与排序。AI 初评受每日预算限制（默认 60 条/天，可在 `.env` 之外通过资讯设置调整）；预算用尽或 AI 不可用时不影响订阅与阅读，只是推荐原因退回为确定性依据。

### HTML 样式或链接不完整

主动脚本、远程 CSS 导入、CSS `url()` 和危险链接会被移除。相对 HTML 链接只有在目标文件也已导入且位于同一归档时才能映射到应用内文档。

HTML 首次打开会测量原布局宽度并缩放到阅读区内；`Aa` 中的内容宽度和字号会在这个自适应比例上继续调整。调整窗口或收起侧栏时会自动重新计算比例。

### Word 排版与原文不完全一致

DOCX 默认通过 docx-preview 按 Word 页面展示，可保留页眉页脚、颜色、页面尺寸、表格、图片和大多数文字样式。应用会保留文档内的分页信息，再以每张纸的页脚为边界，把超长版式段的正文块重新装入独立纸页，并复制页眉页脚、补齐动态页码。这个阅读页数是浏览器近似结果，不是 Word 实时分页算法的印刷页数；超高表格、复杂 SmartArt、浮动对象和宏仍不会完整模拟。

阅读区分页栏左侧的 `Aa` 可调节字号和明亮、护眼、夜间主题。Word 模式会统一缩放整页，普通阅读模式还可调节内容宽度和行距。普通界面、长文正文和代码分别使用适合中文屏幕阅读的本地系统字体栈，不联网下载字体。设置保存在浏览器本地；如需恢复初始排版，打开该菜单并点击“恢复默认”。

`Aa` 右侧的沉浸按钮会收起左右侧栏和搜索等工具，并在底部保留阅读设置与浮动翻页条。沉浸时点击 `Aa`，设置面板会向上展开，可继续调节字号和主题。按 `Esc` 或右上角关闭按钮可退出；在沉浸状态下划词解析时，应用会自动恢复工作区并打开 AI 面板。

AI 回答生成时会逐步显示。生成完成并校验引用后，回答才会进入历史记录；回答下方出现“原文定位”时，点击来源可回到对应正文并短暂高亮。模型只能引用本次来源包中的真实块 ID，虚构 ID 会在保存前移除。提问框可明确选择选区、当前页、当前章节或全文；历史元信息会显示模型、范围、Token 和耗时。

如果更新代码后没有重启旧服务，前端会自动兼容旧服务的一次性 JSON 回答；重启后则恢复逐字流式显示。连接异常统一显示中文提示。

当阅读区窄于 Word 纸张时，应用会先把整页缩放到可用宽度；用户在 `Aa` 中主动放大后可以横向滚动查看细节。中等宽度下顶部搜索和翻页控制会自动换到第二行。

## 生产前检查

当前服务没有认证、用户隔离、限流或后台任务。不要把 `HOST` 改成 `0.0.0.0` 后直接暴露到公网；产品化前至少需要认证、用户隔离、隐私授权、请求限流、备份策略和大文件异步解析。
