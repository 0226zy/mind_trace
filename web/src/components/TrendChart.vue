<script setup>
import { computed } from 'vue'

const props = defineProps({ items: { type: Array, default: () => [] } })

const chart = computed(() => {
  const values = props.items.map((item) => Number(item.value) || 0)
  if (!values.length) return { line: '', area: '', points: [], max: 0 }
  const width = 640
  const height = 170
  const left = 16
  const top = 18
  const max = Math.max(...values, 1)
  const step = values.length > 1 ? (width - left * 2) / (values.length - 1) : 0
  const points = values.map((value, index) => ({
    x: values.length === 1 ? width / 2 : left + index * step,
    y: top + height - (value / max) * height,
    value,
    label: props.items[index].label,
  }))
  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  return { line, area: `${left},${top + height} ${line} ${width - left},${top + height}`, points, max }
})
</script>

<template>
  <div v-if="items.length" class="trend-chart">
    <div class="trend-chart__scale"><span>{{ chart.max }}</span><span>0</span></div>
    <svg viewBox="0 0 640 220" role="img" aria-label="近期登记数量趋势图" preserveAspectRatio="none">
      <line x1="16" y1="18" x2="624" y2="18" class="chart-grid" />
      <line x1="16" y1="103" x2="624" y2="103" class="chart-grid" />
      <line x1="16" y1="188" x2="624" y2="188" class="chart-grid" />
      <polygon :points="chart.area" class="chart-area" />
      <polyline :points="chart.line" class="chart-line" />
      <g v-for="point in chart.points" :key="`${point.label}-${point.x}`">
        <circle :cx="point.x" :cy="point.y" r="4" class="chart-point"><title>{{ point.label }}：{{ point.value }}</title></circle>
      </g>
    </svg>
    <div class="trend-chart__labels">
      <span>{{ items[0]?.label }}</span>
      <span v-if="items.length > 2">{{ items[Math.floor((items.length - 1) / 2)]?.label }}</span>
      <span v-if="items.length > 1">{{ items[items.length - 1]?.label }}</span>
    </div>
  </div>
</template>
