# 桌面版数据与安全规格

## 1. 保护对象和威胁模型

### 1.1 保护对象

- 用户导入的原始文档和 RSS 阅读快照；
- SQLite 中的正文块、标注、阅读进度、AI 历史和兴趣偏好；
- AI API Key；
- 本地备份；
- 应用更新包和发行者身份；
- 桌面主进程提供的系统能力。

### 1.2 必须防御的威胁

| 威胁 | 必须采取的控制 |
| --- | --- |
| 恶意 HTML、Feed 或模型输出试图执行脚本 | 现有清洗、sandbox iframe、DOMPurify、CSP；renderer 无 Node |
| 恶意内容尝试访问 Electron/文件系统 | context isolation、sandbox、窄 preload、IPC sender 验证 |
| 同机其他进程扫描本地端口 | 随机回环端口、每次启动随机 token、所有路径统一鉴权 |
| 路径穿越读取或删除 uploads 外文件 | 解析后路径边界验证；桌面化不得弱化现有检查 |
| 恶意远程地址进行 SSRF | 继续使用现有字面地址、DNS lookup、重定向和响应大小限制 |
| API Key 从页面、备份或日志泄露 | safeStorage、只在 main/worker 内存出现、GET 不回显、全链路脱敏 |
| 安装包或更新被篡改 | HTTPS、可信代码签名、时间戳、ASAR integrity、固定更新源 |
| 多实例并发打开 SQLite | single instance lock，数据库只在一个 utility process 中打开 |
| 更新或崩溃造成数据损坏 | 优雅关闭、版本变更前数据库副本、兼容迁移测试 |

### 1.3 明确边界

`safeStorage` 在 Windows 使用当前登录用户的 DPAPI 保护数据。它用于防止其他系统用户或离线读取直接得到 Key，但不能抵御已经在同一用户权限下执行的恶意软件、调试器或内存抓取。桌面版不得宣称可以防御已完全控制当前 Windows 用户会话的攻击者。

用户选择真实云端模型时，选区和相关上下文仍会发送给对应服务商。这是产品隐私行为，桌面封装不会改变它；首次配置真实 provider 时必须继续给出清晰提示，不能把“本地优先”描述成“所有内容永不离开设备”。

## 2. 持久目录

唯一数据根目录：

```text
%LOCALAPPDATA%\Wenche Reader\
├─ data\
│  └─ reader.sqlite
├─ uploads\
│  └─ rss\
├─ cache\
│  └─ rss-images\
├─ config\
│  ├─ settings.json
│  └─ runtime-state.json
├─ secrets\
│  └─ ai-key.bin
├─ backups\
├─ logs\
└─ session\
```

规范：

- main 在 `app.ready` 前创建根目录，并把 Electron `userData` 指向该根目录；
- `sessionData` 指向 `session/`，避免 Chromium cache 混入业务数据；
- `dataDir`、`uploadDir`、`rssImageCacheDir` 显式传给 worker；
- 任何生产代码不得回退到 `process.cwd()` 或安装目录写数据；
- 任何测试必须传临时根目录；
- cache 可安全清除，但数据库、uploads、config、secrets 和 backups 不得自动清除；
- 日志轮转只删除超过保留策略的日志，不触碰其他目录。

若 `%LOCALAPPDATA%` 缺失、不是绝对路径或目录不可写，应用必须显示启动错误并退出；不得静默写到源码目录、`%TEMP%` 或当前工作目录。

开发与 Electron E2E 可以在 `!app.isPackaged` 时通过 `WENCHE_DESKTOP_DATA_ROOT` 指定绝对临时根目录。生产包必须忽略该环境变量，防止发行行为依赖调用者环境。测试结束时只清理自己创建且已验证位于系统临时目录下的根。

## 3. SQLite 和原文件路径

### 3.1 保留现有 `file_path` 语义

桌面化本身不新增 SQLite schema，也不把 `documents.file_path` 改为相对路径。原因：

- LocalAppData 数据根在安装和普通更新之间稳定；
- 当前代码已经对源文件访问和删除做 uploads 边界检查；
- V2 备份不导出物理 file path，恢复时会在目标 uploads 中重建新路径；
- 为桌面化额外改 schema 会扩大迁移、恢复和 RSS 快照的风险，但不增加首版用户价值。

新桌面数据继续保存 `path.join(uploadDir, safeName)` 生成的绝对路径。RSS 快照继续保存 uploads/rss 内的绝对路径。

agent 必须检查所有使用 `document.filePath` 的入口，确保在读取、重写和删除前都验证目标位于当前 `uploadDir`。特别包括：

- 备份读取原文件；
- `/api/documents/:id/source`；
- 单篇和批量删除；
- 文档格式升级重解析；
- RSS 快照替换和图片修复；
- 恢复完成后清理旧文件。

如果为了消除重复而抽取路径帮助函数，只能抽取现有安全逻辑，不能放宽空路径、根目录本身、`..`、绝对路径逃逸、大小写和 Windows 分隔符检查。

### 3.2 SQLite 所有权

- main、renderer、preload、更新器均不得 import `node:sqlite`；
- utility process 是唯一长期数据库拥有者；
- `Storage.close()` 必须在正常退出和启动失败清理时调用；
- 不新增第二个后台 worker 打开同一数据库；
- 不在桌面化中启用 WAL。未来若启用 WAL，升级前备份算法必须同时更新，不能直接复制单个主数据库文件。

## 4. 版本变更前数据库保护

`config/runtime-state.json` 格式：

```json
{
  "schemaVersion": 1,
  "lastSuccessfulAppVersion": "1.1.0"
}
```

在启动 worker、从而打开 SQLite 之前，main 比较当前 `app.getVersion()` 与 `lastSuccessfulAppVersion`：

- 相同：不创建副本；
- 不同且 `reader.sqlite` 存在：复制到 `backups/pre-upgrade-<from>-to-<to>-<UTC timestamp>.sqlite`；
- 不同但数据库不存在：视为新安装，不创建空备份；
- 复制失败：停止启动，不运行可能执行 schema 迁移的新版本；
- worker ready 且 `/api/health` 成功后，原子更新 `lastSuccessfulAppVersion`；
- 只保留最近 3 份 `pre-upgrade-*.sqlite`，删除前必须按规范文件名和 backups 根目录双重验证；
- 不自动用备份覆盖失败数据库，避免把可诊断数据再次破坏。

复制发生时没有进程打开该数据库。若发现 `reader.sqlite-wal` 或 `reader.sqlite-shm`，停止启动并给出稳定错误码，不复制可能不一致的快照。

## 5. 非秘密配置

`config/settings.json`：

```json
{
  "schemaVersion": 1,
  "ai": {
    "provider": "mock",
    "baseUrl": "",
    "model": ""
  },
  "updates": {
    "channel": "stable"
  }
}
```

规则：

- 文件大小上限 64 KiB；
- 只接受已知字段，忽略未知字段但写回时不传播未知对象；
- provider、URL、模型和 channel 继续使用业务层校验；
- channel 只允许 `stable` 或 `beta`；
- JSON 缺失时使用默认值；
- JSON 语法错误时不覆盖旧文件，返回稳定配置错误并使用 mock + stable 的内存安全默认值；
- 写入采用同目录临时文件、flush、rename 的原子替换；
- 临时文件名不可包含 Key 或配置值；
- 文件不得存放 `apiKey`、token、证书、签名密码或更新凭据。

## 6. AI Key 存储

### 6.1 文件格式

`secrets/ai-key.bin` 只保存 `safeStorage.encryptStringAsync()` 返回的原始 Buffer，不使用 Base64 JSON，不附加 provider 或用户输入。Key 与 provider 分离，使切换 provider 和 mock 时可以保留旧 Key，而公开配置文件不包含秘密。

若固定 Electron 43 补丁版没有异步 safeStorage API，允许在 app ready 后使用同步 `encryptString`/`decryptString`；这一兼容分支只能存在于 `settingsRepository.js`，且必须有测试。不得退回自行生成加密密钥、固定密码、明文或可逆混淆。

### 6.2 读取

- 只在 Electron app ready 后调用 safeStorage；
- 文件不存在返回空 Key；
- 加密能力不可用或解密失败时保留原文件，返回 `keyUnavailable=true` 和空 Key；
- 不把原始异常、密文或路径发给 renderer；
- 不因为 provider=mock 就删除密钥文件。

### 6.3 写入

- 输入 Key 在去除首尾空白后按现有规则验证；
- 空 Key 表示保留旧文件；
- 新 Key 先加密到内存 Buffer，再原子写入临时文件并 rename；
- 只有密钥文件和 `settings.json` 都成功后，main 才向 worker 确认 settings write；
- 两文件写入任一失败时，worker 保持旧 provider。main 应尽力恢复旧配置文件，不能回报成功；
- 任何日志只记录 `hasApiKey: true/false`，不记录长度、前缀或哈希。

## 7. Main/worker 秘密边界

允许 Key 出现的位置：

- AI 设置 POST 的 renderer 请求内存；
- utility process 当前配置内存；
- main/worker 之间的结构化克隆消息内存；
- main 解密后的短期内存；
- provider 发往用户选择的 AI 服务的鉴权头。

禁止 Key 出现的位置：

- argv、环境变量和进程标题；
- URL、query、Cookie、localStorage、sessionStorage 和 IndexedDB；
- GET API、健康接口和错误响应；
- SQLite、备份、Markdown 导出；
- `settings.json`、`runtime-state.json`；
- main/worker stdout、日志和诊断报告；
- GitHub Actions 日志、安装器和更新元数据。

worker 退出后不承诺清除 V8 的全部内存副本，但代码不得主动缓存历史 Key、保存多份副本或在异常对象中附带配置。

## 8. 本地 API 鉴权

### 8.1 Token

- main 每次启动生成 32 随机字节并编码为 base64url；
- token 只发送给 worker 和 main 协议代理；
- renderer、preload 和页面 JavaScript不能读取 token；
- token 不持久化，重启后旧 token 立即失效；
- token 不用于远程认证或加密，只用于证明请求经过当前 main 代理。

### 8.2 覆盖范围

鉴权必须位于 Express middleware 栈最前面，并覆盖：

- `/api/health`；
- 所有 JSON API；
- AI SSE；
- source、backup、Markdown、OPML 和图片响应；
- Express 静态和 vendor 路由。

不保留“为了健康检查而公开”的例外。main 健康检查同样添加 token。

### 8.3 协议代理

只有协议代理写入 `X-Wenche-Session`。renderer 即使构造同名 header，也必须先在 main 被删除再覆盖。代理目标由 main 内部保存的 `backendOrigin` 构造，不能从请求参数、header 或 renderer IPC 获得。

## 9. Renderer 和 IPC 安全

- 所有 renderer 都启用 sandbox、context isolation，关闭 Node integration；
- preload 只暴露实现合同列出的函数；
- main 的每个 IPC handler 验证 sender 是当前主窗口主 frame，URL host 是 `wenche`；
- iframe、未来新增窗口和 DevTools frame 不能调用特权 IPC；
- `shell.openExternal` 仅处理成功解析且协议为 `https:` 或 `http:` 的 URL；
- `file:`、`javascript:`、`data:`、`vbscript:`、自定义协议和带凭据 URL 一律拒绝；
- 权限请求默认拒绝；本产品当前不需要摄像头、麦克风、通知、USB、串口和地理位置；
- 不使用 `<webview>`；
- 不允许 renderer 关闭安全检查、修改代理目标、获取日志内容或任意打开路径。

## 10. CSP 与不可信内容

桌面 HTML 的最低 CSP：

```text
default-src 'self';
connect-src 'self';
img-src 'self' data:;
font-src 'self' data:;
style-src 'self' 'unsafe-inline';
script-src 'self';
object-src 'none';
base-uri 'none';
form-action 'self';
frame-ancestors 'none'
```

保留 `style-src 'unsafe-inline'` 是为了兼容当前文档排版；不得增加 `script-src 'unsafe-inline'`、`unsafe-eval`、远程域名或 `bypassCSP`。

DOCX、HTML、Markdown、模型输出和 RSS 内容继续走项目现有清洗边界。桌面版不能用 Node 文件读取或 Electron WebView 绕过 `/api/documents/:id/source` 的受控接口。

## 11. 日志

日志位于 `logs/`，按日期轮转，默认最多保留 7 天、单文件最大 5 MiB。记录：

- 应用版本、Electron/Node/Chromium 版本；
- main/worker 启动和退出状态；
- 稳定错误码；
- 更新状态；
- 数据目录是否可用、数据库是否存在等布尔状态；
- worker 非零退出码。

不得记录：

- API Key、token、Authorization header；
- 完整请求或响应 body；
- 文档正文、选区、问题、模型答案、Feed 正文；
- 用户原文件名和订阅 URL；
- 环境变量整体、settings 完整对象；
- 签名凭据和更新上传凭据。

本地绝对数据根只允许在用户主动“打开日志目录”时由系统使用，不写入面向 renderer 的错误文本。

## 12. 备份与迁移

### 12.1 Web → Desktop

唯一受支持路径：

1. 用户在旧 Web 版下载 V2 备份；
2. 安装并打开桌面版；
3. 使用现有“备份与恢复”导入；
4. 桌面版在自己的 uploads 根下重新生成原文件路径；
5. 用户重新配置 AI Key。

不得自动搜索仓库 `.env`、`data/reader.sqlite`、`uploads/`，不得静默复制开发者数据。

### 12.2 Desktop → Desktop

- 普通更新复用同一 LocalAppData 根；
- SQLite schema 继续使用现有兼容迁移；
- 每个 schema 变化必须补 migration test；
- 版本变化前数据库副本提供人工恢复依据，不自动回滚；
- V2 应用备份格式保持跨目录、跨版本主要迁移合同。

### 12.3 备份排除项

应用备份继续排除：

- `secrets/ai-key.bin`；
- `settings.json` 中未来可能出现的秘密字段；
- token、Cookie、session 数据；
- logs、cache、更新包、pre-upgrade 数据库副本；
- 签名和发行凭据。

## 13. 清除与卸载

Squirrel 卸载默认只移除程序，不删除 LocalAppData。首版不在卸载器中加入递归删除用户数据。

若 UI 提供“删除全部本地数据”，必须是单独需求和独立设计：需要二次确认、先关闭 worker、解析并显示精确目标根，并优先移动到回收站。它不属于本桌面化实现合同，agent 不得顺手加入。

## 14. 安全参考

- [Electron Security Checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [Electron Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Electron ASAR Integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity)
