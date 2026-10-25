<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { clearToken } from '../stores/auth'

const router = useRouter()
const menuOpen = ref(false)

function logout() {
  clearToken()
  router.replace('/login')
}
</script>

<template>
  <div class="admin-shell">
    <button v-if="menuOpen" class="nav-backdrop" aria-label="关闭导航" @click="menuOpen = false" />
    <aside class="sidebar" :class="{ 'sidebar--open': menuOpen }">
      <RouterLink to="/overview" class="brand" @click="menuOpen = false">
        <span class="brand__mark" aria-hidden="true">止</span>
        <span><strong>止念</strong><small>运营管理</small></span>
      </RouterLink>
      <nav class="main-nav" aria-label="主导航">
        <RouterLink to="/overview" @click="menuOpen = false">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z" /></svg>
          运营概览
        </RouterLink>
        <RouterLink to="/users" @click="menuOpen = false">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 2.13a4 4 0 0 1 0 7.75" /></svg>
          用户管理
        </RouterLink>
      </nav>
      <div class="sidebar__footer">
        <span>让数据保持安静、清晰</span>
        <button @click="logout"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 17l5-5-5-5m5 5H3m10-9h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></svg>退出登录</button>
      </div>
    </aside>

    <div class="main-area">
      <header class="mobile-header">
        <button class="icon-button" aria-label="打开导航" @click="menuOpen = true"><svg viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h16" /></svg></button>
        <strong>止念 · 运营管理</strong>
        <button class="text-button" @click="logout">退出</button>
      </header>
      <main class="page-container"><RouterView /></main>
    </div>
  </div>
</template>
