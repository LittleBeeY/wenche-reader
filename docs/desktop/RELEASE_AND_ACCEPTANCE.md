# 桌面版发行与验收合同

本文定义可发布产物，而不是实现时间表。所有“必须”项都属于完成条件；缺少签名身份或公开更新源等外部条件时，代码可以达到“发行工程完成”，但不得把未签名安装包称为正式 GA。

## 1. Electron Forge 配置

根目录新增 `forge.config.js`，使用原生 ES module。配置至少包含：

```js
{
  packagerConfig: {
    asar: true,
    executableName: "WencheReader",
    icon: "assets/desktop/icon"
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "wenche_reader",
        setupExe: "WencheReader-Setup.exe",
        setupIcon: "assets/desktop/icon.ico",
        iconUrl: "<public HTTPS .ico URL>"
      }
    }
  ],
  plugins: [
    /* FusesPlugin */
  ]
}
```

图标要求：

- 提供包含 16、24、32、48、64、128、256 像素层级的 `.ico`；
- 安装器、程序、任务栏和卸载项使用同一品牌图标；
- 图标资源必须有明确使用权；
- 不在打包时从网络下载图标。

Squirrel 包 ID、`app.setAppUserModelId()`、快捷方式和 executableName 必须一致并通过安装测试。

## 2. 包内容

生产包只包含：

- `desktop/` 运行文件；
- `src/`；
- `public/`；
- 生产 dependencies；
- `package.json`、LICENSE 和第三方许可证材料；
- 桌面图标和错误页。

不得包含：

- `.git`、`.github`、`.agents`、`.codex`；
- `.env`、`data/`、`uploads/`、logs、backups；
- test、e2e、Playwright report、test-results；
- `docs/superpowers/`；
- 源码地图和 DevTools 扩展；
- 签名文件、PFX、密码、发布 token；
- Forge 输出目录自身。

Forge 打包后必须检查 ASAR 文件清单，不能只依靠 ignore 配置的直觉判断。

## 3. Electron fuses

使用 `@electron-forge/plugin-fuses` 设置：

| Fuse | 值 | 理由 |
| --- | --- | --- |
| `RunAsNode` | false | 禁止把签名应用二进制当通用 Node 执行器 |
| `EnableCookieEncryption` | true | 保护 Chromium session 中可能存在的 Cookie |
| `EnableNodeOptionsEnvironmentVariable` | false | 防止生产运行时通过 NODE_OPTIONS 注入行为 |
| `EnableNodeCliInspectArguments` | false | 禁止生产二进制开启 Node inspector |
| `EnableEmbeddedAsarIntegrityValidation` | true | 运行时校验 ASAR 完整性 |
| `OnlyLoadAppFromAsar` | true | 禁止用旁路 app 目录覆盖受校验代码 |

`backendWorker.js` 必须从 ASAR 内成功被 `utilityProcess.fork()` 启动。若需要为了某个资源使用 `asar.unpack`，必须把文件范围缩到最小并说明原因；不得把整个 `src/`、`desktop/` 或 `node_modules/` 解包。

参考：[Electron ASAR Integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity)、[Electron Forge Fuses Plugin](https://js.electronforge.io/modules/_electron_forge_plugin_fuses.html)。

## 4. Squirrel 生命周期

加入 `electron-squirrel-startup` 运行时依赖，并在 main 的最早位置处理安装、更新、卸载和快捷方式事件。Squirrel 事件处理期间不得启动 worker、打开 SQLite 或创建业务窗口。

首发只生成 Squirrel.Windows 安装器，不同时提供 NSIS、MSIX 和绿色 ZIP。选择单一安装语义可以避免自动更新、快捷方式、卸载和数据位置出现多套行为。

开发构建允许未签名；任何对外发布构建必须签名。

## 5. 代码签名

### 5.1 要求

- 证书来自 Microsoft Artifact Signing 或受 Microsoft Trusted Root Program 信任的 RSA 代码签名 CA；
- 使用稳定的发行者身份；
- 所有可执行文件、DLL、安装器和更新包中的可执行内容均被签名；
- 签名带受信任时间戳；
- 证书私钥和密码只存在于受保护的 CI secret/HSM/Artifact Signing 服务；
- 仓库和构建产物中不得出现 PFX 或可导出私钥。

微软说明未签名的新应用会触发 SmartScreen，并可能被 Smart App Control 或企业策略阻止。自签名证书不满足公开发行要求。[SmartScreen reputation for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)

### 5.2 验证

签名步骤之后、发布步骤之前执行：

```powershell
Get-AuthenticodeSignature -LiteralPath <artifact>
```

每个应签文件必须满足：

- `Status` 为 `Valid`；
- 发行者与批准身份一致；
- 时间戳存在且有效；
- 签名后文件 SHA-256 被写入校验清单；
- 签名后不得再次修改文件。

发布工作流发现任一签名缺失或无效必须失败，不能只打印 warning。

## 6. 更新源合同

### 6.1 地址

生产构建通过受保护的仓库变量注入 `WENCHE_UPDATE_BASE_URL`。它必须是公共 HTTPS 静态地址，不能包含凭据、query token 或用户信息。

布局：

```text
<base>/stable/win32/x64/
├─ RELEASES
├─ WencheReader-<version>-full.nupkg
└─ WencheReader-Setup.exe

<base>/beta/win32/x64/
├─ RELEASES
├─ WencheReader-<version>-full.nupkg
└─ WencheReader-Setup.exe
```

当前源码仓库是私有仓库，因此终端用户的 updater 不得依赖该私有仓库的 GitHub API，也不得内置 GitHub Token。CI 可以把已验证产物发布到单独的公共静态存储或公开发行仓库，但客户端只知道上述 HTTPS base URL。

开发环境缺少 base URL 时禁用 updater，并返回明确“未配置更新源”；正式 release job 缺少该变量必须失败。

### 6.2 Channel

- channel 只允许 `stable` 和 `beta`；
- 普通用户默认为 stable；
- beta 可以升级到更新 beta，也可以切回 stable，但不得自动降级；
- RELEASES 与包文件必须在同一 channel/平台/架构目录；
- 已发布版本文件不可原地覆盖；纠错必须发布更高版本。

## 7. Updater 行为

`desktop/updater.js` 使用 Electron 内置 `autoUpdater`：

- 只在 `app.isPackaged` 且更新源配置完整时启用；
- 启动 30 秒后首次检查，避开 Squirrel 首次启动锁；
- 之后每 6 小时检查一次；
- 同一时刻只允许一个 check/download；
- `checkForUpdates()` 的手动调用复用正在进行的请求；
- 更新检查和下载失败不影响业务窗口；
- 下载完成后通知 renderer/native menu，默认“退出时安装”；
- 只有用户明确选择“立即重启更新”才调用 `quitAndInstall()`；
- `quitAndInstall()` 必须走统一 worker shutdown 协议；
- AI 流、备份恢复、导入和数据库事务进行中时，不主动弹出强制重启；
- 不渲染更新服务器返回的远程 HTML；release notes 只按纯文本显示并限制长度。

公开状态枚举固定为：

```text
disabled
idle
checking
available
not-available
downloading
downloaded
error
```

renderer 只接收枚举、版本和经过长度限制的中文说明，不接收 feed URL、本地包路径或原始异常。

参考：[Electron Updating Applications](https://www.electronjs.org/docs/latest/tutorial/updates)、[Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater)。

## 8. CI 合同

### 8.1 普通 CI

保留当前 Linux/Windows、Node 22/24 的单元和浏览器 E2E。增加 Windows desktop job：

```text
npm ci
npm test
npm run test:desktop
npm run desktop:make
npm run test:packaged
```

普通 PR 不接触生产签名和发布凭据。Forge make 使用临时开发证书或不签名模式，但仍检查包内容、ASAR、fuses 和启动。

### 8.2 正式 release workflow

触发条件为 `v<semver>` tag 和显式受保护环境。工作流必须依次验证：

1. tag 去掉 `v` 后与 `package.json.version` 完全一致；
2. lockfile 与 package 一致，使用 `npm ci`；
3. `npm.cmd test`、`npm.cmd run test:ai`、`npm.cmd run test:e2e`、`npm.cmd run release:check` 全部通过；
4. desktop E2E 和 package smoke 通过；
5. 从干净 checkout 构建 Windows x64；
6. 对产物签名并验证签名；
7. 生成 SHA-256、SBOM、LICENSE 和第三方声明；
8. 使用上一正式版本进行真实升级验证；
9. 发布不可变产物和 Squirrel RELEASES；
10. 从公开 URL 再下载一次，验证哈希和签名与构建结果一致。

步骤 9 之前不得让 RELEASES 指向新版本，避免用户下载到未完成上传的包。先上传带版本文件，验证后最后原子替换 RELEASES。

### 8.3 供应链

- 所有 GitHub Actions 使用完整 commit SHA 或经审查的固定 major，并由依赖更新工具维护；
- `package-lock.json` 必须提交；
- Electron 下载缓存不替代哈希校验；
- `npm audit` 是现有检查的一部分，但不能替代签名、SBOM 和 Electron 主版本维护；
- 构建日志不得打印 secret；
- release job 使用最小 `contents`/OIDC 权限。

## 9. 自动测试文件

至少增加：

```text
test/runtime.test.js
test/ai-settings-store.test.js
test/desktop-auth.test.js
test/desktop-settings-repository.test.js
test/desktop-protocol.test.js
test/desktop-version.test.js
e2e/desktop.spec.js
playwright.desktop.config.js
scripts/smoke-packaged.mjs
```

测试可以按仓库风格合并文件，但下述行为覆盖不可减少。

## 10. 单元与集成测试

### 10.1 Runtime

- 传 `port: 0` 后返回真实非零端口；
- listen 成功后才启动 scheduler；
- listen 失败会关闭 Storage；
- `close()` 顺序为 scheduler → server → storage；
- `close()` 调用两次不抛错、不重复关闭；
- provider 配置从 store 读取；
- store 保存失败时 provider 不变。

### 10.2 CLI 回归

- `.env` 仍能控制 provider、host、port、base URL、model；
- 缺失 `.env` 使用 mock 和 127.0.0.1:3000；
- SIGINT 后端口释放、Storage.close 被调用；
- `scripts/open-reader.ps1` 的健康检查仍成功。

### 10.3 Desktop auth

- 无 token、空 token、错误 token、重复 header 均返回 401；
- 正确 token 可访问 health、JSON、source、SSE、图片和备份；
- token 不出现在错误体和响应头；
- 外部 Origin 不获得 CORS 许可；
- token 比较固定长度且不因前缀相同而通过。

### 10.4 Settings

- 首次启动生成默认公开配置，不生成空密钥文件；
- 保存 Key 后明文不出现在 `settings.json`、SQLite、日志和备份；
- 空 Key 保存保留旧密钥；
- mock 保留旧密钥；
- 原子写失败时旧 provider 继续工作；
- 密钥解密失败保留原文件并按未配置启动；
- renderer GET 永不返回 Key；
- main/worker 消息超时不会切换 provider。

### 10.5 Protocol

- `/`、ES modules、CSS、图片和四个 vendor 文件 MIME 正确；
- `%2e%2e`、混合斜杠、双编码、UNC、盘符、NUL 和非法 URI 不能逃逸；
- 非 `wenche` host 被拒绝；
- renderer 提交的 `X-Wenche-Session` 被覆盖；
- API query、POST body 和下载 header 保留；
- SSE 的多个 chunk 保持分离并按顺序到达；
- Range 请求返回正确状态和字节范围；
- 大响应不是由协议实现整体缓冲；
- CSP 不包含 `unsafe-eval`、远程 script 或 `bypassCSP`。

### 10.6 Version backup

- 版本未变不创建数据库副本；
- 版本变化且 DB 存在时先复制再启动 worker；
- 复制失败阻止 worker 启动；
- worker ready 后才更新 lastSuccessfulAppVersion；
- `-wal`/`-shm` 存在时阻止不一致复制；
- 只清理 backups 内符合规范名称的旧副本。

## 11. Desktop E2E

Playwright 使用 Electron 支持启动开发桌面应用，每个测试运行使用独立临时 LocalAppData 根。必须验证：

- 首次启动显示空库引导；
- renderer 中没有 Node `require`、`process` 和 Electron 对象；
- TXT、Markdown、HTML、PDF、DOCX、EPUB 代表样本可导入；
- DOCX vendor 和源文件读取正常；
- AI Mock SSE 至少产生 start、多个 delta、done；
- 标注、历史、阅读设置和 localStorage 在关闭重启后保持；
- RSS 测试 Feed 刷新、图片代理、快照打开正常；
- 备份下载和恢复正常；
- 第二次启动只聚焦原窗口，数据库没有第二拥有者；
- `window.open`、拖放导航、`file:` 导航和权限请求被拒绝；
- 合法 HTTPS 外链交给系统打开，测试中使用 mock 避免真实打开；
- 关闭窗口后 worker 和监听端口退出；
- worker 启动失败显示错误页，不出现白屏或无限重启。

Desktop E2E 不调用真实 AI 服务、不访问正式用户目录、不要求生产签名凭据。

## 12. Packaged smoke

测试对象必须是 Forge 产物，而不是源码：

- 安装器能在没有系统 Node.js 的干净 Windows 用户中安装；
- 安装路径不包含业务数据库和 Key；
- 首次启动创建 LocalAppData 结构；
- ASAR 内能加载 main、worker、public 和 vendor；
- fuses 实际值与配置一致；
- `RunAsNode` 被禁用；
- app.getVersion 与 health 一致；
- 中文 Windows 用户名、空格路径和非管理员用户可用；
- Windows 防火墙不要求开放公网端口；
- 关闭、卸载、重装后数据保留；
- 卸载不留下正在运行的 worker。

正式签名构建另加 SmartScreen/Smart App Control 和 Authenticode 验证。

## 13. 更新验收

用上一正式安装版和当前候选版验证：

1. 旧版创建文档、标注、AI Mock 历史、RSS 状态和阅读设置；
2. 更新检查发现当前候选版；
3. 下载期间旧版仍可阅读；
4. 用户选择重启更新；
5. worker 优雅关闭，无数据库锁错误；
6. 新版启动前生成 pre-upgrade DB 副本；
7. 新版 schema 迁移成功；
8. 全部旧数据和 localStorage 仍存在；
9. AI Key 仍可使用但不能回显；
10. 更新源断网、404、损坏包和无效签名均不会破坏当前安装。

没有上一正式桌面版时，release workflow 应构建两个相邻测试版本并在临时发布源完成同样的 Squirrel 升级测试，不能跳过更新链路。

## 14. 人工验收矩阵

| 环境 | 必选场景 |
| --- | --- |
| Windows 10 x64 | 安装、启动、导入、重启、卸载 |
| Windows 11 x64 | 安装、自动更新、SmartScreen/签名 |
| 标准用户 | 无管理员权限安装和使用 |
| 中文用户名 | 数据路径、DOCX/PDF、备份恢复 |
| 离线 | 启动、阅读、本地搜索、导出 |
| 系统代理 | AI/RSS 可读失败或正常连接，不泄漏配置 |
| 端口密集占用 | 随机端口仍能启动，不依赖 3000 |
| 多次启动 | 单实例聚焦，不并发写 SQLite |
| 强制结束 worker | 错误页、日志、下次启动数据库可用 |

## 15. 完成定义

### 15.1 发行工程完成

- [ ] 本目录的架构和文件合同已实现，无未记录偏差。
- [ ] Web/CLI 功能和现有测试全部通过。
- [ ] Desktop 单元、E2E、packaged smoke 全部通过。
- [ ] Forge 生成可安装 Windows x64 产物。
- [ ] ASAR、fuses、数据目录、密钥和会话鉴权符合规格。
- [ ] 本地静态服务器可以完成 Squirrel 真升级测试。
- [ ] README、CLAUDE、现行架构和 Runbook 已同步。
- [ ] Git 工作区不包含用户数据、密钥、证书、日志和安装产物。

### 15.2 正式公开发行完成

- [ ] 可信发行者身份和时间戳签名已配置。
- [ ] 正式产物签名验证为 Valid。
- [ ] 公共 HTTPS stable/beta 更新源已配置。
- [ ] 上一正式版本到当前版本的真实升级验收通过。
- [ ] 公开下载产物哈希、签名与 CI 构建一致。
- [ ] Windows 10/11 人工验收通过。
- [ ] 发布说明准确描述隐私、数据位置、备份和已知限制。

任何必选项失败时，都不得用“窗口可以打开”或“本机可以运行”替代完成定义。

