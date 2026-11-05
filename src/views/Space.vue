<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CircleClose, Loading, Plus, Search, Star, StarFilled } from '@element-plus/icons-vue'
import { deleteSpace, getSpacePage, saveSpace, updateSpace, uploadSpaceMedia } from '@/api/space'
import { DEFAULT_AVATAR } from '@/utils/avatar'
import { requireLogin, authUser } from '@/utils/auth'
import { MAX_TOPICS, splitTopics } from '@/utils/topic'
import {
  COMMENT_TARGET_SPACE,
  LIKE_TARGET_SPACE,
  getCommentCounts,
  likeTarget,
  unlikeTarget,
} from '@/api/remark'

const route = useRoute()
const router = useRouter()

const spaces = ref([])
const total = ref(0)
// 滚动加载游标：pageNum 始终指向「下一页」要请求的页码
const pageNum = ref(1)
// 每页条数固定：无限滚动没有「每页条数」入口，但接口参数保持原样
const PAGE_SIZE = 10
const keyword = ref('')
// 话题页（space/topic/:category）从路由参数取话题并锁定，圈子主页则为可编辑的筛选条件
const category = ref(route.params.category || '')
const topicMode = computed(() => !!route.params.category)

// 首次进入 / 换筛选条件时的整块加载（遮罩住列表）
const loading = ref(false)
// 触底追加：只在列表底部显示加载条，不遮挡已有内容
const loadingMore = ref(false)
// 是否还有下一页：由「本页是否满页」和「累计条数 vs total」共同判定
const hasMore = ref(true)
// 追加失败：底部给一个「点击重试」，不用弹窗打断
const loadError = ref(false)

// 到底提示：后端没返回 total 时只显示「没有更多了」，避免出现「共 0 条」
const endText = computed(() =>
  total.value > 0 ? `— 没有更多了 · 共 ${total.value} 条 —` : '— 没有更多了 —',
)

/**
 * 请求代次：切换搜索/话题后，此前发出的请求一律作废。
 * 只靠 loading 标记挡不住「旧请求晚到」的情况——晚到的旧结果会被拼进新列表，
 * 出现搜「猫」却混进「狗」动态的问题。
 */
let requestSeq = 0

/**
 * 按 id 去重后追加，返回真正新增的条数。
 * 后端在翻页期间有新动态插入时，相邻两页可能出现重复项（分页漂移），
 * 直接 concat 会让同一条动态渲染两次，key 冲突还会引发节点复用错乱。
 */
const appendSpaces = (records) => {
  const seen = new Set(spaces.value.map((s) => String(s.id)))
  const fresh = []
  for (const item of records) {
    const key = String(item.id)
    if (!key || seen.has(key)) continue
    seen.add(key)
    fresh.push(item)
  }
  if (fresh.length) spaces.value = spaces.value.concat(fresh)
  return fresh.length
}

/**
 * 当前登录用户ID，仅本人动态展示编辑/删除入口
 * 取自响应式登录态：令牌失效后 myId 变空，不会再把上一个身份的动态当成「我的」
 */
const myId = computed(() => String(authUser.value?.id || ''))
const isMySpace = (item) => !!myId.value && String(item.userId) === myId.value

// 媒体规格（与后端保持一致）：图片≤5MB，视频(mp4)≤50MB，单条最多9个
const MAX_MEDIA_COUNT = 9
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const MAX_VIDEO_SIZE = 50 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

const dialogVisible = ref(false)
const saving = ref(false)
const isEdit = ref(false)
const form = ref({ id: null, title: '', content: '', topics: [], visibility: 0, mediaList: [] })
// 进行中的上传数量（支持多文件并发上传），计数归零才允许发布
const uploadingCount = ref(0)
const uploading = computed(() => uploadingCount.value > 0)

/* ==================== 列表加载：首屏 + 滚动追加 ==================== */

// 触底哨兵：放在列表最末尾，进入视口即视为「滚到底了」
const sentinelRef = ref(null)
let observer = null
// 触发防抖窗口：滚动监听与 observer 回调都会打到同一个入口，
// 300ms 内只保留一次，避免一次触底连发多个请求
const TRIGGER_GAP = 300
let triggerTimer = null
// 预取距离：滚到底之前 240px 就把下一页取回来，观感上不会「卡一下」
const PREFETCH = 240

/**
 * 拉取一页并写入列表
 * @param {boolean} append true=追加下一页，false=重载第一页
 */
const fetchPage = async (append) => {
  const seq = requestSeq
  if (append) {
    loadingMore.value = true
  } else {
    loading.value = true
  }
  loadError.value = false
  try {
    const data = await getSpacePage({
      pageNum: pageNum.value,
      pageSize: PAGE_SIZE,
      keyword: keyword.value || undefined,
      category: category.value || undefined,
    })
    // 筛选条件在等待期间变了：本次结果作废，既不写入列表也不改游标
    if (seq !== requestSeq) return

    const records = Array.isArray(data?.records) ? data.records : []
    // 后端 Long 统一序列化为字符串（防雪花ID精度丢失），total 需还原为数字
    total.value = Number(data?.total || 0)

    let added
    if (append) {
      added = appendSpaces(records)
    } else {
      // 重载：旧评论数快照一并作废，避免新列表沿用上一批数据的计数
      commentCountMap.value = {}
      spaces.value = records
      added = records.length
    }

    // 游标只在成功时前进，失败重试才会打到同一页
    pageNum.value += 1

    // 结束判定：本页没满 / 已取满 total / 整页都是重复数据（后端翻页漂移）
    const reachedTotal = total.value > 0 && spaces.value.length >= total.value
    hasMore.value = !(records.length < PAGE_SIZE || reachedTotal || (append && added === 0))

    // 只为本次返回的动态批量拉评论数快照，追加时不重复请求已加载的部分
    if (records.length) loadCommentCounts(records)
  } catch (e) {
    if (seq !== requestSeq) return
    loadError.value = true
    // 首屏失败弹提示；滚动追加失败只在底部给重试入口，避免打断浏览
    if (!append) ElMessage.error(e.message)
  } finally {
    if (append) {
      loadingMore.value = false
    } else {
      loading.value = false
    }
    // 一屏能放下整页时哨兵不会离开视口，observer 也就不会再回调，
    // 这里主动续接一次，否则列表会停在底部不再加载
    if (seq === requestSeq) chainIfSentinelVisible()
  }
}

/** 哨兵是否已进入（或接近）视口 */
const sentinelNearViewport = (offset) => {
  const el = sentinelRef.value
  if (!el) return false
  const viewportH = window.innerHeight || document.documentElement.clientHeight
  return el.getBoundingClientRect().top <= viewportH + offset
}

/** 哨兵仍在视口内且还有数据时，继续加载下一页 */
const chainIfSentinelVisible = () => {
  if (!hasMore.value || loadError.value) return
  nextTick(() => {
    if (!hasMore.value || loadError.value) return
    if (sentinelNearViewport(0)) loadMore()
  })
}

/** 真正发起追加：只做请求级拦截（在途 / 已到底），失败重试与自动续接都走这里 */
const loadMore = () => {
  if (loading.value || loadingMore.value || !hasMore.value) return
  fetchPage(true)
}

/**
 * 滚动触发入口：防抖 + 请求级拦截双重保护
 * 防抖用 trailing 形式（窗口结束后补发一次），而不是直接丢弃，
 * 否则用户恰好在窗口内停止滚动时，这次触底就永久丢失了
 */
const onScrollTrigger = () => {
  // 上一次失败后不再自动重试，等用户点「点击重试」，
  // 否则服务端异常时每次滚动都会打一次接口
  if (loadError.value) return
  if (triggerTimer) return
  triggerTimer = setTimeout(() => {
    triggerTimer = null
    loadMore()
  }, TRIGGER_GAP)
}

/** 失败重试：首屏失败要走整块重载，追加失败只需续接下一页 */
const retryLoad = () => {
  if (!spaces.value.length) {
    reloadSpaces()
    return
  }
  loadMore()
}

// 滚动兜底：内容高度突变时，IntersectionObserver 可能因为「状态没变化」不再回调，
// 这里用被动滚动监听 + rAF 节流补一次几何判断，两条路径都进同一个防抖入口
let scrollTicking = false
const onWindowScroll = () => {
  if (scrollTicking) return
  scrollTicking = true
  requestAnimationFrame(() => {
    scrollTicking = false
    if (sentinelNearViewport(PREFETCH)) onScrollTrigger()
  })
}

/** 重载第一页：换搜索/话题、发布或删除后回到最新的数据 */
const reloadSpaces = () => {
  requestSeq += 1
  pageNum.value = 1
  hasMore.value = true
  loadError.value = false
  loadingMore.value = false
  // 丢弃尚未执行的触底触发，避免旧条件的结果拼到新列表里
  if (triggerTimer) {
    clearTimeout(triggerTimer)
    triggerTimer = null
  }
  return fetchPage(false)
}

const onSentinelIntersect = (entries) => {
  const entry = entries[entries.length - 1]
  if (entry?.isIntersecting) onScrollTrigger()
}

onMounted(() => {
  reloadSpaces()
  observer = new IntersectionObserver(onSentinelIntersect, { rootMargin: `${PREFETCH}px 0px` })
  if (sentinelRef.value) observer.observe(sentinelRef.value)
  window.addEventListener('scroll', onWindowScroll, { passive: true })
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  window.removeEventListener('scroll', onWindowScroll)
  if (triggerTimer) {
    clearTimeout(triggerTimer)
    triggerTimer = null
  }
})

const onSearch = () => {
  reloadSpaces()
}

// 点赞/取消点赞：乐观更新计数与状态，失败时回滚
const likingIds = ref(new Set())
const onToggleLike = async (item) => {
  // 游客能看点赞数，点赞本身是写操作，先引导登录
  if (!(await requireLogin(router, route.fullPath))) return
  if (likingIds.value.has(item.id)) return
  likingIds.value.add(item.id)
  const liked = !!item.liked
  const count = Number(item.likeCount || 0)
  // 先乐观更新界面，请求失败再回滚
  item.liked = !liked
  item.likeCount = liked ? Math.max(count - 1, 0) : count + 1
  try {
    if (liked) {
      await unlikeTarget(LIKE_TARGET_SPACE, item.id)
    } else {
      await likeTarget(LIKE_TARGET_SPACE, item.id)
    }
  } catch (e) {
    item.liked = liked
    item.likeCount = count
    ElMessage.error(e.message)
  } finally {
    likingIds.value.delete(item.id)
  }
}

/* ==================== 动态评论数与详情页跳转 ==================== */

// 每条动态的评论数快照（列表加载后批量拉取，key 为动态ID字符串）
const commentCountMap = ref({})

/**
 * 批量拉取评论数快照并合并进缓存
 * 只传本次新返回的动态 id：滚动追加时不必为已加载的部分重复请求
 */
const loadCommentCounts = async (records = []) => {
  const ids = records.map((s) => s.id).filter(Boolean)
  if (!ids.length) return
  try {
    const map = await getCommentCounts(COMMENT_TARGET_SPACE, ids)
    if (map) commentCountMap.value = { ...commentCountMap.value, ...map }
  } catch {
    // 评论数拉取失败不阻断动态展示，按 0 处理
  }
}

const commentCount = (item) => Number(commentCountMap.value[item.id] || 0)

// 新标签页打开动态详情页；focusComment 为真时详情页自动聚焦评论输入框
const openDetail = (item, focusComment = false) => {
  const query = focusComment ? { focus: 'comment' } : undefined
  window.open(router.resolve({ name: 'spaceDetail', params: { id: item.id }, query }).href, '_blank')
}

// 点击话题标签，新标签页打开该话题页，分页浏览同一话题下的全部动态
const openTopic = (cat) => {
  if (!cat) return
  window.open(router.resolve({ name: 'spaceTopic', params: { category: cat } }).href, '_blank')
}

// 列表页文本截断长度，超出部分以省略号提示，完整内容在详情页查看
// 媒体占位符（[[media:N]]）仅用于详情页定位，列表展示时剥离
const CONTENT_LIMIT = 120
const stripMediaTokens = (text) => (text || '').replace(/\[\[media:\d+\]\]/g, '')
const isContentTruncated = (item) => stripMediaTokens(item.content).length > CONTENT_LIMIT
const truncatedContent = (item) => {
  const content = stripMediaTokens(item.content)
  return content.length > CONTENT_LIMIT ? `${content.slice(0, CONTENT_LIMIT)}…` : content
}

// 列表页仅展示第一个媒体（图片或视频），其余在详情页查看
const firstMedia = (item) => item.mediaList?.[0] || null

const openCreate = async () => {
  if (!(await requireLogin(router, route.fullPath))) return
  isEdit.value = false
  // 话题页或已筛选话题时，发布默认带上当前话题
  form.value = { id: null, title: '', content: '', topics: category.value ? [category.value] : [], visibility: 0, mediaList: [] }
  dialogVisible.value = true
}

const openEdit = (item) => {
  isEdit.value = true
  form.value = {
    id: item.id,
    title: item.title || '',
    content: item.content,
    topics: splitTopics(item.category),
    visibility: Number(item.visibility || 0),
    mediaList: (item.mediaList || []).map((m) => ({ ...m })),
  }
  dialogVisible.value = true
}

// 上传前校验：与后端同规格，不合法直接拦截不发请求
const beforeUpload = (file) => {
  if (form.value.mediaList.length >= MAX_MEDIA_COUNT) {
    ElMessage.warning(`单条动态最多上传 ${MAX_MEDIA_COUNT} 个媒体`)
    return false
  }
  const isImage = IMAGE_TYPES.includes(file.type)
  const isVideo = file.type === 'video/mp4'
  if (!isImage && !isVideo) {
    ElMessage.error('仅支持 jpg/jpeg/png/webp/gif 图片或 mp4 视频')
    return false
  }
  if (isImage && file.size > MAX_IMAGE_SIZE) {
    ElMessage.error('图片大小不能超过 5MB')
    return false
  }
  if (isVideo && file.size > MAX_VIDEO_SIZE) {
    ElMessage.error('视频大小不能超过 50MB')
    return false
  }
  return true
}

// 自定义上传：先用本地 blob 即时回显，上传成功后替换为 OSS 地址，失败则移除该预览
// 媒体占位符按触发上传时的光标位置插入正文，详情页据此在对应位置渲染媒体
const contentInputRef = ref(null)

const currentCursor = () => {
  const el = contentInputRef.value?.textarea || contentInputRef.value?.input
  const pos = el?.selectionStart
  return typeof pos === 'number' ? pos : form.value.content.length
}

const handleUpload = async ({ file }) => {
  const localUrl = URL.createObjectURL(file)
  const isImage = IMAGE_TYPES.includes(file.type)
  const cursor = currentCursor()
  form.value.mediaList.push({ mediaType: isImage ? 0 : 1, url: localUrl })
  const index = form.value.mediaList.length - 1
  const content = form.value.content
  form.value.content = `${content.slice(0, cursor)}[[media:${index}]]${content.slice(cursor)}`
  uploadingCount.value += 1
  try {
    const res = await uploadSpaceMedia(file)
    const pos = form.value.mediaList.findIndex((m) => m.url === localUrl)
    if (pos > -1) {
      form.value.mediaList[pos] = { mediaType: res.mediaType, url: res.url }
    }
  } catch (e) {
    const pos = form.value.mediaList.findIndex((m) => m.url === localUrl)
    if (pos > -1) removeMedia(pos)
    ElMessage.error(e.message)
  } finally {
    URL.revokeObjectURL(localUrl)
    uploadingCount.value -= 1
  }
}

// 删除媒体时同步清理正文占位符：删掉对应占位符，其后媒体下标整体前移
const removeMedia = (index) => {
  form.value.mediaList.splice(index, 1)
  form.value.content = form.value.content.replace(/\[\[media:(\d+)\]\]/g, (match, n) => {
    const v = Number(n)
    if (v === index) return ''
    return v > index ? `[[media:${v - 1}]]` : match
  })
}

const onSave = async () => {
  if (!form.value.content.trim()) {
    ElMessage.warning('请输入动态内容')
    return
  }
  if (uploading.value) {
    ElMessage.warning('媒体上传中，请稍候')
    return
  }
  saving.value = true
  try {
    const payload = {
      title: form.value.title || undefined,
      content: form.value.content,
      category: form.value.topics.join(',') || undefined,
      visibility: form.value.visibility,
      mediaList: form.value.mediaList,
    }
    let res
    if (isEdit.value) {
      res = await updateSpace({ id: form.value.id, ...payload })
    } else {
      res = await saveSpace(payload)
    }
    // 宠物经验奖励已改为消息队列异步发放，不再同步返回经验结果（仅新建时有奖励）
    if (isEdit.value) {
      ElMessage.success('修改成功')
    } else {
      ElMessage.success('发布成功，宠物经验奖励已异步发放')
    }
    dialogVisible.value = false
    // 新发布/刚修改的动态应该出现在最前面，回到第一页重载
    reloadSpaces()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}

/** 删除后就地移除：整表重载会把用户已经滚到的位置丢掉 */
const removeSpaceLocally = (id) => {
  const key = String(id)
  const next = spaces.value.filter((s) => String(s.id) !== key)
  if (next.length === spaces.value.length) return
  spaces.value = next
  total.value = Math.max(total.value - 1, 0)
  delete commentCountMap.value[key]
  // 少了一条后列表可能不够一屏，补一次续接判断
  chainIfSentinelVisible()
}

const onDelete = async (item) => {
  try {
    await ElMessageBox.confirm('确定删除这条动态吗？删除后不可恢复', '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await deleteSpace(item.id)
    ElMessage.success('删除成功')
    removeSpaceLocally(item.id)
  } catch {
    // 用户取消则不处理
  }
}

const formatTime = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '')

// 点击作者名跳转用户主页（与其他页面用户名交互保持一致）
const gotoProfile = (userId) => {
  if (userId) router.push(`/user/${userId}`)
}
</script>

<template>
  <div class="page">
    <div class="page-container">
      <div class="page-head">
        <div>
          <h2 class="page-title">{{ topicMode ? `话题 · #${category}` : '圈子' }}</h2>
          <p class="page-desc">
            {{
              topicMode
                ? `浏览「${category}」话题下的全部动态`
                : '看看大家与宠物在一起的每个瞬间 · 发布新动态可为宠物 +10 经验'
            }}
          </p>
        </div>
        <el-button type="primary" size="large" :icon="Plus" @click="openCreate">发布动态</el-button>
      </div>

      <div class="toolbar pv-panel">
        <el-input
          v-model.trim="keyword"
          placeholder="搜索标题或正文"
          clearable
          :prefix-icon="Search"
          class="toolbar-input"
          @keyup.enter="onSearch"
          @clear="onSearch"
        />
        <el-input
          v-if="!topicMode"
          v-model.trim="category"
          placeholder="按话题筛选"
          clearable
          class="toolbar-input narrow"
          @keyup.enter="onSearch"
          @clear="onSearch"
        />
        <el-button @click="onSearch">搜索</el-button>
      </div>

      <!-- 动态流 -->
      <div v-loading="loading" class="feed-list">
        <div v-for="item in spaces" :key="item.id" class="feed-card pv-panel" @click="openDetail(item)">
          <div class="feed-head">
            <el-avatar :size="40" :src="item.authorAvatar || DEFAULT_AVATAR" class="feed-avatar">
              {{ (item.authorNickname || item.authorUsername || 'U')[0]?.toUpperCase() }}
            </el-avatar>
            <div class="feed-meta">
              <span class="feed-author" @click.stop="gotoProfile(item.userId)">
                {{ item.authorNickname || item.authorUsername }}
              </span>
              <div class="feed-sub">
                <span class="feed-time">{{ formatTime(item.createTime) }}</span>
                <span
                  v-for="t in splitTopics(item.category)"
                  :key="t"
                  class="topic-chip"
                  @click.stop="openTopic(t)"
                >
                  # {{ t }}
                </span>
              </div>
            </div>
            <div v-if="isMySpace(item)" class="feed-actions">
              <el-button link type="primary" @click.stop="openEdit(item)">编辑</el-button>
              <el-button link type="danger" @click.stop="onDelete(item)">删除</el-button>
            </div>
          </div>

          <div v-if="item.title" class="feed-title">{{ item.title }}</div>
          <!-- 列表页仅展示截断后的部分文本，完整内容点击卡片进详情页查看 -->
          <div class="feed-content">{{ truncatedContent(item) }}</div>
          <div v-if="isContentTruncated(item)" class="feed-more">查看全文 →</div>

          <!-- 列表页仅展示第一个媒体，全部图片/视频在详情页查看 -->
          <div v-if="firstMedia(item)" class="media-grid single">
            <div class="media-wrap">
              <el-image
                v-if="firstMedia(item).mediaType === 0"
                :src="firstMedia(item).url"
                fit="cover"
                class="media-item"
              />
              <video
                v-else
                :src="firstMedia(item).url"
                controls
                preload="metadata"
                class="media-item media-video"
                @click.stop
              />
              <span v-if="item.mediaList.length > 1" class="media-count">
                共 {{ item.mediaList.length }} 个媒体
              </span>
            </div>
          </div>

          <div class="feed-footer">
            <el-button
              link
              :class="['like-btn', { liked: item.liked }]"
              :icon="item.liked ? StarFilled : Star"
              @click.stop="onToggleLike(item)"
            >
              {{ Number(item.likeCount || 0) > 0 ? Number(item.likeCount) : (item.liked ? '1' : '点赞') }}
            </el-button>
            <!-- 评论入口保留：点击跳转详情页（新标签页）并自动聚焦评论输入框 -->
            <el-button link class="comment-btn" @click.stop="openDetail(item, true)">
              💬 评论
              <span v-if="commentCount(item) > 0">({{ commentCount(item) }})</span>
            </el-button>
          </div>
        </div>

        <!-- 加载失败时不显示「还没有动态」的空态，避免把请求失败误报成没有数据 -->
        <div v-if="!loading && !loadError && !spaces.length" class="feed-empty pv-panel">
          {{
            keyword || category
              ? '没有搜索到相关动态'
              : '还没有可见的动态，点击「发布动态」分享第一个瞬间吧'
          }}
        </div>

        <!-- 滚动加载状态条：加载中 / 失败重试 / 到底提示，三者互斥 -->
        <div
          v-if="spaces.length || loadError"
          class="feed-status"
          role="status"
          aria-live="polite"
        >
          <template v-if="loadingMore">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span>正在加载更多…</span>
          </template>
          <span v-else-if="loadError" class="feed-status-retry">
            加载失败
            <el-button link type="primary" @click="retryLoad">点击重试</el-button>
          </span>
          <span v-else-if="!hasMore">{{ endText }}</span>
          <span v-else class="feed-status-hint">继续向下滚动，加载更多</span>
        </div>

        <!-- 触底哨兵：进入视口即触发下一页，高度 1px 不占视觉空间 -->
        <div ref="sentinelRef" class="feed-sentinel" aria-hidden="true"></div>
      </div>
    </div>

    <!-- 发布/编辑动态弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑动态' : '发布动态'"
      width="560px"
      :close-on-click-modal="false"
    >
      <el-form :model="form" label-width="70px">
        <el-form-item label="内容" required>
          <el-input
            ref="contentInputRef"
            v-model.trim="form.content"
            type="textarea"
            :rows="5"
            placeholder="分享你和宠物的瞬间..."
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="标题">
          <el-input v-model.trim="form.title" placeholder="选填，给动态起个标题" maxlength="100" show-word-limit />
        </el-form-item>
        <el-form-item label="话题">
          <el-select
            v-model="form.topics"
            multiple
            filterable
            allow-create
            default-first-option
            :multiple-limit="MAX_TOPICS"
            placeholder="输入后回车添加，最多 6 个"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="图片视频">
          <div class="media-picker">
            <div v-for="(media, idx) in form.mediaList" :key="idx" class="media-thumb">
              <img v-if="media.mediaType === 0" :src="media.url" alt="" />
              <video v-else :src="media.url" preload="metadata" />
              <span v-if="media.mediaType === 1" class="media-type-badge">视频</span>
              <el-icon class="media-remove" @click="removeMedia(idx)"><CircleClose /></el-icon>
            </div>
            <el-upload
              v-if="form.mediaList.length < 9"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4"
              :show-file-list="false"
              :before-upload="beforeUpload"
              :http-request="handleUpload"
              class="media-uploader"
            >
              <div class="upload-trigger">
                <el-icon v-if="!uploading"><Plus /></el-icon>
                <span>{{ uploading ? '上传中' : `添加 ${form.mediaList.length}/9` }}</span>
              </div>
            </el-upload>
          </div>
          <div class="upload-tip">
            支持 jpg/png/webp/gif 图片（≤5MB）或 mp4 视频（≤50MB），最多 9 个；上传的媒体将插入到内容中光标所在位置
          </div>
        </el-form-item>
        <el-form-item label="可见性">
          <el-radio-group v-model="form.visibility">
            <el-radio :value="0">公开</el-radio>
            <el-radio :value="1">仅好友</el-radio>
            <el-radio :value="2">仅自己</el-radio>
          </el-radio-group>
          <div class="visibility-tip">
            公开：所有人可见；仅好友：只有好友可见；仅自己：只有自己可见（自己始终能看到自己的动态）
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">发布</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
}
.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.page-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--pv-text);
}
.page-desc {
  margin-top: 4px;
  color: var(--pv-text-secondary);
  font-size: 13px;
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
.toolbar-input.narrow {
  width: 160px;
}
/* 话题标签：点击新标签页打开同话题动态 */
.topic-chip {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 0 10px;
  font-size: 12px;
  line-height: 20px;
  color: var(--pv-ink);
  background: var(--pv-tint);
  border: 1px solid var(--pv-border);
  border-radius: 999px;
  cursor: pointer;
  overflow-wrap: anywhere;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.topic-chip:hover {
  background: var(--pv-ink);
  border-color: var(--pv-ink);
  color: #fff;
}

/* 点赞行 */
.feed-footer {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--pv-border);
}
.comment-btn {
  color: var(--pv-text-secondary);
  font-size: 13px;
}
.comment-btn:hover {
  color: var(--pv-ink);
}
.like-btn {
  color: var(--pv-text-secondary);
  font-size: 13px;
}
.like-btn:hover {
  color: var(--pv-ink);
}
.like-btn.liked {
  color: var(--el-color-warning);
}
.like-btn.liked:hover {
  color: var(--el-color-warning);
}

/* 动态流 */
.feed-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.feed-card {
  padding: 18px 20px;
  cursor: pointer;
  transition: box-shadow 0.15s ease;
}
.feed-card:hover {
  box-shadow: var(--pv-shadow);
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
  cursor: pointer;
  overflow-wrap: anywhere;
}
.feed-author:hover {
  text-decoration: underline;
}
.feed-sub {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin-top: 4px;
}
.feed-time {
  font-size: 12px;
  color: var(--pv-text-secondary);
  white-space: nowrap;
}
.feed-actions {
  flex-shrink: 0;
}
.feed-title {
  margin-top: 12px;
  font-size: 16px;
  font-weight: 600;
  color: var(--pv-text);
  overflow-wrap: anywhere;
}
.feed-content {
  margin-top: 8px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--pv-text);
  white-space: pre-wrap;
  word-break: break-word;
}
.feed-more {
  margin-top: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--pv-ink);
}

/* 媒体九宫格 */
.media-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 12px;
  max-width: 640px;
}
.media-grid.single {
  grid-template-columns: 1fr;
  max-width: 240px;
}
.media-wrap {
  position: relative;
}
.media-count {
  position: absolute;
  right: 8px;
  bottom: 8px;
  font-size: 11px;
  color: #fff;
  background: rgba(23, 24, 28, 0.65);
  border-radius: 4px;
  padding: 2px 6px;
  pointer-events: none;
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

/* 发布弹窗内的媒体选择 */
.media-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.media-thumb {
  position: relative;
  width: 76px;
  height: 76px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--pv-border);
}
.media-thumb img,
.media-thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.media-type-badge {
  position: absolute;
  left: 4px;
  bottom: 4px;
  font-size: 11px;
  color: #fff;
  background: rgba(23, 24, 28, 0.72);
  border-radius: 4px;
  padding: 1px 5px;
}
.media-remove {
  position: absolute;
  top: 3px;
  right: 3px;
  font-size: 18px;
  color: #fff;
  background: rgba(23, 24, 28, 0.6);
  border-radius: 50%;
  cursor: pointer;
}
.media-remove:hover {
  background: rgba(23, 24, 28, 0.85);
}
.upload-trigger {
  width: 76px;
  height: 76px;
  border: 1px dashed var(--pv-border);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--pv-text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s;
}
.upload-trigger:hover {
  border-color: var(--pv-ink);
  color: var(--pv-ink);
}
.upload-tip,
.visibility-tip {
  margin-top: 6px;
  font-size: 12px;
  color: var(--pv-text-secondary);
  line-height: 1.6;
}

/* 滚动加载：底部状态条 + 触底哨兵 */
.feed-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  padding: 2px 0 6px;
  font-size: 13px;
  color: var(--pv-text-secondary);
}
.feed-status .el-icon {
  font-size: 15px;
}
.feed-status-hint {
  opacity: 0.72;
}
.feed-status-retry {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
/* 1px 哨兵：给 IntersectionObserver 一个稳定的观察目标，本身不占视觉空间 */
.feed-sentinel {
  height: 1px;
}

@media (max-width: 768px) {
  /* 工具栏控件小屏纵向铺满，避免固定宽度挤压 */
  .toolbar :deep(.el-input),
  .toolbar :deep(.el-select),
  .toolbar-input,
  .toolbar-input.narrow {
    width: 100%;
  }
  .page-title {
    font-size: 20px;
  }
  /* 超长话题换行成多行时，胶囊圆角改为普通圆角，避免两端过度收弧 */
  .topic-chip {
    border-radius: 10px;
  }
}
</style>
