import { describe, expect, it, vi } from "vitest"

import {
  AdminSettingsRequestError,
  createOIDCProvider,
  deleteOIDCProvider,
  disableOIDCProvider,
  enableOIDCProvider,
  getInfoSettings,
  listOIDCProviders,
  moveOIDCProvider,
  updateOIDCProvider,
  updateInfoSettings,
  type OIDCProviderInput,
} from "@/lib/admin-settings"

describe("admin settings", () => {
  it("loads info settings through the admin API", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            app_name: "MyGod",
            organization_name: "长亭科技",
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        }
      )
    )

    const settings = await getInfoSettings(fetcher)

    expect(settings).toEqual({
      appName: "MyGod",
      organizationName: "长亭科技",
    })
    expect(fetcher).toHaveBeenCalledWith("/api/admin/settings/info", {
      credentials: "include",
      method: "GET",
    })
  })

  it("updates info settings through the admin API", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            app_name: "星环协作",
            organization_name: "长亭科技企业安全",
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        }
      )
    )

    const settings = await updateInfoSettings(
      {
        appName: " 星环协作 ",
        organizationName: " 长亭科技企业安全 ",
      },
      fetcher
    )

    expect(settings).toEqual({
      appName: "星环协作",
      organizationName: "长亭科技企业安全",
    })
    expect(fetcher).toHaveBeenCalledWith("/api/admin/settings/info", {
      body: JSON.stringify({
        app_name: "星环协作",
        organization_name: "长亭科技企业安全",
      }),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "PUT",
    })
  })

  it("throws the admin API error message when update fails", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "invalid_request",
            message: "App 名称不能为空",
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 400,
        }
      )
    )

    await expect(
      updateInfoSettings(
        {
          appName: "",
          organizationName: "长亭科技",
        },
        fetcher
      )
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: "App 名称不能为空",
      name: "AdminSettingsRequestError",
    } satisfies AdminSettingsRequestError)
  })

  it("lists OIDC providers through the admin API", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            providers: [
              {
                id: "provider-1",
                name: "企业 SSO",
                key: "company-sso",
                enabled: true,
                authorize_url: "https://sso.example.com/oauth/authorize",
                token_url: "https://sso.example.com/oauth/token",
                userinfo_url: "https://sso.example.com/oauth/userinfo",
                client_id: "client-id",
                client_secret: "client-secret",
                scopes: ["openid", "email", "profile"],
                email_field: "mail",
                phone_field: "mobile",
                name_field: "real_name",
                nickname_field: "nick",
                avatar_field: "picture",
                sort_order: 2,
              },
            ],
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        }
      )
    )

    const providers = await listOIDCProviders(fetcher)

    expect(providers).toEqual([
      {
        id: "provider-1",
        name: "企业 SSO",
        key: "company-sso",
        enabled: true,
        authorizeUrl: "https://sso.example.com/oauth/authorize",
        tokenUrl: "https://sso.example.com/oauth/token",
        userinfoUrl: "https://sso.example.com/oauth/userinfo",
        clientId: "client-id",
        clientSecret: "client-secret",
        scopes: ["openid", "email", "profile"],
        emailField: "mail",
        phoneField: "mobile",
        nameField: "real_name",
        nicknameField: "nick",
        avatarField: "picture",
        sortOrder: 2,
      },
    ])
    expect(fetcher).toHaveBeenCalledWith("/api/admin/oidc/providers", {
      credentials: "include",
      method: "GET",
    })
  })

  it("creates and updates OIDC providers with full client secret without hidden fields", async () => {
    const providerResponse = {
      id: "provider-1",
      name: "企业 SSO",
      key: "company-sso",
      enabled: true,
      authorize_url: "https://sso.example.com/oauth/authorize",
      token_url: "https://sso.example.com/oauth/token",
      userinfo_url: "https://sso.example.com/oauth/userinfo",
      client_id: "client-id",
      client_secret: "client-secret",
      scopes: ["openid", "email", "profile"],
      email_field: "mail",
      phone_field: "mobile",
      name_field: "real_name",
      nickname_field: "nick",
      avatar_field: "picture",
      sort_order: 2,
    }
    const fetcher = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              provider: providerResponse,
            },
          }),
          {
            headers: {
              "content-type": "application/json",
            },
            status: 200,
          }
        )
      )
    )
    const input = {
      name: " 企业 SSO ",
      authorizeUrl: " https://sso.example.com/oauth/authorize ",
      tokenUrl: " https://sso.example.com/oauth/token ",
      userinfoUrl: " https://sso.example.com/oauth/userinfo ",
      clientId: " client-id ",
      clientSecret: " client-secret ",
      scopes: ["email", "profile"],
      emailField: " mail ",
      phoneField: " mobile ",
      nameField: " real_name ",
      nicknameField: " nick ",
      avatarField: " picture ",
    } satisfies OIDCProviderInput

    await createOIDCProvider(input, fetcher)
    await updateOIDCProvider("provider-1", input, fetcher)

    const expectedBody = JSON.stringify({
      name: "企业 SSO",
      authorize_url: "https://sso.example.com/oauth/authorize",
      token_url: "https://sso.example.com/oauth/token",
      userinfo_url: "https://sso.example.com/oauth/userinfo",
      client_id: "client-id",
      client_secret: "client-secret",
      scopes: ["email", "profile"],
      email_field: "mail",
      phone_field: "mobile",
      name_field: "real_name",
      nickname_field: "nick",
      avatar_field: "picture",
    })
    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/admin/oidc/providers", {
      body: expectedBody,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    })
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/admin/oidc/providers/provider-1",
      {
        body: expectedBody,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        method: "PUT",
      }
    )
  })

  it("deletes OIDC providers through the admin API", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {},
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        }
      )
    )

    await deleteOIDCProvider("provider-1", fetcher)

    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/oidc/providers/provider-1",
      {
        credentials: "include",
        method: "DELETE",
      }
    )
  })

  it("enables and disables OIDC providers through operation endpoints", async () => {
    const providerResponse = {
      id: "provider-1",
      name: "企业 SSO",
      key: "company-sso",
      enabled: true,
      authorize_url: "https://sso.example.com/oauth/authorize",
      token_url: "https://sso.example.com/oauth/token",
      userinfo_url: "https://sso.example.com/oauth/userinfo",
      client_id: "client-id",
      client_secret: "client-secret",
      scopes: ["email", "profile"],
      email_field: "mail",
      name_field: "real_name",
      sort_order: 10,
    }
    const fetcher = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              provider: providerResponse,
            },
          }),
          {
            headers: {
              "content-type": "application/json",
            },
            status: 200,
          }
        )
      )
    )

    await enableOIDCProvider("provider-1", fetcher)
    await disableOIDCProvider("provider-1", fetcher)

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/admin/oidc/providers/provider-1/enable",
      {
        credentials: "include",
        method: "POST",
      }
    )
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/admin/oidc/providers/provider-1/disable",
      {
        credentials: "include",
        method: "POST",
      }
    )
  })

  it("moves OIDC providers and returns the reordered provider list", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            providers: [
              {
                id: "provider-2",
                name: "Beta",
                key: "beta",
                enabled: true,
                authorize_url: "https://beta.example.com/authorize",
                token_url: "https://beta.example.com/token",
                userinfo_url: "https://beta.example.com/userinfo",
                client_id: "beta-client",
                client_secret: "beta-secret",
                scopes: ["email"],
                email_field: "email",
                name_field: "name",
                sort_order: 10,
              },
            ],
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        }
      )
    )

    const providers = await moveOIDCProvider("provider-2", "up", fetcher)

    expect(providers.map((provider) => provider.id)).toEqual(["provider-2"])
    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/oidc/providers/provider-2/move",
      {
        body: JSON.stringify({
          direction: "up",
        }),
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      }
    )
  })
})
