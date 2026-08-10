# 开发启动包装：抑制 Windows 未处理异常弹窗。
# 本项目强制软件渲染，Chromium 原生子进程偶尔会以 0x80000003（断点异常）触发
# Windows 错误框；ELECTRON_DEFAULT_ERROR_MODE=1 让 Windows 直接退出而非弹窗。
$env:ELECTRON_DEFAULT_ERROR_MODE = "1"
& electron-forge start
exit $LASTEXITCODE
