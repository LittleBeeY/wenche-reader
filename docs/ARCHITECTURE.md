# 架构与 API

## 系统边界

AI Deep Reader 是单进程、本地优先的 Web 应用。Express 同时提供静态前端和 JSON API；SQLite 保存结构化数据，原始上传文件保存在本地目录。应用没有账号系统，默认只适合可信的单机环境。

## 组件

| 位置 | 职责 |
| --- | --- |
| `public/` | 阅读器、归档管理、分页、文内搜索、划词菜单、AI 历史和侧栏状态 |
| `src/server.js` | 静态资源、文档/归档/AI API、上传文件生命周期 |
| `src/lib/documentParser.js` | TXT、Markdown、HTML、PDF、DOCX、EPUB 解析和 HTML/CSS 清洗 |
| `src/lib/storage.js` | SQLite 建表、迁移、事务和查询 |
| `src/lib/aiProvider.js` | Mock 与 OpenAI-compatible provider、三种回答模式的提示词 |
| `src/lib/selectionContext.js` | 选区上下文和全文问题上下文裁剪 |

## 主要数据流

1. 浏览器把一个或多个文件编码为 Base64 JSON，提交到文档 API。
2. 服务端校验扩展名，解析并清洗内容，把原文件写入 `uploads/`。
3. 文档元数据、标准化块和可选的保真 HTML 写入 `data/reader.sqlite`。
4. 前端根据块分页；HTML 保真内容在无脚本 sandbox iframe 中显示。
5. 划词解析时，服务端按模式提取附近上下文；无选区的自定义问题使用受长度限制的全文相关上下文。
6. Provider 返回 Markdown，服务端保存 AI 记录，前端使用 `marked` 转换并经 DOMPurify 清洗后展示。

## 数据模型

| 表 | 内容 |
| --- | --- |
| `documents` | 标题、原文件名、文件路径、归档、格式版本和保真 HTML |
| `blocks` | 文档内有序文本块、类型及清洗后的块级 HTML |
| `ai_records` | 模式、问题、选区、上下文、回答、provider 和时间 |
| `archive_categories` | 用户创建的命名归档 |

删除文档时会先校验原文件位于 `uploads/`，再删除文件和关联数据库记录。删除非空归档会返回冲突，必须先移动或删除其中的文档。

## API 速查

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/documents` | 文档列表 |
| `POST` | `/api/documents` | 导入单个 Base64 文档 |
| `POST` | `/api/documents/batch` | 批量导入，可附归档名 |
| `GET` | `/api/documents/:id` | 文档块、保真 HTML 和 AI 历史 |
| `DELETE` | `/api/documents/:id` | 删除单篇文档及原文件 |
| `POST` | `/api/documents/batch-delete` | 批量删除文档 |
| `PATCH` | `/api/documents/batch-category` | 批量移动到归档 |
| `GET/POST` | `/api/archives` | 获取或创建归档 |
| `PATCH/DELETE` | `/api/archives/:id` | 重命名或删除空归档 |
| `GET` | `/api/ai/status` | 返回 provider 配置状态，不返回密钥 |
| `POST` | `/api/ai/explain` | 直接解析或深入解析 |
| `POST` | `/api/ai/ask` | 自定义问题 |

上传 API 的请求体使用 JSON，因此 Express 当前设置了 `120mb` 的总请求上限；这不是生产环境的用户配额。

## 安全约束

- HTML 导入会移除脚本、iframe、内联事件和危险 URL；保真布局仅在禁用脚本的 iframe 中运行。
- AI Markdown 必须经过 DOMPurify 后才能写入 `innerHTML`。
- `.env`、数据库、上传文件和日志不能进入 Git。
- 云端 AI 请求会发送选区和相关上下文，产品化前需要明确的隐私授权和供应商政策。
