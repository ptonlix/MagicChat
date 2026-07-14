import { describe, expect, it, vi } from "vitest"

import { getClientInfo } from "@/lib/app-info"

describe("client app info", () => {
  it("loads public app info from the client API", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            app_name: "星环协作",
            authenticated: true,
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

    const info = await getClientInfo(fetcher)

    expect(info).toEqual({
      appName: "星环协作",
      authenticated: true,
      organizationName: "长亭科技",
    })
    expect(fetcher).toHaveBeenCalledWith("/api/client/info", {
      credentials: "include",
      method: "GET",
    })
  })
})
