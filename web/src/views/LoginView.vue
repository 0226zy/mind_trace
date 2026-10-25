<script setup>
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { login } from '../api/admin'
import { setToken } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const form = reactive({ username: '', password: '' })
const loading = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  if (!form.username.trim() || !form.password) {
    error.value = '请输入管理员账号和密码'
    return
  }
  loading.value = true
  try {
    const data = await login(form.username.trim(), form.password)
    if (!data?.token) throw new Error('登录响应中缺少 token')
    setToken(data.token)
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/overview'
    await router.replace(redirect)
  } catch (err) {
    error.value = err.message || '登录失败，请稍后重试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-intro">
      <div class="login-brand"><span class="brand__mark">止</span><span>止念</span></div>
      <div>
        <p class="eyebrow">MIND TRACE ADMIN</p>
        <h1>留一处安静，<br />看清运营全貌。</h1>
        <p>聚合必要的数据，不呈现用户的思虑正文。</p>
      </div>
      <small>克制、清晰、尊重隐私</small>
    </section>
    <section class="login-panel">
      <form class="login-card" @submit.prevent="submit">
        <div class="login-card__heading">
          <p class="eyebrow">WELCOME BACK</p>
          <h2>管理员登录</h2>
          <p>使用管理员账号进入运营后台</p>
        </div>
        <label class="field">
          <span>管理员账号</span>
          <input v-model="form.username" name="username" autocomplete="username" placeholder="请输入账号" :disabled="loading" />
        </label>
        <label class="field">
          <span>密码</span>
          <input v-model="form.password" name="password" type="password" autocomplete="current-password" placeholder="请输入密码" :disabled="loading" />
        </label>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button class="button button--primary login-submit" type="submit" :disabled="loading">
          <span v-if="loading" class="spinner spinner--light" aria-hidden="true" />
          {{ loading ? '正在登录…' : '登录' }}
        </button>
        <p class="login-note"><span aria-hidden="true">◦</span> 登录状态仅保存在当前浏览器</p>
      </form>
    </section>
  </main>
</template>
