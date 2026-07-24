# 发布、验证与恢复

## 发布定位

Desktop 通过公开 Stable Release 向 Windows、macOS 和 Linux 客户端提供版本更新。
Release Notes、客户端设置界面和常规发布文档不展示构建签名状态，发布链路持续校验
HTTPS、版本、平台、架构、文件大小和 SHA-512。

唯一公开更新仓库为 `ptonlix/MagicChat`。普通客户端匿名读取公开 Feed、更新清单和制品，
不携带 GitHub Token；`GITHUB_TOKEN` 仅允许在 GitHub Actions 发布任务中创建 Release。

## 载体与清单

- Windows x64/arm64：NSIS OTA；Release 只发布一个 `latest.yml`，`files` 分别引用文件名
  带 `x64` 和 `arm64` 的两个安装器，不包含顶层 `path` 或 `sha512`。
- macOS Intel/Apple Silicon：Universal ZIP 是 `latest-mac.yml` 的 OTA 主载体；DMG 只用于
  首次安装、平台拒绝应用内替换后的手动升级和恢复。
- Linux x64：AppImage 使用 `latest-linux.yml`；arm64 AppImage 使用
  `latest-linux-arm64.yml`。deb 不作为自更新包，只提供匹配架构的手动下载。

开发运行、test/preview 通道、Linux deb、便携解压、只读目录和未知安装来源不得通过静默
兼容分支强行进入 OTA。平台或安装器拒绝替换时，必须保留当前版本并转为可诊断的手动升级。

## Stable 发布流程

1. 创建严格格式的 `desktop-v<major>.<minor>.<patch>` Tag；预发布、构建元数据和前导零均
   会被拒绝。
2. 每个原生 Runner 在临时 Git worktree 中把 Tag 版本注入 `package.json`，原始工作树版本
   文件不得被修改或提交。
3. Windows x64/arm64、macOS Universal、Linux x64/arm64 分别构建、校验并上传隔离的
   GitHub Actions artifact，不直接创建 Release。
4. 聚合任务校验应用包版本、应用 ID、平台、架构、主更新载体、文件大小和 SHA-512；同名
   不同内容、缺失文件、错架构或 Windows 旧版顶层字段都会阻断发布。
5. 校验完成后生成中文 Release Notes，并一次创建 `draft=false`、`prerelease=false` 的公开
   Stable Release。若同一 Tag 或 Release 已存在，任务立即失败且不覆盖既有资产。
6. 上传中断时删除不完整 Release，再由发布负责人确认远端状态；修复必须使用更高补丁版本，
   不允许替换同一 Tag 下的文件。

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

## 失败恢复

- 网络、超时或限流：保留当前版本，按 15 分钟至 6 小时、带随机抖动的上限退避重试。
- 清单、版本、平台、架构、大小或 SHA-512 不匹配：拒绝安装并清理不可信缓存。
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
