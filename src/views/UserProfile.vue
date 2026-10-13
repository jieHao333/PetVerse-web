<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search } from '@element-plus/icons-vue'
import { getUserById } from '@/api/user'
import { getPetByUserId } from '@/api/pet'
import { getSpacePage } from '@/api/space'
import { acceptFriendRequest, getFriendRelation, rejectFriendRequest, sendFriendRequest } from '@/api/social'
import { currentUser } from '@/utils/auth'
import { DEFAULT_AVATAR } from '@/utils/avatar'
import { splitTopics } from '@/utils/topic'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const user = ref(null)
const pet = ref(null)
const spaces = ref([])

// 加好友 / 聊一聊入口：查看自己主页时不展示，关系状态拉取失败也隐藏，避免给出错误的按钮
const me = currentUser()
const relation = ref(null)
const friendActionLoading = ref(false)
const isSelf = computed(() => String(user.value?.id ?? '') === String(me?.id ?? ''))
const showActions = computed(() => !!user.value && !isSelf.value && !!relation.value)
const isFriend = computed(() => relation.value?.friend === true)

const loadRelation = async () => {
  try {
    relation.value = await getFriendRelation(route.params.id)
  } catch {
    relation.value = null
  }
}

const onAddFriend = async () => {
  friendActionLoading.value = true
  try {
    await sendFriendRequest(route.params.id)
    ElMessage.success(`已向 ${displayName.value} 发送好友申请`)
    await loadRelation()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    friendActionLoading.value = false
  }
}

// 对方发来的待处理申请就地处理，省得再跑一趟好友页
const onAccept = async () => {
  friendActionLoading.value = true
  try {
    await acceptFriendRequest(relation.value.receivedRequestId)
    ElMessage.success(`已和 ${displayName.value} 成为好友`)
    await loadRelation()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    friendActionLoading.value = false
  }
}

const onReject = async () => {
  friendActionLoading.value = true
  try {
    await rejectFriendRequest(relation.value.receivedRequestId)
    ElMessage.success('已拒绝该申请')
    await loadRelation()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    friendActionLoading.value = false
  }
}

// 新标签页打开一对一聊天页，与动态详情页的打开方式一致
const openChat = () => {
  window.open(router.resolve({ name: 'chat', params: { userId: route.params.id } }).href, '_blank')
}

// TA 的动态：无限滚动加载，每次 10 条，后端已按发布时间倒序（最新在最上面）
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
      userId: route.params.id,
      pageNum: pageNum.value,
      pageSize: SPACE_PAGE_SIZE,
      // 用户主页时间线固定按发布时间倒序（最新在最上面），不参与圈子的综合热度排序
      sort: 'latest',
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

// 新标签页打开动态详情页，与圈子列表跳转方式保持一致；focusComment 为真时详情页自动聚焦评论输入框
const openDetail = (item, focusComment = false) => {
  const query = focusComment ? { focus: 'comment' } : undefined
  window.open(router.resolve({ name: 'spaceDetail', params: { id: item.id }, query }).href, '_blank')
}

const displayName = computed(() => user.value?.nickname || user.value?.username || '用户')

// 宠物升级进度百分比，满级或无升级需求时为 100%
const petProgress = computed(() => {
  if (!pet.value || !pet.value.nextLevelExp) return 100
  return Math.min(100, Math.round((pet.value.exp / pet.value.nextLevelExp) * 100))
})

// 时间格式化：2026-08-22T13:58 -> 2026-08-22 13:58
const formatTime = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '')

// 三个数据源独立容错：用户不存在直接提示返回，宠物/动态失败仅置空不阻断
onMounted(async () => {
  const userId = route.params.id
  try {
    user.value = await getUserById(userId)
  } catch (e) {
    ElMessage.error(e.message)
  }
  if (!user.value) {
    ElMessage.error('用户不存在')
    router.back()
    return
  }
  loading.value = false
  // 好友关系只影响操作按钮，拉取失败静默即可
  if (!isSelf.value) loadRelation()
  try {
    pet.value = await getPetByUserId(userId)
  } catch {
    pet.value = null
  }
  // 首屏先加载第一页，后续由滚动触底按需加载；哨兵元素需等 DOM 渲染完成后再观察
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
    <!-- 单列纵向排布：账号信息 → TA 的宠物 → TA 的动态 -->
    <div v-loading="loading" class="page-container up-container">
      <!-- 账号信息 -->
      <el-card shadow="never">
        <template #header>
          <span class="card-title">账号信息</span>
        </template>
        <div v-if="user" class="up-head">
          <div class="avatar-ring">
            <el-avatar :size="80" :src="user.avatar || DEFAULT_AVATAR">
              {{ (user.nickname || user.username || 'U')[0].toUpperCase() }}
            </el-avatar>
          </div>
          <div class="up-info">
            <div class="up-name">{{ displayName }}</div>
            <div class="up-account">账号: {{ user.username }}</div>
            <div class="up-meta">注册于 {{ formatTime(user.createTime) }}</div>
          </div>
          <!-- 加好友与聊一聊：仅访问他人主页且关系状态可用时展示 -->
          <div v-if="showActions" class="up-actions">
            <el-button type="primary" round @click="openChat">聊一聊</el-button>
            <el-tag v-if="isFriend" type="success" effect="plain" round>已是好友</el-tag>
            <template v-else-if="relation.receivedRequestId">
              <el-button round :loading="friendActionLoading" @click="onAccept">同意申请</el-button>
              <el-button round :disabled="friendActionLoading" @click="onReject">拒绝</el-button>
            </template>
            <el-button v-else-if="relation.requestSent" round disabled>已申请</el-button>
            <el-button v-else round :loading="friendActionLoading" @click="onAddFriend">加好友</el-button>
          </div>
        </div>
      </el-card>

      <!-- 宠物信息 -->
      <el-card shadow="never">
        <template #header>
          <span class="card-title">TA 的宠物</span>
        </template>
        <div v-if="pet" class="pet-block">
          <div class="pet-head">
            <div class="avatar-ring">
              <el-avatar :size="64" :src="pet.imageUrl || ''">
                {{ (pet.name || '宠')[0] }}
              </el-avatar>
            </div>
            <div>
              <div class="pet-name-row">
                <span class="pet-name">{{ pet.name }}</span>
                <!-- 真实宠物展示档案标签，虚拟宠物展示等级标签 -->
                <el-tag v-if="pet.type === 'REAL'" effect="plain" round class="real-tag">
                  真实宠物
                </el-tag>
                <el-tag v-else effect="dark" round class="lv-tag">Lv.{{ pet.level }}</el-tag>
              </div>
              <div class="pet-breed">
                <template v-if="pet.type === 'REAL'">
                  {{ pet.species || '未填种类' }} · {{ pet.genderName || '未填性别' }}
                </template>
                <template v-else>{{ pet.species }} · {{ pet.breed }}</template>
              </div>
            </div>
          </div>

          <!-- 真实宠物：展示档案信息（生日/绝育/收养时间），不含等级经验 -->
          <div v-if="pet.type === 'REAL'" class="pet-profile">
            <div class="pf-item">
              <span class="pf-label">生日</span>
              <span class="pf-value">{{ pet.birthday || '未填写' }}</span>
            </div>
            <div class="pf-item">
              <span class="pf-label">是否绝育</span>
              <span class="pf-value">{{ pet.sterilized ? '已绝育' : '未绝育' }}</span>
            </div>
            <div class="pf-item">
              <span class="pf-label">收养时间</span>
              <span class="pf-value">{{ pet.adoptionDate || '未填写' }}</span>
            </div>
          </div>

          <!-- 虚拟宠物：展示升级进度 -->
          <div v-else class="pet-exp">
            <div class="exp-label">
              <span>升级进度</span>
              <span>{{ pet.exp }} / {{ pet.nextLevelExp || '已满级' }}</span>
            </div>
            <el-progress :percentage="petProgress" :stroke-width="10" :show-text="false" />
          </div>
        </div>
        <p v-else class="empty-tip">TA 还没有宠物</p>
      </el-card>

      <!-- 发布的动态 -->
      <el-card shadow="never">
        <template #header>
          <span class="card-title">TA 的动态</span>
        </template>
        <!-- 按标题/发布时间搜索该用户的动态，回车/清空/变更触发，重置后仍支持触底加载 -->
        <div class="space-search">
          <el-input
            v-model.trim="keyword"
            placeholder="搜索 TA 的动态标题或正文"
            clearable
            :prefix-icon="Search"
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
        </div>
        <div v-if="spaces.length" class="space-list">
          <div v-for="item in spaces" :key="item.id" class="space-item" @click="openDetail(item)">
            <div class="space-title-row">
              <span class="space-title">{{ item.title || '无标题动态' }}</span>
              <el-tag v-for="t in splitTopics(item.category)" :key="t" size="small" round>{{ t }}</el-tag>
            </div>
            <div class="space-content">{{ item.content }}</div>
            <div v-if="item.mediaList && item.mediaList.length" class="space-media">
              <template v-for="(media, idx) in item.mediaList.slice(0, 3)" :key="idx">
                <img v-if="media.mediaType === 0" :src="media.url" alt="" />
                <!-- 视频保留原生控件，点击不冒泡到卡片，避免误跳详情页 -->
                <video v-else :src="media.url" preload="metadata" @click.stop />
              </template>
              <span v-if="item.mediaList.length > 3" class="space-media-more">
                +{{ item.mediaList.length - 3 }}
              </span>
            </div>
            <div class="space-time">{{ formatTime(item.createTime) }}</div>
          </div>
        </div>
        <!-- 滚动触底加载哨兵：常驻列表外，搜索重置后观察器无需重建 -->
        <div ref="sentinelRef" class="space-load-tip">
          <span v-if="loadingMore">加载中...</span>
          <span v-else-if="finished && spaces.length">已经到底啦</span>
        </div>
        <p v-if="finished && !spaces.length" class="empty-tip">
          {{ keyword || dateRange ? '没有搜索到相关动态' : '还没有发布过动态' }}
        </p>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
}
.up-container {
  max-width: none;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.card-title {
  font-weight: 700;
  font-size: 15px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.card-title::before {
  content: '';
  width: 4px;
  height: 16px;
  border-radius: 2px;
  background: var(--pv-ink);
}
.up-head {
  display: flex;
  align-items: center;
  gap: 20px;
}
.avatar-ring {
  padding: 3px;
  border-radius: 50%;
  background: var(--pv-ink);
  flex-shrink: 0;
}
.avatar-ring :deep(.el-avatar) {
  border: 3px solid #fff;
  font-size: 26px;
}
.up-info {
  flex: 1;
  min-width: 0;
}
/* 操作区贴右：加好友 / 聊一聊 */
.up-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.up-name {
  font-size: 22px;
  font-weight: 700;
  color: var(--pv-text);
}
.up-account {
  color: var(--pv-text-secondary);
  margin-top: 4px;
}
.up-meta {
  font-size: 12px;
  color: var(--pv-text-secondary);
  margin-top: 6px;
}

/* 宠物信息 */
.pet-block {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.pet-head {
  display: flex;
  align-items: center;
  gap: 16px;
}
.pet-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pet-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--pv-text);
}
.lv-tag {
  background: var(--pv-ink);
  border: none;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.pet-breed {
  color: var(--pv-text-secondary);
  margin-top: 4px;
  font-size: 13px;
}
.pet-exp {
  background: var(--pv-tint);
  border: 1px solid var(--pv-border);
  border-radius: 12px;
  padding: 12px 16px;
}
.exp-label {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--pv-text-secondary);
  margin-bottom: 8px;
}
.pet-exp :deep(.el-progress-bar__outer) {
  background-color: #e4e4e0;
}
.pet-exp :deep(.el-progress-bar__inner) {
  background: var(--pv-ink);
}

/* 真实宠物档案标签与信息 */
.real-tag {
  color: var(--pv-ink);
  border-color: var(--pv-border);
  background: var(--pv-tint);
  font-weight: 600;
}
.pet-profile {
  background: var(--pv-tint);
  border: 1px solid var(--pv-border);
  border-radius: 12px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pf-item {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}
.pf-label {
  color: var(--pv-text-secondary);
}
.pf-value {
  color: var(--pv-text);
  font-weight: 500;
}

/* 动态列表 */
.space-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.space-item {
  border: 1px solid var(--pv-border);
  border-radius: 12px;
  padding: 14px 16px;
  background: #fff;
  cursor: pointer;
  transition: box-shadow 0.15s ease;
}
.space-item:hover {
  box-shadow: var(--pv-shadow);
}
.space-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.space-title {
  font-weight: 600;
  color: var(--pv-text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.space-content {
  margin-top: 8px;
  font-size: 13px;
  color: var(--pv-text-secondary);
  line-height: 1.7;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
}
.space-time {
  margin-top: 8px;
  font-size: 12px;
  color: var(--pv-text-secondary);
  text-align: right;
}
.space-media {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}
.space-media img,
.space-media video {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--pv-border);
}
.space-media-more {
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.space-load-tip {
  text-align: center;
  font-size: 12px;
  color: var(--pv-text-secondary);
  padding: 6px 0 2px;
}
.space-search {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.space-search .el-input {
  width: 240px;
}
/* 日期范围选择器默认 350px 偏宽，收窄与搜索框协调 */
.space-search :deep(.el-date-editor) {
  width: 250px;
  flex-shrink: 0;
}
.space-search :deep(.el-range-separator) {
  padding: 0 2px;
}
.space-search :deep(.el-range-input) {
  font-size: 13px;
}
.empty-tip {
  color: var(--pv-text-secondary);
  text-align: center;
  padding: 18px 0;
}

@media (max-width: 768px) {
  .up-head {
    flex-wrap: wrap;
  }
  .up-actions {
    width: 100%;
    justify-content: flex-end;
  }
  .space-search .el-input {
    flex: 1;
    width: auto;
    min-width: 160px;
  }
  .space-search :deep(.el-date-editor) {
    width: 100%;
    flex-shrink: 1;
  }
}
</style>
