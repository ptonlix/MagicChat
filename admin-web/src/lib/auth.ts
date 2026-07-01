export const AUTH_SESSION_KEY = "mygod.authenticated"

type AuthStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">

type AuthFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

type AdminLoginInput = {
  account: string
  password: string
}

type AdminUser = {
  email: string
}

type AdminLoginSuccessEnvelope = {
  data?: {
    admin?: AdminUser
  }
  success?: boolean
}

type AdminLoginErrorEnvelope = {
  error?: {
    code?: string
    message?: string
  }
  success?: boolean
}

export class AdminLoginRequestError extends Error {
  code?: string

  constructor(message: string, options?: { code?: string }) {
    super(message)
    this.name = "AdminLoginRequestError"
    this.code = options?.code
  }
}

function getBrowserStorage(): AuthStorage | null {
  if (typeof window === "undefined") {
    return null
  }

  return window.localStorage
}

export async function adminLogin(
  input: AdminLoginInput,
  fetcher: AuthFetch = fetch
) {
  const response = await fetcher("/api/admin/auth/login", {
    body: JSON.stringify({
      email: input.account.trim(),
      password: input.password,
    }),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  })
  const payload = await readJson<
    AdminLoginErrorEnvelope | AdminLoginSuccessEnvelope
  >(response)

  if (!response.ok || payload?.success === false) {
    const error = (payload as AdminLoginErrorEnvelope | undefined)?.error
    throw new AdminLoginRequestError(
      error?.message ?? `登录失败（HTTP ${response.status}）`,
      {
        code: error?.code,
      }
    )
  }

  const admin = (payload as AdminLoginSuccessEnvelope | undefined)?.data?.admin

  if (!admin?.email) {
    throw new AdminLoginRequestError("登录响应格式不正确")
  }

  return admin
}

export function isAuthenticated(
  storage: AuthStorage | null = getBrowserStorage()
) {
  return storage?.getItem(AUTH_SESSION_KEY) === "true"
}

export function setAuthSession(
  storage: AuthStorage | null = getBrowserStorage()
) {
  storage?.setItem(AUTH_SESSION_KEY, "true")
}

export function clearAuthSession(
  storage: AuthStorage | null = getBrowserStorage()
) {
  storage?.removeItem(AUTH_SESSION_KEY)
}

async function readJson<T>(response: Response): Promise<T | undefined> {
  const contentType = response.headers.get("content-type")

  if (!contentType?.includes("application/json")) {
    return undefined
  }

  return response.json() as Promise<T>
}
