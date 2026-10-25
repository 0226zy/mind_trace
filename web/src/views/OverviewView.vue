<script setup>
import { computed, onMounted, ref } from 'vue'
import { getOverview } from '../api/admin'
import StatCard from '../components/StatCard.vue'
import StateBlock from '../components/StateBlock.vue'
import TrendChart from '../components/TrendChart.vue'
import { formatNumber, shortDate } from '../utils/format'
import { metric, normalizeTrend, recordShare } from '../utils/overview'

const loading = ref(true)
const error = ref('')
const data = ref(null)
const updatedAt = ref('')

const cards = computed(() => [
  { label: '注册用户', value: formatNumber(metric(data.value, 'user')), hint: '累计注册用户', tone: 'blue' },
  { label: '思虑点', value: formatNumber(metric(data.value, 'thought')), hint: '仅统计数量', tone: 'sage' },
  { label: '登记记录', value: formatNumber(metric(data.value, 'record')), hint: '累计登记版本', tone: 'sand' },
  { label: '完成收尾', value: formatNumber(metric(data.value, 'closedRecord')), hint: '已完成七步收尾', tone: 'gray' },
])
const trend = computed(() => normalizeTrend(data.value).map((item, index) => ({ ...item, label: shortDate(item.label, index) })))
const share = computed(() => recordShare(data.value))
const donutStyle = computed(() => ({ background: `conic-gradient(#718da0 0 ${share.value.closedRate}%, #dce3e2 ${share.value.closedRate}% 100%)` }))

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await getOverview()
    updatedAt.value = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
  } catch (err) {
    error.value = err.message || '概览加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page-heading">
    <div><p class="eyebrow">OVERVIEW</p><h1>运营概览</h1><p>了解产品运行情况，只呈现必要的聚合指标。</p></div>
    <button class="button button--secondary button--small" :disabled="loading" @click="load">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7" /></svg>刷新数据
    </button>
  </div>

  <StateBlock v-if="loading && !data" type="loading" title="正在汇总数据" description="请稍候，很快就好。" />
  <StateBlock v-else-if="error && !data" type="error" title="概览暂时无法加载" :description="error" @retry="load" />
  <template v-else-if="data">
    <p v-if="error" class="inline-error" role="alert">{{ error }}，当前展示上次加载的数据。</p>
    <section class="stats-grid" aria-label="核心指标">
      <StatCard v-for="card in cards" :key="card.label" v-bind="card" />
    </section>

    <section class="overview-grid">
      <article class="panel trend-panel">
        <div class="panel__heading"><div><h2>登记趋势</h2><p>近期每日登记数量</p></div><span v-if="updatedAt" class="updated-time">{{ updatedAt }} 更新</span></div>
        <TrendChart v-if="trend.length" :items="trend" />
        <StateBlock v-else title="暂无趋势数据" description="服务端提供趋势数据后将在这里展示。" />
      </article>

      <article class="panel share-panel">
        <div class="panel__heading"><div><h2>收尾占比</h2><p>登记记录完成情况</p></div></div>
        <div v-if="share.records" class="share-content">
          <div class="donut" :style="donutStyle" role="img" :aria-label="`已收尾 ${share.closedRate}%，未收尾 ${share.openRate}%`">
            <div><strong>{{ share.closedRate }}<small>%</small></strong><span>已收尾</span></div>
          </div>
          <div class="legend">
            <div><span><i class="legend__dot legend__dot--closed" />已收尾</span><strong>{{ formatNumber(share.closed) }}</strong></div>
            <div><span><i class="legend__dot legend__dot--open" />未收尾</span><strong>{{ formatNumber(share.pending) }}</strong></div>
          </div>
        </div>
        <StateBlock v-else title="暂无登记记录" description="产生登记后，这里会展示收尾占比。" />
      </article>
    </section>
    <p class="privacy-note"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Zm-3-10 2 2 4-4" /></svg>本页面不收集、不展示用户思虑正文</p>
  </template>
</template>
