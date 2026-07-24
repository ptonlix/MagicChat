# 原生发布校验工具

五个原生 Runner 必须在上传 artifact 前完成包内真实性校验，缺少下列工具或无法解析实际内容时立即失败，不允许退化为目录名或文件名判断。

- Windows x64/arm64：复用 electron-builder 26.15.3 锁定的 `7zip@1.0.0` `7za.exe` 解开 NSIS 和内部 `app-64.7z` / `app-arm64.7z`；PowerShell 读取应用文件版本，Node 读取 PE Machine 与 `app.asar`。固定归档 SHA-256 分别为 x64 `be071f15bd6da2f78fe81c6ddef2009b0c4d8a51f36b780cb806c7e6df95e1b3`、arm64 `ac3f38f96ce7498096a123bb0862dd6db863a7353c9e9e1c15f73c183adf6620`。
- macOS Universal：`ditto` 解 ZIP，`hdiutil` 只读挂载 DMG，`plutil` 读取版本，`lipo -archs` 必须精确返回 `x86_64` 与 `arm64`。
- Linux x64/arm64：AppImage 自解包后由 Node 读取主程序 ELF Machine；`dpkg-deb -f/-x` 读取 deb 的 Architecture、Version 与包内主程序。

预期 Machine 为 PE x64 `0x8664`、PE arm64 `0xAA64`、ELF x64 `0x003E`、ELF arm64 `0x00B7`。任一解包命令失败、内部架构包缺失、包内版本不一致或工具不可用均阻断当前矩阵任务。

## 本地真实制品记录

- 2026-07-24，macOS arm64 主机：对现有 `MagicChat-0.1.0-mac-universal.zip` 与 `.dmg` 执行 `verify:package`，Info.plist 版本为 `0.1.0`，ZIP 与 DMG 主二进制均由 `lipo -archs` 确认为 `x86_64 arm64`，校验通过。
- Windows x64/arm64 与 Linux x64/arm64 必须由对应 GitHub Runner 保存结果；不得由本机 macOS 记录推断通过。
