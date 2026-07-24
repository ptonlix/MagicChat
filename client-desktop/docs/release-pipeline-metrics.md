# Desktop 发布流水线成本记录

## 结构基线

- 优化前：2 个 Job 定义，矩阵展开后每次发布执行 6 个 Job（5 个 package + 1 个 release）；平台无关的 `check`、完整测试、生产构建与 `verify:build` 在五个原生 Runner 各执行一次。
- 优化后：3 个 Job 定义，矩阵展开后每次发布执行 7 个 Job（1 个 quality + 5 个 package + 1 个 release）；平台无关门禁只执行一次，五个原生目标及各自 build、`verify:build`、打包和真实性校验保持不变。
- 确定性变化：完整测试次数由 5 降为 1，Lint、类型和边界检查次数由 5 降为 1；原生目标数仍为 5，发布前本地资产门禁和远端 Draft 复核均未减少。

## 实际运行记录

Runner 分钟和总耗时必须来自同仓库、相近缓存状态的两次成功 Actions 运行，不用静态估算代替。发布负责人从 GitHub Actions Job 页面记录每个 Job 的 `started_at`、`completed_at` 与 Runner 类型，并按下列字段附到发布验收记录：

```text
Tag:
Workflow run URL:
结构版本: 优化前 / 优化后
Job 执行数:
平台无关测试执行次数:
Windows x64 / arm64 分钟:
macOS Universal 分钟:
Linux x64 / arm64 分钟:
quality 分钟:
release 分钟:
Runner 分钟合计:
工作流总耗时:
```

成本结论只有在记录完整且五个原生目标、`verify:package`、`release:prepare-assets` 与 Draft 远端复核全部成功时才有效。
