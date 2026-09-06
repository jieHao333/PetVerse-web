<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { getProductDetail, getReviewSummary, pageProductReviews } from '@/api/shop'
import {
  deleteProductReview,
  deleteReviewReply,
  pageReviewReplies,
  saveProductReview,
  saveReviewReply,
  updateProductReview,
  uploadShopImage,
  uploadShopVideo,
} from '@/api/shop'

const route = useRoute()

const productId = computed(() => route.params.id)

/* ==================== 评价媒体上传（图片最多9张，视频最多1个） ==================== */

const MAX_IMAGES = 9
const IMAGE_SIZE_LIMIT = 5 * 1024 * 1024
const VIDEO_SIZE_LIMIT = 50 * 1024 * 1024

// 选择图片并上传：校验数量与大小后存入列表，供发表/编辑表单复用
const addImages = async (uploadFile, uploading, images) => {
  if (images.value.length >= MAX_IMAGES) {
    ElMessage.warning(`评价图片最多上传${MAX_IMAGES}张`)
    return
  }
  if (uploadFile.raw.size > IMAGE_SIZE_LIMIT) {
    ElMessage.error('图片大小不能超过5MB')
    return
  }
  uploading.value = true
  try {
    images.value.push(await uploadShopImage(uploadFile.raw))
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    uploading.value = false
  }
}

// 选择视频并上传：同一时间仅保留一个，再次选择会覆盖
const addVideo = async (uploadFile, uploading, video) => {
  if (uploadFile.raw.size > VIDEO_SIZE_LIMIT) {
    ElMessage.error('视频大小不能超过50MB')
    return
  }
  uploading.value = true
  try {
    video.value = await uploadShopVideo(uploadFile.raw)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    uploading.value = false
  }
}

/* ==================== 商品描述信息（评价专用页不含任何购买入口） ==================== */

const product = ref(null)
const productLoading = ref(false)

const categoryTagType = (code) => ({ 1: 'primary', 2: 'warning', 3: 'danger' })[code] || 'info'

const loadProduct = async () => {
  productLoading.value = true
  try {
    product.value = await getProductDetail(productId.value)
  } catch {
    // 商品可能已下架（详情接口仅上架商品可见），降级为仅展示评价区，不影响评价资格
    product.value = null
  } finally {
    productLoading.value = false
  }
}

/* ==================== 评价资格 ==================== */

const summary = ref(null)
const summaryLoading = ref(false)

const loadSummary = async () => {
  summaryLoading.value = true
  try {
    summary.value = await getReviewSummary(productId.value)
  } catch (e) {
    ElMessage.error(e.message)
    summary.value = null
  } finally {
    summaryLoading.value = false
  }
}

/* ==================== 发表评价（完成后自动关闭标签页） ==================== */

const reviewForm = ref({ rating: 5, content: '' })
const submittingReview = ref(false)
const formImages = ref([])
const formVideo = ref('')
const formImageUploading = ref(false)
const formVideoUploading = ref(false)

const onFormImageChange = (uploadFile) => addImages(uploadFile, formImageUploading, formImages)
const onFormVideoChange = (uploadFile) => addVideo(uploadFile, formVideoUploading, formVideo)

// 评价操作完成后自动关闭本标签页（页面由「我的订单」脚本打开，允许被脚本关闭；
// 若浏览器拦截自动关闭，停留本页可手动关闭）
const autoClose = (message) => {
  ElMessage.success(message)
  setTimeout(() => window.close(), 800)
}

const onSubmitReview = async () => {
  submittingReview.value = true
  try {
    await saveProductReview({
      productId: productId.value,
      rating: reviewForm.value.rating,
      content: reviewForm.value.content || undefined,
      imageUrls: formImages.value.length ? formImages.value : undefined,
      videoUrl: formVideo.value || undefined,
    })
    autoClose('评价成功，感谢您的反馈')
  } catch (e) {
    ElMessage.error(e.message)
    loadSummary()
  } finally {
    submittingReview.value = false
  }
}

/* ==================== 修改 / 删除我的评价 ==================== */

// 当前登录用户ID（Long 已序列化为字符串，统一转字符串比较）
const myId = String(JSON.parse(localStorage.getItem('user') || 'null')?.id || '')

const isMine = (userId) => String(userId) === myId

// 内联编辑我的评价：一次只编辑一条
const editingId = ref(null)
const editForm = ref({ rating: 5, content: '' })
const savingEdit = ref(false)
const editImages = ref([])
const editVideo = ref('')
const editImageUploading = ref(false)
const editVideoUploading = ref(false)

const startEdit = (item) => {
  editingId.value = item.id
  editForm.value = { rating: item.rating, content: item.content || '' }
  editImages.value = item.imageUrls ? [...item.imageUrls] : []
  editVideo.value = item.videoUrl || ''
}

const onEditImageChange = (uploadFile) => addImages(uploadFile, editImageUploading, editImages)
const onEditVideoChange = (uploadFile) => addVideo(uploadFile, editVideoUploading, editVideo)

const cancelEdit = () => {
  editingId.value = null
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
    autoClose('评价已更新')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    savingEdit.value = false
  }
}

const onDeleteReview = (item) => {
  ElMessageBox.confirm('删除后将无法重新评价该商品，确定删除吗？', '删除评价', {
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消',
  })
    .then(async () => {
      try {
        await deleteProductReview(item.id)
        autoClose('评价已删除')
      } catch (e) {
        ElMessage.error(e.message)
      }
    })
    .catch(() => {})
}

/* ==================== 评价列表 ==================== */

const reviews = ref([])
const reviewTotal = ref(0)
const reviewPageNum = ref(1)
const reviewPageSize = ref(10)
// 星级筛选：0 表示全部
const ratingFilter = ref(0)
const reviewLoading = ref(false)

const loadReviews = async () => {
  reviewLoading.value = true
  try {
    const data = await pageProductReviews({
      productId: productId.value,
      pageNum: reviewPageNum.value,
      pageSize: reviewPageSize.value,
      rating: ratingFilter.value || undefined,
    })
    reviews.value = data.records || []
    // 后端 Long 统一序列化为字符串，total 需还原为数字供分页组件使用
    reviewTotal.value = Number(data.total || 0)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    reviewLoading.value = false
  }
}

const onRatingFilter = (rating) => {
  ratingFilter.value = rating
  reviewPageNum.value = 1
  loadReviews()
}

const onReviewSizeChange = () => {
  reviewPageNum.value = 1
  loadReviews()
}

const formatTime = (time) => (time ? String(time).replace('T', ' ').slice(0, 16) : '')

/* ==================== 评价回复互动 ==================== */

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
  const state = replyOf(item.id)
  state.open = !state.open
  if (state.open && !state.loaded) {
    loadReplies(item.id)
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

onMounted(() => {
  loadProduct()
  loadSummary()
  loadReviews()
})
</script>

<template>
  <div class="page">
    <div class="page-container">
      <!-- 商品描述信息（仅展示，无购买入口） -->
      <el-card v-loading="productLoading" shadow="never" class="section">
        <template #header>
          <div class="card-header">
            <span class="card-title">商品评价</span>
          </div>
        </template>

        <div v-if="product" class="product-info">
          <el-image :src="product.imageUrl || ''" fit="cover" class="product-img">
            <template #error>
              <div class="img-placeholder">🛍️</div>
            </template>
          </el-image>
          <div class="product-detail">
            <div class="product-name">{{ product.name }}</div>
            <el-tag :type="categoryTagType(product.category)" size="small" effect="plain">
              {{ product.categoryName }}
            </el-tag>
            <div class="product-desc">{{ product.description || '商家还没有填写商品介绍' }}</div>
          </div>
        </div>
        <el-alert
          v-else-if="!productLoading"
          title="商品信息暂不可见（可能已下架），仍可继续查看和发表评价"
          type="info"
          :closable="false"
        />
      </el-card>

      <!-- 评价区 -->
      <el-card v-loading="summaryLoading" shadow="never" class="section">
        <!-- 发表评价（仅购买完成且未评价过的用户可见） -->
        <div v-if="summary?.canReview" class="review-form">
          <div class="review-form-title">您购买过该商品，来分享一下使用体验吧~</div>
          <el-rate v-model="reviewForm.rating" show-text :texts="['很差', '较差', '一般', '满意', '非常满意']" />
          <el-input
            v-model="reviewForm.content"
            type="textarea"
            :rows="4"
            maxlength="500"
            show-word-limit
            placeholder="说说商品的质量、使用感受等（选填）"
          />
          <div class="media-block">
            <div class="media-label">晒图/视频（选填，图片最多{{ MAX_IMAGES }}张、视频1个）</div>
            <div v-loading="formImageUploading || formVideoUploading" class="media-list">
              <div v-for="(img, i) in formImages" :key="img" class="media-thumb">
                <el-image
                  :src="img"
                  fit="cover"
                  class="media-img"
                  :preview-src-list="formImages"
                  :initial-index="i"
                  hide-on-click-modal
                />
                <span class="media-remove" @click="formImages.splice(i, 1)">×</span>
              </div>
              <div v-if="formVideo" class="media-thumb">
                <video :src="formVideo" class="media-video" muted preload="metadata"></video>
                <span class="media-remove" @click="formVideo = ''">×</span>
              </div>
              <el-upload
                v-if="formImages.length < MAX_IMAGES"
                class="media-add"
                accept="image/*"
                multiple
                :auto-upload="false"
                :show-file-list="false"
                :on-change="onFormImageChange"
              >
                <div class="media-add-inner"><span class="media-add-icon">＋</span><span>图片</span></div>
              </el-upload>
              <el-upload
                v-if="!formVideo"
                class="media-add"
                accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm"
                :auto-upload="false"
                :show-file-list="false"
                :on-change="onFormVideoChange"
              >
                <div class="media-add-inner"><span class="media-add-icon">＋</span><span>视频</span></div>
              </el-upload>
            </div>
          </div>
          <div class="review-form-footer">
            <el-button type="primary" size="large" :loading="submittingReview" @click="onSubmitReview">
              发表评价
            </el-button>
          </div>
        </div>
        <el-alert
          v-else-if="summary?.reviewed"
          title="您已评价过该商品，可在下方评价列表中修改或删除"
          type="success"
          :closable="false"
          class="review-alert"
        />
        <el-alert
          v-else-if="summary?.everReviewed"
          title="您已删除该商品的评价，删除后无法重新评价"
          type="warning"
          :closable="false"
          class="review-alert"
        />
        <el-alert
          v-else-if="summary"
          title="购买并完成取货后才能评价该商品"
          type="warning"
          :closable="false"
          class="review-alert"
        />

        <!-- 评价列表 -->
        <div class="list-header">
          <span class="list-title">全部评价</span>
          <div class="summary-filters">
            <el-button
              :type="ratingFilter === 0 ? 'primary' : 'default'"
              size="small"
              round
              @click="onRatingFilter(0)"
            >
              全部
            </el-button>
            <el-button
              v-for="star in [5, 4, 3, 2, 1]"
              :key="star"
              :type="ratingFilter === star ? 'primary' : 'default'"
              size="small"
              round
              @click="onRatingFilter(star)"
            >
              {{ star }} 星
            </el-button>
          </div>
        </div>

        <div v-loading="reviewLoading" class="review-list">
          <div v-for="item in reviews" :key="item.id" class="review-item">
            <el-avatar :size="40" :src="item.userAvatar || ''" class="review-avatar">
              {{ (item.userNickname || '宠').slice(0, 1) }}
            </el-avatar>
            <div class="review-body">
              <div class="review-head">
                <span class="review-user">{{ item.userNickname || `用户${item.userId}` }}</span>
                <el-rate :model-value="item.rating" disabled size="small" />
                <span class="review-time">{{ formatTime(item.createTime) }}</span>
              </div>

              <!-- 编辑态：内联修改评分与内容 -->
              <div v-if="editingId === item.id" class="edit-form">
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

              <template v-else>
                <div class="review-content">{{ item.content || '该用户没有填写评价内容' }}</div>
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
                <div class="review-actions">
                  <el-button link type="primary" size="small" @click="startReply(item.id)">回复</el-button>
                  <template v-if="isMine(item.userId)">
                    <el-button link size="small" @click="startEdit(item)">修改</el-button>
                    <el-button link type="danger" size="small" @click="onDeleteReview(item)">删除</el-button>
                  </template>
                </div>
              </template>

              <!-- 回复互动区 -->
              <div v-if="replyOf(item.id).open" class="reply-section">
                <div v-loading="replyOf(item.id).loading" class="reply-list">
                  <div v-for="reply in replyOf(item.id).list" :key="reply.id" class="reply-item">
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
                        <el-button link type="primary" size="small" @click="startReply(item.id, reply)">回复</el-button>
                        <el-button
                          v-if="isMine(reply.userId)"
                          link
                          type="danger"
                          size="small"
                          @click="onDeleteReply(item.id, reply)"
                        >
                          删除
                        </el-button>
                      </div>
                    </div>
                  </div>

                  <div v-if="replyOf(item.id).list.length < replyOf(item.id).total" class="reply-more">
                    <el-button link type="primary" size="small" @click="loadMoreReplies(item.id)">
                      查看更多回复（已加载 {{ replyOf(item.id).list.length }}/{{ replyOf(item.id).total }}）
                    </el-button>
                  </div>
                  <div v-if="!replyOf(item.id).loading && replyOf(item.id).list.length === 0" class="reply-empty">
                    还没有人回复，来说点什么吧~
                  </div>
                </div>

                <div class="reply-input">
                  <div v-if="replyOf(item.id).target" class="reply-target">
                    回复 @{{ replyOf(item.id).target.nickname }}
                    <el-button link size="small" @click="cancelReplyTarget(item.id)">取消</el-button>
                  </div>
                  <div class="reply-input-row">
                    <el-input
                      v-model="replyOf(item.id).input"
                      maxlength="500"
                      show-word-limit
                      placeholder="友善互动，比如：该商品真的这么好吗？"
                      @keyup.enter="onSubmitReply(item.id)"
                    />
                    <el-button
                      type="primary"
                      :loading="replyOf(item.id).submitting"
                      @click="onSubmitReply(item.id)"
                    >
                      发布
                    </el-button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <el-empty
            v-if="!reviewLoading && reviews.length === 0"
            :description="ratingFilter ? '该星级下暂无评价' : '暂无评价，购买并完成取货后即可评价'"
            :image-size="80"
          />
        </div>

        <div v-if="reviewTotal > 0" class="pager">
          <el-pagination
            v-model:current-page="reviewPageNum"
            v-model:page-size="reviewPageSize"
            :page-sizes="[10, 15, 20, 50]"
            :total="Number(reviewTotal)"
            layout="sizes, prev, pager, next"
            background
            @current-change="loadReviews"
            @size-change="onReviewSizeChange"
          />
        </div>
      </el-card>

      <div class="close-tip">评价完成后本页面将自动关闭；若浏览器阻止自动关闭，请手动关闭此标签页</div>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
}
.section {
  margin-bottom: 24px;
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

/* 商品描述信息 */
.product-info {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}
.product-img {
  width: 160px;
  height: 160px;
  border-radius: 12px;
  background: var(--pv-tint);
  flex-shrink: 0;
  display: block;
}
.img-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48px;
  background: var(--pv-tint);
  border-radius: 12px;
}
.product-detail {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}
.product-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--pv-text);
  line-height: 1.4;
}
.product-desc {
  color: var(--pv-text-secondary);
  line-height: 1.8;
  white-space: pre-wrap;
}

/* 发表评价 */
.review-form {
  padding: 16px 18px;
  border: 1px solid var(--pv-border);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.review-form-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--pv-text);
}
.review-form-footer {
  display: flex;
  justify-content: flex-end;
}
.review-alert {
  margin-bottom: 16px;
}

/* 评价列表 */
.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.list-title {
  font-weight: 700;
  font-size: 14px;
  color: var(--pv-text);
}
.summary-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.summary-filters .el-button + .el-button {
  margin-left: 0;
}
.review-list {
  min-height: 80px;
}
.review-item {
  display: flex;
  gap: 14px;
  padding: 16px 4px;
  border-bottom: 1px solid var(--pv-border);
}
.review-item:last-child {
  border-bottom: none;
}
.review-avatar {
  flex-shrink: 0;
  background: var(--pv-tint);
  color: var(--pv-text);
}
.review-body {
  flex: 1;
  min-width: 0;
}
.review-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.review-user {
  font-weight: 600;
  font-size: 13px;
  color: var(--pv-text);
}
.review-time {
  font-size: 12px;
  color: var(--pv-text-secondary);
  margin-left: auto;
}
.review-content {
  margin-top: 6px;
  font-size: 13px;
  color: var(--pv-text);
  line-height: 1.7;
  word-break: break-word;
}
.review-actions {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 评价晒单媒体：上传九宫格与列表展示共用视觉 */
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

/* 评价列表中的晒单媒体 */
.review-media {
  margin-top: 8px;
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

/* 内联编辑我的评价 */
.edit-form {
  margin-top: 8px;
  padding: 12px 14px;
  border: 1px solid var(--pv-border);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.edit-form-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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
.pager {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
.close-tip {
  text-align: center;
  font-size: 12px;
  color: var(--pv-text-secondary);
  padding-bottom: 12px;
}
</style>
