<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import { cancelOrder, pageMyOrders, payOrder } from '@/api/shop'

const router = useRouter()

const orders = ref([])
const total = ref(0)
const pageNum = ref(1)
const pageSize = ref(10)
const loading = ref(false)
// 状态筛选：空串表示全部
const status = ref('')

const statusTabs = [
  { value: '', label: '全部' },
  { value: 0, label: '待支付' },
  { value: 1, label: '待取货' },
  { value: 2, label: '已完成' },
  { value: 3, label: '已取消' },
]

const statusTagType = (code) => ({ 0: 'warning', 1: 'primary', 2: 'success', 3: 'info' })[code] || 'info'

const loadOrders = async () => {
  loading.value = true
  try {
    const data = await pageMyOrders({
      pageNum: pageNum.value,
      pageSize: pageSize.value,
      status: status.value === '' ? undefined : status.value,
    })
    orders.value = data.records || []
    // 后端 Long 统一序列化为字符串，total 需还原为数字供分页组件使用
    total.value = Number(data.total || 0)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadOrders()
  // 秒级时钟驱动待支付订单倒计时，组件卸载时释放定时器
  countdownTimer = setInterval(tick, 1000)
})

onUnmounted(() => {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
})

/* ==================== 支付倒计时 ==================== */

// 当前时钟，每秒刷新一次驱动倒计时文本重算
const now = ref(Date.now())
let countdownTimer = null
// 上次超时自动刷新时间戳，防止超时后未即时取消导致每秒重复请求列表（限 10 秒一次）
let lastAutoRefresh = 0

// 解析后端返回的支付截止时间（兼容 ISO 与空格分隔格式）
const parseDeadline = (deadline) => new Date(String(deadline).replace(' ', 'T')).getTime()

// 是否已支付超时：超时后隐藏支付/取消按钮，后端支付接口也会惰性取消并拒绝支付
const isPayExpired = (order) => !!order.payDeadline && parseDeadline(order.payDeadline) <= now.value

// 超时订单状态标签同步展示为已取消（与后端惰性取消结果一致），消除刷新返回前"待支付"标签的滞后窗口；
// 列表刷新返回后 order.status 本身即为 3，两处逻辑收敛为同一结果
const displayStatus = (order) => (order.status === 0 && isPayExpired(order) ? 3 : order.status)
const displayStatusName = (order) => (order.status === 0 && isPayExpired(order) ? '已取消' : order.statusName)

// 待支付订单剩余支付时间文本，超时后提示即将自动取消（后端延迟消息有秒级延迟属正常）
const countdownText = (order) => {
  if (!order.payDeadline) {
    return ''
  }
  if (isPayExpired(order)) {
    return '已超时，即将自动取消'
  }
  const diff = parseDeadline(order.payDeadline) - now.value
  const totalSec = Math.floor(diff / 1000)
  const pad = (n) => String(n).padStart(2, '0')
  if (totalSec >= 3600) {
    return `${Math.floor(totalSec / 3600)}:${pad(Math.floor((totalSec % 3600) / 60))}:${pad(totalSec % 60)}`
  }
  return `${pad(Math.floor(totalSec / 60))}:${pad(totalSec % 60)}`
}

const tick = () => {
  now.value = Date.now()
  // 存在已超时的待支付订单时刷新列表，同步后端自动取消后的最新状态（节流 10 秒）
  const hasExpired = orders.value.some((o) => o.status === 0 && isPayExpired(o))
  if (hasExpired && now.value - lastAutoRefresh > 10000) {
    lastAutoRefresh = now.value
    loadOrders()
  }
}

const onTabChange = () => {
  pageNum.value = 1
  loadOrders()
}

const onSizeChange = () => {
  pageNum.value = 1
  loadOrders()
}

/* ==================== 订单操作 ==================== */

// 模拟支付
const payingId = ref(null)
const onPay = async (order) => {
  payingId.value = order.id
  try {
    await payOrder(order.id)
    ElMessage.success('支付成功，请凭取货码到店取货')
    loadOrders()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    payingId.value = null
  }
}

const onCancel = async (order) => {
  try {
    await ElMessageBox.confirm('确定取消该订单吗？取消后库存将回补', '取消订单', { type: 'warning' })
  } catch {
    return
  }
  try {
    await cancelOrder(order.id)
    ElMessage.success('订单已取消')
    loadOrders()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// 查看取货码
const pickupDialog = ref(false)
const pickupOrder = ref(null)
const showPickupCode = (order) => {
  pickupOrder.value = order
  pickupDialog.value = true
}

// 已完成订单开放评价：新标签页打开评价专用页（仅商品描述信息，无购买入口，
// 发表/修改/删除评价完成后自动关闭该标签页；评价入口仅保留此路径）
const goReview = (item) => {
  const { href } = router.resolve(`/shop/product/${item.productId}/review`)
  window.open(href, '_blank')
}
</script>

<template>
  <div class="page">
    <div class="page-container">
      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <span class="card-title">我的订单</span>
            <el-button text :icon="ArrowLeft" @click="router.push('/shop')">去商城逛逛</el-button>
          </div>
        </template>

        <el-radio-group v-model="status" class="status-tabs" @change="onTabChange">
          <el-radio-button v-for="tab in statusTabs" :key="tab.label" :value="tab.value">
            {{ tab.label }}
          </el-radio-button>
        </el-radio-group>

        <div v-loading="loading" class="order-list">
          <el-empty v-if="!loading && orders.length === 0" description="暂无相关订单" />

          <div v-for="order in orders" :key="order.id" class="order-card">
            <div class="order-head">
              <span class="order-no">订单号：{{ order.orderNo }}</span>
              <span class="order-time">{{ order.createTime }}</span>
              <el-tag :type="statusTagType(displayStatus(order))" size="small" effect="plain">
                {{ displayStatusName(order) }}
              </el-tag>
            </div>

            <div class="order-shop">
              🏪
              <span class="shop-link" @click="router.push(`/shop/store/${order.merchantId}`)">
                {{ order.shopName }}
              </span>
              <el-tag size="small" effect="plain" type="info">{{ order.pickupTypeName || '到店自取' }}</el-tag>
            </div>

            <div v-for="item in order.items" :key="item.id" class="order-item">
              <el-image :src="item.productImage || ''" fit="cover" class="item-img">
                <template #error>
                  <div class="img-placeholder">🛍️</div>
                </template>
              </el-image>
              <div class="item-info">
                <div class="item-name">{{ item.productName }}</div>
                <div class="item-sub">¥{{ item.price }} × {{ item.quantity }}</div>
              </div>
              <div class="item-amount">¥{{ item.amount }}</div>
              <el-button
                v-if="order.status === 2"
                link
                type="primary"
                size="small"
                @click="goReview(item)"
              >
                评价
              </el-button>
            </div>

            <div class="order-foot">
              <div v-if="order.remark" class="order-remark">备注：{{ order.remark }}</div>
              <div class="order-actions">
                <span class="order-total">
                  合计：<em>¥{{ order.totalAmount }}</em>
                </span>
                <template v-if="order.status === 0">
                  <!-- 已超时：隐藏支付与取消入口，后端已惰性取消，等待列表刷新同步状态 -->
                  <span v-if="isPayExpired(order)" class="pay-countdown">支付已超时，订单已自动取消</span>
                  <template v-else>
                    <span class="pay-countdown">⏳ 剩余支付时间 {{ countdownText(order) }}</span>
                    <el-button :loading="payingId === order.id" type="primary" size="small" @click="onPay(order)">
                      立即支付
                    </el-button>
                    <el-button size="small" @click="onCancel(order)">取消订单</el-button>
                  </template>
                </template>
                <el-button
                  v-if="order.status === 1"
                  type="primary"
                  size="small"
                  plain
                  @click="showPickupCode(order)"
                >
                  出示取货码
                </el-button>
              </div>
            </div>
          </div>
        </div>

        <div class="pager">
          <span class="total-text">共 {{ total }} 笔订单</span>
          <el-pagination
            v-model:current-page="pageNum"
            v-model:page-size="pageSize"
            :page-sizes="[10, 20, 50]"
            :total="Number(total)"
            layout="sizes, prev, pager, next"
            background
            @current-change="loadOrders"
            @size-change="onSizeChange"
          />
        </div>
      </el-card>
    </div>

    <!-- 取货码 -->
    <el-dialog v-model="pickupDialog" title="到店取货码" width="360px">
      <div v-if="pickupOrder" class="pickup-body">
        <div class="pickup-shop">{{ pickupOrder.shopName }}</div>
        <div class="pickup-code">{{ pickupOrder.pickupCode }}</div>
        <div class="pickup-tip">到店后向商家出示此取货码完成取货</div>
      </div>
      <template #footer>
        <el-button type="primary" @click="pickupDialog = false">知道了</el-button>
      </template>
    </el-dialog>
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
.status-tabs {
  margin-bottom: 16px;
}

/* 订单卡片 */
.order-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 120px;
}
.order-card {
  border: 1px solid var(--pv-border);
  border-radius: 12px;
  overflow: hidden;
}
.order-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--pv-tint);
  font-size: 13px;
  color: var(--pv-text-secondary);
}
.order-no {
  font-weight: 500;
}
.order-time {
  margin-left: auto;
}
.order-shop {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid var(--pv-border);
  font-size: 13px;
}
.shop-link {
  font-weight: 600;
  color: var(--pv-text);
  cursor: pointer;
}
.shop-link:hover {
  color: var(--pv-ink);
}

.order-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
}
.item-img {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  flex-shrink: 0;
  background: var(--pv-tint);
}
.img-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  background: var(--pv-tint);
}
.item-info {
  flex: 1;
  min-width: 0;
}
.item-name {
  font-weight: 600;
  color: var(--pv-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-sub {
  font-size: 12px;
  color: var(--pv-text-secondary);
  margin-top: 4px;
}
.item-amount {
  color: var(--pv-text);
  font-weight: 500;
}

/* 已完成订单的评价入口 */
.order-item .el-button {
  flex-shrink: 0;
}

.order-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-top: 1px solid var(--pv-border);
}
.order-remark {
  font-size: 12px;
  color: var(--pv-text-secondary);
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.order-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}
.order-total {
  font-size: 13px;
  color: var(--pv-text-secondary);
}
.order-total em {
  font-style: normal;
  color: #d4380d;
  font-size: 17px;
  font-weight: 700;
}
.pay-countdown {
  font-size: 12px;
  font-weight: 600;
  color: #d4380d;
}

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

/* 取货码弹窗 */
.pickup-body {
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pickup-shop {
  font-weight: 600;
  color: var(--pv-text);
}
.pickup-code {
  font-size: 32px;
  font-weight: 700;
  letter-spacing: 4px;
  color: var(--pv-ink);
  padding: 16px 0;
  border: 1px dashed var(--pv-border);
  border-radius: 12px;
  background: var(--pv-tint);
}
.pickup-tip {
  font-size: 12px;
  color: var(--pv-text-secondary);
}
</style>
