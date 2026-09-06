<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  deleteProductReview,
  deleteReviewReply,
  pageMyReviews,
  pageReviewReplies,
  saveReviewReply,
  updateProductReview,
  uploadShopImage,
  uploadShopVideo,
} from '@/api/shop'

const router = useRouter()

/* ==================== 我的评价列表 ==================== */

const reviews = ref([])
const total = ref(0)
const pageNum = ref(1)
const pageSize = ref(10)
const loading = ref(false)

const categoryTagType = (code) => ({ 1: 'primary', 2: 'warning', 3: 'danger' })[code] || 'info'

const formatTime = (time) => (time ? String(time).replace('T', ' ').slice(0, 16) : '')

const loadReviews = async () => {
  loading.value = true
  try {
    const data = await pageMyReviews({ pageNum: pageNum.value, pageSize: pageSize.value })
    reviews.value = data.records || []
    // 后端 Long 统一序列化为字符串，total 需还原为数字供分页组件使用
    total.value = Number(data.total || 0)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

const onSizeChange = () => {
  pageNum.value = 1
  loadReviews()
}

// 点击商品新标签页打开商品详情页
const openDetail = (item) => {
  if (!item.productId) return
  const { href } = router.resolve(`/shop/product/${item.productId}`)
  window.open(href, '_blank')
}

/* ==================== 内联修改我的评价（含晒单媒体） ==================== */

const MAX_IMAGES = 9
const IMAGE_SIZE_LIMIT = 5 * 1024 * 1024
const VIDEO_SIZE_LIMIT = 50 * 1024 * 1024

const editingId = ref(null)
const editForm = ref({ rating: 5, content: '' })
const savingEdit = ref(false)
const editImages = ref([])
const editVideo = ref('')
const editImageUploading = ref(false)
const editVideoUploading = ref(false)

const startEdit = (item) => {
  editingId.value = item.reviewId
  editForm.value = { rating: item.rating, content: item.content || '' }
  editImages.value = item.imageUrls ? [...item.imageUrls] : []
  editVideo.value = item.videoUrl || ''
}

const cancelEdit = () => {
  editingId.value = null
}

// 选择图片并上传：校验数量与大小后存入列表
const onEditImageChange = async (uploadFile) => {
  if (editImages.value.length >= MAX_IMAGES) {
    ElMessage.warning(`评价图片最多上传${MAX_IMAGES}张`)
    return
  }
  if (uploadFile.raw.size > IMAGE_SIZE_LIMIT) {
    ElMessage.error('图片大小不能超过5MB')
    return
  }
  editImageUploading.value = true
  try {
    editImages.value.push(await uploadShopImage(uploadFile.raw))
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    editImageUploading.value = false
  }
}

// 选择视频并上传：同一时间仅保留一个，再次选择会覆盖
const onEditVideoChange = async (uploadFile) => {
  if (uploadFile.raw.size > VIDEO_SIZE_LIMIT) {
    ElMessage.error('视频大小不能超过50MB')
    return
  }
  editVideoUploading.value = true
  try {
    editVideo.value = await uploadShopVideo(uploadFile.raw)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    editVideoUploading.value = false
  }
}

const onSaveEdit = async () => {
  savingEdit.value = true
  try {
    await updateProductReview({
      id: editingId.value,
      rating: editForm.value.rating,
      content: editForm.value.content || undefined,
      // 空数组/空串表示清空媒体，后端会显式置为 NULL
      imageUrls: editImages.value,
      videoUrl: editVideo.value || '',
    })
    editingId.value = null
    ElMessage.success('评价已更新')
    loadReviews()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    savingEdit.value = false
  }
}

/* ==================== 删除我的评价 ==================== */

const onDeleteReview = (item) => {
  ElMessageBox.confirm('删除后将无法重新评价该商品，确定删除吗？', '删除评价', {
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消',
  })
    .then(async () => {
      try {
        await deleteProductReview(item.reviewId)
        ElMessage.success('评价已删除')
        loadReviews()
      } catch (e) {
        ElMessage.error(e.message)
      }
    })
    .catch(() => {})
}

/* ==================== 评价回复互动（评论按钮展开查看该评价下所有互动消息） ==================== */

// 当前登录用户ID（Long 已序列化为字符串，统一转字符串比较），用于判断本人回复可删除
const myId = String(JSON.parse(localStorage.getItem('user') || 'null')?.id || '')

const isMine = (userId) => String(userId) === myId

// 每条评价独立的回复区状态：展开/列表/分页/输入框/回复对象
const replyStateMap = ref({})

const replyOf = (reviewId) => {
  if (!replyStateMap.value[reviewId]) {
    replyStateMap.value[reviewId] = {
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
  return replyStateMap.value[reviewId]
}

const toggleReplies = (item) => {
  const state = replyOf(item.reviewId)
  state.open = !state.open
  if (state.open && !state.loaded) {
    loadReplies(item.reviewId)
  }
}

const loadReplies = async (reviewId, append = false) => {
  const state = replyOf(reviewId)
  state.loading = true
  try {
    const data = await pageReviewReplies({
      reviewId,
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

const loadMoreReplies = (reviewId) => {
  const state = replyOf(reviewId)
  state.pageNum += 1
  loadReplies(reviewId, true)
}

// 点击回复：reply 为空表示直接回复该评价，否则回复某条回复
const startReply = (reviewId, reply = null) => {
  const state = replyOf(reviewId)
  state.open = true
  if (!state.loaded) {
    loadReplies(reviewId)
  }
  state.target = reply
    ? { userId: reply.userId, nickname: reply.userNickname || `用户${reply.userId}` }
    : null
  state.input = ''
}

const cancelReplyTarget = (reviewId) => {
  replyOf(reviewId).target = null
}

const onSubmitReply = async (reviewId) => {
  const state = replyOf(reviewId)
  if (!state.input.trim()) {
    ElMessage.warning('请输入回复内容')
    return
  }
  state.submitting = true
  try {
    const reply = await saveReviewReply({
      reviewId,
      content: state.input,
      replyUserId: state.target?.userId || undefined,
    })
    // 时间正序展示，新回复直接追加到末尾
    state.list = [...state.list, reply]
    state.total += 1
    state.input = ''
    state.target = null
    ElMessage.success('回复成功')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    state.submitting = false
  }
}

const onDeleteReply = (reviewId, reply) => {
  ElMessageBox.confirm('确定删除这条回复吗？', '删除回复', {
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消',
  })
    .then(async () => {
      try {
        await deleteReviewReply(reply.id)
        const state = replyOf(reviewId)
        state.list = state.list.filter((it) => String(it.id) !== String(reply.id))
        state.total -= 1
        ElMessage.success('回复已删除')
      } catch (e) {
        ElMessage.error(e.message)
      }
    })
    .catch(() => {})
}

onMounted(loadReviews)
</script>

<template>
  <div class="page">
    <div class="page-container">
      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <span class="card-title">我的评价</span>
            <el-button text @click="router.push('/shop/orders')">我的订单</el-button>
          </div>
        </template>

        <div v-loading="loading" class="review-list">
          <el-empty v-if="!loading && reviews.length === 0" description="暂无评价，完成订单取货后即可评价" />

          <div v-for="item in reviews" :key="item.reviewId" class="review-card">
            <!-- 商品信息行 -->
            <div class="product-row" @click="openDetail(item)">
              <el-image :src="item.productImage || ''" fit="cover" class="product-img">
                <template #error>
                  <div class="img-placeholder">🛍️</div>
                </template>
              </el-image>
              <div class="product-info">
                <div class="product-name">
                  {{ item.productName || '商品已下架或删除' }}
                </div>
                <div class="product-meta">
                  <el-tag v-if="item.categoryName" :type="categoryTagType(item.category)" size="small" effect="plain">
                    {{ item.categoryName }}
                  </el-tag>
                  <span v-if="item.shopName" class="shop-name">🏪 {{ item.shopName }}</span>
                </div>
              </div>
              <span class="view-link">查看商品 ›</span>
            </div>

            <!-- 编辑态：内联修改评分、内容与晒单媒体 -->
            <div v-if="editingId === item.reviewId" class="edit-form">
              <el-rate v-model="editForm.rating" show-text :texts="['很差', '较差', '一般', '满意', '非常满意']" />
              <el-input
                v-model="editForm.content"
                type="textarea"
                :rows="3"
                maxlength="500"
                show-word-limit
                placeholder="说说商品的质量、使用感受等（选填）"
              />
              <div class="media-block">
                <div class="media-label">晒图/视频（选填，图片最多{{ MAX_IMAGES }}张、视频1个）</div>
                <div v-loading="editImageUploading || editVideoUploading" class="media-list">
                  <div v-for="(img, i) in editImages" :key="img" class="media-thumb">
                    <el-image
                      :src="img"
                      fit="cover"
                      class="media-img"
                      :preview-src-list="editImages"
                      :initial-index="i"
                      hide-on-click-modal
                    />
                    <span class="media-remove" @click="editImages.splice(i, 1)">×</span>
                  </div>
                  <div v-if="editVideo" class="media-thumb">
                    <video :src="editVideo" class="media-video" muted preload="metadata"></video>
                    <span class="media-remove" @click="editVideo = ''">×</span>
                  </div>
                  <el-upload
                    v-if="editImages.length < MAX_IMAGES"
                    class="media-add"
                    accept="image/*"
                    multiple
                    :auto-upload="false"
                    :show-file-list="false"
                    :on-change="onEditImageChange"
                  >
                    <div class="media-add-inner"><span class="media-add-icon">＋</span><span>图片</span></div>
                  </el-upload>
                  <el-upload
                    v-if="!editVideo"
                    class="media-add"
                    accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm"
                    :auto-upload="false"
                    :show-file-list="false"
                    :on-change="onEditVideoChange"
                  >
                    <div class="media-add-inner"><span class="media-add-icon">＋</span><span>视频</span></div>
                  </el-upload>
                </div>
              </div>
              <div class="edit-form-footer">
                <el-button size="small" @click="cancelEdit">取消</el-button>
                <el-button type="primary" size="small" :loading="savingEdit" @click="onSaveEdit">保存</el-button>
              </div>
            </div>

            <!-- 展示态 -->
            <template v-else>
              <div class="review-body">
                <div class="review-head">
                  <el-rate :model-value="item.rating" disabled size="small" />
                  <span class="review-time">{{ formatTime(item.createTime) }}</span>
                </div>
                <div class="review-content">{{ item.content || '我没有填写评价内容' }}</div>
                <!-- 晒单媒体：图片点击放大，视频内建播放控制 -->
                <div
                  v-if="(item.imageUrls && item.imageUrls.length) || item.videoUrl"
                  class="review-media"
                >
                  <el-image
                    v-for="(img, i) in item.imageUrls || []"
                    :key="img"
                    :src="img"
                    fit="cover"
                    class="review-media-img"
                    :preview-src-list="item.imageUrls"
                    :initial-index="i"
                    hide-on-click-modal
                  />
                  <video
                    v-if="item.videoUrl"
                    :src="item.videoUrl"
                    controls
                    preload="metadata"
                    class="review-media-video"
                  ></video>
                </div>
                <div class="review-foot">
                  <!-- 评论按钮：展开/收起该评价下的所有互动消息 -->
                  <el-button link type="primary" size="small" @click="toggleReplies(item)">
                    💬 {{ replyOf(item.reviewId).open ? '收起回复' : '评论' }}
                    ({{ replyOf(item.reviewId).loaded ? replyOf(item.reviewId).total : item.replyCount || 0 }})
                  </el-button>
                  <div class="review-actions">
                    <el-button link type="primary" size="small" @click="startEdit(item)">修改</el-button>
                    <el-button link type="danger" size="small" @click="onDeleteReview(item)">删除</el-button>
                  </div>
                </div>

                <!-- 回复互动区：查看该评价下所有互动消息，也可参与回复 -->
                <div v-if="replyOf(item.reviewId).open" class="reply-section">
                  <div v-loading="replyOf(item.reviewId).loading" class="reply-list">
                    <div v-for="reply in replyOf(item.reviewId).list" :key="reply.id" class="reply-item">
                      <el-avatar :size="28" :src="reply.userAvatar || ''" class="reply-avatar">
                        {{ (reply.userNickname || '宠').slice(0, 1) }}
                      </el-avatar>
                      <div class="reply-body">
                        <div class="reply-head">
                          <span class="reply-user">{{ reply.userNickname || `用户${reply.userId}` }}</span>
                          <template v-if="reply.replyUserId">
                            <span class="reply-arrow">回复</span>
                            <span class="reply-user">@{{ reply.replyUserNickname || `用户${reply.replyUserId}` }}</span>
                          </template>
                          <span class="reply-time">{{ formatTime(reply.createTime) }}</span>
                        </div>
                        <div class="reply-content">{{ reply.content }}</div>
                        <div class="reply-actions">
                          <el-button link type="primary" size="small" @click="startReply(item.reviewId, reply)">回复</el-button>
                          <el-button
                            v-if="isMine(reply.userId)"
                            link
                            type="danger"
                            size="small"
                            @click="onDeleteReply(item.reviewId, reply)"
                          >
                            删除
                          </el-button>
                        </div>
                      </div>
                    </div>

                    <div v-if="replyOf(item.reviewId).list.length < replyOf(item.reviewId).total" class="reply-more">
                      <el-button link type="primary" size="small" @click="loadMoreReplies(item.reviewId)">
                        查看更多回复（已加载 {{ replyOf(item.reviewId).list.length }}/{{ replyOf(item.reviewId).total }}）
                      </el-button>
                    </div>
                    <div v-if="!replyOf(item.reviewId).loading && replyOf(item.reviewId).list.length === 0" class="reply-empty">
                      还没有人回复
                    </div>
                  </div>

                  <div class="reply-input">
                    <div v-if="replyOf(item.reviewId).target" class="reply-target">
                      回复 @{{ replyOf(item.reviewId).target.nickname }}
                      <el-button link size="small" @click="cancelReplyTarget(item.reviewId)">取消</el-button>
                    </div>
                    <div class="reply-input-row">
                      <el-input
                        v-model="replyOf(item.reviewId).input"
                        maxlength="500"
                        show-word-limit
                        placeholder="回复这条评价下的互动…"
                        @keyup.enter="onSubmitReply(item.reviewId)"
                      />
                      <el-button
                        type="primary"
                        :loading="replyOf(item.reviewId).submitting"
                        @click="onSubmitReply(item.reviewId)"
                      >
                        发布
                      </el-button>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>

        <div v-if="total > 0" class="pager">
          <span class="total-text">共 {{ total }} 条评价</span>
          <el-pagination
            v-model:current-page="pageNum"
            v-model:page-size="pageSize"
            :page-sizes="[10, 15, 20, 50]"
            :total="Number(total)"
            layout="sizes, prev, pager, next"
            background
            @current-change="loadReviews"
            @size-change="onSizeChange"
          />
        </div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
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

/* 评价卡片 */
.review-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 120px;
}
.review-card {
  border: 1px solid var(--pv-border);
  border-radius: 12px;
  overflow: hidden;
}
.product-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--pv-tint);
  cursor: pointer;
}
.product-img {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  flex-shrink: 0;
  background: #fff;
}
.img-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  background: #fff;
  border-radius: 8px;
}
.product-info {
  flex: 1;
  min-width: 0;
}
.product-name {
  font-weight: 600;
  color: var(--pv-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.product-meta {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.shop-name {
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.view-link {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--pv-ink);
}
.product-row:hover .product-name {
  color: var(--pv-ink);
  text-decoration: underline;
}

/* 展示态评价内容 */
.review-body {
  padding: 12px 16px 14px;
}
.review-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.review-time {
  font-size: 12px;
  color: var(--pv-text-secondary);
  margin-left: auto;
}
.review-content {
  margin-top: 8px;
  font-size: 13px;
  color: var(--pv-text);
  line-height: 1.7;
  word-break: break-word;
}
.review-media {
  margin-top: 10px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex-wrap: wrap;
}
.review-media-img {
  width: 88px;
  height: 88px;
  border-radius: 8px;
  cursor: zoom-in;
  background: var(--pv-tint);
}
.review-media-video {
  width: 200px;
  max-height: 200px;
  border-radius: 8px;
  background: #000;
  display: block;
}
.review-foot {
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.reply-count {
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.review-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 评价回复互动区 */
.reply-section {
  margin-top: 10px;
  padding: 10px 14px;
  background: var(--pv-tint);
  border-radius: 10px;
}
.reply-list {
  min-height: 20px;
}
.reply-item {
  display: flex;
  gap: 10px;
  padding: 8px 0;
}
.reply-item + .reply-item {
  border-top: 1px dashed var(--pv-border);
}
.reply-avatar {
  flex-shrink: 0;
  background: #fff;
  color: var(--pv-text);
}
.reply-body {
  flex: 1;
  min-width: 0;
}
.reply-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.reply-user {
  font-size: 12px;
  font-weight: 600;
  color: var(--pv-text);
}
.reply-arrow {
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.reply-time {
  font-size: 12px;
  color: var(--pv-text-secondary);
  margin-left: auto;
}
.reply-content {
  margin-top: 4px;
  font-size: 13px;
  color: var(--pv-text);
  line-height: 1.6;
  word-break: break-word;
}
.reply-actions {
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.reply-more {
  padding: 4px 0;
}
.reply-empty {
  padding: 6px 0;
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.reply-target {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--pv-text-secondary);
  display: flex;
  align-items: center;
  gap: 8px;
}
.reply-input-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.reply-input-row .el-button {
  flex-shrink: 0;
}

/* 内联编辑我的评价 */
.edit-form {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.edit-form-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* 评价晒单媒体上传 */
.media-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.media-label {
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.media-list {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex-wrap: wrap;
  min-height: 72px;
}
.media-thumb {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: 8px;
  overflow: hidden;
}
.media-img {
  width: 100%;
  height: 100%;
  display: block;
  background: var(--pv-tint);
}
.media-video {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  background: #000;
}
.media-remove {
  position: absolute;
  top: 0;
  right: 0;
  width: 18px;
  height: 18px;
  line-height: 16px;
  text-align: center;
  border-radius: 0 0 0 8px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}
.media-remove:hover {
  background: rgba(0, 0, 0, 0.75);
}
.media-add :deep(.el-upload) {
  width: 72px;
  height: 72px;
  border: 1px dashed var(--pv-border);
  border-radius: 8px;
  background: var(--pv-tint);
  display: flex;
  align-items: center;
  justify-content: center;
}
.media-add-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.media-add-icon {
  font-size: 20px;
  line-height: 1;
  color: var(--pv-text-secondary);
}

/* 分页 */
.pager {
  margin-top: 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}
.total-text {
  font-size: 13px;
  color: var(--pv-text-secondary);
}
</style>
