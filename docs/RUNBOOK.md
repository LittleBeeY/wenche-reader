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
npm.cmd run release:check
```

`/api/ai/status` 只返回 provider、模型和是否配置，不会返回 API Key。

## 备份与恢复

停止服务后一起备份：

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

## 生产前检查

当前服务没有认证、用户隔离、限流或后台任务。不要把 `HOST` 改成 `0.0.0.0` 后直接暴露到公网；产品化前至少需要认证、用户隔离、隐私授权、请求限流、备份策略和大文件异步解析。
