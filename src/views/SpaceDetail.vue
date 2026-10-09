<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Star, StarFilled } from '@element-plus/icons-vue'
import { deleteSpace, getSpaceDetail } from '@/api/space'
import { DEFAULT_AVATAR } from '@/utils/avatar'
import { requireLogin } from '@/utils/auth'
import {
  COMMENT_TARGET_SPACE,
  LIKE_TARGET_SPACE,
  deleteComment,
  getCommentPage,
  likeTarget,
  saveComment,
  unlikeTarget,
} from '@/api/remark'

const route = useRoute()
const router = useRouter()
const spaceId = ref(route.params.id)

// 当前登录用户ID，仅本人动态展示删除入口
const myId = String(JSON.parse(localStorage.getItem('user') || 'null')?.id || '')
const isMine = (userId) => String(userId) === myId

const space = ref(null)
const loading = ref(true)
const loadError = ref('')

const loadSpace = async () => {
  loading.value = true
  try {
    space.value = await getSpaceDetail(spaceId.value)
    if (!space.value) loadError.value = '动态不存在或已删除'
  } catch (e) {
    loadError.value = e.message || '动态不存在或无权查看'
  } finally {
    loading.value = false
  }
}

/* ==================== 点赞 ==================== */

const liking = ref(false)
const onToggleLike = async () => {
  if (!space.value || liking.value) return
  // 游客可浏览点赞数与评论，点赞需要先登录
  if (!(await requireLogin(router, route.fullPath))) return
  liking.value = true
  const liked = !!space.value.liked
  const count = Number(space.value.likeCount || 0)
  space.value.liked = !liked
  space.value.likeCount = liked ? Math.max(count - 1, 0) : count + 1
  try {
    if (liked) {
      await unlikeTarget(LIKE_TARGET_SPACE, space.value.id)
    } else {
      await likeTarget(LIKE_TARGET_SPACE, space.value.id)
    }
  } catch (e) {
    space.value.liked = liked
    space.value.likeCount = count
    ElMessage.error(e.message)
  } finally {
    liking.value = false
  }
}

/* ==================== 评论（详情页为唯一评论入口） ==================== */

const comments = ref([])
const commentTotal = ref(0)
const commentPageNum = ref(1)
const commentPageSize = ref(10)
const commentLoading = ref(false)
const commentInput = ref('')
const commentTarget = ref(null)
const submitting = ref(false)
const inputRef = ref(null)

const loadComments = async () => {
  commentLoading.value = true
  try {
    const data = await getCommentPage({
      targetType: COMMENT_TARGET_SPACE,
      targetId: spaceId.value,
      pageNum: commentPageNum.value,
      pageSize: commentPageSize.value,
    })
    comments.value = data.records || []
    commentTotal.value = Number(data.total || 0)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    commentLoading.value = false
  }
}

// 切换评论页码后重新拉取该页（每页 10 条）
const onCommentPageChange = () => {
  loadComments()
}

// 点击回复：comment 为空表示直接评论动态，否则回复某条评论
const startReply = async (comment = null) => {
  if (!(await requireLogin(router, route.fullPath))) return
  commentTarget.value = comment
    ? {
        userId: comment.userId,
        nickname: comment.userNickname || `用户${comment.userId}`,
        commentId: comment.id,
      }
    : null
  commentInput.value = ''
  inputRef.value?.focus()
}

// 回复折叠：后端评论为平铺模型（仅 replyUserId），前端按时间顺序把连续回复
// 归入其前最近的一条顶层评论，默认折叠，点击「展示X条回复」展开
const expandedReplies = ref({})

const toggleReplies = (rootId) => {
  expandedReplies.value[rootId] = !expandedReplies.value[rootId]
}

const commentRows = computed(() => {
  // 先按楼层归组：回复归入「被回复人参与过的最近楼层」，找不到则自成一楼
  const threads = []
  for (const c of comments.value) {
    let thread = null
    if (c.replyUserId) {
      for (let i = threads.length - 1; i >= 0; i--) {
        if (threads[i].participants.has(String(c.replyUserId))) {
          thread = threads[i]
          break
        }
      }
    }
    if (!thread) {
      thread = { rootId: c.id, root: c, replies: [], participants: new Set() }
      threads.push(thread)
    } else {
      thread.replies.push(c)
    }
    thread.participants.add(String(c.userId))
  }
  // 再展开为渲染行：顶层评论 + 折叠开关 + 回复（回复默认隐藏）
  const rows = []
  for (const t of threads) {
    rows.push({ type: 'comment', comment: t.root, thread: t })
    if (t.replies.length) {
      rows.push({ type: 'toggle', thread: t })
      for (const reply of t.replies) rows.push({ type: 'reply', comment: reply, thread: t })
    }
  }
  return rows
})

const onSubmitComment = async () => {
  if (!(await requireLogin(router, route.fullPath))) return
  if (!commentInput.value.trim()) {
    ElMessage.warning('请输入评论内容')
    return
  }
  submitting.value = true
  const targetCommentId = commentTarget.value?.commentId || null
  try {
    const comment = await saveComment({
      targetType: COMMENT_TARGET_SPACE,
      targetId: spaceId.value,
      content: commentInput.value,
      replyUserId: commentTarget.value?.userId || undefined,
    })
    // 时间正序展示：新评论落在最后一页，未满页直接追加，已满页则跳到新的末页
    commentTotal.value += 1
    const lastPage = Math.ceil(commentTotal.value / commentPageSize.value)
    if (lastPage === commentPageNum.value) {
      comments.value = [...comments.value, comment]
    } else {
      commentPageNum.value = lastPage
      await loadComments()
    }
    // 回复成功后自动展开目标楼层，让用户看到自己的回复
    if (targetCommentId) {
      const row = commentRows.value.find(
        (r) => r.comment && String(r.comment.id) === String(targetCommentId)
      )
      if (row) expandedReplies.value[row.thread.rootId] = true
    }
    commentInput.value = ''
    commentTarget.value = null
    ElMessage.success('评论成功')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    submitting.value = false
  }
}

const onDeleteComment = (comment) => {
  ElMessageBox.confirm('确定删除这条评论吗？', '删除评论', {
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消',
  })
    .then(async () => {
      try {
        await deleteComment(comment.id)
        comments.value = comments.value.filter((it) => String(it.id) !== String(comment.id))
        commentTotal.value -= 1
        ElMessage.success('评论已删除')
      } catch (e) {
        ElMessage.error(e.message)
      }
    })
    .catch(() => {})
}

/* ==================== 动态操作 ==================== */

const onDeleteSpace = async () => {
  try {
    await ElMessageBox.confirm('确定删除这条动态吗？删除后不可恢复', '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await deleteSpace(spaceId.value)
    ElMessage.success('删除成功')
    // 详情页已被删除，返回圈子列表
    router.replace('/space')
  } catch {
    // 用户取消则不处理
  }
}

const formatTime = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '')

const gotoProfile = (userId) => {
  if (userId) router.push(`/user/${userId}`)
}

// 正文中的媒体占位符：发布时按光标位置插入，形如 [[media:0]]
const MEDIA_TOKEN_RE = /\[\[media:(\d+)\]\]/g

// 正文按光标插入的媒体占位符拆分为 文本/媒体 交替片段；
// 未被占位符引用的媒体（历史动态）追加到末尾
const contentSegments = computed(() => {
  const content = space.value?.content || ''
  const mediaList = space.value?.mediaList || []
  const segments = []
  const referenced = new Set()
  const re = new RegExp(MEDIA_TOKEN_RE.source, 'g')
  let last = 0
  let m
  while ((m = re.exec(content))) {
    if (m.index > last) segments.push({ type: 'text', value: content.slice(last, m.index) })
    const media = mediaList[Number(m[1])]
    if (media) {
      segments.push({ type: 'media', media })
      referenced.add(Number(m[1]))
    }
    last = m.index + m[0].length
  }
  if (last < content.length) segments.push({ type: 'text', value: content.slice(last) })
  mediaList.forEach((media, idx) => {
    if (!referenced.has(idx)) segments.push({ type: 'media', media })
  })
  return segments
})

const previewImages = computed(() =>
  (space.value?.mediaList || []).filter((m) => m.mediaType === 0).map((m) => m.url)
)

const previewIndex = (media) => previewImages.value.indexOf(media.url)

const isMySpace = computed(() => space.value && String(space.value.userId) === myId)

// 加载动态详情与评论；路由参数变化时（同标签页切换动态）重置状态重新加载
const loadAll = async () => {
  space.value = null
  loadError.value = ''
  comments.value = []
  commentTotal.value = 0
  commentPageNum.value = 1
  commentInput.value = ''
  commentTarget.value = null
  await loadSpace()
  if (!space.value) return
  await loadComments()
  // 从列表页评论按钮跳转时带 focus=comment，自动聚焦评论输入框
  if (route.query.focus === 'comment') {
    inputRef.value?.focus()
  }
}

watch(
  () => route.params.id,
  (id) => {
    if (id && id !== spaceId.value) {
      spaceId.value = id
      loadAll()
    }
  }
)

onMounted(loadAll)
</script>

<template>
  <div class="page">
    <div class="page-container detail-container">
      <el-card v-if="loading" shadow="never">
        <el-skeleton :rows="8" animated />
      </el-card>

      <el-card v-else-if="loadError || !space" shadow="never" class="error-card">
        <el-result icon="warning" title="无法查看该动态" :sub-title="loadError || '动态不存在或已删除'">
          <template #extra>
            <el-button type="primary" round @click="router.replace('/space')">返回圈子</el-button>
          </template>
        </el-result>
      </el-card>

      <template v-else>
        <div class="back-row">
          <el-button link @click="router.push('/space')">← 返回圈子</el-button>
        </div>

        <el-card shadow="never" class="detail-card">
          <div class="feed-head">
            <el-avatar :size="44" :src="space.authorAvatar || DEFAULT_AVATAR" class="feed-avatar">
              {{ (space.authorNickname || space.authorUsername || 'U')[0]?.toUpperCase() }}
            </el-avatar>
            <div class="feed-meta">
              <span class="feed-author" @click="gotoProfile(space.userId)">
                {{ space.authorNickname || space.authorUsername }}
              </span>
              <div class="feed-sub">
                <span class="feed-time">{{ formatTime(space.createTime) }}</span>
                <el-tag v-if="space.category" size="small" type="info" effect="plain" round>
                  {{ space.category }}
                </el-tag>
              </div>
            </div>
            <div v-if="isMySpace" class="feed-actions">
              <el-button link type="danger" @click="onDeleteSpace">删除</el-button>
            </div>
          </div>

          <h1 v-if="space.title" class="detail-title">{{ space.title }}</h1>
          <!-- 正文与媒体按光标位置交替渲染：媒体左对齐、一行一个 -->
          <div class="detail-body">
            <template v-for="(seg, i) in contentSegments" :key="i">
              <div v-if="seg.type === 'text'" class="detail-content">{{ seg.value }}</div>
              <div v-else class="media-line">
                <el-image
                  v-if="seg.media.mediaType === 0"
                  :src="seg.media.url"
                  fit="cover"
                  class="media-single"
                  :preview-src-list="previewImages"
                  :initial-index="previewIndex(seg.media)"
                  preview-teleported
                />
                <video
                  v-else
                  :src="seg.media.url"
                  controls
                  preload="metadata"
                  class="media-single media-video"
                />
              </div>
            </template>
          </div>

          <div class="feed-footer">
            <el-button
              link
              :class="['like-btn', { liked: space.liked }]"
              :icon="space.liked ? StarFilled : Star"
              @click="onToggleLike"
            >
              {{ Number(space.likeCount || 0) > 0 ? Number(space.likeCount) : (space.liked ? '1' : '点赞') }}
            </el-button>
            <span class="comment-count">💬 {{ commentTotal }} 条评论</span>
          </div>
        </el-card>

        <!-- 评论区：详情页才可进行评论 -->
        <el-card shadow="never" class="comment-card">
          <template #header>
            <span class="card-title">评论（{{ commentTotal }}）</span>
          </template>

          <div class="comment-input">
            <div v-if="commentTarget" class="comment-target">
              回复 @{{ commentTarget.nickname }}
              <el-button link size="small" @click="commentTarget = null">取消</el-button>
            </div>
            <div class="comment-input-row">
              <el-input
                ref="inputRef"
                v-model="commentInput"
                maxlength="500"
                show-word-limit
                :placeholder="commentTarget ? '回复这条评论…' : '评论这条动态…'"
                @keyup.enter="onSubmitComment"
              />
              <el-button type="primary" :loading="submitting" @click="onSubmitComment">发布</el-button>
            </div>
          </div>

          <div v-loading="commentLoading" class="comment-list">
            <template v-for="row in commentRows" :key="row.type === 'toggle' ? `toggle-${row.thread.rootId}` : row.comment.id">
              <!-- 折叠开关：仅当该楼层存在回复时展示 -->
              <div v-if="row.type === 'toggle'" class="reply-toggle">
                <el-button link type="primary" size="small" @click="toggleReplies(row.thread.rootId)">
                  {{
                    expandedReplies[row.thread.rootId]
                      ? '收起回复'
                      : `展示${row.thread.replies.length}条回复`
                  }}
                </el-button>
              </div>
              <div
                v-else
                v-show="row.type === 'comment' || expandedReplies[row.thread.rootId]"
                :class="['comment-item', { 'reply-item': row.type === 'reply' }]"
              >
                <el-avatar :size="32" :src="row.comment.userAvatar || DEFAULT_AVATAR" class="comment-avatar">
                  {{ (row.comment.userNickname || '宠').slice(0, 1) }}
                </el-avatar>
                <div class="comment-body">
                  <div class="comment-head">
                    <span class="comment-user" @click="gotoProfile(row.comment.userId)">
                      {{ row.comment.userNickname || `用户${row.comment.userId}` }}
                    </span>
                    <template v-if="row.comment.replyUserId">
                      <span class="comment-arrow">回复</span>
                      <span class="comment-user" @click="gotoProfile(row.comment.replyUserId)">
                        @{{ row.comment.replyUserNickname || `用户${row.comment.replyUserId}` }}
                      </span>
                    </template>
                    <span class="comment-time">{{ formatTime(row.comment.createTime) }}</span>
                  </div>
                  <div class="comment-content">{{ row.comment.content }}</div>
                  <div class="comment-actions">
                    <el-button link type="primary" size="small" @click="startReply(row.comment)">回复</el-button>
                    <el-button
                      v-if="isMine(row.comment.userId)"
                      link
                      type="danger"
                      size="small"
                      @click="onDeleteComment(row.comment)"
                    >
                      删除
                    </el-button>
                  </div>
                </div>
              </div>
            </template>

            <div v-if="commentTotal > commentPageSize" class="comment-pager">
              <el-pagination
                v-model:current-page="commentPageNum"
                :page-size="commentPageSize"
                :total="commentTotal"
                layout="prev, pager, next"
                background
                @current-change="onCommentPageChange"
              />
            </div>
            <div v-if="!commentLoading && comments.length === 0" class="comment-empty">
              还没有人评论，来说两句吧
            </div>
          </div>
        </el-card>
      </template>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
}
/* 详情页铺满屏幕：纵向 flex 让评论卡片撑满剩余高度，内容水平居中对称 */
.detail-container {
  display: flex;
  flex-direction: column;
}
.comment-card {
  flex: 1;
}
.back-row {
  margin-bottom: 12px;
}
.detail-card {
  margin-bottom: 16px;
}
.error-card :deep(.el-card__body) {
  padding: 40px 24px;
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
}
.feed-author:hover {
  text-decoration: underline;
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
.feed-actions {
  flex-shrink: 0;
}

.detail-title {
  margin-top: 16px;
  font-size: 20px;
  font-weight: 700;
  color: var(--pv-text);
  line-height: 1.4;
}
.detail-content {
  margin-top: 10px;
  font-size: 15px;
  line-height: 1.8;
  color: var(--pv-text);
  white-space: pre-wrap;
  word-break: break-word;
}

/* 媒体按光标位置内联展示：左对齐、一行一个 */
.media-line {
  margin: 12px 0;
}
.media-single {
  display: block;
  width: 100%;
  max-width: 480px;
  aspect-ratio: 1;
  border-radius: 10px;
  background: var(--pv-tint);
  object-fit: cover;
}
.media-video {
  border: 1px solid var(--pv-border);
}

.feed-footer {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--pv-border);
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
.comment-count {
  font-size: 13px;
  color: var(--pv-text-secondary);
}

/* 评论区 */
.comment-input {
  margin-bottom: 8px;
}
.comment-target {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--pv-text-secondary);
  display: flex;
  align-items: center;
  gap: 8px;
}
.comment-input-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.comment-input-row .el-button {
  flex-shrink: 0;
}
.comment-list {
  min-height: 20px;
}
.comment-item {
  display: flex;
  gap: 10px;
  padding: 12px 0;
}
.comment-item + .comment-item {
  border-top: 1px dashed var(--pv-border);
}
/* 回复折叠开关与回复项：缩进对齐评论头像右侧，浅色底区分楼层 */
.reply-toggle {
  padding: 0 0 6px 42px;
}
.reply-item {
  margin-left: 42px;
  padding: 10px 12px;
  background: var(--pv-tint);
  border-radius: 10px;
  border-top: none;
}
.reply-item + .reply-item {
  margin-top: 8px;
}
.comment-avatar {
  flex-shrink: 0;
  background: var(--pv-tint);
  color: var(--pv-text);
}
.comment-body {
  flex: 1;
  min-width: 0;
}
.comment-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.comment-user {
  font-size: 13px;
  font-weight: 600;
  color: var(--pv-text);
  cursor: pointer;
}
.comment-user:hover {
  text-decoration: underline;
}
.comment-arrow {
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.comment-time {
  font-size: 12px;
  color: var(--pv-text-secondary);
  margin-left: auto;
}
.comment-content {
  margin-top: 4px;
  font-size: 14px;
  color: var(--pv-text);
  line-height: 1.6;
  word-break: break-word;
  white-space: pre-wrap;
}
.comment-actions {
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.comment-pager {
  padding: 14px 0 4px;
  display: flex;
  justify-content: center;
}
.comment-empty {
  padding: 16px 0;
  text-align: center;
  font-size: 13px;
  color: var(--pv-text-secondary);
}

@media (max-width: 768px) {
  /* 窄屏收窄回复缩进，给长评论多留宽度 */
  .reply-toggle {
    padding-left: 24px;
  }
  .reply-item {
    margin-left: 24px;
  }
}
</style>
