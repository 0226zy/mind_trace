<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: [Number, String], default: '—' },
  hint: { type: String, default: '' },
  tone: { type: String, default: 'blue' },
})
</script>

<template>
  <article class="stat-card">
    <div class="stat-card__top">
      <span>{{ label }}</span>
      <span class="stat-card__dot" :class="`stat-card__dot--${tone}`" aria-hidden="true" />
    </div>
    <strong>{{ value }}</strong>
    <small>{{ hint }}</small>
  </article>
</template>
