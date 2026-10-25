import { auth, clearToken } from '../stores/auth'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(message, { status = 0, code = '' } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export async function request(path, options = {}) {
  const { body, headers: customHeaders, ...rest } = options
  const headers = { Accept: 'application/json', ...customHeaders }

  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`

  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('无法连接服务，请检查网络后重试')
  }

  let payload = null
  try {
    payload = await response.json()
  } catch {
    // 非 JSON 响应仍通过 HTTP 状态处理。
  }

  if (response.status === 401) {
    clearToken()
    if (window.location.pathname !== '/login') {
      const redirect = `${window.location.pathname}${window.location.search}`
      window.location.assign(`/login?redirect=${encodeURIComponent(redirect)}`)
    }
    throw new ApiError(payload?.error?.message || '登录已失效，请重新登录', { status: 401 })
  }

  if (!response.ok) {
    throw new ApiError(payload?.error?.message || `请求失败（${response.status}）`, {
      status: response.status,
      code: payload?.error?.code,
    })
  }

  return payload?.data
}
