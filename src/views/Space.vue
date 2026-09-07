<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CircleClose, Plus, Search, Star, StarFilled } from '@element-plus/icons-vue'
import { deleteSpace, getSpacePage, saveSpace, updateSpace, uploadSpaceMedia } from '@/api/space'
import { DEFAULT_AVATAR } from '@/utils/avatar'
import {
  COMMENT_TARGET_SPACE,
  LIKE_TARGET_SPACE,
  deleteComment,
  getCommentCounts,
  getCommentPage,
  likeTarget,
  saveComment,
  unlikeTarget,
} from '@/api/remark'

const router = useRouter()

const spaces = ref([])
const total = ref(0)
const pageNum = ref(1)
const pageSize = ref(10)
const keyword = ref('')
const category = ref('')
// 排序方式：latest-最新 / hot-最热(按点赞数热度)
const sort = ref('latest')
// 发布时间范围：[开始日期, 结束日期]，格式 YYYY-MM-DD，起止均含当天
const dateRange = ref(null)
const loading = ref(false)

// 当前登录用户ID，仅本人动态展示编辑/删除入口
const myId = String(JSON.parse(localStorage.getItem('user') || 'null')?.id || '')
const isMySpace = (item) => String(item.userId) === myId

// 媒体规格（与后端保持一致）：图片≤5MB，视频(mp4)≤50MB，单条最多9个
const MAX_MEDIA_COUNT = 9
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const MAX_VIDEO_SIZE = 50 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

const dialogVisible = ref(false)
const saving = ref(false)
const isEdit = ref(false)
const form = ref({ id: null, title: '', content: '', category: '', visibility: 0, mediaList: [] })
// 进行中的上传数量（支持多文件并发上传），计数归零才允许发布
const uploadingCount = ref(0)
const uploading = computed(() => uploadingCount.value > 0)

const loadSpaces = async () => {
  loading.value = true
  try {
    const data = await getSpacePage({
      pageNum: pageNum.value,
      pageSize: pageSize.value,
      keyword: keyword.value || undefined,
      category: category.value || undefined,
      sort: sort.value,
      // 选中的日期换算为当天零点与当天末尾，确保起止日期当天的动态都能命中
      startTime: dateRange.value?.[0] ? `${dateRange.value[0]} 00:00:00` : undefined,
      endTime: dateRange.value?.[1] ? `${dateRange.value[1]} 23:59:59` : undefined,
    })
    spaces.value = data.records
    // 后端 Long 统一序列化为字符串（防雪花ID精度丢失），total 需还原为数字供分页组件使用
    total.value = Number(data.total || 0)
    // 动态列表刷新后重置各条评论区状态，并批量拉取评论数快照
    commentStateMap.value = {}
    loadCommentCounts()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

onMounted(loadSpaces)

const onSearch = () => {
  pageNum.value = 1
  loadSpaces()
}

// 切换排序后回到第一页重新加载
const onSortChange = () => {
  pageNum.value = 1
  loadSpaces()
}

// 点赞/取消点赞：乐观更新计数与状态，失败时回滚
const likingIds = ref(new Set())
const onToggleLike = async (item) => {
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

/* ==================== 动态评论互动（评论按钮展开查看该动态下所有评论） ==================== */

// 判断是否本人（Long 已序列化为字符串，统一转字符串比较），本人评论可删除
const isMine = (userId) => String(userId) === myId

// 每条动态的评论数快照（列表加载后批量拉取，key 为动态ID字符串）
const commentCountMap = ref({})

const loadCommentCounts = async () => {
  const ids = spaces.value.map((s) => s.id).filter(Boolean)
  if (!ids.length) {
    commentCountMap.value = {}
    return
  }
  try {
    commentCountMap.value = (await getCommentCounts(COMMENT_TARGET_SPACE, ids)) || {}
  } catch {
    // 评论数拉取失败不阻断动态展示，按 0 处理
    commentCountMap.value = {}
  }
}

// 每条动态独立的评论区状态：展开/列表/分页/输入框/回复对象
const commentStateMap = ref({})

const commentOf = (spaceId) => {
  if (!commentStateMap.value[spaceId]) {
    commentStateMap.value[spaceId] = {
      open: false,
      list: [],
      total: 0,
      pageNum: 1,
      pageSize: 10,
      loading: false,
      loaded: false,
      input: '',
      target: null,
      submitting: false,
    }
  }
  return commentStateMap.value[spaceId]
}

// 展示的评论数：已展开加载过用实时总数，否则用批量拉取的快照
const commentCount = (item) => {
  const state = commentStateMap.value[item.id]
  if (state && state.loaded) return state.total
  return Number(commentCountMap.value[item.id] || 0)
}

const toggleComments = (item) => {
  const state = commentOf(item.id)
  state.open = !state.open
  if (state.open && !state.loaded) {
    loadComments(item.id)
  }
}

const loadComments = async (spaceId, append = false) => {
  const state = commentOf(spaceId)
  state.loading = true
  try {
    const data = await getCommentPage({
      targetType: COMMENT_TARGET_SPACE,
      targetId: spaceId,
      pageNum: state.pageNum,
      pageSize: state.pageSize,
    })
    const records = data.records || []
    state.list = append ? [...state.list, ...records] : records
    state.total = Number(data.total || 0)
    state.loaded = true
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    state.loading = false
  }
}

const loadMoreComments = (spaceId) => {
  const state = commentOf(spaceId)
  state.pageNum += 1
  loadComments(spaceId, true)
}

// 点击回复：comment 为空表示直接评论动态，否则回复某条评论
const startCommentReply = (spaceId, comment = null) => {
  const state = commentOf(spaceId)
  state.open = true
  if (!state.loaded) {
    loadComments(spaceId)
  }
  state.target = comment
    ? { userId: comment.userId, nickname: comment.userNickname || `用户${comment.userId}` }
    : null
  state.input = ''
}

const cancelCommentTarget = (spaceId) => {
  commentOf(spaceId).target = null
}

const onSubmitComment = async (spaceId) => {
  const state = commentOf(spaceId)
  if (!state.input.trim()) {
    ElMessage.warning('请输入评论内容')
    return
  }
  state.submitting = true
  try {
    const comment = await saveComment({
      targetType: COMMENT_TARGET_SPACE,
      targetId: spaceId,
      content: state.input,
      replyUserId: state.target?.userId || undefined,
    })
    // 时间正序展示，新评论直接追加到末尾，同步刷新计数
    state.list = [...state.list, comment]
    state.total += 1
    commentCountMap.value[spaceId] = state.total
    state.input = ''
    state.target = null
    ElMessage.success('评论成功')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    state.submitting = false
  }
}

const onDeleteComment = (spaceId, comment) => {
  ElMessageBox.confirm('确定删除这条评论吗？', '删除评论', {
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消',
  })
    .then(async () => {
      try {
        await deleteComment(comment.id)
        const state = commentOf(spaceId)
        state.list = state.list.filter((it) => String(it.id) !== String(comment.id))
        state.total -= 1
        commentCountMap.value[spaceId] = state.total
        ElMessage.success('评论已删除')
      } catch (e) {
        ElMessage.error(e.message)
      }
    })
    .catch(() => {})
}

// 切换每页条数后回到第一页重新加载
const onSizeChange = () => {
  pageNum.value = 1
  loadSpaces()
}

const openCreate = () => {
  isEdit.value = false
  form.value = { id: null, title: '', content: '', category: '', visibility: 0, mediaList: [] }
  dialogVisible.value = true
}

const openEdit = (item) => {
  isEdit.value = true
  form.value = {
    id: item.id,
    title: item.title || '',
    content: item.content,
    category: item.category || '',
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
const handleUpload = async ({ file }) => {
  const localUrl = URL.createObjectURL(file)
  const isImage = IMAGE_TYPES.includes(file.type)
  form.value.mediaList.push({ mediaType: isImage ? 0 : 1, url: localUrl })
  const index = form.value.mediaList.length - 1
  uploadingCount.value += 1
  try {
    const res = await uploadSpaceMedia(file)
    if (index < form.value.mediaList.length && form.value.mediaList[index]?.url === localUrl) {
      form.value.mediaList[index] = { mediaType: res.mediaType, url: res.url }
    }
  } catch (e) {
    const pos = form.value.mediaList.findIndex((m) => m.url === localUrl)
    if (pos > -1) form.value.mediaList.splice(pos, 1)
    ElMessage.error(e.message)
  } finally {
    URL.revokeObjectURL(localUrl)
    uploadingCount.value -= 1
  }
}

const removeMedia = (index) => {
  form.value.mediaList.splice(index, 1)
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
      category: form.value.category || undefined,
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
    loadSpaces()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
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
    loadSpaces()
  } catch {
    // 用户取消则不处理
  }
}

const formatTime = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '')

// 点击作者名跳转用户主页（与其他页面用户名交互保持一致）
const gotoProfile = (userId) => {
  if (userId) router.push(`/user/${userId}`)
}

// 媒体九宫格：单张占满一行，两张两列，其余三列
const mediaGridClass = (item) => {
  const count = item.mediaList?.length || 0
  if (count === 1) return 'media-grid single'
  if (count === 2 || count === 4) return 'media-grid two-col'
  return 'media-grid'
}

// 图片预览列表（仅取图片项），供 el-image 放大预览
const previewImages = (item) => (item.mediaList || []).filter((m) => m.mediaType === 0).map((m) => m.url)

const previewIndex = (item, media) => previewImages(item).indexOf(media.url)
</script>

<template>
  <div class="page">
    <div class="page-container">
      <div class="page-head">
        <div>
          <h2 class="page-title">圈子</h2>
          <p class="page-desc">看看大家与宠物在一起的每个瞬间 · 发布新动态可为宠物 +10 经验</p>
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
          v-model.trim="category"
          placeholder="按分类筛选"
          clearable
          class="toolbar-input narrow"
          @keyup.enter="onSearch"
          @clear="onSearch"
        />
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="YYYY-MM-DD"
          clearable
          @change="onSearch"
        />
        <el-button @click="onSearch">搜索</el-button>
        <el-radio-group v-model="sort" class="sort-toggle" @change="onSortChange">
          <el-radio-button value="latest">最新</el-radio-button>
          <el-radio-button value="hot">最热</el-radio-button>
        </el-radio-group>
      </div>

      <!-- 动态流 -->
      <div v-loading="loading" class="feed-list">
        <div v-for="item in spaces" :key="item.id" class="feed-card pv-panel">
          <div class="feed-head">
            <el-avatar :size="40" :src="item.authorAvatar || DEFAULT_AVATAR" class="feed-avatar">
              {{ (item.authorNickname || item.authorUsername || 'U')[0]?.toUpperCase() }}
            </el-avatar>
            <div class="feed-meta">
              <span class="feed-author" @click="gotoProfile(item.userId)">
                {{ item.authorNickname || item.authorUsername }}
              </span>
              <div class="feed-sub">
                <span class="feed-time">{{ formatTime(item.createTime) }}</span>
                <el-tag v-if="item.category" size="small" type="info" effect="plain" round>
                  {{ item.category }}
                </el-tag>
              </div>
            </div>
            <div v-if="isMySpace(item)" class="feed-actions">
              <el-button link type="primary" @click="openEdit(item)">编辑</el-button>
              <el-button link type="danger" @click="onDelete(item)">删除</el-button>
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

          <div class="feed-footer">
            <el-button
              link
              :class="['like-btn', { liked: item.liked }]"
              :icon="item.liked ? StarFilled : Star"
              @click="onToggleLike(item)"
            >
              {{ Number(item.likeCount || 0) > 0 ? Number(item.likeCount) : (item.liked ? '1' : '点赞') }}
            </el-button>
            <el-button link class="comment-btn" @click="toggleComments(item)">
              💬 {{ commentOf(item.id).open ? '收起回复' : '评论' }}
              <span v-if="commentCount(item) > 0">({{ commentCount(item) }})</span>
            </el-button>
          </div>

          <!-- 评论互动区：查看该动态下所有评论，也可参与评论/回复 -->
          <div v-if="commentOf(item.id).open" class="comment-section">
            <div v-loading="commentOf(item.id).loading" class="comment-list">
              <div v-for="c in commentOf(item.id).list" :key="c.id" class="comment-item">
                <el-avatar :size="28" :src="c.userAvatar || DEFAULT_AVATAR" class="comment-avatar">
                  {{ (c.userNickname || '宠').slice(0, 1) }}
                </el-avatar>
                <div class="comment-body">
                  <div class="comment-head">
                    <span class="comment-user" @click="gotoProfile(c.userId)">
                      {{ c.userNickname || `用户${c.userId}` }}
                    </span>
                    <template v-if="c.replyUserId">
                      <span class="comment-arrow">回复</span>
                      <span class="comment-user" @click="gotoProfile(c.replyUserId)">
                        @{{ c.replyUserNickname || `用户${c.replyUserId}` }}
                      </span>
                    </template>
                    <span class="comment-time">{{ formatTime(c.createTime) }}</span>
                  </div>
                  <div class="comment-content">{{ c.content }}</div>
                  <div class="comment-actions">
                    <el-button link type="primary" size="small" @click="startCommentReply(item.id, c)">回复</el-button>
                    <el-button
                      v-if="isMine(c.userId)"
                      link
                      type="danger"
                      size="small"
                      @click="onDeleteComment(item.id, c)"
                    >
                      删除
                    </el-button>
                  </div>
                </div>
              </div>

              <div v-if="commentOf(item.id).list.length < commentOf(item.id).total" class="comment-more">
                <el-button link type="primary" size="small" @click="loadMoreComments(item.id)">
                  查看更多评论（已加载 {{ commentOf(item.id).list.length }}/{{ commentOf(item.id).total }}）
                </el-button>
              </div>
              <div
                v-if="!commentOf(item.id).loading && commentOf(item.id).list.length === 0"
                class="comment-empty"
              >
                还没有人评论，来说两句吧
              </div>
            </div>

            <div class="comment-input">
              <div v-if="commentOf(item.id).target" class="comment-target">
                回复 @{{ commentOf(item.id).target.nickname }}
                <el-button link size="small" @click="cancelCommentTarget(item.id)">取消</el-button>
              </div>
              <div class="comment-input-row">
                <el-input
                  v-model="commentOf(item.id).input"
                  maxlength="500"
                  show-word-limit
                  :placeholder="commentOf(item.id).target ? '回复这条评论…' : '评论这条动态…'"
                  @keyup.enter="onSubmitComment(item.id)"
                />
                <el-button
                  type="primary"
                  :loading="commentOf(item.id).submitting"
                  @click="onSubmitComment(item.id)"
                >
                  发布
                </el-button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="!loading && !spaces.length" class="feed-empty pv-panel">
          {{
            keyword || category || dateRange
              ? '没有搜索到相关动态'
              : '还没有可见的动态，点击「发布动态」分享第一个瞬间吧'
          }}
        </div>

        <div v-if="total > 0" class="pager pv-panel">
          <span class="total-text">共 {{ total }} 条</span>
          <el-pagination
            v-model:current-page="pageNum"
            v-model:page-size="pageSize"
            :page-sizes="[10, 15, 20, 50]"
            :total="Number(total)"
            layout="sizes, prev, pager, next"
            background
            @current-change="loadSpaces"
            @size-change="onSizeChange"
          />
        </div>
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
        <el-form-item label="分类">
          <el-input v-model.trim="form.category" placeholder="如：日常、养宠经验（选填）" maxlength="50" />
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
          <div class="upload-tip">支持 jpg/png/webp/gif 图片（≤5MB）或 mp4 视频（≤50MB），最多 9 个</div>
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
.sort-toggle {
  margin-left: auto;
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

/* 评论互动区 */
.comment-section {
  margin-top: 12px;
  padding: 10px 14px;
  background: var(--pv-tint);
  border-radius: 10px;
}
.comment-list {
  min-height: 20px;
}
.comment-item {
  display: flex;
  gap: 10px;
  padding: 8px 0;
}
.comment-item + .comment-item {
  border-top: 1px dashed var(--pv-border);
}
.comment-avatar {
  flex-shrink: 0;
  background: #fff;
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
  font-size: 12px;
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
  font-size: 13px;
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
.comment-more {
  padding: 4px 0;
}
.comment-empty {
  padding: 6px 0;
  font-size: 12px;
  color: var(--pv-text-secondary);
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

.pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  padding: 14px 20px;
}
.total-text {
  font-size: 13px;
  color: var(--pv-text-secondary);
}
</style>
