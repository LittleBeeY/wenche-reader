# 架构与 API

## 系统边界

文澈阅读是单进程、本地优先的 Web 应用。Express 同时提供静态前端和 JSON API；SQLite 保存结构化数据，原始上传文件保存在本地目录。应用没有账号系统，默认只监听 `127.0.0.1`，适合可信的单机环境。

## 组件

| 位置 | 职责 |
| --- | --- |
| `public/` | 阅读器、归档管理、分页、文内搜索、主题与沉浸阅读、阅读标注、AI 流式回答、原文定位、历史与沉淀和侧栏状态 |
| `public/docxPreview.js` | 从受控原文件接口读取 DOCX，调用 docx-preview 渲染版式，把正文块重新装入独立纸页，并生成页码和可搜索逐页文本 |
| `src/server.js` | 静态资源、文档/归档/标注/AI/备份 API、上传文件生命周期 |
| `src/lib/documentParser.js` | TXT、Markdown、HTML、PDF、DOCX、EPUB 解析和 HTML/CSS 清洗 |
| `src/lib/storage.js` | SQLite 建表、迁移、事务和查询 |
| `src/lib/aiProvider.js` | Mock 与 OpenAI-compatible provider、三种回答模式的提示词和流式响应解析 |
| `src/lib/markdownExport.js` | 将阅读标注和已沉淀 AI 回答导出为 Markdown |
| `src/lib/selectionContext.js` | 选区上下文和全文问题上下文裁剪 |
| `e2e/` | Chrome、Edge、Firefox 隔离端到端测试和复杂 HTML 样本 |

## 主要数据流

1. 浏览器把一个或多个文件编码为 Base64 JSON，提交到文档 API。
2. 服务端校验扩展名、Base64、文件大小和二进制签名，解析并清洗内容，把使用随机文件名的原文件写入 `uploads/`。
3. 文档元数据、标准化块和可选的保真 HTML 写入 `data/reader.sqlite`。
4. 普通文档由前端根据文本块分页；HTML 保真内容在无脚本 sandbox iframe 中显示并按阅读区自动适配宽度。DOCX 由浏览器读取受控原文件并通过 docx-preview 生成高保真版式，再以页脚位置为边界把顶层正文块装入独立纸页，复制页眉页脚并补齐动态页码；Mammoth 文本块继续用于 AI 上下文。
5. 字号、内容宽度、行距和明亮/护眼/夜间主题保存在浏览器本地；普通阅读按相对字号整体缩放，DOCX 高保真模式统一缩放整个 Word 页面。沉浸阅读只改变当前布局，不覆盖原侧栏状态。
6. 划词解析时，服务端按模式提取附近上下文，并加入稳定的页码和段落标记；无选区的自定义问题使用受长度限制的全文相关上下文。
7. 浏览器通过 `Accept: text/event-stream` 请求 AI，Provider 的增量内容以 SSE `delta` 事件返回；完整结束后服务端才保存记录并发送 `done`。前端对每次增量都使用 `marked` 转换并经 DOMPurify 清洗后展示，历史回答中的位置标记可映射到正文页或块。
8. 高亮、批注、书签和 AI 回答沉淀写入 SQLite；前端原地更新高亮 DOM 并保持滚动位置，点击高亮可通过标注 API 删除；Markdown 导出只读取这些结构化记录。
9. 备份导出把数据库快照和原始文件编码到一个 JSON 文件中，排除 `.env`；恢复时先写新文件，再用事务替换结构化数据。

## 数据模型

| 表 | 内容 |
| --- | --- |
| `documents` | 标题、原文件名、文件路径、归档、格式版本和保真 HTML |
| `blocks` | 文档内有序文本块、类型及清洗后的块级 HTML |
| `ai_records` | 模式、问题、选区、上下文、回答、provider、沉淀标题、补充笔记和时间 |
| `annotations` | 文档、类型、高亮选区、块位置、页码、批注和颜色 |
| `archive_categories` | 用户创建的命名归档 |

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
| `POST` | `/api/ai/explain` | 直接解析或深入解析 |
| `POST` | `/api/ai/ask` | 自定义问题 |
| `PATCH` | `/api/ai/records/:id` | 沉淀、编辑或移出一条 AI 回答 |
| `GET` | `/api/knowledge` | 获取全部已沉淀 AI 回答 |
| `POST` | `/api/annotations` | 创建高亮、批注或书签 |
| `PATCH/DELETE` | `/api/annotations/:id` | 编辑或删除阅读标注 |
| `GET` | `/api/export/markdown` | 导出当前或全部阅读沉淀 |
| `GET` | `/api/backup` | 下载完整本地数据备份，不含密钥 |
| `POST` | `/api/backup/restore` | 用文澈备份替换当前本地数据 |

`POST /api/ai/explain` 和 `POST /api/ai/ask` 默认仍兼容 JSON 响应；请求头包含 `Accept: text/event-stream` 时返回 `start`、`delta`、`done` 或 `error` 事件。

上传 API 使用 Base64 JSON。JSON 请求体上限为 `220mb`；文档业务层另行限制单文件 25 MB、单批最多 50 个文件、单批解码后合计 60 MB，备份恢复中的原文件合计上限为 150 MB。

## 安全约束

- HTML 导入会移除脚本、iframe、内联事件和危险 URL；保真布局仅在禁用脚本的 iframe 中运行。
- PDF、DOCX 和 EPUB 会检查基础文件签名；DOCX 和 EPUB 还会限制 ZIP 条目数、解压大小和压缩率。
- DOCX 在服务端通过 Mammoth 转换为安全语义文本，在浏览器通过 docx-preview 渲染视觉页面；原文件接口复用 uploads 路径边界检查，拒绝读取目录外文件。
- AI Markdown 必须经过 DOMPurify 后才能写入 `innerHTML`。
- HTTP 响应设置 CSP、`nosniff`、拒绝嵌入和无来源引用等安全响应头。
- AI 问题和选区有长度上限，避免异常请求无限扩大模型上下文。
- `.env`、数据库、上传文件和日志不能进入 Git。
- 备份包含私人文章、标注和 AI 回答，但不包含 `.env` 或 API Key，仍应作为敏感文件保管。
- 云端 AI 请求会发送选区和相关上下文，产品化前需要明确的隐私授权和供应商政策。
