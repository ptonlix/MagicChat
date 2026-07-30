export type UpdateInstallLifecycleDependencies = {
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
