<script setup>
defineProps({
  type: { type: String, default: 'empty' },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
})
defineEmits(['retry'])
</script>

<template>
  <div class="state-block" :class="`state-block--${type}`" role="status">
    <span v-if="type === 'loading'" class="spinner" aria-hidden="true" />
    <svg v-else-if="type === 'error'" class="state-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6m0 4h.01" />
    </svg>
    <svg v-else class="state-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 4h14v16H5zM8 8h8M8 12h5M8 16h6" />
    </svg>
    <strong>{{ title || (type === 'loading' ? '正在加载' : type === 'error' ? '暂时无法加载' : '暂无数据') }}</strong>
    <p v-if="description">{{ description }}</p>
    <button v-if="type === 'error'" class="button button--secondary button--small" @click="$emit('retry')">重新加载</button>
  </div>
</template>
