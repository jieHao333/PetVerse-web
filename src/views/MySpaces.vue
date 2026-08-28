<script setup>
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { getSpacePage } from '@/api/space'

const me = JSON.parse(localStorage.getItem('user') || 'null')

const spaces = ref([])

// 我的动态：无限滚动加载，每次 10 条，后端已按发布时间倒序（最新在最上面）
const SPACE_PAGE_SIZE = 10
const pageNum = ref(1)
const loadingMore = ref(false)
const finished = ref(false)
const keyword = ref('')
// 发布时间范围：[开始日期, 结束日期]，格式 YYYY-MM-DD，起止均含当天
const dateRange = ref(null)
const sentinelRef = ref(null)
let scrollObserver = null

// 触底继续加载下一页；失败不置 finished，下次滚动到底可重试；支持标题模糊匹配与发布时间范围过滤
const loadMoreSpaces = async () => {
  if (loadingMore.value || finished.value) return
  loadingMore.value = true
  try {
    const page = await getSpacePage({
      userId: me?.id,
      pageNum: pageNum.value,
      pageSize: SPACE_PAGE_SIZE,
      keyword: keyword.value || undefined,
      // 选中的日期换算为当天零点与当天末尾，确保起止日期当天的动态都能命中
      startTime: dateRange.value?.[0] ? `${dateRange.value[0]} 00:00:00` : undefined,
      endTime: dateRange.value?.[1] ? `${dateRange.value[1]} 23:59:59` : undefined,
    })
    const records = page?.records || []
    spaces.value = spaces.value.concat(records)
    if (records.length < SPACE_PAGE_SIZE) {
      finished.value = true
    } else {
      pageNum.value += 1
    }
  } catch {
    // 加载失败仅保留已有数据，不阻断页面
  } finally {
    loadingMore.value = false
  }
}

const setupScrollLoad = () => {
  if (!sentinelRef.value) return
  // 提前 200px 触发预加载，滚动体验更连贯；离屏时不请求数据，达成“不向下翻就不加载”
  scrollObserver = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) loadMoreSpaces()
    },
    { rootMargin: '200px' },
  )
  scrollObserver.observe(sentinelRef.value)
}

// 搜索/清空：重置滚动状态后从第一页重新加载，仍支持触底继续加载
const onSearchSpace = async () => {
  if (loadingMore.value) return
  spaces.value = []
  pageNum.value = 1
  finished.value = false
  await loadMoreSpaces()
}

// 时间格式化：2026-08-22T13:58 -> 2026-08-22 13:58
const formatTime = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '')

// 媒体九宫格：单张占满一行，两张/四张两列，其余三列（与宠域空间一致）
const mediaGridClass = (item) => {
  const count = item.mediaList?.length || 0
  if (count === 1) return 'media-grid single'
  if (count === 2 || count === 4) return 'media-grid two-col'
  return 'media-grid'
}

// 图片预览列表（仅取图片项），供 el-image 放大预览
const previewImages = (item) => (item.mediaList || []).filter((m) => m.mediaType === 0).map((m) => m.url)

const previewIndex = (item, media) => previewImages(item).indexOf(media.url)

// 首屏先加载第一页，后续由滚动触底按需加载；哨兵元素需等 DOM 渲染完成后再观察
onMounted(async () => {
  await loadMoreSpaces()
  await nextTick()
  setupScrollLoad()
})

onUnmounted(() => {
  scrollObserver?.disconnect()
})
</script>

<template>
  <div class="page">
    <div class="page-container">
      <div class="toolbar pv-panel">
        <el-input
          v-model.trim="keyword"
          placeholder="搜索我的动态标题或正文"
          clearable
          :prefix-icon="Search"
          class="toolbar-input"
          @keyup.enter="onSearchSpace"
          @clear="onSearchSpace"
        />
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="YYYY-MM-DD"
          clearable
          @change="onSearchSpace"
        />
        <el-button @click="onSearchSpace">搜索</el-button>
      </div>

      <!-- 动态流 -->
      <div class="feed-list">
        <div v-for="item in spaces" :key="item.id" class="feed-card pv-panel">
          <div class="feed-head">
            <el-avatar :size="40" :src="item.authorAvatar || me?.avatar || ''" class="feed-avatar">
              {{ (item.authorNickname || me?.nickname || me?.username || 'U')[0]?.toUpperCase() }}
            </el-avatar>
            <div class="feed-meta">
              <span class="feed-author">{{ item.authorNickname || me?.nickname || me?.username }}</span>
              <div class="feed-sub">
                <span class="feed-time">{{ formatTime(item.createTime) }}</span>
                <el-tag v-if="item.category" size="small" type="info" effect="plain" round>
                  {{ item.category }}
                </el-tag>
              </div>
            </div>
          </div>

          <div v-if="item.title" class="feed-title">{{ item.title }}</div>
          <div class="feed-content">{{ item.content }}</div>

          <div v-if="item.mediaList && item.mediaList.length" :class="mediaGridClass(item)">
            <template v-for="(media, idx) in item.mediaList" :key="idx">
              <el-image
                v-if="media.mediaType === 0"
                :src="media.url"
                fit="cover"
                class="media-item"
                :preview-src-list="previewImages(item)"
                :initial-index="previewIndex(item, media)"
                preview-teleported
              />
              <video
                v-else
                :src="media.url"
                controls
                preload="metadata"
                class="media-item media-video"
              />
            </template>
          </div>
        </div>

        <div v-if="finished && !spaces.length" class="feed-empty pv-panel">
          {{ keyword || dateRange ? '没有搜索到相关动态' : '还没有发布过动态，去「宠域空间」分享第一个瞬间吧' }}
        </div>

        <!-- 滚动触底加载哨兵：常驻列表外，搜索重置后观察器无需重建 -->
        <div ref="sentinelRef" class="feed-load-tip">
          <span v-if="loadingMore">加载中...</span>
          <span v-else-if="finished && spaces.length">已经到底啦</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 14px 16px;
  flex-wrap: wrap;
}
.toolbar-input {
  width: 220px;
}
/* 日期范围选择器默认 350px 偏宽，收窄与搜索框协调 */
.toolbar :deep(.el-date-editor) {
  width: 250px;
  flex-shrink: 0;
}
.toolbar :deep(.el-range-separator) {
  padding: 0 2px;
}
.toolbar :deep(.el-range-input) {
  font-size: 13px;
}

/* 动态流 */
.feed-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.feed-card {
  padding: 18px 20px;
}
.feed-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.feed-avatar {
  flex-shrink: 0;
  background: var(--pv-ink);
  color: #fff;
}
.feed-meta {
  flex: 1;
  min-width: 0;
}
.feed-author {
  font-weight: 600;
  font-size: 15px;
  color: var(--pv-text);
}
.feed-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.feed-time {
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.feed-title {
  margin-top: 12px;
  font-size: 16px;
  font-weight: 600;
  color: var(--pv-text);
}
.feed-content {
  margin-top: 8px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--pv-text);
  white-space: pre-wrap;
  word-break: break-word;
}

/* 媒体九宫格 */
.media-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 12px;
  max-width: 640px;
}
.media-grid.two-col {
  grid-template-columns: repeat(2, 1fr);
  max-width: 480px;
}
.media-grid.single {
  grid-template-columns: 1fr;
  max-width: 360px;
}
.media-item {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 10px;
  background: var(--pv-tint);
  object-fit: cover;
  display: block;
}
.media-video {
  border: 1px solid var(--pv-border);
}
.feed-empty {
  padding: 48px 0;
  text-align: center;
  color: var(--pv-text-secondary);
}
.feed-load-tip {
  text-align: center;
  font-size: 12px;
  color: var(--pv-text-secondary);
  padding: 6px 0 2px;
}
</style>
