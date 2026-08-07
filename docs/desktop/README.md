# 文澈阅读桌面版设计规格

> 状态：已实现的规范性合同
> 基线：`main` 分支（当前实现以代码与测试为准），核对日期 2026-08-07
> 适用范围：Windows 10/11 x64 桌面发行版

## 文档目的

本目录是交给编码 agent 的桌面版实现规格。它不描述按周或按阶段推进的计划，也不提供多套可自由选择的架构；agent 应把这里的决策视为已实现的合同，后续修改必须保持测试与文档同步。

项目通用规则仍以仓库根目录的 `CLAUDE.md` 为最高优先级。当前 Web/CLI 行为以代码、测试、`docs/ARCHITECTURE.md` 和 `docs/RUNBOOK.md` 为准。本目录只对桌面化改造及其新增行为具有设计权威；实现完成后，agent 必须同步更新现行架构和运行文档，不能让本目录成为与代码脱节的历史方案。

## 阅读顺序

1. [ARCHITECTURE.md](ARCHITECTURE.md)：第一性原理、不可变量、目标进程模型和运行时生命周期。
2. [IMPLEMENTATION_SPEC.md](IMPLEMENTATION_SPEC.md)：文件级改动、模块接口、消息协议和依赖约束。
3. [DATA_AND_SECURITY.md](DATA_AND_SECURITY.md)：数据目录、AI 密钥、威胁模型、请求鉴权和迁移规则。
4. [RELEASE_AND_ACCEPTANCE.md](RELEASE_AND_ACCEPTANCE.md)：安装、签名、更新、CI、测试矩阵和完成定义。

## 已确定的产品与技术决策

| 主题 | 规范性决定 |
| --- | --- |
| 首发平台 | Windows 10/11 x64；不同时实现 macOS、Linux、ARM64 |
| 桌面运行时 | Electron 43 的最新非预发布补丁版，写入 `package.json` 时使用精确版本，不使用 `^` 或 `~` |
| 打包工具 | Electron Forge，Squirrel.Windows 安装器 |
| 前端 | 继续使用 `public/` 原生 ES modules，不引入 React、Vue、Vite 或新的前端构建层 |
| 后端 | 继续使用 Express、`node:sqlite`、现有 provider adapter 和 RSS 服务 |
| 进程隔离 | Electron main 负责可信桌面能力；Express、SQLite 和 RSS 调度器运行在一个 utility process 中 |
| 页面来源 | 生产窗口加载 `app://wenche/`；静态资源由协议处理器从应用包读取，`/api/*` 代理到随机回环端口 |
| 本地服务 | 只监听 `127.0.0.1:0`，由系统分配端口；所有请求都要求每次启动随机生成的会话令牌 |
| 数据位置 | `%LOCALAPPDATA%\Wenche Reader`，不写安装目录或 `app.asar` |
| AI 密钥 | 由 Electron main 使用 `safeStorage` 加密；不再把桌面版 Key 写入 `.env` |
| Web/CLI 兼容 | `npm start`、`.env` 配置和现有浏览器测试必须继续工作 |
| 更新 | Electron `autoUpdater` + Squirrel.Windows 静态更新源；不从私有 GitHub Release 给终端用户更新 |
| 签名 | 公开发行安装器、程序和更新包必须使用可信代码签名并带时间戳 |
| 后台行为 | 关闭主窗口即退出；不新增托盘常驻、开机启动或后台静默运行 |
| 迁移 | 旧 Web 版数据通过现有 V2 备份导出/恢复进入桌面版；不扫描磁盘或自动搬运开发目录 |
| 遥测 | 不加入默认遥测；诊断日志仅保存在本地并由用户主动导出 |

## 第一版明确不做

- 不把 Express 暴露到局域网或公网。
- 不实现账号、云同步、多人数据隔离或远程管理。
- 不重写文档解析器、AI 提示词、RSS 排序或阅读器布局。
- 不加入系统托盘、开机启动、文件类型关联、全局快捷键和多窗口编辑。
- 不提供“绿色版”和安装版两套不同的数据语义。
- 不因为桌面化而替换 `node:sqlite`；通过精确版本和契约测试管理其兼容风险。
- 不把通用 IPC、文件系统、Shell 或 Node API 暴露给 renderer。

## Agent 执行规则

- 不得静默改变本目录中的架构选择。发现选择在当前 Electron 版本不可行时，先用最小复现和测试记录证据，再采用文档中已经定义的受限回退；没有受限回退的情况必须向用户报告。
- 每项改动都必须能追溯到本目录的明确要求；不要顺手重构相邻业务代码。
- 先补能暴露回归的测试，再调整运行时边界。
- 开发、测试和打包不得读取或写入仓库中的正式 `data/`、`uploads/`、`.env`。
- 不得提交证书、签名密码、更新凭据、真实 API Key、安装产物或用户数据。
- 完成不是“能打开窗口”，而是 [RELEASE_AND_ACCEPTANCE.md](RELEASE_AND_ACCEPTANCE.md) 中所有必选检查通过。

## 官方技术依据

- [Electron 发布周期](https://releases.electronjs.org/schedule)
- [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)
- [Electron 自定义协议](https://www.electronjs.org/docs/latest/api/protocol)
- [Electron 安全清单](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Electron 应用更新](https://www.electronjs.org/docs/latest/tutorial/updates)
- [Electron Forge](https://www.electronforge.io/)
- [Squirrel.Windows Maker](https://www.electronforge.io/config/makers/squirrel.windows)
- [Node.js SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
- [Microsoft SmartScreen 发行说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
