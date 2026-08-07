# 桌面版实现合同

本文规定代码落点、公开接口、消息格式和兼容约束。示例类型使用 TypeScript 风格仅为表达合同；项目继续使用原生 JavaScript ES modules，不需要引入 TypeScript。

## 1. 预期文件结构

```text
desktop/
├─ main.js
├─ backendWorker.js
├─ protocol.js
├─ preload.cjs
├─ settingsRepository.js
├─ updater.js
└─ error.html

src/
├─ cli.js
├─ runtime.js
└─ lib/
   └─ aiSettingsStore.js

forge.config.js
scripts/
└─ smoke-packaged.mjs
```

现有 `public/`、解析器、provider adapter、RSS 模块和 API 路径不重新组织。新增文件数量应维持上述最小边界；不要引入通用“桌面框架层”。

## 2. `package.json`

### 2.1 元数据

增加或确认：

```json
{
  "main": "desktop/main.js",
  "productName": "文澈阅读",
  "author": "LittleBeeY"
}
```

`version` 是应用版本唯一事实来源。`src/lib/appInfo.js`、Electron、健康接口、安装器和更新元数据必须读取同一个值。

### 2.2 依赖

运行时已有代码直接提供 `/vendor/jszip.min.js`，因此 `jszip` 必须成为顶层 `dependencies`，不能继续依赖 npm 的间接提升结果。

Squirrel 生命周期处理使用 `electron-squirrel-startup`，它同样属于顶层 `dependencies`；main 必须在启动 worker 或打开数据库前处理并退出安装事件。

加入以下 `devDependencies`，全部精确锁定：

- `electron`：Electron 43 最高稳定补丁版；
- `@electron-forge/cli`；
- `@electron-forge/maker-squirrel`；
- `@electron-forge/plugin-fuses`；
- `@electron/fuses`。

使用 Electron 内置 `autoUpdater`，不再增加第二套更新库。没有明确用途时不得加入 electron-builder、Vite、Webpack、React 或原生 SQLite addon。

### 2.3 脚本

保留现有脚本语义，并增加：

```json
{
  "start": "node src/cli.js",
  "desktop:dev": "electron-forge start",
  "desktop:make": "electron-forge make --platform=win32 --arch=x64",
  "test:desktop": "playwright test --config=playwright.desktop.config.js",
  "test:packaged": "node scripts/smoke-packaged.mjs"
}
```

`npm start` 仍启动浏览器版后端并监听 `.env` 指定的 host/port。`desktop:dev` 必须使用隔离临时或显式开发数据目录，不默认打开仓库正式 `data/`。

## 3. 单一版本来源

修改 `src/lib/appInfo.js`，通过 `import.meta.url` 定位仓库/应用包中的 `package.json`，用 `readFileSync` 读取版本。不要使用 JSON import assertion，以免 CLI Node 22 与 Electron Node 的语法差异增加风险。

合同：

```js
APP_INFO.version === packageJson.version
```

打包测试必须断言：

```text
app.getVersion()
GET /api/health -> version
package.json version
release tag 去掉 v
```

四者完全相同。

## 4. `src/lib/aiSettingsStore.js`

定义唯一存储接口：

```js
/**
 * @typedef {Object} AiRuntimeConfig
 * @property {string} provider
 * @property {string} apiKey
 * @property {string} baseUrl
 * @property {string} model
 */

class AiSettingsStore {
  async read() {}
  async write(nextConfig) {}
}
```

语义：

- `read()` 返回完整运行时配置，缺失值规范化为空字符串，provider 默认为 `mock`；
- `write()` 接受服务端已经校验、解析后的完整配置，持久化成功后返回实际保存值；
- 空白 Key 表示“保留旧 Key”，不是删除；切换到 mock 同样保留旧 Key；
- Key 永远不通过 GET API 返回；
- 存储失败时不得先重建 provider 或修改当前内存配置。

本文件实现 `EnvAiSettingsStore`：

- 构造参数为 `{ envPath }`；
- 复用 `loadEnvFile`、`updateEnvFile`；
- 保持现有注释、空行和环境变量优先语义；
- 写成功后同步需要的 `process.env`，保证 CLI 行为不变。

桌面 IPC 实现在 `desktop/backendWorker.js` 中，只实现同一接口，不把 Electron import 引入 `src/`。

## 5. `src/server.js`

### 5.1 `createApp` 参数

扩展为：

```js
createApp({
  dataDir,
  uploadDir,
  rssImageCacheDir,
  staticRoot,
  settingsStore,
  desktopSessionToken,
  storage,
  aiProvider,
  aiProviderConfig,
  aiTestRequestImpl,
  uploadLimits,
  rss
})
```

要求：

- 默认值继续指向现有项目根目录，测试不传新参数时行为不变；
- `staticRoot` 默认为现有 `public/`；
- `rssImageCacheDir` 默认为 `path.join(dataDir, "rss-image-cache")`；桌面版显式传 `%LOCALAPPDATA%\Wenche Reader\cache\rss-images`；
- `settingsStore` 未传时创建 `EnvAiSettingsStore`；
- `desktopSessionToken` 为空时不启用桌面鉴权，保持 CLI 和现有测试兼容；
- 不从 Electron main 直接向 `createApp` 传 Storage 或业务对象。

### 5.2 桌面会话鉴权

当 `desktopSessionToken` 非空时，在 JSON parser、静态资源和所有路由之前安装中间件。中间件：

- 只接受 `Host` 为当前监听的回环地址；
- 读取 `X-Wenche-Session`；
- 使用 `crypto.timingSafeEqual` 比较固定长度 token；
- 缺失或错误统一返回 401，不返回 token 格式、期望值或端口信息；
- 不把 token 记入日志；
- 不设置允许外部 Origin 的 CORS 头。

测试直接使用 `createApp` 时，可以显式传 token 并在请求中加 header。

### 5.3 AI 设置路由

改写 `/api/ai/settings`：

- GET 根据当前 provider 状态和 store 的内存快照返回公开配置及 `hasApiKey`；
- POST 继续使用现有输入校验与 provider 解析规则；
- 先 `await settingsStore.write(fullConfig)`；
- 只有持久化成功后才调用 `reloadAiProvider` 并同步 `RssService.setAiProvider`；
- 写失败返回错误，旧 provider 继续可用；
- test 路由测试提交值或已存值，但不持久化。

删除 `server.js` 中直接写 `.env` 的 `saveAiSettings`，相关语义转移到 store。不要改变 provider adapter、模型端点和连接检查策略。

### 5.4 静态文件

CLI 仍由 Express 提供 `staticRoot` 和四个 `/vendor` 文件。桌面窗口不直接访问这些 HTTP 静态路由，但保留它们用于 Web/CLI 和现有 E2E。

四个 vendor 文件必须使用基于模块位置的确定路径：

- `marked/lib/marked.umd.js`；
- `dompurify/dist/purify.min.js`；
- `jszip/dist/jszip.min.js`；
- `docx-preview/dist/docx-preview.min.js`。

打包测试必须从 ASAR 环境访问四个文件，不能只在开发目录测试。

### 5.5 删除直接启动代码

删除 `server.js` 末尾基于 `process.argv[1]` 的 listen/scheduler 入口。`server.js` 只导出应用工厂和可测试辅助逻辑；CLI 启动移到 `src/cli.js`，桌面启动通过 `src/runtime.js`。

## 6. `src/runtime.js`

导出：

```js
export async function startRuntime(options) {}
```

输入：

```js
{
  host: "127.0.0.1",
  port: 0,
  dataDir,
  uploadDir,
  rssImageCacheDir,
  staticRoot,
  settingsStore,
  desktopSessionToken,
  rss,
  uploadLimits,
  aiTestRequestImpl
}
```

返回：

```js
{
  app,
  server,
  storage,
  rssService,
  scheduler,
  host,
  port,
  origin,
  close
}
```

实现合同：

- 调用 `settingsStore.read()` 后创建初始 provider；
- 用 `http.createServer(app)` 和 Promise 包装 `listen`，而不是散落 `app.listen`；
- 只有 listen 成功后启动 `RssScheduler`；
- 获取 `server.address().port` 作为实际端口；
- `close()` 幂等，重复调用返回同一个关闭 Promise；
- `close()` 先 `scheduler.stop()`，再关闭 server，最后 `storage.close()`；
- listen 失败时关闭已创建的 Storage；
- 不在这里导入 Electron；
- 不注册全局 signal，CLI 和 desktop 宿主各自负责生命周期。

若当前 `RssScheduler` 没有幂等 `stop()`，只为满足本合同补最小实现和单元测试。

## 7. `src/cli.js`

CLI 入口承担：

1. 从项目根目录加载 `.env`；
2. 创建 `EnvAiSettingsStore`；
3. 用原有默认值 `HOST=127.0.0.1`、`PORT=3000` 调用 `startRuntime`；
4. 输出与当前等价的启动信息；
5. 对 `SIGINT`、`SIGTERM` 各注册一次优雅关闭；
6. 启动失败时设置非零退出码。

不得改变 `scripts/open-reader.ps1` 依赖的启动方式和健康接口。

## 8. `desktop/settingsRepository.js`

main 进程中的桌面配置仓库，构造参数：

```js
new DesktopSettingsRepository({ configDir, secretsDir, safeStorage, fs })
```

公开方法：

```js
await repository.read()
await repository.write(fullConfig)
repository.getPublicState()
```

具体文件格式和故障语义见 [DATA_AND_SECURITY.md](DATA_AND_SECURITY.md)。该模块不创建 provider，不知道 Express，也不返回加密实现细节。

## 9. Main 与 worker 消息合同

所有消息必须是可结构化克隆的普通对象，并有固定 `type`。未知消息忽略并记脱敏警告，不执行动态分发。

### 9.1 Main → worker

```js
{
  type: "bootstrap",
  dataDir,
  uploadDir,
  rssImageCacheDir,
  staticRoot,
  desktopSessionToken,
  initialAiConfig
}

{ type: "settings-write-result", requestId, ok, config?, errorCode? }

{ type: "shutdown-request" }
```

约束：

- bootstrap 只发送一次；
- `initialAiConfig.apiKey` 只存在于内存消息，不进入 argv、env 或日志；
- 路径必须由 main 构造，worker 不接受 renderer 传入的路径；
- 错误响应只用稳定 `errorCode`，不把安全存储内部错误和文件内容回传 renderer。

### 9.2 Worker → main

```js
{ type: "backend-ready", host: "127.0.0.1", port }

{ type: "backend-start-error", code }

{ type: "settings-write", requestId, config }

{ type: "shutdown-complete" }
```

`requestId` 使用 worker 生成的 UUID。worker 最多等待设置写入 10 秒，超时视为持久化失败，旧 provider 和旧配置继续生效。

不得建立通用 RPC 方法名或允许 renderer 指定消息 type。

## 10. `desktop/backendWorker.js`

worker：

- 启动后立即注册 `process.parentPort` message listener；
- 等待 bootstrap，不能使用默认项目数据目录自行启动；
- 用 `initialAiConfig` 创建内存配置和实现 `AiSettingsStore` 接口的 IPC store；
- 调用 `startRuntime({ host: "127.0.0.1", port: 0, ... })`；
- ready 后只发送端口，不发送 token；
- settings write 成功后更新内存快照，失败保持旧值；
- 收到 shutdown 时只执行一次 `runtime.close()`；
- 捕获未处理启动错误，发送稳定错误码并以非零退出；
- 不打印配置对象、请求正文、文档正文或环境变量。

## 11. `desktop/protocol.js`

导出三个窄函数：

```js
export function registerAppScheme() {}
export async function installAppProtocol({ session, appRoot, backendOrigin, sessionToken }) {}
export function uninstallAppProtocol({ session }) {}
```

`registerAppScheme()` 只能在 app ready 前调用。`installAppProtocol` 负责 [ARCHITECTURE.md](ARCHITECTURE.md) 中的静态映射和 API 代理。

静态路径实现必须：

- 用 `decodeURIComponent` 后再规范化；
- 拒绝 NUL、反斜杠混淆、盘符、UNC、`..` 和解析失败；
- 用 `path.resolve` + `path.relative` 证明目标仍位于允许根目录；
- 目录路径只把 `/` 映射到 `index.html`，不自动目录列表；
- 不向 renderer 暴露本机绝对路径；
- 对 HTML 添加 CSP、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`；
- 保留正确 MIME type，ES module 必须以 JavaScript MIME 返回。

API 转发必须保持 Response 流，不调用 `.text()`、`.json()`、`.arrayBuffer()` 后再返回。

## 12. `desktop/preload.cjs`

沙箱 renderer 的 preload 必须是 CommonJS（Electron 沙箱模式不支持 ESM preload），因此文件名使用 `.cjs`，其余接口约定不变。

只通过 `contextBridge.exposeInMainWorld("wencheDesktop", api)` 暴露：

```js
{
  getRuntimeInfo(): Promise<{ desktop: true, platform: "win32", version: string }>,
  checkForUpdates(): Promise<{ accepted: boolean }>,
  restartToInstallUpdate(): Promise<{ accepted: boolean }>,
  openLogDirectory(): Promise<{ accepted: boolean }>,
  onUpdateState(callback): () => void
}
```

限制：

- 回调只接收枚举状态和公开文本，不接收 Electron Event；
- 取消订阅函数必须真正移除 listener；
- 不暴露 `ipcRenderer` 对象；
- 不允许调用方自定义 channel；
- 参数做类型和长度校验；
- main 每个 handler 验证 `senderFrame` 是 `app://wenche` 主 frame。

业务页面不应依赖该对象完成阅读、导入、AI 或 RSS；它只用于桌面关于信息、更新状态和故障入口，使同一前端仍能由普通浏览器运行。

## 13. `desktop/main.js`

### 13.1 Ready 前

- 调用 `registerAppScheme()`；
- 验证 `%LOCALAPPDATA%` 是绝对路径，创建 `%LOCALAPPDATA%\Wenche Reader`；
- 仅在 `!app.isPackaged` 时允许 `WENCHE_DESKTOP_DATA_ROOT` 覆盖数据根，供开发和 E2E 使用；生产包必须忽略该变量；
- `app.setPath("userData", root)`；
- 创建并设置独立 `sessionData` 目录；
- 申请单实例锁；
- 设置 Windows AppUserModelId，值必须与 Squirrel 包配置一致。

### 13.2 Ready 后

- 创建固定 partition 的持久 session，例如 `persist:wenche`；
- 默认拒绝摄像头、麦克风、地理位置、通知、MIDI、USB、串口和剪贴板读取权限；
- 初始化 settings repository 和脱敏日志；
- 生成 `randomBytes(32).toString("base64url")` 会话令牌；
- fork worker，并按架构启动顺序等待 ready；
- 安装协议；
- 创建单个 BrowserWindow；
- 初始化 updater；
- 注册 IPC handler 和退出协议。

### 13.3 窗口安全

- `setWindowOpenHandler` 默认返回 deny；
- 合法 http/https 外链只允许 main 用 `shell.openExternal` 打开，并在 URL parse 后再次校验协议；
- `will-navigate` 只允许当前 `app://wenche` 内部导航；
- 阻止 `will-attach-webview`；
- 禁止权限请求；
- 生产环境不自动打开 DevTools；
- 不加载任何远程脚本、更新说明 HTML 或远程 Electron 页面。

## 14. `desktop/updater.js`

只封装 Electron `autoUpdater`，导出：

```js
createUpdater({ autoUpdater, app, feedUrl, channel, logger, notify })
```

要求见 [RELEASE_AND_ACCEPTANCE.md](RELEASE_AND_ACCEPTANCE.md)。模块不得访问 SQLite、renderer DOM 或 AI 配置；它通过枚举事件通知 main。

## 15. `desktop/error.html`

错误页是打包内静态、无内联脚本或远程资源的页面，至少显示：

- 文澈阅读未能启动本地服务；
- 稳定错误码；
- “重新启动应用”；
- “打开日志目录”；
- 不展示本机绝对路径、异常堆栈、token、Key 或配置内容。

按钮通过 preload 窄接口实现。错误页必须遵守同一 CSP 和 renderer 安全设置。

## 16. 现有业务代码的禁止改动

除非桌面测试暴露真实兼容问题，否则不得修改：

- `documentParser.js` 的格式解析与清洗策略；
- `aiProvider.js` 的 provider 适配、提示词、温度和预算；
- `selectionContext.js` 的检索和来源包；
- 引用校验规则；
- RSS 排序、预算和推荐逻辑；
- 备份 V2 外部格式；
- 当前上传限制；
- 阅读器布局和浏览器 localStorage key。

桌面化造成的改动应集中在启动、路径、设置持久化、鉴权、桌面协议、打包和测试。

## 17. 文档同步

实现完成时必须同步：

- `README.md`：增加桌面安装入口，不删除源码启动方式；
- `CLAUDE.md`：补桌面命令、代码边界和安全约束；
- `docs/ARCHITECTURE.md`：记录 desktop main、utility process、协议代理和数据路径；
- `docs/RUNBOOK.md`：记录安装、日志、备份、更新和故障排查；
- `docs/README.md`：把本目录从“待实现设计”改为已实现桌面规范入口；
- 本目录：删除已经不再准确的“待实现”表述，保留为实现合同。
