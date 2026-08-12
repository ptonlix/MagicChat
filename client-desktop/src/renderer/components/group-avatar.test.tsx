import { render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GroupAvatar } from "@/components/group-avatar"
import { configureDesktopHost } from "@/lib/desktop-host"

describe("GroupAvatar", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("通过 Desktop 资源解析器加载成员头像", () => {
    const resolveResourceUrl = vi.fn((value: string) => `https://chat.chaitin.net${value}`)
    const restoreHost = configureDesktopHost({ resolveResourceUrl })

    try {
      const { container } = render(
        <GroupAvatar
          members={[
            {
              avatar: "/assets/avatars/builtin/01.webp",
              name: "Alice",
              nickname: "",
              role: "owner",
            },
          ]}
          name="测试群"
        />,
      )

      expect(container.querySelector("img")).toHaveAttribute(
        "src",
        "https://chat.chaitin.net/assets/avatars/builtin/01.webp",
      )
      expect(resolveResourceUrl).toHaveBeenCalledWith("/assets/avatars/builtin/01.webp")
    } finally {
      restoreHost()
    }
  })

  it("成员资料不可用时显示群聊图标而不是问号", () => {
    const { container } = render(
      <GroupAvatar
        members={[
          {
            avatar: "",
            name: "",
            nickname: "",
            role: "owner",
          },
        ]}
        name="测试群"
      />,
    )

    expect(container).not.toHaveTextContent("?")
    expect(container.querySelector("svg")).toBeInTheDocument()
  })
})
