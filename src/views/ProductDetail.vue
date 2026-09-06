<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ShoppingCart } from '@element-plus/icons-vue'
import { addCartItem, buyNowOrder, getProductDetail, getReviewSummary, pageProductReviews, payOrder } from '@/api/shop'

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
