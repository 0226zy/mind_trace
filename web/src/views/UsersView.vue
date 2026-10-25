<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { getUsers } from '../api/admin'
import StateBlock from '../components/StateBlock.vue'
import { formatDate, formatNumber } from '../utils/format'

const users = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const loading = ref(true)
const error = ref('')
let requestId = 0

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const rangeStart = computed(() => total.value ? (page.value - 1) * pageSize.value + 1 : 0)
const rangeEnd = computed(() => Math.min(page.value * pageSize.value, total.value))

async function load() {
  const currentRequest = ++requestId
  loading.value = true
  error.value = ''
  try {
    const data = await getUsers(page.value, pageSize.value)
    if (currentRequest !== requestId) return
    users.value = Array.isArray(data?.items) ? data.items : []
    total.value = Number(data?.total) || 0
  } catch (err) {
    if (currentRequest !== requestId) return
    error.value = err.message || '用户列表加载失败'
    users.value = []
  } finally {
    if (currentRequest === requestId) loading.value = false
  }
}

function goTo(nextPage) {
  if (nextPage < 1 || nextPage > totalPages.value || nextPage === page.value) return
  page.value = nextPage
}

watch(page, load)
watch(pageSize, () => {
  if (page.value !== 1) page.value = 1
  else load()
})
onMounted(load)
</script>

<template>
  <div class="page-heading">
    <div><p class="eyebrow">USERS</p><h1>用户管理</h1><p>查看账号与使用统计，不展示任何敏感思虑正文。</p></div>
    <span class="total-badge">共 {{ formatNumber(total) }} 位用户</span>
  </div>

  <section class="panel users-panel">
    <div class="table-toolbar">
      <div><h2>用户列表</h2><p>按注册时间查看用户信息</p></div>
      <label class="page-size">每页显示<select v-model.number="pageSize" :disabled="loading"><option :value="10">10 条</option><option :value="20">20 条</option><option :value="50">50 条</option></select></label>
    </div>

    <StateBlock v-if="loading" type="loading" title="正在加载用户列表" />
    <StateBlock v-else-if="error" type="error" title="用户列表暂时无法加载" :description="error" @retry="load" />
    <StateBlock v-else-if="!users.length" title="还没有用户" description="有用户注册后，账号信息会显示在这里。" />
    <template v-else>
      <div class="table-wrap">
        <table>
          <thead><tr><th>用户 ID</th><th>昵称</th><th>注册时间</th><th class="number-cell">思虑数</th><th class="number-cell">记录数</th></tr></thead>
          <tbody>
            <tr v-for="user in users" :key="user.id ?? user.userId">
              <td data-label="用户 ID"><span class="user-id" :title="String(user.id ?? user.userId)">{{ user.id ?? user.userId }}</span></td>
              <td data-label="昵称"><span class="nickname"><span class="avatar" aria-hidden="true">{{ (user.nickname || '未')[0] }}</span>{{ user.nickname || '未设置昵称' }}</span></td>
              <td data-label="注册时间">{{ formatDate(user.createdAt ?? user.registeredAt) }}</td>
              <td data-label="思虑数" class="number-cell">{{ formatNumber(user.thoughtCount) }}</td>
              <td data-label="记录数" class="number-cell">{{ formatNumber(user.recordCount) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span>显示 {{ rangeStart }}–{{ rangeEnd }} 条，共 {{ formatNumber(total) }} 条</span>
        <div>
          <button class="page-button" :disabled="page <= 1" aria-label="上一页" @click="goTo(page - 1)"><svg viewBox="0 0 24 24" fill="none"><path d="m15 18-6-6 6-6" /></svg></button>
          <span>第 {{ page }} / {{ totalPages }} 页</span>
          <button class="page-button" :disabled="page >= totalPages" aria-label="下一页" @click="goTo(page + 1)"><svg viewBox="0 0 24 24" fill="none"><path d="m9 18 6-6-6-6" /></svg></button>
        </div>
      </div>
    </template>
  </section>
</template>
