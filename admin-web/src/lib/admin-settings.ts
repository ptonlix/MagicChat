import { adminFetch } from "@/lib/auth"

type AdminSettingsFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

type AdminSettingsSuccessEnvelope<T> = {
  data?: T
  success?: boolean
}

type AdminSettingsErrorEnvelope = {
  error?: {
    code?: string
    message?: string
  }
  success?: boolean
}

type InfoSettingsResponse = {
  app_name?: string
  organization_name?: string
}

type OIDCProviderResponse = {
  avatar_field?: string
  authorize_url?: string
  client_id?: string
  client_secret?: string
  email_field?: string
  enabled?: boolean
  id?: string
  key?: string
  name?: string
  name_field?: string
  nickname_field?: string
  phone_field?: string
  scopes?: string[]
  sort_order?: number
  token_url?: string
  userinfo_url?: string
}

export type InfoSettings = {
  appName: string
  organizationName: string
}

export type OIDCProvider = {
  avatarField: string
  authorizeUrl: string
  clientId: string
  clientSecret: string
  emailField: string
  enabled: boolean
  id: string
  key: string
  name: string
  nameField: string
  nicknameField: string
  phoneField: string
  scopes: string[]
  sortOrder: number
  tokenUrl: string
  userinfoUrl: string
}

export type UpdateInfoSettingsInput = {
  appName: string
  organizationName: string
}

export type OIDCProviderInput = Omit<
  OIDCProvider,
  "enabled" | "id" | "key" | "sortOrder"
>
export type OIDCProviderMoveDirection = "down" | "up"

export class AdminSettingsRequestError extends Error {
  code?: string

  constructor(message: string, options?: { code?: string }) {
    super(message)
    this.name = "AdminSettingsRequestError"
    this.code = options?.code
  }
}

export async function getInfoSettings(
  fetcher: AdminSettingsFetch = adminFetch
) {
  const response = await fetcher("/api/admin/settings/info", {
    credentials: "include",
    method: "GET",
  })
  const payload = await readJson<
    | AdminSettingsErrorEnvelope
    | AdminSettingsSuccessEnvelope<InfoSettingsResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "加载系统设置失败")
  }

  const data = (
    payload as AdminSettingsSuccessEnvelope<InfoSettingsResponse> | undefined
  )?.data

  return normalizeInfoSettings(data)
}

export async function updateInfoSettings(
  input: UpdateInfoSettingsInput,
  fetcher: AdminSettingsFetch = adminFetch
) {
  const response = await fetcher("/api/admin/settings/info", {
    body: JSON.stringify({
      app_name: input.appName.trim(),
      organization_name: input.organizationName.trim(),
    }),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "PUT",
  })
  const payload = await readJson<
    | AdminSettingsErrorEnvelope
    | AdminSettingsSuccessEnvelope<InfoSettingsResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "保存系统设置失败")
  }

  const data = (
    payload as AdminSettingsSuccessEnvelope<InfoSettingsResponse> | undefined
  )?.data

  return normalizeInfoSettings(data)
}

export async function listOIDCProviders(
  fetcher: AdminSettingsFetch = adminFetch
) {
  const response = await fetcher("/api/admin/oidc/providers", {
    credentials: "include",
    method: "GET",
  })
  const payload = await readJson<
    | AdminSettingsErrorEnvelope
    | AdminSettingsSuccessEnvelope<{ providers?: OIDCProviderResponse[] }>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "加载 OIDC 登录方式失败")
  }

  const providers = (
    payload as
      | AdminSettingsSuccessEnvelope<{ providers?: OIDCProviderResponse[] }>
      | undefined
  )?.data?.providers

  return normalizeOIDCProviderList(providers)
}

export async function createOIDCProvider(
  input: OIDCProviderInput,
  fetcher: AdminSettingsFetch = adminFetch
) {
  return saveOIDCProvider("/api/admin/oidc/providers", "POST", input, fetcher)
}

export async function updateOIDCProvider(
  id: string,
  input: OIDCProviderInput,
  fetcher: AdminSettingsFetch = adminFetch
) {
  return saveOIDCProvider(
    `/api/admin/oidc/providers/${encodeURIComponent(id)}`,
    "PUT",
    input,
    fetcher
  )
}

export async function deleteOIDCProvider(
  id: string,
  fetcher: AdminSettingsFetch = adminFetch
) {
  const response = await fetcher(
    `/api/admin/oidc/providers/${encodeURIComponent(id)}`,
    {
      credentials: "include",
      method: "DELETE",
    }
  )
  const payload = await readJson<
    | AdminSettingsErrorEnvelope
    | AdminSettingsSuccessEnvelope<Record<string, never>>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "删除 OIDC 登录方式失败")
  }
}

export async function enableOIDCProvider(
  id: string,
  fetcher: AdminSettingsFetch = adminFetch
) {
  return updateOIDCProviderStatus(id, "enable", fetcher)
}

export async function disableOIDCProvider(
  id: string,
  fetcher: AdminSettingsFetch = adminFetch
) {
  return updateOIDCProviderStatus(id, "disable", fetcher)
}

export async function moveOIDCProvider(
  id: string,
  direction: OIDCProviderMoveDirection,
  fetcher: AdminSettingsFetch = adminFetch
) {
  const response = await fetcher(
    `/api/admin/oidc/providers/${encodeURIComponent(id)}/move`,
    {
      body: JSON.stringify({
        direction,
      }),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }
  )
  const payload = await readJson<
    | AdminSettingsErrorEnvelope
    | AdminSettingsSuccessEnvelope<{ providers?: OIDCProviderResponse[] }>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "移动 OIDC 登录方式失败")
  }

  const providers = (
    payload as
      | AdminSettingsSuccessEnvelope<{ providers?: OIDCProviderResponse[] }>
      | undefined
  )?.data?.providers

  return normalizeOIDCProviderList(providers)
}

async function saveOIDCProvider(
  path: string,
  method: "POST" | "PUT",
  input: OIDCProviderInput,
  fetcher: AdminSettingsFetch
) {
  const response = await fetcher(path, {
    body: JSON.stringify(toOIDCProviderRequest(input)),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method,
  })
  const payload = await readJson<
    | AdminSettingsErrorEnvelope
    | AdminSettingsSuccessEnvelope<{ provider?: OIDCProviderResponse }>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "保存 OIDC 登录方式失败")
  }

  const provider = (
    payload as
      | AdminSettingsSuccessEnvelope<{ provider?: OIDCProviderResponse }>
      | undefined
  )?.data?.provider

  return normalizeOIDCProvider(provider)
}

async function updateOIDCProviderStatus(
  id: string,
  action: "disable" | "enable",
  fetcher: AdminSettingsFetch
) {
  const response = await fetcher(
    `/api/admin/oidc/providers/${encodeURIComponent(id)}/${action}`,
    {
      credentials: "include",
      method: "POST",
    }
  )
  const payload = await readJson<
    | AdminSettingsErrorEnvelope
    | AdminSettingsSuccessEnvelope<{ provider?: OIDCProviderResponse }>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "更新 OIDC 登录方式状态失败")
  }

  const provider = (
    payload as
      | AdminSettingsSuccessEnvelope<{ provider?: OIDCProviderResponse }>
      | undefined
  )?.data?.provider

  return normalizeOIDCProvider(provider)
}

function createRequestError(
  payload:
    | AdminSettingsErrorEnvelope
    | AdminSettingsSuccessEnvelope<unknown>
    | undefined,
  response: Response,
  fallbackMessage: string
) {
  const error = (payload as AdminSettingsErrorEnvelope | undefined)?.error

  return new AdminSettingsRequestError(
    error?.message ?? `${fallbackMessage}（HTTP ${response.status}）`,
    {
      code: error?.code,
    }
  )
}

function normalizeInfoSettings(
  settings: InfoSettingsResponse | undefined
): InfoSettings {
  if (!settings?.app_name || !settings.organization_name) {
    throw new AdminSettingsRequestError("系统设置响应格式不正确")
  }

  return {
    appName: settings.app_name,
    organizationName: settings.organization_name,
  }
}

function normalizeOIDCProviderList(
  providers: OIDCProviderResponse[] | undefined
) {
  if (!Array.isArray(providers)) {
    throw new AdminSettingsRequestError("OIDC 登录方式响应格式不正确")
  }

  return providers.map(normalizeOIDCProvider)
}

function normalizeOIDCProvider(
  provider: OIDCProviderResponse | undefined
): OIDCProvider {
  if (
    !provider?.id ||
    !provider.name ||
    !provider.key ||
    typeof provider.enabled !== "boolean" ||
    !provider.authorize_url ||
    !provider.token_url ||
    !provider.userinfo_url ||
    !provider.client_id ||
    !provider.client_secret ||
    !Array.isArray(provider.scopes) ||
    !provider.email_field ||
    !provider.name_field ||
    typeof provider.sort_order !== "number"
  ) {
    throw new AdminSettingsRequestError("OIDC 登录方式响应格式不正确")
  }

  return {
    avatarField: provider.avatar_field ?? "",
    authorizeUrl: provider.authorize_url,
    clientId: provider.client_id,
    clientSecret: provider.client_secret,
    emailField: provider.email_field,
    enabled: provider.enabled,
    id: provider.id,
    key: provider.key,
    name: provider.name,
    nameField: provider.name_field,
    nicknameField: provider.nickname_field ?? "",
    phoneField: provider.phone_field ?? "",
    scopes: provider.scopes,
    sortOrder: provider.sort_order,
    tokenUrl: provider.token_url,
    userinfoUrl: provider.userinfo_url,
  }
}

function toOIDCProviderRequest(input: OIDCProviderInput) {
  return {
    name: input.name.trim(),
    authorize_url: input.authorizeUrl.trim(),
    token_url: input.tokenUrl.trim(),
    userinfo_url: input.userinfoUrl.trim(),
    client_id: input.clientId.trim(),
    client_secret: input.clientSecret.trim(),
    scopes: input.scopes.map((scope) => scope.trim()).filter(Boolean),
    email_field: input.emailField.trim(),
    phone_field: input.phoneField.trim(),
    name_field: input.nameField.trim(),
    nickname_field: input.nicknameField.trim(),
    avatar_field: input.avatarField.trim(),
  }
}

async function readJson<T>(response: Response): Promise<T | undefined> {
  const contentType = response.headers.get("content-type")

  if (!contentType?.includes("application/json")) {
    return undefined
  }

  return response.json() as Promise<T>
}
