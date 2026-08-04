import { describe, expect, it, vi } from "vitest"

import { DocumentTitleController, limitDocumentTitle } from "./document-title-controller"

describe("DocumentTitleController", () => {
  it("按 Unicode 码点限制标题为 500 个字符", () => {
    expect(limitDocumentTitle("😀".repeat(500))).toBe("😀".repeat(500))
    expect(limitDocumentTitle(`${"😀".repeat(500)}尾`)).toBe("😀".repeat(500))
  })

  it("600ms 防抖并规范化空标题", async () => {
    vi.useFakeTimers()
    const save = vi.fn(async (title: string) => title)
    const controller = new DocumentTitleController("标题", save)
    controller.change("   ")
    await vi.advanceTimersByTimeAsync(599)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledWith("无标题文档")
    vi.useRealTimers()
  })

  it("保存中输入会单飞追赶", async () => {
    let release: ((value: string) => void) | undefined
    const save = vi.fn(
      (_title: string) =>
        new Promise<string>((resolve) => {
          release = resolve
        }),
    )
    const controller = new DocumentTitleController("初始", save)
    controller.change("第一版")
    const first = controller.flush()
    controller.change("第二版")
    await controller.flush()
    release?.("第一版")
    await first
    expect(save).toHaveBeenCalledTimes(2)
  })

  it("销毁后不再发起追赶保存", async () => {
    let release: ((value: string) => void) | undefined
    const save = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve
        }),
    )
    const controller = new DocumentTitleController("初始", save)
    controller.change("第一版")
    const first = controller.flush()
    controller.change("第二版")

    controller.destroy()
    release?.("第一版")
    await first

    expect(save).toHaveBeenCalledTimes(1)
  })

  it("dirty 时不覆盖远端标题，干净时直接采用且不保存", () => {
    const save = vi.fn(async (title: string) => title)
    const controller = new DocumentTitleController("初始", save)
    controller.change("本地")
    controller.receiveRemote("远端")
    expect(controller.value.input).toBe("本地")
    controller.discardLocal()
    expect(controller.value.input).toBe("远端")
    expect(save).not.toHaveBeenCalled()
  })

  it("保存中收到更新后的远端标题时采用远端权威值", async () => {
    let release: ((value: string) => void) | undefined
    const save = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve
        }),
    )
    const controller = new DocumentTitleController("初始", save)
    controller.change("本地")
    const pending = controller.flush()

    controller.receiveRemote("远端")
    release?.("本地")
    await pending

    expect(controller.value).toEqual({
      authoritativeTitle: "远端",
      input: "远端",
      state: "saved",
    })
    expect(save).toHaveBeenCalledOnce()
  })

  it("保存中继续输入时保留新输入，并以远端标题为追赶基线", async () => {
    const releases: Array<(value: string) => void> = []
    const save = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          releases.push(resolve)
        }),
    )
    const controller = new DocumentTitleController("初始", save)
    controller.change("第一版")
    const first = controller.flush()
    controller.change("第二版")
    controller.receiveRemote("远端")

    releases[0]?.("第一版")
    await first
    expect(controller.value).toEqual({
      authoritativeTitle: "远端",
      input: "第二版",
      state: "saving",
    })
    expect(save).toHaveBeenNthCalledWith(2, "第二版")

    releases[1]?.("第二版")
    await vi.waitFor(() => expect(controller.value.state).toBe("saved"))
    expect(controller.value.input).toBe("第二版")
  })
})
