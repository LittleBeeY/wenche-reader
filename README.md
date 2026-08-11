# 文澈阅读

文澈阅读是一款免费、开源、本地优先的 AI 深度阅读器。它支持批量导入文章、按页连续阅读，并可对选中文本直接解析、深入解析或自定义提问。

正式软件名称：**文澈AI深度阅读系统 V1.0**。

[![CI](https://github.com/LittleBeeY/wenche-reader/actions/workflows/ci.yml/badge.svg)](https://github.com/LittleBeeY/wenche-reader/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/LittleBeeY/wenche-reader)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.13.0-brightgreen)](https://nodejs.org/)

## 界面预览

![阅读工作区](docs/screenshots/reader.png)

![资讯收件箱](docs/screenshots/rss.png)

## 当前能力

- 资讯（RSS/Atom）订阅：粘贴 Feed 或网站地址自动探测订阅，支持 OPML 批量导入（先预览并识别新增、重复、无效条目）与导出。
- 资讯收件箱：默认采用 Fluent Reader 风格的响应式封面卡片网格，每篇文章显示明确的发布日期、时间和阅读时长；封面优先选择正文大图和横图，过滤头像、Logo、二维码与追踪像素，再按来源图标、来源占位图回退。支持未读/全部/已读筛选、收藏、稍后读、不感兴趣、关键词搜索、紧凑/摘要/卡片三种视图和批量标记已读。
- 今日精选：每天生成有限的重点内容（重点 3 条 + 精选若干），每条附可解释的推荐原因，同一来源默认不超过两条，支持重新生成。
- AI 初评与智能排序：低成本分诊只分析最近 48 小时候选，输出结构化摘要、主题与质量信号；新鲜度是最高单项权重，列表查询还会按当前时间实时衰减旧内容。已读降权、重复降权和负反馈即时生效；AI 不可用时订阅与阅读完全不受影响，也可在设置中全局关闭自动分析。
- 订阅管理：分组、重命名、重点/普通/降低优先级、暂停、单源刷新与失败重试、刷新间隔、正文获取方式和 AI 初评开关；删除订阅保留已收藏与有标注的内容。
- 打开资讯即生成隐藏阅读快照，完整复用文澈深读能力：分页、划词解析、批注、收藏、沉淀与导出；正文远程图片会经 SSRF 防护、格式与大小校验后缓存为本站资源，历史破图条目在首次打开时自动重提取；可一键“保存到文档”进入本地资料库；仅摘要来源支持按需提取全文，已有标注或 AI 记录时不会静默覆盖旧快照。
- 抓取安全：仅允许 http/https，拒绝本机与内网地址（含 IPv4 变体与 IPv4-mapped IPv6）、逐跳校验重定向、限制大小与超时、禁止 XML 外部实体。
- 支持批量导入 `.txt`、`.md/.markdown`、`.html/.htm`、`.pdf`、`.docx`、`.epub`；空库首次打开显示冷启动引导卡，可从中直接添加文档或订阅资讯。
- 支持命名归档、批量归档、自然排序、列表搜索、单篇和批量删除。
- 长文自动分页，可跨文档连续上一页/下一页，并保存阅读进度。
- DOCX 默认按 Word 页面高保真展示，保留页眉页脚、字体颜色、标题、表格、内嵌图片和常用页面样式；超长版式段会按正文块重新装入独立纸页，重复页眉页脚并补齐动态页码，同时提取逐页文本供搜索和 AI 使用。
- HTML 原排版在禁用脚本的沙箱中展示，首次打开会自动适应阅读区宽度，同一归档内的相对链接可跳转到已导入文档。
- 支持文内搜索、匹配跳转和高亮。
- 支持持久化划词高亮、批注和分页书签；保存标注不会改变当前位置，点击已高亮文字即可取消，也可在沉淀视图中跳转、编辑或删除。
- 划词后可选择“解析”“深入解析”或“自定义问题”；提问时可明确选择“选中文字、当前页、当前章节、全文”四种回答范围。
- 选区使用正文块 ID 和字符偏移保存定位；全文问题通过 SQLite FTS5/BM25 检索相关段落，并按章节和相邻上下文组装有限来源包。
- AI 回答会流式生成并按安全 Markdown 渲染；模型引用只能使用来源包中的真实块 ID，服务端会删除无效引用，回答中的原文依据可一键定位回正文。
- 直接解析和深入解析都只解释文字意思，不单列其他分析栏目；深入解析会把省略逻辑、关键措辞和上下文限定解释得更完整。两种模式使用不同的上下文预算、随机性和输出上限；完整回答会记录模型、提示词版本、Token 与延迟，保留在历史中并可继续沉淀。
- 阅读标注和 AI 回答沉淀可按当前文章或全部文章导出为 Markdown。
- 可从页面一键下载本地数据备份并恢复文章、归档、标注和 AI 记录；备份不包含 API Key。
- 本地文档保持文档库、正文、AI 三栏工作区；资讯采用任务聚焦布局，浏览时只显示资讯导航与宽列表，打开文章后把返回、标题来源、正文搜索、文章操作、阅读设置和翻页整合为一个顶部工具栏，只保留文章收藏而不重复显示页书签；正文与 AI 聚焦显示，窄屏按导航、列表、正文单任务切换。资讯隐藏快照拥有独立阅读进度，切回本地文档时恢复此前的本地文章，不会继续显示资讯正文或覆盖本地最近阅读。
- 左侧栏采用类似 X 的纵向主导航：本地文档、资讯和添加文档保持为清晰的一级入口，导入位置、文档管理、备份恢复收进底部“更多”，文件夹筛选默认收起；整栏可缩成 72px 图标轨道，并记住浏览器中的开合状态。资讯订阅源、订阅管理、本地文档库及各资料夹仍可按需折叠。文档列表与正文各自稳定滚动；AI 解析面板可拖动、缩放并记住位置尺寸，也可收纳成一个可独立拖动的小方块，窄屏默认收纳以免遮挡导航。快捷解析和解析记录使用折叠栏保持简洁，划词解析时面板会自动展开。
- 阅读字号可在 80%–160% 间调节，标题、正文、表格和 Word 整页同步缩放；还可切换明亮、护眼、夜间主题和内容宽度、行距，设置会保存在当前浏览器。夜间主题为"深空·极光"品牌皮肤（深空底色 + 极光光斑 + 玻璃材质），浏览器标签栏颜色随主题联动。
- 顶部的沉浸阅读按钮可暂时收起左右侧栏和搜索等工具，底部保留阅读设置、上一页、页码和下一页；按 `Esc` 或右上角关闭按钮即可恢复，划词调用 AI 时会自动退出沉浸模式并展开解析面板。
- 中等宽度下阅读工具栏自动换行，窄屏下 Word 纸页自动适配阅读区宽度，用户主动放大后仍可横向查看细节。

## 快速启动

需要 Node.js 22.13.0 或更高版本。

Linux / macOS：

```bash
npm install
npm start
```

Windows：

```powershell
npm.cmd install
npm.cmd start
```

打开 `http://localhost:3000`。

服务默认只监听 `127.0.0.1`，不会主动向局域网或公网开放。

Windows 一键入口：

- 双击 `scripts\open-reader.cmd`：安装缺失依赖、启动服务并打开网页。

如果端口 `3000` 被占用：

```powershell
$env:PORT="3127"
npm.cmd start
```

## Windows 桌面版

面向 Windows 10/11 x64 的桌面发行版（无需安装 Node.js）：

- **首次安装**：双击 `WencheReader-Setup.exe`，安装完成后会自动在桌面和开始菜单创建「文澈阅读」快捷方式；
- **日常启动**：从**桌面快捷方式**或**开始菜单 → 文澈阅读**启动。`WencheReader-Setup.exe` 是一次性安装器，安装完成后请不要再运行它（重复运行只会触发 Squirrel 的安装逻辑并直接退出，不会打开应用）；
- 如果快捷方式丢失，可到安装目录 `%LOCALAPPDATA%\wenche_reader\` 直接双击 `WencheReader.exe` 启动；
- 阅读数据保存在 `%LOCALAPPDATA%\Wenche Reader`，卸载不会删除用户数据；
- 「设置 → 数据」可查看存储占用、清理资讯图片/浏览缓存，并支持把数据根迁移到其他磁盘（迁移后自动重启，阅读数据完整保留）；
- 侧栏「更多 → 设置」（RSS 页脚或 RSS 文章「更多」菜单的「设置」打开同一个对话框）统一管理：AI 接口、资讯偏好、数据备份与恢复、关于与更新（版本、更新、日志、卸载）；
- 卸载入口也会同时卸载开始菜单/桌面快捷方式与程序文件；阅读数据保留在本地数据目录；
- 启动应用前若已设置环境变量 `AI_API_KEY`（可搭配 `AI_PROVIDER`/`AI_API_BASE`/`AI_MODEL`），桌面版会把它作为当前会话的 Key 自动使用、不会写入本机；`AI_API_KEY` 缺失时也自动识别 `OPENAI_API_KEY`/`DEEPSEEK_API_KEY` 等常见别名；AI 设置对话框中也会显示 Key 来源变量名，可随时改用保存的 Key；
- 源码启动方式继续保留：`npm.cmd start`，桌面开发用 `npm.cmd run desktop:dev`。

## 配置 AI

默认使用 Mock provider，方便在没有 API Key 时测试阅读和交互流程，但不会产生真实模型回答。

**在应用内配置**：打开网页后，点击左侧 AI 面板顶部的「AI 接口」状态栏（如“AI 接口：Mock 模式”），或在资讯首页标题栏点击 AI 按钮，在弹出的对话框中：

1. 选择 AI 接口（DeepSeek、OpenAI、Kimi、智谱 GLM、通义千问 Qwen、本地 Ollama、Anthropic Claude、Google Gemini 或自定义 OpenAI-compatible 服务）；
2. 填写 API Key（Ollama 可留空）；根地址和模型已按所选接口带入默认值，可按需修改；
3. 点击「测试连接」验证，再点「保存设置」。

保存后立即生效，无需重启服务。已保存的 Key 不会回显在页面上，留空保存表示保持不变。

如果启动服务时进程环境已设置 `AI_API_KEY`（可搭配 `AI_PROVIDER`/`AI_API_BASE`/`AI_MODEL`），源码版与桌面版行为一致：自动把环境变量作为当前会话的 Key 使用，不写入 `.env`，设置对话框会显示“当前 Key 来自环境变量”，留空保存也不会落盘。`AI_API_KEY` 缺失时还会自动识别 `OPENAI_API_KEY`、`DEEPSEEK_API_KEY` 等常见别名变量名（按当前 provider 优先匹配，见 `src/lib/aiEnvKeys.js`），设置对话框会显示实际来源变量名。同时存在多个 Key 变量时，对话框提供下拉框让用户选择用哪个（默认自动匹配）：桌面版切换即生效，源码版保存后生效，均为当前会话、不落盘。

配置信息存放在项目根目录的 `.env` 中，也可以手动编辑。`AI_PROVIDER` 可以是厂商预设名，预设会自动带入根地址与默认模型，`AI_API_BASE` 和 `AI_MODEL` 可覆盖：

```dotenv
AI_PROVIDER=deepseek
AI_API_KEY=your_api_key
AI_API_BASE=https://api.deepseek.com
AI_MODEL=deepseek-v4-flash
PORT=3000
HOST=127.0.0.1
```

支持的预设：`deepseek`、`openai`、`kimi`、`zhipu`、`qwen`、`ollama`（本地，无需 Key）、`anthropic`、`gemini`。也可以直接用传输层类型 `openai-compatible`（任意提供 `/chat/completions` 的服务）、`anthropic` 或 `gemini`，此时地址与模型必须自备。

> **接入新的模型怎么办？** 分两类：
> - **OpenAI 兼容协议的服务**（绝大多数国产/海外 API 都属于这一类，例如 SiliconFlow、Together、Groq、自建代理、本地 vLLM/LM Studio）：在设置对话框选择 **OpenAI-compatible（任意兼容服务）**，填入服务根地址和模型即可，**不需要改代码**。
> - **不兼容 OpenAI 协议的服务**（目前只有 Anthropic 和 Gemini 是规模大到值得适配的）：在 `src/lib/aiProvider.js` 注册一个新的适配器（参考 `createAnthropicAdapter` / `createGeminiAdapter`），并在 `PROVIDER_PRESETS` 中加一项预设（一行 + 一行标签），无需改动路由或前端。

## 本地数据与隐私

- 原始文件保存在 `uploads/`。
- 文档元数据、标准化文本块、归档、阅读标注、AI 历史和沉淀记录保存在 `data/reader.sqlite`。
- API Key 保存在本地 `.env`。
- `.env`、`data/`、`uploads/`、日志和 `node_modules/` 已被 Git 忽略。
- 使用真实云端模型时，选区及相关上下文会发送给配置的模型服务商。

## 导入限制

- 单次最多导入 50 个文件。
- 单文件最大 25 MB，单批文件解码后合计最大 60 MB。
- EPUB 会检查条目数量、解压后大小和异常压缩率，以避免压缩炸弹。
- PDF、DOCX 和 EPUB 会校验基础文件签名；扩展名与内容不匹配时会拒绝导入。
- DOCX 会保留文件中的分页信息，并把浏览器渲染后的超长版式段按可用正文高度重新装入独立纸页。应用不会拆开普通段落和常规表格，页眉、页脚与页码会出现在每张纸上。该结果不是 Office 排版引擎计算出的印刷页；复杂 SmartArt、超高表格、浮动对象、宏和 Word 实时分页仍可能与 Office 有差异。

## 测试

```powershell
npm.cmd test
npm.cmd run test:ai
npm.cmd run test:e2e:install
npm.cmd run test:e2e
npm.cmd run release:check
```

`test:e2e:install` 只需在首次运行或 Playwright 浏览器版本变化后执行。端到端测试覆盖本机 Chrome、Edge 和 Playwright Firefox。

## 文档

- [架构与 API](docs/ARCHITECTURE.md)
- [运行、备份与排障](docs/RUNBOOK.md)
- [文档索引](docs/README.md)
- [RSS 资讯与 AI 阅读生态详细设计](docs/RSS_DESIGN.md)
- [安全问题报告](SECURITY.md)
- [参与贡献](CONTRIBUTING.md)
- [行为准则](CODE_OF_CONDUCT.md)
- [版本记录](CHANGELOG.md)

## 当前边界

这是面向可信单机环境的 V1 系列（当前版本 1.1.0），目前没有账号、多人隔离、云端部署、扫描 PDF OCR 和多文档语义检索。不要直接暴露到公网；公网或多人环境还需要认证、用户隔离、隐私授权、限流和后台解析任务。

## 开源许可

项目采用 [Apache License 2.0](LICENSE) 开源，可免费使用、修改和分发。
