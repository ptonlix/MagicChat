export type UpdateInstallLifecycleDependencies = {
  documentWindows: {
    requestCloseAll(): Promise<boolean>
  }
  messageCache: {
    close(): Promise<void>
    reopen(): Promise<void>
  }
  windows: {
    cancelPrepareToQuit(): void
    prepareToQuit(): void
  }
}

export async function prepareUpdateInstall(
  deps: UpdateInstallLifecycleDependencies,
): Promise<() => void> {
  deps.windows.prepareToQuit()
  try {
    if (!(await deps.documentWindows.requestCloseAll()))
      throw new Error("存在未同步文档，已取消安装")
    await deps.messageCache.close()
  } catch (error) {
    deps.windows.cancelPrepareToQuit()
    await deps.messageCache.reopen().catch(() => undefined)
    throw error
  }
  return () => {
    deps.windows.cancelPrepareToQuit()
    void deps.messageCache.reopen().catch(() => undefined)
  }
}
