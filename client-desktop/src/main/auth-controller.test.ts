import { describe, expect, it } from "vitest"

import {
  buildWebAuthStartUrl,
  isAllowedAuthNavigation,
  isAuthCompletionUrl,
} from "@main/auth-controller"

describe("Desktop 内嵌第三方认证", () => {
  it("使用现有 Web Auth 接口发起登录", () => {
    expect(
      buildWebAuthStartUrl(
        { normalizedUrl: "https://chat.chaitin.net" },
        "oidc"
      )
    ).toBe(
      "https://chat.chaitin.net/api/client/auth/third-party/oidc/start?redirect=/init"
    )
  })

  it("识别当前服务返回的登录完成页面", () => {
    expect(
      isAuthCompletionUrl(
        "https://chat.chaitin.net/init",
        "https://chat.chaitin.net"
      )
    ).toBe(true)
    expect(
      isAuthCompletionUrl(
        "https://attacker.example/init",
        "https://chat.chaitin.net"
      )
    ).toBe(false)
  })

  it("允许 HTTPS 认证链并拒绝外部 HTTP 和本地文件", () => {
    expect(
      isAllowedAuthNavigation(
        "https://id.chaitin.net/authorize",
        "https://chat.chaitin.net"
      )
    ).toBe(true)
    expect(
      isAllowedAuthNavigation(
        "http://attacker.example/authorize",
        "https://chat.chaitin.net"
      )
    ).toBe(false)
    expect(
      isAllowedAuthNavigation(
        "file:///tmp/credentials",
        "https://chat.chaitin.net"
      )
    ).toBe(false)
  })

  it("允许本地开发服务使用 HTTP", () => {
    expect(
      isAllowedAuthNavigation(
        "http://localhost:8080/api/client/auth/third-party/oidc/callback",
        "http://localhost:8080"
      )
    ).toBe(true)
  })
})
