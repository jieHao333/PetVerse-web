<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ShoppingCart } from '@element-plus/icons-vue'
import { addCartItem, buyNowOrder, deleteReviewReply, getProductDetail, getReviewSummary, pageProductReviews, pageReviewReplies, payOrder, saveReviewReply } from '@/api/shop'
import { summarizeProductReviews } from '@/api/ai'
import { DEFAULT_AVATAR } from '@/utils/avatar'

const route = useRoute()
const router = useRouter()

const productId = computed(() => route.params.id)

/* ==================== 商品详情 ==================== */

const detail = ref(null)
const loading = ref(false)
const quantity = ref(1)

const categoryTagType = (code) => ({ 1: 'primary', 2: 'warning', 3: 'danger' })[code] || 'info'

const loadDetail = async () => {
  loading.value = true
  try {
    detail.value = await getProductDetail(productId.value)
    quantity.value = 1
  } catch (e) {
    ElMessage.error(e.message)
    detail.value = null
  } finally {
    loading.value = false
  }
}

// 点击店铺名进入店家页面
const goStore = () => {
  if (detail.value?.merchantId) {
    router.push(`/shop/store/${detail.value.merchantId}`)
  }
}

/* ==================== 加入购物车 / 立即购买 ==================== */

const addingCart = ref(false)

const onAddToCart = async () => {
  addingCart.value = true
  try {
    await addCartItem({ productId: detail.value.id, quantity: quantity.value })
    ElMessage.success('已加入购物车')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    addingCart.value = false
  }
}

// 直接购买：先确认订单（可填备注），下单后进入模拟支付
const buyDialog = ref(false)
const buying = ref(false)
const buyRemark = ref('')

const openBuyDialog = () => {
  buyRemark.value = ''
  buyDialog.value = true
}

const payDialog = ref(false)
const paying = ref(false)
const pendingOrder = ref(null)

const onBuyNow = async () => {
  buying.value = true
  try {
    const order = await buyNowOrder({
      productId: detail.value.id,
      quantity: quantity.value,
      remark: buyRemark.value || undefined,
    })
    buyDialog.value = false
    pendingOrder.value = order
    payDialog.value = true
  } catch (e) {
    ElMessage.error(e.message)
    loadDetail()
  } finally {
    buying.value = false
  }
}

const onPay = async () => {
  paying.value = true
  try {
    pendingOrder.value = await payOrder(pendingOrder.value.id)
    ElMessage.success('支付成功，请凭取货码到店取货')
    payDialog.value = false
    // 支付后库存已扣减，刷新详情
    loadDetail()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    paying.value = false
  }
}

const buyTotal = computed(() =>
  detail.value ? (Number(detail.value.price) * quantity.value).toFixed(2) : '0.00',
)

/* ==================== 用户评价（只读展示，发表/修改在订单页的评价专用页） ==================== */

const activeTab = ref('intro')
const summary = ref(null)
const reviews = ref([])
const reviewTotal = ref(0)
const reviewPageNum = ref(1)
const reviewPageSize = ref(10)
// 星级筛选：0 表示全部
const ratingFilter = ref(0)
const reviewLoading = ref(false)

const loadSummary = async () => {
  try {
    summary.value = await getReviewSummary(productId.value)
  } catch {
    // 评价摘要加载失败不影响购买主流程，静默降级
    summary.value = null
  }
}

/* ==================== AI 评论总结（LangGraph 编排生成） ==================== */

const aiSummary = ref(null)
const aiSummaryLoading = ref(false)

const onAiSummary = async () => {
  if (aiSummaryLoading.value) return
  aiSummaryLoading.value = true
  try {
    aiSummary.value = await summarizeProductReviews(productId.value)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    aiSummaryLoading.value = false
  }
}

// 情感 -> 展示文案 / 标签色
const sentimentMeta = (s) =>
  ({
    positive: { text: '好评居多', type: 'success' },
    negative: { text: '差评居多', type: 'danger' },
  })[s] || { text: '评价中性', type: 'info' }

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

/* ==================== 评价回复互动（所有登录用户可质询/回复，无需购买过该商品） ==================== */

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

// 点击回复：reply 为空表示直接回复该评价（如质询“该商品真的这么好吗？”），否则回复某条回复
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
  loadDetail()
  loadSummary()
  loadReviews()
})
</script>

<template>
  <div class="page">
    <div class="page-container">
      <el-card shadow="never" class="section">
        <template #header>
          <div class="card-header">
            <span class="card-title">商品详情</span>
            <div class="header-actions">
              <el-button :icon="ShoppingCart" plain @click="router.push('/shop/cart')">购物车</el-button>
              <el-button :icon="ArrowLeft" @click="router.push('/shop')">返回商城</el-button>
            </div>
          </div>
        </template>

        <div v-loading="loading">
          <el-empty v-if="!loading && !detail" description="商品不存在或已下架">
            <el-button type="primary" @click="router.push('/shop')">返回商城</el-button>
          </el-empty>

          <div v-else-if="detail" class="detail-layout">
            <!-- 左侧主图 -->
            <div class="detail-gallery">
              <el-image :src="detail.imageUrl || ''" fit="cover" class="main-img">
                <template #error>
                  <div class="img-placeholder">🛍️</div>
                </template>
              </el-image>
            </div>

            <!-- 右侧购买区 -->
            <div class="detail-info">
              <div class="info-name">{{ detail.name }}</div>
              <div class="info-tags">
                <el-tag :type="categoryTagType(detail.category)" size="small" effect="plain">
                  {{ detail.categoryName }}
                </el-tag>
              </div>
              <div class="info-price-box">
                <span class="price-label">售价</span>
                <span class="price">¥{{ detail.price }}</span>
                <span class="stock">库存 {{ detail.stock }}</span>
              </div>
              <div class="info-shop">
                <span class="shop-label">店铺</span>
                <span class="shop-name" @click="goStore">🏪 {{ detail.shopName || '未知店铺' }}</span>
                <el-button link type="primary" size="small" @click="goStore">进入店铺 ›</el-button>
              </div>
              <div class="info-buy">
                <span class="buy-label">数量</span>
                <el-input-number v-model="quantity" :min="1" :max="Math.max(detail.stock || 1, 1)" />
                <span class="buy-total">合计：<em>¥{{ buyTotal }}</em></span>
              </div>
              <div class="info-actions">
                <el-button
                  size="large"
                  :icon="ShoppingCart"
                  :loading="addingCart"
                  :disabled="!detail.stock"
                  @click="onAddToCart"
                >
                  加入购物车
                </el-button>
                <el-button
                  type="primary"
                  size="large"
                  :disabled="!detail.stock"
                  @click="openBuyDialog"
                >
                  {{ detail.stock ? '立即购买' : '已售罄' }}
                </el-button>
              </div>
              <div class="info-tip">仅支持到店自取，支付后凭取货码到店取货</div>
            </div>
          </div>
        </div>
      </el-card>

      <!-- 商品介绍 / 用户评价 -->
      <el-card v-if="detail" shadow="never" class="section">
        <el-tabs v-model="activeTab">
          <el-tab-pane label="商品介绍" name="intro">
            <div class="intro-body">
              <div v-if="detail.description" class="intro-desc">{{ detail.description }}</div>
              <el-empty v-else description="商家还没有填写商品介绍" :image-size="80" />
            </div>
          </el-tab-pane>

          <el-tab-pane label="用户评价" name="review">
            <!-- 评价摘要：平均分 + 总数 -->
            <div v-if="summary && summary.totalCount > 0" class="review-summary">
              <span class="summary-score">{{ summary.avgRating }}</span>
              <el-rate :model-value="Number(summary.avgRating)" disabled allow-half size="small" />
              <span class="summary-total">共 {{ summary.totalCount }} 条评价</span>
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

            <!-- AI 评论总结：由 LangGraph 汇总真实评论，生成口碑概览 -->
            <div v-if="summary && summary.totalCount > 0" class="ai-review-box">
              <div class="ai-review-head">
                <span class="ai-review-title">✨ AI 评论总结</span>
                <el-button type="primary" plain size="small" round :loading="aiSummaryLoading" @click="onAiSummary">
                  {{ aiSummary ? '重新生成' : '生成总结' }}
                </el-button>
              </div>
              <div v-if="aiSummary && aiSummary.count > 0" class="ai-review-body">
                <div class="ai-review-oneline">
                  <el-tag :type="sentimentMeta(aiSummary.sentiment).type" size="small" effect="dark">
                    {{ sentimentMeta(aiSummary.sentiment).text }}
                  </el-tag>
                  <span>{{ aiSummary.one_line }}</span>
                </div>
                <div v-if="aiSummary.pros?.length" class="ai-review-cols">
                  <div class="ai-review-col">
                    <div class="ai-review-label good">👍 优点</div>
                    <ul><li v-for="(p, i) in aiSummary.pros" :key="i">{{ p }}</li></ul>
                  </div>
                  <div v-if="aiSummary.cons?.length" class="ai-review-col">
                    <div class="ai-review-label bad">👎 不足</div>
                    <ul><li v-for="(c, i) in aiSummary.cons" :key="i">{{ c }}</li></ul>
                  </div>
                </div>
                <div v-if="aiSummary.keywords?.length" class="ai-review-keywords">
                  <el-tag v-for="(k, i) in aiSummary.keywords" :key="i" size="small" effect="plain" type="info">
                    {{ k }}
                  </el-tag>
                </div>
                <div class="ai-review-note">基于 {{ aiSummary.count }} 条真实评论由 AI 生成，仅供参考</div>
              </div>
              <div v-else-if="aiSummary" class="ai-review-empty">该商品暂无足够评论可供 AI 总结</div>
              <div v-else class="ai-review-empty">点击「生成总结」，AI 将汇总真实评论帮你快速了解商品口碑</div>
            </div>

            <div v-loading="reviewLoading" class="review-list">
              <div v-for="item in reviews" :key="item.id" class="review-item">
                <el-avatar :size="40" :src="item.userAvatar || DEFAULT_AVATAR" class="review-avatar">
                  {{ (item.userNickname || '宠').slice(0, 1) }}
                </el-avatar>
                <div class="review-body">
                  <div class="review-head">
                    <span class="review-user">{{ item.userNickname || `用户${item.userId}` }}</span>
                    <el-rate :model-value="item.rating" disabled size="small" />
                    <span class="review-time">{{ formatTime(item.createTime) }}</span>
                  </div>
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

                  <!-- 回复互动：所有登录用户均可质询/回复，无需购买过该商品 -->
                  <div class="review-actions">
                    <el-button link type="primary" size="small" @click="toggleReplies(item)">
                      {{
                        replyOf(item.id).open
                          ? '收起回复'
                          : replyOf(item.id).loaded && replyOf(item.id).total > 0
                            ? `回复 (${replyOf(item.id).total})`
                            : '回复'
                      }}
                    </el-button>
                  </div>

                  <div v-if="replyOf(item.id).open" class="reply-section">
                    <div v-loading="replyOf(item.id).loading" class="reply-list">
                      <div v-for="reply in replyOf(item.id).list" :key="reply.id" class="reply-item">
                        <el-avatar :size="28" :src="reply.userAvatar || DEFAULT_AVATAR" class="reply-avatar">
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
                        还没有人回复，来质询或追问吧~
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
                description="暂无评价，购买并完成取货后即可评价"
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
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </div>

    <!-- 确认直接购买 -->
    <el-dialog v-model="buyDialog" title="确认订单" width="460px">
      <div v-if="detail" class="confirm-body">
        <div class="confirm-shop">🏪 {{ detail.shopName }} · 到店自取</div>
        <div class="confirm-item">
          <span class="confirm-name">{{ detail.name }} × {{ quantity }}</span>
          <span class="confirm-amount">¥{{ buyTotal }}</span>
        </div>
        <div class="confirm-total">应付金额：<em>¥{{ buyTotal }}</em></div>
        <el-input
          v-model="buyRemark"
          type="textarea"
          :rows="2"
          maxlength="200"
          show-word-limit
          placeholder="买家备注（选填），如期望取货时间等"
        />
      </div>
      <template #footer>
        <el-button @click="buyDialog = false">再想想</el-button>
        <el-button type="primary" :loading="buying" @click="onBuyNow">提交订单</el-button>
      </template>
    </el-dialog>

    <!-- 模拟支付 -->
    <el-dialog v-model="payDialog" title="订单支付" width="420px" :close-on-click-modal="false">
      <div v-if="pendingOrder" class="pay-body">
        <div class="pay-order-no">订单号：{{ pendingOrder.orderNo }}</div>
        <div class="pay-amount">¥{{ pendingOrder.totalAmount }}</div>
        <div class="pay-tip">模拟支付环境，点击下方按钮即视为支付成功；支付完成后生成取货码</div>
      </div>
      <template #footer>
        <el-button @click="router.push('/shop/orders')">稍后支付</el-button>
        <el-button type="primary" :loading="paying" @click="onPay">确认支付</el-button>
      </template>
    </el-dialog>
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
  gap: 14px;
  flex-wrap: wrap;
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
.header-actions {
  display: flex;
  align-items: center;
}

/* 详情布局：左图右信息 */
.detail-layout {
  display: flex;
  gap: 28px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.detail-gallery {
  width: 380px;
  flex-shrink: 0;
}
.main-img {
  width: 100%;
  height: 380px;
  border-radius: 14px;
  background: var(--pv-tint);
  display: block;
}
.img-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 72px;
  background: var(--pv-tint);
  border-radius: 14px;
}
.detail-info {
  flex: 1;
  min-width: 320px;
}
.info-name {
  font-size: 22px;
  font-weight: 700;
  color: var(--pv-text);
  line-height: 1.4;
}
.info-tags {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.info-price-box {
  margin-top: 16px;
  padding: 14px 18px;
  background: var(--pv-tint);
  border-radius: 12px;
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.price-label {
  font-size: 13px;
  color: var(--pv-text-secondary);
}
.price {
  color: #d4380d;
  font-size: 30px;
  font-weight: 700;
}
.stock {
  font-size: 13px;
  color: var(--pv-text-secondary);
  margin-left: auto;
}
.info-shop {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.shop-label {
  font-size: 13px;
  color: var(--pv-text-secondary);
}
.shop-name {
  font-weight: 600;
  color: var(--pv-text);
  cursor: pointer;
}
.shop-name:hover {
  color: var(--pv-ink);
  text-decoration: underline;
}
.info-buy {
  margin-top: 18px;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.buy-label {
  font-size: 13px;
  color: var(--pv-text-secondary);
}
.buy-total {
  font-size: 14px;
  color: var(--pv-text);
}
.buy-total em {
  font-style: normal;
  color: #d4380d;
  font-size: 20px;
  font-weight: 700;
}
.info-actions {
  margin-top: 22px;
  display: flex;
  gap: 14px;
}
.info-tip {
  margin-top: 14px;
  font-size: 12px;
  color: var(--pv-text-secondary);
}

/* 商品介绍 */
.intro-body {
  min-height: 120px;
}
.intro-desc {
  color: var(--pv-text);
  line-height: 1.8;
  white-space: pre-wrap;
}

/* 用户评价（只读展示） */
.review-summary {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.summary-score {
  font-size: 32px;
  font-weight: 700;
  color: #d4380d;
}
.summary-total {
  font-size: 13px;
  color: var(--pv-text-secondary);
}
.summary-filters {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.summary-filters .el-button + .el-button {
  margin-left: 0;
}

/* AI 评论总结 */
.ai-review-box {
  border: 1px solid #e4ddf7;
  border-radius: 12px;
  background: linear-gradient(180deg, #faf8ff 0%, #ffffff 100%);
  padding: 14px 16px;
  margin-bottom: 16px;
}
.ai-review-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.ai-review-title {
  font-size: 14px;
  font-weight: 700;
  color: #6b4fd8;
}
.ai-review-body {
  margin-top: 12px;
}
.ai-review-oneline {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--pv-text);
}
.ai-review-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 20px;
  margin-top: 10px;
}
.ai-review-label {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 4px;
}
.ai-review-label.good {
  color: #2ec7a0;
}
.ai-review-label.bad {
  color: #e8604c;
}
.ai-review-col ul {
  margin: 0;
  padding-left: 16px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--pv-text);
}
.ai-review-keywords {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.ai-review-note {
  margin-top: 10px;
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.ai-review-empty {
  margin-top: 10px;
  font-size: 13px;
  color: var(--pv-text-secondary);
}
@media (max-width: 768px) {
  .ai-review-cols {
    grid-template-columns: 1fr;
  }
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
.review-actions {
  margin-top: 6px;
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
.pager {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}

/* 确认订单弹窗 */
.confirm-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.confirm-shop {
  font-weight: 600;
  color: var(--pv-text);
}
.confirm-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  color: var(--pv-text-secondary);
}
.confirm-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.confirm-total {
  text-align: right;
  font-size: 14px;
}
.confirm-total em {
  font-style: normal;
  color: #d4380d;
  font-size: 18px;
  font-weight: 700;
}

/* 支付弹窗 */
.pay-body {
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pay-order-no {
  font-size: 13px;
  color: var(--pv-text-secondary);
}
.pay-amount {
  font-size: 34px;
  font-weight: 700;
  color: #d4380d;
}
.pay-tip {
  font-size: 12px;
  color: var(--pv-text-secondary);
}
</style>
