export type StaggeredRefreshController = {
  refreshNext: () => void
  stop: () => void
}

export function startStaggeredRefresh(
  tasks: ReadonlyArray<() => Promise<unknown> | unknown>,
  cycleMs: number
): StaggeredRefreshController {
  if (tasks.length === 0) {
    return { refreshNext: () => undefined, stop: () => undefined }
  }

  const stepMs = Math.max(1, Math.floor(cycleMs / tasks.length))
  const running = new Set<number>()
  let nextIndex = 0
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const runNext = () => {
    if (stopped) return
    const index = nextIndex
    nextIndex = (nextIndex + 1) % tasks.length
    if (running.has(index)) return
    running.add(index)
    void Promise.resolve(tasks[index]())
      .catch(() => undefined)
      .finally(() => running.delete(index))
  }

  const schedule = () => {
    timer = setTimeout(() => {
      runNext()
      schedule()
    }, stepMs)
  }
  schedule()

  return {
    refreshNext: runNext,
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = undefined
    },
  }
}
