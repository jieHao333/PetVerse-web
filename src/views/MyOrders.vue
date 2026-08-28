<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import AppHeader from '@/components/AppHeader.vue'
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

onMounted(loadOrders)

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
</script>

<template>
  <div class="page">
    <AppHeader show-nav />

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
              <el-tag :type="statusTagType(order.status)" size="small" effect="plain">
                {{ order.statusName }}
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
            </div>

            <div class="order-foot">
              <div v-if="order.remark" class="order-remark">备注：{{ order.remark }}</div>
              <div class="order-actions">
                <span class="order-total">
                  合计：<em>¥{{ order.totalAmount }}</em>
                </span>
                <template v-if="order.status === 0">
                  <el-button :loading="payingId === order.id" type="primary" size="small" @click="onPay(order)">
                    立即支付
                  </el-button>
                  <el-button size="small" @click="onCancel(order)">取消订单</el-button>
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
