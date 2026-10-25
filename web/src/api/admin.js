import { request } from './request'

export function login(username, password) {
  return request('/admin/login', { method: 'POST', body: { username, password } })
}

export function getOverview() {
  return request('/admin/overview')
}

export function getUsers(page, pageSize = 10) {
  return request(`/admin/users?page=${page}&pageSize=${pageSize}`)
}
