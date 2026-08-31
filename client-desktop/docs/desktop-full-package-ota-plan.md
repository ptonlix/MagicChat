# Desktop 官网全量包 OTA 方案

## 目标

Desktop 只使用官网 `https://jiying.chat/releases/version.json` 发现更新，并下载完整安装包。GitHub Release 是构建和分发源，运维再把固定文件名的官网资产手工同步到 `/releases/`。

本方案明确停止旧 GitHub OTA 兼容：不再生成 `latest*.yml`、外置 `.blockmap` 或 macOS ZIP，也不保留 `electron-updater` Provider。

## 更新链路

```text
desktop-v<version> Tag
  -> GitHub Actions 构建并验证 7 个完整安装包
  -> GitHub Release 发布 7 个安装包 + version.json
  -> Actions 生成官网六文件上传目录
  -> 运维上传安装包与 SHA256SUMS.txt
  -> 运维最后上传 version.json
  -> Desktop 启动后约 60 秒或用户手动检查
  -> 比较 version；同版本时再比较 build
  -> 下载对应平台完整包并更新或提示手工安装
```

`version` 判断功能版本，`build` 表示同一版本的第几次有效构建。同版本下只有官网 `build` 更大时才视为新构建；更高 `version` 总是优先。

## 平台映射

- Windows x64：`version.json.windows`，完整 NSIS EXE。
- Windows ARM64：GitHub Release 提供完整 EXE；当前官网 JSON 没有独立字段，因此保持手工下载，不能误用 x64 URL。
- macOS Intel/Apple Silicon：`version.json.macos`，Universal DMG。
- Linux x64：`version.json["linux-amd"]`，完整 AppImage。
- Linux ARM64：`version.json["linux-arm"]`，完整 AppImage。
- Linux deb：GitHub Release 提供手工安装和恢复，不执行应用内自替换。

## 资产合同

GitHub Release 恰好 8 个公开文件：

```text
Jiying-<version>-win-x64.exe
Jiying-<version>-win-arm64.exe
Jiying-<version>-mac-universal.dmg
Jiying-<version>-linux-x86_64.AppImage
Jiying-<version>-linux-amd64.deb
Jiying-<version>-linux-arm64.AppImage
Jiying-<version>-linux-arm64.deb
version.json
```

官网手工上传 artifact 恰好 6 个文件：

```text
jiying.exe
jiying.dmg
jiying.amd.AppImage
jiying.arm.AppImage
version.json
SHA256SUMS.txt
```

官网安装包使用固定文件名，所以点击下载始终命中同一 URL 的当前文件。必须先上传安装包、完成摘要和匿名访问验证，再最后替换 `version.json`。

## 旧版本与品牌迁移

- 1.8.1 已接入官网 JSON，可以发现 1.8.2。
- 1.8.0 及更早版本依赖的旧 GitHub OTA 不再兼容，用户需手工安装一次 1.8.2。
- macOS 不执行自动删除旧应用的一次性代码。用户退出 MagicChat，将即应安装到“应用程序”，再把 `/Applications/MagicChat.app` 移入废纸篓。
- 只移除旧应用程序，不删除 `~/Library/Application Support/magicchat-desktop`；验证即应数据正常后再清空废纸篓。
- 1.8.2 之后继续走官网 JSON OTA，无需重复品牌迁移。

## 发布门禁

- Tag 必须是严格的 `desktop-v<semver>` Annotated 或 signed Tag。
- 版本写入临时 worktree，不污染发布者 checkout。
- Windows 校验 NSIS 与包内 PE 架构和版本；macOS 校验 DMG、Universal 架构、签名、公证和 Gatekeeper；Linux 校验 AppImage ELF 与 deb 元数据。
- Release 聚合拒绝缺失、重复、额外文件以及任何旧更新清单、ZIP 或外置 blockmap。
- 发布脚本只上传 `release-plan.json` 列出的八个文件，并在公开前复核远端资产摘要。
- 官网六文件目录继续生成 SHA-256 清单，运维上传前后都应复核。

## 验收重点

1. 公开 Release 精确包含 8 个文件，官网 artifact 精确包含 6 个文件。
2. 官网 `version.json` 的桌面字段版本和 build 正确，URL 匿名可访问。
3. 1.8.1 能发现 1.8.2；1.8.0 及更早版本按手工迁移说明安装。
4. macOS 安装即应后保留登录和本地数据，且用户确认无误后只移除旧 `MagicChat.app`。
5. 1.8.2 到后续版本能够通过官网 JSON 发现、下载并完成平台允许的更新路径。
6. 失败时旧版本仍可运行，并提供完整安装包手工恢复。
