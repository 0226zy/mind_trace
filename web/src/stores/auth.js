import { reactive } from 'vue'

const TOKEN_KEY = 'mind_trace_admin_token'

export const auth = reactive({
  token: localStorage.getItem(TOKEN_KEY) || '',
})

export function setToken(token) {
  auth.token = token
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  auth.token = ''
  localStorage.removeItem(TOKEN_KEY)
}
