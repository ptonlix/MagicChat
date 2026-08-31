# 桌面端基于 `version.json` 的全量 OTA 改造方案

## 1. 文档状态

- 状态：已按方案完成代码改造
- 实施状态：自动化检查完成，等待 GitHub Actions 原生打包和跨版本真机验收
- 实施日期：2026-08-31
- 适用范围：MagicChat Desktop Stable 桌面客户端
- 构建与制品仓库：`https://github.com/ptonlix/MagicChat/releases`
- 正式版本清单：`https://jiying.chat/releases/version.json`
- 正式安装包目录：`https://jiying.chat/releases/`

## 2. 背景

当前桌面端基于 `electron-updater` 的 GitHub Provider，通过 GitHub Release 中的 `latest*.yml` 和外置 `.blockmap` 完成版本发现和差分下载。

后续发布环境不允许上传外置 `.blockmap`。同时，项目已经存在统一的 `version.json`：

```json
{
  "android": {
    "build": 10,
    "version": "1.4.0",
    "url": "https://jiying.chat/releases/jiying.apk"
  },
  "ios": {
    "build": 1,
    "version": "1.0.0",
    "url": "https://jiying.chat/releases/jiying.dmg"
  },
  "windows": {
    "build": 1,
    "version": "1.0.0",
    "url": "https://jiying.chat/releases/jiying.exe"
  },
  "macos": {
    "build": 1,
    "version": "1.0.0",
    "url": "https://jiying.chat/releases/jiying.dmg"
  },
  "linux-amd": {
    "build": 1,
    "version": "1.0.0",
    "url": "https://jiying.chat/releases/jiying.amd.AppImage"
  },
  "linux-arm": {
    "build": 1,
    "version": "1.0.0",
    "url": "https://jiying.chat/releases/jiying.arm.AppImage"
  }
}
```

本方案将桌面 OTA 改为：客户端读取现有 `version.json`，根据平台和架构选取配置，比较版本号，下载 URL 指向的完整安装包并完成升级。

## 3. 已确认的设计决策

1. GitHub Release 继续发布到 `ptonlix/MagicChat`，不迁移仓库。
2. GitHub Release 不再上传任何独立 `.blockmap` 文件。
3. 桌面客户端使用 `https://jiying.chat/releases/version.json` 发现新版本。
4. 不增加 `/releases/desktop` OTA 目录，也不使用 Generic Provider 作为最终方案。
5. 保持现有 `version.json` 一级平台字段格式。
6. `android` 和 `ios` 字段必须原样保留，桌面发布不得覆盖或删除移动端配置。
7. 验证阶段的桌面 URL 指向 GitHub Release 完整安装包。
8. GitHub 验证通过后，人工将安装包同步到官网，并把桌面 URL 替换为官网固定地址。
9. `version.json` 必须在安装包上传并验证完成后最后发布。
10. 桌面 OTA 使用完整 `.exe`、`.dmg` 或 `.AppImage`，不依赖外置 `.blockmap`。
11. 第一版使用桥接发布兼容仍在使用 GitHub Provider 的旧客户端。

## 4. 目标发布链路

```text
代码提交与 desktop-v* Tag
           │
           ▼
GitHub Actions 跨平台构建
           │
           ├─ 生成完整安装包
           ├─ 生成 latest*.yml（兼容旧客户端）
           ├─ 生成 version.json
           └─ 不上传外置 .blockmap
           │
           ▼
ptonlix/MagicChat GitHub Release
           │
           ├─ 第一阶段：version.json 的桌面 URL 指向 GitHub Release
           │             用真实完整包验证新版升级逻辑
           │
           └─ 验证通过后人工同步
                         │
                         ▼
              jiying.chat/releases/
                         │
                         ├─ 覆盖官网固定安装包
                         └─ 最后发布官网 version.json
```

客户端正式更新流程：

```text
启动或手动检查更新
→ 请求 https://jiying.chat/releases/version.json
→ 根据系统和架构选择平台字段
→ 比较当前版本与 version.json.version
→ 有新版本时提示用户
→ 用户确认后下载 version.json.url 指向的完整包
→ 校验下载结果和平台签名
→ 执行对应平台的升级流程
```

## 5. 平台映射规则

桌面客户端读取 `version.json` 时按以下规则选择字段：

| 运行平台 | 架构      | `version.json` 字段 | 安装包             |
| -------- | --------- | ------------------- | ------------------ |
| Windows  | x64       | `windows`           | NSIS `.exe`        |
| macOS    | x64/ARM64 | `macos`             | Universal `.dmg`   |
| Linux    | x64       | `linux-amd`         | x86_64 `.AppImage` |
| Linux    | ARM64     | `linux-arm`         | ARM64 `.AppImage`  |

### 5.1 Windows ARM64 限制

现有 JSON 只有一个 `windows` 字段，而当前打包流程同时生成 Windows x64 和 ARM64 两个安装器。一个 URL 无法同时表示两个架构。

第一阶段建议明确：

- `windows` 固定发布 Windows x64 安装包。
- Windows ARM64 暂不进入基于现有 JSON 的自动全量 OTA。
- ARM64 用户可继续从 GitHub Release 手动下载匹配安装包。

如果后续要支持 Windows ARM64 自动更新，需要扩展 JSON，例如增加：

```json
{
  "windows": {
    "build": 8,
    "version": "1.8.0",
    "url": "https://jiying.chat/releases/jiying.exe"
  },
  "windows-arm": {
    "build": 8,
    "version": "1.8.0",
    "url": "https://jiying.chat/releases/jiying.arm.exe"
  }
}
```

该扩展不纳入本次第一阶段范围，除非评审时明确要求同时完成。

## 6. `version.json` 的生成规则

### 6.1 打包输出

桌面 Release 聚合阶段新增 `version.json` 输出。它必须包含完整的现有平台结构，而不是只输出桌面字段。

生成过程：

1. 读取并校验一个完整基础清单。
2. 原样保留 `android`、`ios`。
3. 用当前 Desktop Tag 更新 `windows`、`macos`、`linux-amd`、`linux-arm` 的 `version`。
4. 更新对应的递增 `build`。
5. 验证阶段生成 GitHub Release 下载 URL。
6. 输出格式化 JSON 并加入 Release 资产。

### 6.2 移动端字段保护

桌面构建不能自行猜测 Android 和 iOS 版本。建议由发布流程显式提供基础清单，例如：

```text
release-version-base.json
```

或在发布前下载当前官网 `version.json` 作为输入。无论采用哪种方式，都必须满足：

- `android` 和 `ios` 存在。
- 字段结构合法。
- 桌面发布只修改桌面字段。
- 输入清单读取失败时终止发布，不能生成缺少移动端字段的新文件。

为了保证发布可复现，优先建议将经过确认的完整基础清单作为发布输入，而不是在构建过程中无条件依赖在线地址。

### 6.3 版本比较

桌面端以 `version` 的 Stable SemVer 为主要判断依据：

```text
远端 1.8.0 > 当前 1.7.1 → 有新版本
远端 1.8.0 = 当前 1.8.0 → 已是最新版本
远端 1.7.1 < 当前 1.8.0 → 不允许自动降级
```

`build` 保持为正整数并随发布递增，用于与现有清单格式保持一致，也可作为同版本构建诊断信息；第一阶段不使用 `build` 绕过 SemVer 执行同版本覆盖更新。

## 7. GitHub 验证阶段的 `version.json`

以 `desktop-v1.8.0` 为例，GitHub Release 中的桌面字段先指向 GitHub 完整安装包：

```json
{
  "android": {
    "build": 10,
    "version": "1.4.0",
    "url": "https://jiying.chat/releases/jiying.apk"
  },
  "ios": {
    "build": 1,
    "version": "1.0.0",
    "url": "https://jiying.chat/releases/jiying.dmg"
  },
  "windows": {
    "build": 8,
    "version": "1.8.0",
    "url": "https://github.com/ptonlix/MagicChat/releases/download/desktop-v1.8.0/MagicChat-1.8.0-win-x64.exe"
  },
  "macos": {
    "build": 8,
    "version": "1.8.0",
    "url": "https://github.com/ptonlix/MagicChat/releases/download/desktop-v1.8.0/MagicChat-1.8.0-mac-universal.dmg"
  },
  "linux-amd": {
    "build": 8,
    "version": "1.8.0",
    "url": "https://github.com/ptonlix/MagicChat/releases/download/desktop-v1.8.0/MagicChat-1.8.0-linux-x86_64.AppImage"
  },
  "linux-arm": {
    "build": 8,
    "version": "1.8.0",
    "url": "https://github.com/ptonlix/MagicChat/releases/download/desktop-v1.8.0/MagicChat-1.8.0-linux-arm64.AppImage"
  }
}
```

验证目标：

- 客户端能正确识别当前平台。
- 客户端能正确比较版本。
- 下载的是完整安装包，不请求 `.blockmap`。
- GitHub Release URL 可匿名下载。
- 下载完成后能够进入正确的平台升级流程。

## 8. 正式官网 `version.json`

GitHub 验证完成、完整安装包同步到官网后，只替换桌面字段的 URL：

```json
{
  "android": {
    "build": 10,
    "version": "1.4.0",
    "url": "https://jiying.chat/releases/jiying.apk"
  },
  "ios": {
    "build": 1,
    "version": "1.0.0",
    "url": "https://jiying.chat/releases/jiying.dmg"
  },
  "windows": {
    "build": 8,
    "version": "1.8.0",
    "url": "https://jiying.chat/releases/jiying.exe"
  },
  "macos": {
    "build": 8,
    "version": "1.8.0",
    "url": "https://jiying.chat/releases/jiying.dmg"
  },
  "linux-amd": {
    "build": 8,
    "version": "1.8.0",
    "url": "https://jiying.chat/releases/jiying.amd.AppImage"
  },
  "linux-arm": {
    "build": 8,
    "version": "1.8.0",
    "url": "https://jiying.chat/releases/jiying.arm.AppImage"
  }
}
```

这样不需要增加 `/desktop` 目录，继续沿用已经存在的官网地址结构。

## 9. 桌面客户端改造范围

### 9.1 新增版本清单读取

在桌面主进程更新服务中新增：

```text
GET https://jiying.chat/releases/version.json
```

要求：

- 仅接受 HTTPS。
- 设置请求超时。
- 禁止使用过期本地缓存。
- 校验响应为普通 JSON 对象。
- 校验目标字段包含合法的 `build`、Stable SemVer `version` 和 HTTPS `url`。
- 请求失败时保留当前版本并进入可重试错误状态。

### 9.2 平台选择和版本判断

根据 `process.platform`、`process.arch` 和安装来源选择字段。开发环境、test/preview 通道和不支持的安装来源不自动执行 Stable OTA。

版本比较必须满足：

- 仅远端 Stable SemVer 更高时提示升级。
- 禁止预发布版本和格式异常版本。
- 禁止自动降级。
- 同版本不重复下载。

### 9.3 完整安装包下载

下载逻辑直接使用 `version.json.url`：

- 下载到应用专用临时目录。
- 不直接覆盖当前运行文件。
- 支持下载进度。
- 支持取消和超时。
- 下载失败时删除不完整文件。
- 下载完成后检查文件大小非零且扩展名与平台一致。
- 不请求任何独立 `.blockmap`。

现有 JSON 没有文件大小和摘要字段。第一阶段至少依赖 HTTPS、发布仓库可信性和平台原生签名验证；这弱于当前 `latest*.yml` 中的 SHA-512 校验，是本方案需要明确接受的风险。

后续建议在兼容现有字段的前提下增加可选的 `size` 和 `sha512`，客户端存在字段时必须校验，不存在时按第一阶段兼容策略处理。

### 9.4 平台安装策略

#### Windows

- 下载完整 x64 NSIS `.exe`。
- 客户端校验 HTTPS、扩展名、非空内容和 PE `MZ` 文件头；安装包版本与架构由 CI 原生包
  校验保证。Windows 代码签名仍取决于发布环境是否配置签名证书，系统安装提示不得绕过。
- 安装前阻止活跃文件传输。
- 记录目标版本和安装意图。
- 安全退出应用并启动安装器。
- 安装失败时保留旧版本并提供 GitHub 手动下载入口。

#### macOS

- 下载完整 Universal `.dmg`。
- 客户端校验 HTTPS、扩展名、非空内容和 DMG `koly` 尾部；Developer ID、Universal 架构、
  公证和目标版本由 macOS CI 原生包校验保证。
- 打开 DMG 并引导用户完成覆盖安装。
- 第一阶段按“发现、下载、打开安装器”的全量升级处理，不承诺无交互静默替换。
- 若需要继续使用 electron-updater 的自动替换能力，应另外保留 ZIP 和 `latest-mac.yml` 流程，不属于本次 JSON 直链第一阶段。

#### Linux AppImage

- x64 下载 `linux-amd.url`。
- ARM64 下载 `linux-arm.url`。
- 验证下载文件为匹配架构的 AppImage。
- 保留当前 AppImage，准备新文件并赋予可执行权限。
- 安全退出后替换原 AppImage。
- 替换失败时恢复旧文件。

#### Linux deb

- deb 安装来源不执行自动文件替换。
- 检查到新版本后打开 GitHub Release 或对应手动下载地址。

## 10. Release 资产改造

### 10.1 移除外置 blockmap

修改 Release 资产模型：

- Windows 不再发布 `.exe.blockmap`。
- macOS 不再发布 `.zip.blockmap`。
- GitHub Actions Artifact 不再传递 `dist/*.blockmap`。
- 发布校验不再要求 `.exe`、`.zip` 旁边存在 blockmap。

继续校验：

- Tag 与版本一致。
- 平台和架构一致。
- 制品文件存在。
- 文件大小正确。
- 本地和远端 SHA-256 一致。
- 原生安装包中的应用版本正确。

### 10.2 Release 文件集合

为了兼容旧版 electron-updater，同时支持新 `version.json` 更新逻辑，以 `1.8.0` 为例发布：

```text
version.json

latest.yml
latest-mac.yml
latest-linux.yml
latest-linux-arm64.yml

MagicChat-1.8.0-win-x64.exe
MagicChat-1.8.0-win-arm64.exe

MagicChat-1.8.0-mac-universal.zip
MagicChat-1.8.0-mac-universal.dmg

MagicChat-1.8.0-linux-x86_64.AppImage
MagicChat-1.8.0-linux-arm64.AppImage
MagicChat-1.8.0-linux-amd64.deb
MagicChat-1.8.0-linux-arm64.deb
```

共 13 个文件，不包含任何独立 `.blockmap`。

`latest*.yml` 在桥接阶段继续保留，用于让旧客户端发现和下载已经内置 `version.json` 更新逻辑的新版本。新客户端的版本发现不依赖这些文件。

## 11. 人工发布与同步流程

### 11.1 发布 GitHub Release

1. 创建并推送 `desktop-v<major>.<minor>.<patch>` Annotated Tag。
2. GitHub Actions 完成跨平台构建。
3. Release 聚合阶段生成完整 `version.json`。
4. 桌面字段 URL 指向当前 GitHub Release 的完整安装包。
5. 发布 13 个 Release 文件。
6. 验证 Release 不包含 `.blockmap`。

### 11.2 GitHub 下载验证

1. 将验证用 `version.json` 部署到测试可访问位置，或在受控窗口发布到官网清单地址。
2. 使用桥接版客户端读取该 JSON。
3. 验证 Windows x64、macOS、Linux x64 和 Linux ARM64 的下载地址选择。
4. 验证完整包下载、进度、取消、失败重试和安装流程。
5. 确认网络请求中不存在 `.blockmap`。

### 11.3 同步官网完整安装包

从 GitHub Release 下载并上传：

```text
MagicChat-1.8.0-win-x64.exe
→ data/releases/jiying.exe

MagicChat-1.8.0-mac-universal.dmg
→ data/releases/jiying.dmg

MagicChat-1.8.0-linux-x86_64.AppImage
→ data/releases/jiying.amd.AppImage

MagicChat-1.8.0-linux-arm64.AppImage
→ data/releases/jiying.arm.AppImage
```

上传时使用临时文件名，完整上传并校验后再原子替换正式固定文件，避免客户端下载到半个安装包。

### 11.4 验证官网文件

覆盖 `version.json` 前验证：

- 四个固定 URL 返回 HTTP 200。
- `Content-Length` 与本地完整包一致。
- 服务器文件 SHA-256 与 GitHub Release 文件一致。
- Windows、Linux 架构对应关系正确。
- macOS DMG 签名和公证仍然有效。

### 11.5 最后发布官网 `version.json`

1. 基于 GitHub Release 中的 JSON 保留 `android`、`ios`。
2. 将四个桌面 URL 替换为官网固定 URL。
3. 不改变已经验证的桌面 `version` 和 `build`。
4. 将新 JSON 上传为临时文件。
5. 校验 JSON 格式和所有 URL。
6. 原子替换 `data/releases/version.json`。

必须先发布安装包、最后发布 `version.json`。否则客户端会先发现新版本，再下载到不存在或尚未上传完成的文件。

## 12. Caddy 缓存策略

`version.json` 和固定安装包文件会被覆盖，不能使用长期不可变缓存。

建议：

```text
/releases/version.json
Cache-Control: no-store, no-cache, must-revalidate
```

```text
/releases/jiying.exe
/releases/jiying.dmg
/releases/jiying.amd.AppImage
/releases/jiying.arm.AppImage
Cache-Control: no-cache
```

同时保留 `ETag`、`Last-Modified` 和 Range 请求能力。

## 13. 旧客户端桥接迁移

旧客户端仍然通过 `ptonlix/MagicChat` 的 GitHub Provider 和 `latest*.yml` 检查版本，因此不能只发布官网 `version.json`。

选择一个版本作为桥接版本，例如 `1.8.0`：

```text
1. 在 1.8.0 中实现 version.json 更新逻辑。
2. 1.8.0 Release 继续包含 latest*.yml。
3. 将 1.8.0 发布到 ptonlix/MagicChat。
4. 旧客户端从 GitHub 发现 1.8.0。
5. 外置 blockmap 不存在时，旧 electron-updater 回退下载完整包。
6. 安装 1.8.0 后，客户端改为读取官网 version.json。
7. 发布 1.8.1，用于验证官网 version.json 全量升级链路。
```

后续继续向 `ptonlix/MagicChat` 发布 `latest*.yml` 和完整包，可以保证长期未启动的旧客户端仍然拥有桥接入口。

## 14. 代码改动清单

| 文件或模块                                       | 计划改动                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `client-desktop/src/main/updater-service.ts`     | 从 GitHub Provider 版本发现切换为读取 `version.json`；实现平台选择、SemVer 比较、全量下载状态和安装协调 |
| `client-desktop/src/main/updater-eligibility.ts` | 保持 Stable、平台、架构和安装来源资格判断；补充 JSON 全量升级模式语义                                   |
| `client-desktop/src/shared/bridge.ts`            | 如现有状态不足，补充完整包下载、取消、打开安装器和错误码所需的 IPC 类型                                 |
| `client-desktop/electron-builder.yml`            | 保持 GitHub 发布元数据用于桥接兼容；不改成 `/releases/desktop` Generic Provider                         |
| `client-desktop/scripts/release-assets.mjs`      | 移除公开 blockmap；将 `version.json` 加入精确 Release 资产集合                                          |
| `client-desktop/scripts/release-tools.mjs`       | 取消外置 blockmap 强制校验；保留安装包和摘要校验                                                        |
| 新增桌面版本清单生成脚本                         | 合并基础清单、保留移动端字段、生成 GitHub Release 桌面 URL                                              |
| `.github/workflows/desktop-release.yml`          | 不传递 `.blockmap`；传入完整基础清单并生成 `version.json`                                               |
| `client-desktop/scripts/verify-package.mjs`      | 保留安装包真实性验证；增加最终更新清单与包的一致性验证                                                  |
| `homepage/Caddyfile`                             | 给 `version.json` 和固定安装包设置适合覆盖发布的缓存策略                                                |
| `client-desktop/docs/*`                          | 更新 Stable OTA、验收和恢复文档                                                                         |

## 15. 自动化测试计划

### 15.1 `version.json` 测试

- 正确读取现有完整 JSON 格式。
- 保留 `android`、`ios`。
- 缺失移动端字段时拒绝生成正式清单。
- 缺失目标桌面字段时返回可诊断错误。
- 非整数、负数或缺失 `build` 时拒绝。
- 非 Stable SemVer 时拒绝。
- 非 HTTPS URL 时拒绝。
- Windows x64、macOS、Linux x64、Linux ARM64 映射正确。
- Windows ARM64 不误用 x64 安装包。

### 15.2 版本判断测试

- 更高版本提示升级。
- 同版本不提示。
- 更低版本不降级。
- 非法版本不下载。
- 并发检查合并为一个请求。
- 超时、离线、HTTP 非 2xx 和 JSON 损坏进入可重试错误。

### 15.3 全量下载测试

- 下载直接使用 `url`，不请求 `.blockmap`。
- 进度单调递增。
- 重复点击不会重复下载。
- 取消后删除临时文件。
- 网络失败后删除不完整文件。
- 平台扩展名或架构不匹配时拒绝安装。
- 有活跃传输时阻止安装。

### 15.4 Release 测试

- 最终 Release 恰好包含约定的 13 个文件。
- Release、Actions Artifact 均不包含 `.blockmap`。
- `version.json` URL 与 Tag、版本化文件名一致。
- GitHub Release 发布目标仍为 `ptonlix/MagicChat`。
- 远端 Release 文件数量、大小和 SHA-256 一致。

## 16. 真机验收矩阵

| 场景                          | 预期结果                                          |
| ----------------------------- | ------------------------------------------------- |
| Windows x64 旧版 → 桥接版     | 从 GitHub `latest.yml` 发现并回退全量下载成功     |
| Windows x64 桥接版 → 下一版本 | 从官网 `version.json` 下载完整 EXE 并进入安装流程 |
| Windows ARM64                 | 不误下 x64 包；第一阶段提示手动升级               |
| macOS 桥接版 → 下一版本       | 下载完整 DMG，校验后打开安装器                    |
| Linux x64 AppImage            | 下载 x86_64 AppImage 并安全替换                   |
| Linux ARM64 AppImage          | 下载 ARM64 AppImage 并安全替换                    |
| Linux deb                     | 检查到新版本后转为手动升级                        |
| Android/iOS                   | 桌面发布后原有字段完全不变                        |
| GitHub URL 验证               | 四个桌面平台 URL 可匿名下载完整包                 |
| 官网 URL 验证                 | URL 切换后从官网正常下载完整包                    |
| 网络请求检查                  | 新 JSON 更新器不请求 `.blockmap`                  |

## 17. 上线顺序

1. 确认 Windows ARM64 第一阶段处理策略。
2. 新增完整 `version.json` 生成和校验脚本。
3. 修改 Release 资产模型，取消外置 `.blockmap`。
4. 保留 `latest*.yml` 兼容旧客户端。
5. 实现桌面端 `version.json` 读取、平台映射和版本比较。
6. 实现各平台完整包下载和安装协调。
7. 修改官网缓存策略。
8. 补齐自动化测试和发布文档。
9. 创建桥接版本。
10. 发布桥接版本到 `ptonlix/MagicChat`。
11. 使用 GitHub Release URL 完成真机升级验证。
12. 将完整安装包同步到官网固定文件名。
13. 验证官网安装包大小、摘要、签名和架构。
14. 最后将正式 `version.json` 发布到官网。
15. 发布下一版本，验证桥接版从官网完成全量升级。

## 18. 回滚方案

### 18.1 新 `version.json` 尚未发布

安装包或验证失败时，不覆盖官网 `version.json`，线上客户端不会发现新版本。

### 18.2 新 `version.json` 已发布但尚未安装

原子恢复上一份 `version.json`，停止更多客户端发现问题版本；同时保留服务器上的安装包用于调查。

### 18.3 问题版本已经安装

不允许自动降级。应发布更高 Patch 版本，例如从问题版本 `1.8.0` 修复到 `1.8.1`。

### 18.4 官网固定包错误

恢复上一版本固定安装包，然后恢复对应的 `version.json`。必须先恢复安装包、最后恢复清单。

## 19. 风险和待确认项

1. 现有 JSON 没有 `size` 和 `sha512`，完整性保护弱于当前 electron-updater 清单；建议后续兼容扩展。
2. Windows ARM64 没有独立字段，第一阶段不能安全自动更新。
3. macOS JSON 目前指向 DMG，因此第一阶段是下载并打开安装器，不是 ZIP 无交互自动替换。
4. 自定义下载和安装比切换 Generic Provider 改造范围更大，必须进行多平台真机验证。
5. `android`、`ios` 与桌面共用一个文件，发布流程必须防止移动端配置丢失。
6. 固定安装包文件会被覆盖，必须先原子替换包、最后原子替换清单。
7. 全量 OTA 会增加官网带宽，单次更新可能下载 150～300 MB。
8. 旧客户端迁移依赖桥接版本的 `latest*.yml`，不能立即删除兼容发布物。

## 20. 验收标准

满足以下条件后视为完成：

- 打包流程自动输出完整且格式正确的 `version.json`。
- `android`、`ios` 在桌面发布前后保持不变。
- GitHub Release 包含约定的 13 个文件且不包含 `.blockmap`。
- 新桌面客户端从官网 `version.json` 发现版本。
- 新桌面客户端按平台和架构选择正确字段。
- 新桌面客户端只下载完整安装包，不请求独立 `.blockmap`。
- Windows x64、macOS、Linux x64、Linux ARM64 完成约定的全量升级流程。
- Windows ARM64 不会误装 x64 包。
- 旧客户端能通过个人 GitHub Release 升级到桥接版本。
- 桥接版本能从官网 `version.json` 发现并升级到下一版本。
- GitHub URL 验证完成后，切换为官网 URL 无需重新构建客户端。
- 官网普通下载和桌面 OTA 使用相同的最新完整安装包。
- 发布失败时可以通过恢复安装包和 `version.json` 停止继续扩散。

## 21. 本次实施结果

已完成：

- 桌面主进程从官网根目录 `version.json` 检查 Stable 版本，不再使用 GitHub Provider 发现新版本。
- Windows x64、macOS Universal、Linux x64/ARM64 按现有字段映射下载完整包；Windows ARM64
  保持手动升级，不会误用 `windows` x64 URL。
- 下载支持单任务复用、超时、进度、取消、不完整文件清理、可选 `size/sha512` 校验和平台
  文件头/架构校验。
- Windows 启动完整 EXE，macOS 打开完整 DMG，Linux AppImage 在退出后以暂存和备份方式替换。
- 发布聚合自动生成保留 Android/iOS 的 GitHub URL 版 `version.json`。
- Release 精确资产集合改为 13 个文件，不上传任何外置 `.blockmap`，继续保留四个
  `latest*.yml` 作为旧客户端桥接入口。
- GitHub Actions 另外生成 `magicchat-website-release-<version>` artifact，内含可直接交给
  官网维护人员的 `jiying.exe`、`jiying.dmg`、两个 AppImage、官网 URL 版 `version.json`
  和 `SHA256SUMS.txt`。
- 官网 Caddy 对 `version.json` 使用 `no-store`，对固定安装包使用 `no-cache`，并允许任意
  客户 Web 域名跨域读取公开版本清单。

自动化验证结果：

- `pnpm check` 通过。
- 新增 OTA、清单生成、Release 资产和官网上传目录测试通过。
- 全量测试通过；新增的清单、下载、安装协调、Release 和官网上传目录用例均通过。
- `pnpm build`、`pnpm verify:build`、`pnpm verify:workflow` 通过。

仍需发布负责人执行：

1. 发布桥接版本 Tag，由 GitHub Actions 在各原生 Runner 上完成真实安装包构建。
2. 使用旧客户端验证通过 `latest*.yml` 回退全量下载到桥接版。
3. 使用桥接版和下一版本完成 Windows x64、macOS、Linux AppImage 跨版本真机升级。
4. 下载 Actions 中的官网上传 artifact，校验 `SHA256SUMS.txt`，先上传四个安装包，最后上传
   `version.json`。
