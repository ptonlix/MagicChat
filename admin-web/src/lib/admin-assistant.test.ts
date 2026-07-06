import { describe, expect, it, vi } from "vitest"

import {
  AdminAssistantRequestError,
  checkLLMModelHealth,
  createLLMModel,
  deleteLLMModel,
  discoverLLMModels,
  disableLLMModel,
  enableLLMModel,
  listLLMModels,
  moveLLMModel,
  updateLLMModel,
  type LLMModelInput,
} from "@/lib/admin-assistant"

describe("admin assistant", () => {
  it("lists LLM models through the admin API", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            models: [
              {
                id: "model-1",
                display_name: "Claude Sonnet",
                model_name: "claude-3-5-sonnet-latest",
                base_url: "https://api.anthropic.com",
                api_key: "sk-ant-test",
                protocol: "anthropic",
                enabled: true,
                sort_order: 10,
                connectivity_status: "connected",
                last_checked_at: "2026-07-06T11:30:00Z",
                last_connected_at: "2026-07-06T11:30:00Z",
                last_error_message: "",
                last_response_duration_ms: 1340,
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

    const models = await listLLMModels(fetcher)

    expect(models).toEqual([
      {
        id: "model-1",
        displayName: "Claude Sonnet",
        modelName: "claude-3-5-sonnet-latest",
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-ant-test",
        protocol: "anthropic",
        enabled: true,
        sortOrder: 10,
        connectivityStatus: "connected",
        lastCheckedAt: "2026-07-06T11:30:00Z",
        lastConnectedAt: "2026-07-06T11:30:00Z",
        lastErrorMessage: "",
        lastResponseDurationMs: 1340,
      },
    ])
    expect(fetcher).toHaveBeenCalledWith("/api/admin/assistant/models", {
      credentials: "include",
      method: "GET",
    })
  })

  it("discovers Anthropic LLM models with temporary credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            models: [
              {
                id: "claude-3-5-sonnet-latest",
                display_name: "Claude 3.5 Sonnet",
              },
              {
                id: "claude-3-haiku-20240307",
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

    const models = await discoverLLMModels(
      {
        apiKey: " sk-ant-test ",
        baseUrl: " https://api.anthropic.com/v1 ",
      },
      fetcher
    )

    expect(models).toEqual([
      {
        displayName: "Claude 3.5 Sonnet",
        id: "claude-3-5-sonnet-latest",
      },
      {
        displayName: "",
        id: "claude-3-haiku-20240307",
      },
    ])
    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/assistant/models/discover",
      {
        body: JSON.stringify({
          base_url: "https://api.anthropic.com/v1",
          api_key: "sk-ant-test",
        }),
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      }
    )
  })

  it("creates and updates LLM models with the full API key", async () => {
    const modelResponse = {
      id: "model-1",
      display_name: "Claude Sonnet",
      model_name: "claude-3-5-sonnet-latest",
      base_url: "https://api.anthropic.com",
      api_key: "sk-ant-test",
      protocol: "anthropic",
      enabled: true,
      sort_order: 10,
      connectivity_status: "unknown",
      last_checked_at: null,
      last_connected_at: null,
      last_error_message: "",
      last_response_duration_ms: null,
    }
    const fetcher = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              model: modelResponse,
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
      displayName: " Claude Sonnet ",
      modelName: " claude-3-5-sonnet-latest ",
      baseUrl: " https://api.anthropic.com ",
      apiKey: " sk-ant-test ",
    } satisfies LLMModelInput

    await createLLMModel(input, fetcher)
    await updateLLMModel("model-1", input, fetcher)

    const expectedBody = JSON.stringify({
      display_name: "Claude Sonnet",
      model_name: "claude-3-5-sonnet-latest",
      base_url: "https://api.anthropic.com",
      api_key: "sk-ant-test",
    })
    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/admin/assistant/models", {
      body: expectedBody,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    })
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/admin/assistant/models/model-1",
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

  it("updates status, order, health, and deletion through operation endpoints", async () => {
    const modelResponse = {
      id: "model-1",
      display_name: "Claude Sonnet",
      model_name: "claude-3-5-sonnet-latest",
      base_url: "https://api.anthropic.com",
      api_key: "sk-ant-test",
      protocol: "anthropic",
      enabled: true,
      sort_order: 10,
      connectivity_status: "connected",
      last_checked_at: "2026-07-06T11:30:00Z",
      last_connected_at: "2026-07-06T11:30:00Z",
      last_error_message: "",
      last_response_duration_ms: 1340,
    }
    const fetcher = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              model: modelResponse,
              models: [modelResponse],
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

    await enableLLMModel("model-1", fetcher)
    await disableLLMModel("model-1", fetcher)
    await moveLLMModel("model-1", "up", fetcher)
    await checkLLMModelHealth("model-1", fetcher)
    await deleteLLMModel("model-1", fetcher)

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/admin/assistant/models/model-1/enable",
      {
        credentials: "include",
        method: "POST",
      }
    )
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/admin/assistant/models/model-1/disable",
      {
        credentials: "include",
        method: "POST",
      }
    )
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "/api/admin/assistant/models/model-1/move",
      {
        body: JSON.stringify({ direction: "up" }),
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      }
    )
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      "/api/admin/assistant/models/model-1/health-check",
      {
        credentials: "include",
        method: "POST",
      }
    )
    expect(fetcher).toHaveBeenNthCalledWith(
      5,
      "/api/admin/assistant/models/model-1",
      {
        credentials: "include",
        method: "DELETE",
      }
    )
  })

  it("uses the health-check request duration when a connected model has no server duration", async () => {
    const dateNowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_340)
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            model: {
              id: "model-1",
              display_name: "Claude Sonnet",
              model_name: "claude-3-5-sonnet-latest",
              base_url: "https://api.anthropic.com",
              api_key: "sk-ant-test",
              protocol: "anthropic",
              enabled: true,
              sort_order: 10,
              connectivity_status: "connected",
              last_checked_at: "2026-07-06T11:30:00Z",
              last_connected_at: "2026-07-06T11:30:00Z",
              last_error_message: "",
              last_response_duration_ms: null,
            },
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

    const model = await checkLLMModelHealth("model-1", fetcher)

    expect(model.lastResponseDurationMs).toBe(1340)
    dateNowSpy.mockRestore()
  })

  it("throws the admin API error message when list fails", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "unauthorized",
            message: "未登录",
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 401,
        }
      )
    )

    await expect(listLLMModels(fetcher)).rejects.toMatchObject({
      code: "unauthorized",
      message: "未登录",
      name: "AdminAssistantRequestError",
    } satisfies AdminAssistantRequestError)
  })
})
