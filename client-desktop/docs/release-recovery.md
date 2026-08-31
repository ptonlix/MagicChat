# 发布、验证与恢复

## 发布定位

Desktop 新版本通过 `https://jiying.chat/releases/version.json` 发现更新，并下载其中指向的
完整安装包。GitHub Release 继续作为构建、验证和旧客户端桥接入口；桥接用 `latest*.yml`
保留，但新客户端不再依赖 electron-updater Provider 或外置 blockmap。

唯一公开构建仓库为 `ptonlix/MagicChat`。普通客户端匿名读取官网清单和公开制品，
不携带 GitHub Token；`GITHUB_TOKEN` 仅允许在 GitHub Actions 的最终 `release` Job 中创建
和修改 Release，`quality` 与 `package` Job 只有 `contents: read`。

## 载体与清单

- Windows x64：`version.json.windows` 指向完整 NSIS EXE。Windows ARM64 因现有清单没有
  独立字段，仅提供 GitHub Release 手动下载，不能误用 x64 URL。
- macOS Intel/Apple Silicon：`version.json.macos` 指向 Universal DMG；客户端下载后打开 DMG，
  由用户完成覆盖安装。
- Linux x64/arm64 AppImage：分别读取 `linux-amd`、`linux-arm`，下载完整 AppImage 后安全替换。
  deb 不自替换，只提供手动升级。
- GitHub Release 仍包含四个 `latest*.yml`、ZIP 和完整安装包，供旧客户端升级到桥接版；
  Release 与 Actions artifact 均不得包含独立 `.blockmap`。

开发运行、test/preview 通道、Linux deb、便携解压、只读目录和未知安装来源不得通过静默
兼容分支强行进入 OTA。平台或安装器拒绝替换时，必须保留当前版本并转为可诊断的手动升级。

## Stable 发布流程

### macOS 签名与公证凭据

macOS Stable 制品使用 `Developer ID Application` 签名，并通过 App Store Connect Team
API Key 提交 Apple 公证。GitHub 仓库的 `Settings -> Secrets and variables -> Actions`
必须配置以下 Repository Secrets：

- `MACOS_CERTIFICATE_P12_BASE64`：包含 Developer ID Application 证书及私钥的 `.p12`
  文件 Base64 内容。
- `MACOS_CERTIFICATE_PASSWORD`：导出 `.p12` 时设置的密码。
- `MACOS_NOTARY_API_KEY_P8_BASE64`：App Store Connect Team API `.p8` 文件 Base64 内容。

同一页面的 Variables 必须配置：

- `APPLE_API_KEY_ID`：App Store Connect Team API Key ID。
- `APPLE_API_ISSUER`：App Store Connect Team API Issuer ID。

Key ID、Issuer ID 和 Team ID 不是私钥，但不得把 `.p8`、`.p12`、证书密码或其 Base64
内容写入工作流、仓库文件、Actions artifact 或日志。macOS 可使用以下命令生成单行 Secret
内容，并分别粘贴到 GitHub；命令不会修改源文件：

```bash
base64 -i "/path/to/DeveloperIDApplication.p12" | pbcopy
base64 -i "/path/to/AuthKey_KEYID.p8" | pbcopy
```

发布工作流只在 Tag 触发的 macOS package 步骤中注入这些凭据。electron-builder 必须完成
hardened runtime 签名、公证和票据 stapling；`verify:package` 随后分别解开 ZIP 和挂载 DMG，
验证 Developer ID Application、Team ID `8RK3WCWST9`、代码签名完整性、公证票据和
Gatekeeper。任一步失败都不得上传或发布 macOS 制品。

1. 使用任意 Markdown 文件编写本版说明；[人工发布说明模板](release-notes-template.md) 仅供
   参考，不要求固定章节或标题。Markdown 标题会被 Git 默认清理规则当作注释，因此必须
   使用 `--cleanup=verbatim`：

   ```bash
   git tag -a desktop-v1.2.3 --cleanup=verbatim -F my-release-notes.md
   git push origin desktop-v1.2.3
   ```

   Tag 必须是 Annotated 或 signed Tag，严格匹配 `desktop-v<semver>`，解引用 Commit 必须与
   checkout 一致；正文必须非空、不含控制字符且不超过长度上限。

2. 单一 `quality` Job 在安装依赖前验证 Tag，然后只执行一次 `pnpm check`、完整测试、生产
   构建、`verify:build` 和工作流静态校验。
3. 五个 `package` 目标依赖 `quality`。版本准备脚本在 CI 的 `RUNNER_TEMP` 内创建唯一
   detached worktree，本地执行时回退到系统临时目录，只修改其中的
   `client-desktop/package.json`；不接受外部 `--target`，不删除或污染调用方 checkout。
4. 每个原生 Runner 校验真实构建内容：Windows 检查最终 NSIS 的 PE/版本、同次生成的打包
   应用 PE 架构与 `app.asar` 版本，macOS 检查 ZIP/DMG、plist 和 Universal 二进制，
   Linux 检查 AppImage ELF 与 deb 元数据。验证后只上传隔离的 Actions artifact。
5. `release:prepare-assets` 恰好接收五个目标，在内部 staging 目录生成 Windows 双架构桥接
   清单和完整 `version.json`，保留基线文件的 Android/iOS 字段，复核 size、SHA-256、
   SHA-512 和精确的 13 个公开资产，并输出 `release-plan.json`。随后生成官网手工上传
   artifact，其中包含四个固定文件名安装包、官网 URL 版 `version.json` 和 `SHA256SUMS.txt`。
   Desktop `build` 取同一 workflow run 的 `github.run_attempt`：新版本首次运行为 1，
   发布前使用 `Re-run all jobs` 重跑时递增。已公开的版本不得覆盖，修复必须发布更高版本。
6. `release` Job 在任何写操作前重新检查远端状态，创建不可发现的 Draft 并立即记录 Release
   ID、Tag、仓库和 workflow run 所有权。脚本只上传 `release-plan.json` 列出的文件。
7. 上传后按 Release ID 读取远端资产，复核名称、大小、数量、唯一性，并轮询 GitHub Asset
   `digest`，直至每项 `sha256:<hex>` 与本地 SHA-256 一致；全部通过后才将同一 Release ID
   转为 `draft=false`、`prerelease=false` 的公开 Stable Release。

安装后的应用展示名称为“即应”，GitHub Release 安装包使用 `Jiying-<version>-...` 文件名。
`appId=com.magicchat.desktop`、`magicchat://` 和 `magicchat-desktop` 用户数据目录保持稳定。
首个品牌迁移版本在 macOS 上将 `即应.app` 拖入“应用程序”并首次启动时，会先识别相同
Bundle ID 的旧 `MagicChat.app`，由用户确认后移入废纸篓，再注册 `magicchat://` 协议；
用户拒绝或迁移失败时新应用不会继续启动。直接从 DMG 运行不会删除旧应用。必须从上一版
真机升级，复核登录状态、快捷方式、卸载项，并确认“应用程序”目录只保留 `即应.app`。

自动化命令从 `client-desktop/` 执行：

```bash
pnpm check
pnpm test
NODE_OPTIONS="--max-old-space-size=512" nice -n 10 pnpm build
pnpm verify:build
pnpm verify:package -- --platform <win|mac|linux> --arch <x64|arm64|universal> --tag desktop-v1.2.3
```

打包和 `verify:package` 必须在对应目标操作系统执行。跨平台生成成功不能替代真机安装、
替换、重启和用户数据保留验收。

## 原生发布校验工具

五个原生 Runner 必须在上传 artifact 前完成包内真实性校验。缺少下列工具或无法解析实际
内容时立即失败，不允许退化为目录名或文件名判断。

- Windows x64/arm64：校验最终 NSIS 是有效 PE 且 ProductVersion 与 Tag 一致；同时从
  electron-builder 同次生成的 `win-unpacked` / `win-arm64-unpacked` 读取主程序 PE
  Machine、ProductVersion 与 `app.asar` 版本。最终安装器继续通过清单 size 和 SHA-512 复核。
- macOS Universal：`ditto` 解 ZIP，`hdiutil` 只读挂载 DMG，`plutil` 读取版本，
  `lipo -archs` 必须精确返回 `x86_64` 与 `arm64`；ZIP 与 DMG 内应用还必须分别通过
  `codesign --verify`、Developer ID/Team ID 检查、`stapler validate` 和 `spctl --assess`。
- Linux x64/arm64：AppImage 自解包后由 Node 读取主程序 ELF Machine，并验证 electron-builder
  内嵌元数据；`dpkg-deb -f/-x` 分别读取 deb 的 Architecture、Version 与包内主程序。

预期 Machine 为 PE x64 `0x8664`、PE arm64 `0xAA64`、ELF x64 `0x003E`、ELF arm64
`0x00B7`。任一解包命令失败、内部架构包缺失、包内版本不一致或工具不可用均阻断当前
矩阵任务。

### 本地真实制品记录

- 2026-07-24，macOS arm64 主机：对现有 `MagicChat-0.1.0-mac-universal.zip` 与 `.dmg`
  执行签名门禁引入前的 `verify:package`，Info.plist 版本为 `0.1.0`，ZIP 与 DMG 主二进制
  均由 `lipo -archs` 确认为 `x86_64 arm64`。该记录只作为版本和架构基线，不能证明
  Developer ID 签名、公证或 Gatekeeper 验收通过。
- Windows x64/arm64 与 Linux x64/arm64 必须由对应 GitHub Runner 保存结果；不得由本机
  macOS 记录推断通过。

## 失败恢复

- Draft 上传或复核失败：自动清理前必须重新确认 Release ID、Tag、Draft 状态和当前 workflow
  run 所有权；四项全部匹配时才按 Release ID 删除。任一信息无法确认时保留 Draft，并从
  Actions 日志和 `release-transaction.json` 取得 ID 后人工检查。禁止执行
  `gh release delete <tag>`。
- 公开操作已经发起但后续诊断失败：不得自动删除或重新转为 Draft。先按 Release ID 查询
  远端状态；若已公开，停止其成为 Latest 或发布更高补丁版本。
- 同 Tag 已有公开 Release 或未知 Draft：当前运行立即失败，不上传、不覆盖、不删除。
- 网络、超时或限流：保留当前版本，按 15 分钟至 6 小时、带随机抖动的上限退避重试。
- 清单、版本、平台、架构、可选大小或可选 SHA-512 不匹配：拒绝安装并清理不可信缓存。
- Windows 安装器被系统策略阻止：不添加绕过系统安全检查的代码；使用 Release 中匹配
  架构的 NSIS 手动恢复。
- macOS 原生更新器或系统策略拒绝应用内替换：返回
  `platform_signature_required`，保留当前应用并从同一 Release 使用 DMG 手动升级。
- Linux AppImage 只读或权限失败：保留当前 AppImage，修复目录权限或下载新的匹配架构
  AppImage；deb 用户继续由包管理器手动升级。
- 活跃上传或下载：阻止退出安装，等待传输完成或由用户明确取消后重试。
- 新版本无法健康启动：保留用户配置和安全存储，确认 schema 向后兼容后手动安装上一兼容
  版本；优先发布更高补丁版本向前修复，不执行应用内降级。

发现严重问题时，让问题 Release 不再成为 Latest，停止新的发现，并发布更高修复版本。
不得覆盖旧 Tag 资产，否则缓存和摘要将失去一致性。

平台签名和凭据属于构建与 CI 配置，不进入客户端状态、Release Notes 或常规发布文档。
证书、私钥和 Token 必须使用 CI 密钥托管、最小权限、轮换和访问审计，不得进入仓库、
客户端包、更新清单或普通日志。

## 验收状态

三平台跨版本结果统一记录在 [Stable OTA 验收指南](stable-ota-acceptance.md)。只有目标系统、
架构和安装来源真机完成基线安装、检查、下载、替换、重启、健康标记及用户数据保留后，
才能把对应组合标记为通过。
