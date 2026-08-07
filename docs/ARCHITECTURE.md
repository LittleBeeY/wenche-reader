# 架构与 API

## 系统边界

文澈阅读是单进程、本地优先的 Web 应用。Express 同时提供静态前端和 JSON API；SQLite 保存结构化数据，原始上传文件保存在本地目录。应用没有账号系统，默认只监听 `127.0.0.1`，适合可信的单机环境。

## 桌面发行架构（Electron）

Windows 10/11 x64 桌面版复用同一套 Express / `node:sqlite` 业务代码，进程边界如下：

- `desktop/main.js`：可信桌面能力（窗口、`app://` 协议、safeStorage、更新器、单实例锁），不解析文档、不调用模型、不打开 SQLite；
- `desktop/backendWorker.js`：utility process，唯一长期持有 SQLite 的后端宿主，调用 `src/runtime.js` 启动 Express 与 RSS 调度器；
- `desktop/protocol.js`：`app://wenche/` 静态映射与 `/api/*` 代理，代理请求时写入 main 生成的唯一会话令牌；
- `desktop/settingsRepository.js`：`config/settings.json`（非敏感）与 `secrets/ai-key.bin`（safeStorage 加密）的持久化；
- 数据根目录固定为 `%LOCALAPPDATA%\Wenche Reader`（`data/`、`uploads/`、`cache/rss-images`、`config/`、`secrets/`、`backups/`、`logs/`、`session/`）。

Web/CLI 入口保持不变：`src/cli.js` 经 `src/runtime.js` 启动同一个 `createApp`；桌面 utility process 也调用 `startRuntime`，仅把设置存储换成 IPC store，并启用桌面会话鉴权。

## 组件

| 位置 | 职责 |
| --- | --- |
| `public/` | 阅读器、归档管理、分页、文内搜索、主题与沉浸阅读、阅读标注、AI 流式回答、原文定位、历史与沉淀，以及类似 X 的主导航、低频工具菜单和侧栏状态 |
| `public/docxPreview.js` | 从受控原文件接口读取 DOCX，调用 docx-preview 渲染版式，把正文块重新装入独立纸页，并生成页码和可搜索逐页文本 |
| `public/rssView.js` | 资讯导航、订阅树、带明确日期时间的三种密度资讯列表、今日精选、文章操作条、OPML 与偏好设置对话框 |
| `public/rssState.js` | 资讯列表视图偏好（范围、筛选、排序、密度）的浏览器本地持久化 |
| `public/disclosureState.js` | 资讯订阅分组与本地文档资料夹展开状态的浏览器本地持久化 |
| `src/server.js` | 静态资源、文档/归档/标注/AI/备份 API、AI 接口设置读写与连接测试、上传文件生命周期 |
| `src/lib/documentParser.js` | TXT、Markdown、HTML、PDF、DOCX、EPUB 解析和 HTML/CSS 清洗；导出供 RSS 复用的文章级清洗与快照解析入口 |
| `src/lib/storage.js` | SQLite 建表、迁移、事务和查询（含 RSS 全部表） |
| `src/lib/aiProvider.js` | Provider 预设表与适配器注册表（openai-compatible、Anthropic、Gemini、Mock）、三种回答模式的提示词/生成预算、Token 与延迟统计和流式响应解析 |
| `src/lib/answerCitations.js` | 校验模型返回的稳定来源 ID，移除不在本次来源包中的引用 |
| `src/lib/markdownExport.js` | 将阅读标注和已沉淀 AI 回答导出为 Markdown |
| `src/lib/selectionContext.js` | 按选区、页、章节或全文组装有长度预算的来源包，并保留章节路径 |
| `public/selectionAnchors.js` | 把普通正文、保真 HTML 和 DOCX 渲染节点映射到真实块 ID，生成字符偏移锚点 |
| `src/lib/rss/feedFetcher.js` | 基于 node:http(s) 的受限抓取：安全 lookup、逐跳重定向校验、大小/超时/解压限制、ETag 条件请求 |
| `src/lib/rss/ssrfGuard.js` | URL 校验与私有地址判定，连接层阻止 DNS 重绑定 |
| `src/lib/rss/feedParser.js` | 自带安全 XML 解析器（拒绝 DOCTYPE），RSS 2.0 / Atom 1.0 规范化、封面候选筛选、去重键与内容哈希 |
| `src/lib/rss/imageProxy.js` | 把正文远程图片改写为本站代理地址，经 SSRF、大小和图片签名校验后按 URL 哈希缓存 |
| `src/lib/rss/opml.js` | OPML 解析、导入预览分类（new/duplicate/reenable/invalid/unsupported）与导出 |
| `src/lib/rss/rssService.js` | 订阅发现、添加、刷新编排、去重入库、阅读快照、AI 分诊调度与今日精选生成 |
| `src/lib/rss/rssScheduler.js` | 单进程定时调度：每分钟检查到期源、并发 4、抖动与指数退避；仅 listen 后启动 |
| `src/lib/rss/rssRanking.js` | 以新鲜度为最高单项权重的可解释线性排序、推荐原因生成与今日精选选条（同源不超过两条、保留探索位） |
| `src/lib/rss/rssAnalysis.js` | AI 结构化初评：JSON 校验、失败回退确定性分析、内容哈希缓存 |
| `src/lib/rss/rssRoutes.js` | `/api/rss/*` 路由与输入校验 |
| `e2e/` | Chrome、Edge、Firefox 隔离端到端测试、复杂 HTML 样本和固定测试 Feed 服务 |

## 主要数据流

1. 浏览器把一个或多个文件编码为 Base64 JSON，提交到文档 API。
2. 服务端校验扩展名、Base64、文件大小和二进制签名，解析并清洗内容，把使用随机文件名的原文件写入 `uploads/`。
3. 文档元数据、标准化块和可选的保真 HTML 写入 `data/reader.sqlite`。
4. 普通文档由前端根据文本块分页；HTML 保真内容在无脚本 sandbox iframe 中显示并按阅读区自动适配宽度。DOCX 由浏览器读取受控原文件并通过 docx-preview 生成高保真版式，再以页脚位置为边界把顶层正文块装入独立纸页，复制页眉页脚并补齐动态页码；Mammoth 文本块继续用于 AI 上下文。
5. 左侧栏把本地文档、资讯与添加文档保留为一级入口，把导入位置、文档管理和备份恢复收进“更多”，并可缩成 72px 图标轨道；侧栏、文档库、文件夹筛选和各资料夹的开合状态保存在浏览器本地。字号、内容宽度、行距和明亮/护眼/夜间主题也保存在浏览器本地；普通阅读按相对字号整体缩放，DOCX 高保真模式统一缩放整个 Word 页面。侧栏宽度动画结束后会重新适配 HTML 和 DOCX 内容。AI 解析面板以悬浮层覆盖正文，支持拖动、缩放和收纳为可拖动紧凑入口；展开面板与收纳入口的位置、尺寸和开合状态分别保存在浏览器本地，窄屏进入时强制收纳以保持导航可操作。沉浸阅读只改变当前布局，不覆盖原侧栏状态。
6. 普通正文、HTML iframe 和 DOCX 渲染节点会按顺序绑定真实块 ID；划词后生成 `blockId + startOffset + endOffset` 锚点。AI 请求显式携带 `selection/page/section/document` 范围。
7. 选区和页范围按块 ID取上下文；章节范围由最近的上级标题边界确定；全文范围先查询 `blocks_fts` 的 FTS5/BM25 排名，再补入章节标题和相邻段落。每个来源使用 `[source:Bn]` 稳定标识并受模式长度预算限制。
8. 标题、选区和来源正文被放入不可信资料区，提示词明确禁止执行文章内指令。直接和深入模式都只解释文字意思，深入模式解释得更完整；它们与自定义模式使用不同结构、温度与输出上限。应用只依赖 provider adapter 的统一契约（`explain`/`streamExplain`/`getStatus` 与标准化结果），各厂商的端点路径、鉴权头、请求/响应/流式映射都收在 `aiProvider.js` 的适配器内。
9. AI 接口在应用内配置：设置对话框通过 `GET/POST /api/ai/settings` 读写 `.env`（保留注释与其他键、不回显 Key、留空保持原 Key），保存后服务端重建 provider 实例并通过 `RssService.setAiProvider` 同步给资讯初评；`POST /api/ai/settings/test` 按接口类型发起连接检查。
10. 浏览器通过 `Accept: text/event-stream` 请求 AI，`start` 事件携带范围和来源元数据，Provider 的增量内容以 `delta` 返回；服务端在完成后校验 `[cite:Bn]`，只保存真实来源引用，再发送 `done`。前端节流 Markdown 渲染并经 DOMPurify 清洗。
11. AI 历史记录同时保存范围、选区锚点、上下文块、来源元数据、模型、提示词版本、输入/输出 Token、首字延迟与总延迟；完整回答结束后才入库。
12. 高亮、批注、书签和 AI 回答沉淀写入 SQLite；前端原地更新高亮 DOM并保持滚动位置，点击高亮可通过标注 API 删除；Markdown 导出只读取这些结构化记录。
13. 备份导出把数据库快照和原始文件编码到一个 JSON 文件中，排除 `.env`；恢复时先写新文件，再用事务替换结构化数据。
14. 资讯流：调度器每分钟检查到期订阅源，条件请求拉取 Feed，按 GUID → 规范地址 → 标题+日期 → 内容指纹去重入库；相同去重键的 Feed 内容变化会更新条目而不重置阅读状态。打开条目时把清洗后的正文组装为受控 HTML，经 `documentParser.js` 生成隐藏阅读快照（`uploads/rss/`），AI 回答、标注与引用都绑定该快照；取消订阅只软删除 Feed，已收藏、稍后读和有沉淀的快照常驻。
15. 网页全文提取会把条目标记为 `content_source=extracted`，后续 Feed 刷新不会用较短的 Feed 正文覆盖它。正文中的远程及懒加载图片地址统一改写到 `/api/rss/images`，浏览器只读取同源缓存；历史正文若仍含无地址图片，首次打开时自动重提取。若当前快照尚无标注或 AI 记录，提取后原地重建快照；已有阅读资产时保留正文块与稳定 ID，仅在图片块数量和替代文本完全对应时补写图片地址，避免 AI 引用错位。

## 数据模型

| 表 | 内容 |
| --- | --- |
| `documents` | 标题、原文件名、文件路径、归档、格式版本和保真 HTML；`source_type` 区分上传与 RSS 快照，隐藏快照 `is_library_visible=0` 不出现在文档列表 |
| `blocks` / `blocks_fts` | 文档内有序文本块、类型及清洗后的块级 HTML；FTS5 trigram 虚拟表用于中英文全文相关段落检索 |
| `ai_records` | 模式、范围、问题、选区锚点、上下文块与来源、回答、provider/model、提示词版本、Token、延迟、沉淀标题、补充笔记和时间 |
| `annotations` | 文档、类型、高亮选区、块位置、页码、批注和颜色 |
| `archive_categories` | 用户创建的命名归档 |
| `rss_folders` | 订阅分组（名称唯一、排序） |
| `rss_feeds` | 订阅源：地址唯一、分组、优先级、抓取间隔、ETag/Last-Modified、退避计数、软删除时间、全文模式 |
| `rss_entries` | 资讯条目：GUID/去重键、规范地址、清洗后摘要与正文、内容哈希、正文来源（Feed/提取）、阅读状态、收藏/稍后读/不感兴趣、阅读进度、关联快照 |
| `rss_entry_analysis` | AI 初评：摘要、要点、主题、质量信号、排序分、推荐原因、置信度、对应内容哈希 |
| `rss_briefs` / `rss_brief_entries` | 今日精选：日期唯一，条目保留生成时的分组、原因和分数，当天内稳定 |
| `rss_preferences` | 单行 JSON：关注/屏蔽主题、屏蔽来源、精选数量、刷新频率、未读数开关、自动 AI 初评与预算、保留周期 |

删除文档时会先校验原文件位于 `uploads/`，再删除文件和关联数据库记录。删除非空归档会返回冲突，必须先移动或删除其中的文档。

## API 速查

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/documents` | 文档列表 |
| `GET` | `/api/health` | 服务状态、产品名和版本号 |
| `POST` | `/api/documents` | 导入单个 Base64 文档 |
| `POST` | `/api/documents/batch` | 批量导入，可附归档名 |
| `GET` | `/api/documents/:id` | 文档块、保真 HTML 和 AI 历史 |
| `GET` | `/api/documents/:id/source` | 读取该文档位于 uploads 内的原文件，供本地高保真渲染 |
| `DELETE` | `/api/documents/:id` | 删除单篇文档及原文件 |
| `POST` | `/api/documents/batch-delete` | 批量删除文档 |
| `PATCH` | `/api/documents/batch-category` | 批量移动到归档 |
| `GET/POST` | `/api/archives` | 获取或创建归档 |
| `PATCH/DELETE` | `/api/archives/:id` | 重命名或删除空归档 |
| `GET` | `/api/ai/status` | 返回 provider 配置状态，不返回密钥 |
| `GET` | `/api/ai/settings` | 返回当前 AI 配置（不回显 Key）与可选 provider 预设列表 |
| `POST` | `/api/ai/settings` | 保存 AI 配置到 `.env` 并立即重建 provider 实例 |
| `POST` | `/api/ai/settings/test` | 用提交或已存的配置测试 provider 连接 |
| `POST` | `/api/ai/explain` | 直接解析或深入解析 |
| `POST` | `/api/ai/ask` | 自定义问题 |
| `PATCH` | `/api/ai/records/:id` | 沉淀、编辑或移出一条 AI 回答 |
| `GET` | `/api/knowledge` | 获取全部已沉淀 AI 回答 |
| `POST` | `/api/annotations` | 创建高亮、批注或书签 |
| `PATCH/DELETE` | `/api/annotations/:id` | 编辑或删除阅读标注 |
| `GET` | `/api/export/markdown` | 导出当前或全部阅读沉淀 |
| `GET` | `/api/backup` | 下载完整本地数据备份（V2，含订阅与资讯状态），不含密钥 |
| `POST` | `/api/backup/restore` | 用文澈备份替换当前本地数据（兼容 V1） |
| `GET` | `/api/rss/feeds` | 订阅源、分组与未读数 |
| `POST` | `/api/rss/discover` | 从 Feed 或网站地址探测候选订阅 |
| `POST` | `/api/rss/feeds` | 确认添加订阅（重复返回 409，软删除后恢复） |
| `PATCH/DELETE` | `/api/rss/feeds/:id` | 修改名称、分组、优先级、暂停；删除为软删除 |
| `POST` | `/api/rss/feeds/:id/refresh` | 刷新单个订阅 |
| `POST` | `/api/rss/refresh` | 手动刷新全部未暂停订阅（忽略调度到期时间） |
| `GET` | `/api/rss/status` | 刷新状态、上次成功时间与失败来源 |
| `GET/POST` | `/api/rss/folders` | 获取或创建订阅分组 |
| `PATCH/DELETE` | `/api/rss/folders/:id` | 重命名或删除空分组 |
| `POST` | `/api/rss/opml/preview` | 解析 OPML 并分类预览，不写入 |
| `POST` | `/api/rss/opml/import` | 导入用户确认的 OPML 条目 |
| `GET` | `/api/rss/opml/export` | 导出订阅与分组 |
| `GET` | `/api/rss/entries` | 游标分页列出资讯（scope/read/sort/query） |
| `GET` | `/api/rss/entries/:id` | 条目正文、状态与分析 |
| `GET` | `/api/rss/images?url=...` | 获取经安全校验并缓存的正文图片 |
| `PATCH` | `/api/rss/entries/:id/state` | 更新已读、收藏、稍后读、隐藏或阅读进度 |
| `POST` | `/api/rss/entries/batch-state` | 批量更新状态 |
| `POST` | `/api/rss/entries/:id/extract` | 按需提取网页全文；无阅读资产时同步更新快照，有资产时保护旧快照 |
| `POST` | `/api/rss/entries/:id/open` | 创建/复用隐藏阅读快照并返回 documentId（幂等） |
| `POST` | `/api/rss/entries/:id/save-to-library` | 快照显示到本地文档并选择文件夹 |
| `POST` | `/api/rss/entries/:id/analyze` | 手动触发 AI 初评 |
| `GET/POST` | `/api/rss/briefs/today` | 获取或生成/重新生成今日精选 |
| `GET/PATCH` | `/api/rss/preferences` | 获取或修改本地兴趣与资讯设置 |

`POST /api/ai/explain` 和 `POST /api/ai/ask` 接受 `scope=selection|page|section|document`，`selection` 可包含 `text`、`blockIds`、`anchors[{blockId,startOffset,endOffset}]` 和 `pageIndex`。省略 `scope` 时仍按旧请求推断范围。默认兼容 JSON 响应；请求头包含 `Accept: text/event-stream` 时返回 `start`、`delta`、`done` 或 `error` 事件。

上传 API 使用 Base64 JSON。JSON 请求体上限为 `220mb`；文档业务层另行限制单文件 25 MB、单批最多 50 个文件、单批解码后合计 60 MB，备份恢复中的原文件合计上限为 150 MB。

## 安全约束

- Feed、网页与正文图片抓取只允许 http/https，拒绝凭据、回环、链路本地、RFC1918 与保留地址（含十进制/十六进制 IPv4 变体和 IPv4-mapped IPv6）；自定义 DNS lookup 在连接层过滤私有 IP 以抵御 DNS 重绑定；每次重定向重新校验，最多 5 跳；Feed 最大 5 MB、网页最大 10 MB、图片最大 8 MB，解压同样受限。正文图片还必须通过 JPEG、PNG、GIF、WebP、AVIF、BMP 或 ICO 文件签名检查，SVG 与伪装成图片的响应不会进入缓存。
- Feed XML 使用自带解析器，拒绝 DOCTYPE，不展开外部实体；摘要与正文入库前经与导入文档同级的 HTML 清洗。
- HTML 导入会移除脚本、iframe、内联事件和危险 URL；保真布局仅在禁用脚本的 iframe 中运行。
- PDF、DOCX 和 EPUB 会检查基础文件签名；DOCX 和 EPUB 还会限制 ZIP 条目数、解压大小和压缩率。
- DOCX 在服务端通过 Mammoth 转换为安全语义文本，在浏览器通过 docx-preview 渲染视觉页面；原文件接口复用 uploads 路径边界检查，拒绝读取目录外文件。
- AI Markdown 必须经过 DOMPurify 后才能写入 `innerHTML`。
- 文章标题、选区和来源正文均按不可信资料传给模型；只有用户问题和系统模式指令可以控制任务。
- 模型引用必须使用本次来源包中的 `[cite:Bn]`，服务端在保存前删除虚构来源 ID。
- HTTP 响应设置 CSP、`nosniff`、拒绝嵌入和无来源引用等安全响应头。
- AI 问题和选区有长度上限，避免异常请求无限扩大模型上下文。
- `.env`、数据库、上传文件和日志不能进入 Git。
- 备份包含私人文章、标注和 AI 回答，但不包含 `.env` 或 API Key，仍应作为敏感文件保管。
- 云端 AI 请求会发送选区和相关上下文，产品化前需要明确的隐私授权和供应商政策。
