<template>
  <div class="bi-page">
    <div class="bi-head">
      <h2 class="bi-title">数据看板</h2>
      <div class="bi-actions">
        <el-button :loading="loading" @click="loadAll">刷新</el-button>
        <el-button type="primary" :loading="aggregating" @click="onAggregate">立即聚合</el-button>
      </div>
    </div>

    <el-row :gutter="12" class="bi-stats">
      <el-col v-for="s in assetStats" :key="s.label" :xs="12" :sm="8" :md="4">
        <el-card shadow="never" class="stat-card">
          <div class="stat-label">{{ s.label }}</div>
          <div class="stat-value tabular-nums">{{ s.value }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="bi-block">
      <template #header>今日核心指标</template>
      <el-row :gutter="12">
        <el-col v-for="m in todayKeyMetrics" :key="m.key" :xs="12" :sm="8" :md="4">
          <div class="metric">
            <div class="metric-label">{{ m.label }}</div>
            <div class="metric-value tabular-nums">{{ m.display }}</div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <el-card shadow="never" class="bi-block">
      <template #header>
        <div class="model-head">
          <span>重排模型（反馈闭环）</span>
          <el-button size="small" type="primary" :loading="training" @click="onTrain">训练模型</el-button>
        </div>
      </template>
      <div v-if="activeModel" class="model-active">
        <el-tag type="success" size="small">激活 v{{ activeModel.version }}</el-tag>
        <span class="model-meta">算法 {{ activeModel.algorithm }}</span>
        <span class="model-meta">AUC {{ Number(activeModel.auc || 0).toFixed(3) }}</span>
        <span class="model-meta">样本 {{ activeModel.sampleCount }}</span>
        <span class="model-meta">特征 {{ (activeModel.features || []).join(' / ') }}</span>
      </div>
      <el-empty v-else description="暂无激活模型，积累≥30条商品曝光样本后点击「训练模型」" :image-size="60" />
      <el-table v-if="models.length" :data="models" size="small" border class="model-table">
        <el-table-column prop="version" label="版本" min-width="70" />
        <el-table-column prop="algorithm" label="算法" min-width="80" />
        <el-table-column prop="auc" label="AUC" min-width="80" />
        <el-table-column prop="sampleCount" label="样本数" min-width="80" />
        <el-table-column label="状态" min-width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">{{ row.status === 1 ? '激活' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="trainedAt" label="训练时间" min-width="160" />
      </el-table>
    </el-card>

    <el-card shadow="never" class="bi-block">
      <template #header>近 7 日趋势</template>
      <el-table :data="trendRows" size="small" border empty-text="暂无指标数据，点击「立即聚合」生成">
        <el-table-column prop="date" label="日期" min-width="110" />
        <el-table-column prop="dau" label="DAU" min-width="70" />
        <el-table-column prop="event_count" label="事件量" min-width="80" />
        <el-table-column prop="recommend_exposure" label="推荐曝光" min-width="90" />
        <el-table-column prop="recommend_click" label="推荐点击" min-width="90" />
        <el-table-column prop="ctr" label="推荐CTR" min-width="90" />
        <el-table-column prop="ai_adoption" label="AI采纳率" min-width="90" />
      </el-table>
    </el-card>

    <el-card shadow="never" class="bi-block">
      <template #header>热门商品 Top 10</template>
      <el-table :data="overview.topProducts || []" size="small" border empty-text="暂无商品统计">
        <el-table-column prop="productId" label="商品ID" min-width="120" />
        <el-table-column prop="exposureCnt" label="曝光" min-width="80" />
        <el-table-column prop="clickCnt" label="点击" min-width="80" />
        <el-table-column label="CTR" min-width="140">
          <template #default="{ row }">
            <el-progress :percentage="pct(row.ctr)" :stroke-width="10" />
          </template>
        </el-table-column>
        <el-table-column prop="orderCnt" label="下单" min-width="70" />
        <el-table-column prop="hotScore" label="热度" min-width="80" />
      </el-table>
    </el-card>

    <el-card shadow="never" class="bi-block">
      <el-tabs v-model="tab" @tab-change="onTabChange">
        <el-tab-pane label="商品统计" name="products" />
        <el-tab-pane label="用户画像" name="profiles" />
        <el-tab-pane label="原始事件" name="events" />
      </el-tabs>
      <el-table v-loading="tableLoading" :data="tableRows" size="small" border empty-text="暂无数据">
        <el-table-column v-for="col in tableCols" :key="col.prop" :prop="col.prop" :label="col.label" min-width="110" show-overflow-tooltip />
      </el-table>
      <el-pagination
        class="bi-pager"
        layout="prev, pager, next, total"
        :total="tableTotal"
        :page-size="pageSize"
        :current-page="pageNum"
        @current-change="onPage"
      />
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getBiOverview, getBiMetrics, getBiProducts, getBiProfiles, getBiEvents, triggerAggregate,
  getModels, trainModel,
} from '@/api/bi'

const loading = ref(false)
const aggregating = ref(false)
const training = ref(false)
const overview = ref({})
const metrics = ref([])
const models = ref([])
const activeModel = computed(() => models.value.find((m) => m.status === 1) || null)

const tab = ref('products')
const tableLoading = ref(false)
const tableRows = ref([])
const tableTotal = ref(0)
const pageNum = ref(1)
const pageSize = 10

const assetStats = computed(() => [
  { label: '原始事件', value: overview.value.eventCount ?? 0 },
  { label: '行为明细', value: overview.value.behaviorCount ?? 0 },
  { label: '用户画像', value: overview.value.profileCount ?? 0 },
  { label: '商品统计', value: overview.value.productCount ?? 0 },
  { label: '反馈样本', value: overview.value.sampleCount ?? 0 },
])

const METRIC_LABELS = {
  dau: '活跃用户',
  recommend_exposure: '推荐曝光',
  recommend_click: '推荐点击',
  recommend_ctr: '推荐CTR',
  ai_adoption_rate: 'AI采纳率',
  search_count: '搜索次数',
}
const RATE_KEYS = new Set(['recommend_ctr', 'ai_adoption_rate'])

function metricValue(key) {
  const found = (overview.value.todayMetrics || []).find((m) => m.metricKey === key)
  return found ? Number(found.metricValue || 0) : 0
}

const todayKeyMetrics = computed(() =>
  Object.keys(METRIC_LABELS).map((key) => {
    const v = metricValue(key)
    return {
      key,
      label: METRIC_LABELS[key],
      display: RATE_KEYS.has(key) ? `${(v * 100).toFixed(1)}%` : String(Math.round(v)),
    }
  }),
)

const trendRows = computed(() => {
  const byDate = {}
  for (const m of metrics.value) {
    const d = m.statDate
    if (!byDate[d]) byDate[d] = { date: d }
    byDate[d][m.metricKey] = m.metricValue
  }
  return Object.values(byDate)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((r) => ({
      date: r.date,
      dau: Math.round(r.dau || 0),
      event_count: Math.round(r.event_count || 0),
      recommend_exposure: Math.round(r.recommend_exposure || 0),
      recommend_click: Math.round(r.recommend_click || 0),
      ctr: `${((r.recommend_ctr || 0) * 100).toFixed(1)}%`,
      ai_adoption: `${((r.ai_adoption_rate || 0) * 100).toFixed(1)}%`,
    }))
})

const COLS = {
  products: [
    { prop: 'productId', label: '商品ID' },
    { prop: 'exposureCnt', label: '曝光' },
    { prop: 'clickCnt', label: '点击' },
    { prop: 'ctr', label: 'CTR' },
    { prop: 'orderCnt', label: '下单' },
    { prop: 'reviewCnt', label: '评价' },
    { prop: 'hotScore', label: '热度' },
  ],
  profiles: [
    { prop: 'userId', label: '用户ID' },
    { prop: 'ownSpecies', label: '饲养物种' },
    { prop: 'activityLevel', label: '活跃度' },
    { prop: 'consumptionLevel', label: '消费力' },
    { prop: 'exposureCnt', label: '曝光' },
    { prop: 'clickCnt', label: '点击' },
    { prop: 'ctr', label: 'CTR' },
  ],
  events: [
    { prop: 'eventId', label: '事件ID' },
    { prop: 'source', label: '来源' },
    { prop: 'eventType', label: '类型' },
    { prop: 'userId', label: '用户ID' },
    { prop: 'targetType', label: '目标类型' },
    { prop: 'targetId', label: '目标ID' },
    { prop: 'scene', label: '场景' },
    { prop: 'eventTime', label: '时间' },
  ],
}
const tableCols = computed(() => COLS[tab.value] || COLS.products)

function pct(v) {
  return Math.max(0, Math.min(100, Math.round(Number(v || 0) * 100)))
}

async function loadAll() {
  loading.value = true
  try {
    const [ov, mt, md] = await Promise.all([getBiOverview(), getBiMetrics({}), getModels()])
    overview.value = ov || {}
    metrics.value = mt || []
    models.value = md || []
  } catch (e) {
    ElMessage.error(e.message || '加载看板失败')
  } finally {
    loading.value = false
  }
  loadTable()
}

async function loadTable() {
  tableLoading.value = true
  try {
    const params = { pageNum: pageNum.value, pageSize }
    const fn = tab.value === 'profiles' ? getBiProfiles : tab.value === 'events' ? getBiEvents : getBiProducts
    const res = await fn(params)
    tableRows.value = res?.records || []
    tableTotal.value = res?.total || 0
  } catch (e) {
    ElMessage.error(e.message || '加载明细失败')
  } finally {
    tableLoading.value = false
  }
}

function onTabChange() {
  pageNum.value = 1
  loadTable()
}

function onPage(p) {
  pageNum.value = p
  loadTable()
}

async function onAggregate() {
  aggregating.value = true
  try {
    await triggerAggregate()
    ElMessage.success('已触发聚合')
    await loadAll()
  } catch (e) {
    ElMessage.error(e.message || '聚合失败')
  } finally {
    aggregating.value = false
  }
}

async function onTrain() {
  training.value = true
  try {
    await trainModel()
    ElMessage.success('模型训练完成')
    await loadAll()
  } catch (e) {
    ElMessage.error(e.message || '训练失败（样本可能不足）')
  } finally {
    training.value = false
  }
}

onMounted(loadAll)
</script>

<style scoped>
.bi-page { padding: 16px; }
.bi-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.bi-title { margin: 0; font-size: 20px; font-weight: 600; }
.bi-stats { margin-bottom: 12px; }
.stat-card { text-align: center; }
.stat-label { font-size: 12px; color: var(--el-text-color-secondary); }
.stat-value { font-size: 24px; font-weight: 600; margin-top: 4px; }
.bi-block { margin-bottom: 12px; }
.metric { text-align: center; padding: 8px 0; }
.metric-label { font-size: 12px; color: var(--el-text-color-secondary); }
.metric-value { font-size: 20px; font-weight: 600; margin-top: 4px; }
.bi-pager { margin-top: 12px; justify-content: flex-end; }
.model-head { display: flex; align-items: center; justify-content: space-between; }
.model-active { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.model-meta { font-size: 13px; color: var(--el-text-color-secondary); }
.model-table { margin-top: 12px; }
.tabular-nums { font-variant-numeric: tabular-nums; }
</style>