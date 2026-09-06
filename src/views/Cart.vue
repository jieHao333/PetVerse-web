<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, ShoppingCart } from '@element-plus/icons-vue'
import { createOrder, listCart, payOrder, removeCartItem, updateCartItem } from '@/api/shop'

const router = useRouter()

const loading = ref(false)
const items = ref([])
// 勾选结算的购物车条目ID
const checkedIds = ref([])

const loadCart = async () => {
  loading.value = true
  try {
    items.value = (await listCart()) || []
    // 清理已不存在条目的勾选状态
    checkedIds.value = checkedIds.value.filter((id) => items.value.some((it) => String(it.id) === String(id)))
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

onMounted(loadCart)

// 按店铺分组展示
const groups = computed(() => {
  const map = new Map()
  for (const item of items.value) {
    const key = String(item.merchantId)
    if (!map.has(key)) {
      map.set(key, { merchantId: item.merchantId, shopName: item.shopName, items: [] })
    }
    map.get(key).items.push(item)
  }
  return Array.from(map.values())
})

const isChecked = (item) => checkedIds.value.some((id) => String(id) === String(item.id))

const toggleItem = (item, checked) => {
  const key = String(item.id)
  if (checked) {
    if (!checkedIds.value.some((id) => String(id) === key)) {
      checkedIds.value.push(item.id)
    }
  } else {
    checkedIds.value = checkedIds.value.filter((id) => String(id) !== key)
  }
}

// 店内全选/取消全选
const toggleGroup = (group, checked) => {
  for (const item of group.items) {
    if (item.valid) {
      toggleItem(item, checked)
    }
  }
}

const isGroupAllChecked = (group) => {
  const validItems = group.items.filter((it) => it.valid)
  return validItems.length > 0 && validItems.every((it) => isChecked(it))
}

// 修改数量（后端校验库存上限）
const onQuantityChange = async (item, quantity) => {
  try {
    await updateCartItem({ id: item.id, quantity })
    item.quantity = quantity
  } catch (e) {
    ElMessage.error(e.message)
    loadCart()
  }
}

const onRemove = async (item) => {
  try {
    await removeCartItem(item.id)
    ElMessage.success('已从购物车移除')
    loadCart()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

const checkedItems = computed(() => items.value.filter((it) => isChecked(it)))

const totalAmount = computed(() =>
  checkedItems.value.reduce((sum, it) => sum + Number(it.price) * it.quantity, 0).toFixed(2),
)

/* ==================== 结算下单 ==================== */

const checkoutDialog = ref(false)
const remark = ref('')
const creating = ref(false)

const openCheckout = () => {
  if (checkedItems.value.length === 0) {
    ElMessage.warning('请先勾选要结算的商品')
    return
  }
  // 一次只能结算同一店铺的商品
  const merchantIds = new Set(checkedItems.value.map((it) => String(it.merchantId)))
  if (merchantIds.size > 1) {
    ElMessage.warning('一次只能结算同一店铺的商品，请分批勾选')
    return
  }
  remark.value = ''
  checkoutDialog.value = true
}

// 下单后进入模拟支付
const payDialog = ref(false)
const paying = ref(false)
const pendingOrder = ref(null)

const onCreateOrder = async () => {
  creating.value = true
  try {
    const order = await createOrder({
      cartItemIds: checkedItems.value.map((it) => it.id),
      remark: remark.value || undefined,
    })
    ElMessage.success('订单已创建，请在 24 小时内完成支付')
    checkoutDialog.value = false
    pendingOrder.value = order
    payDialog.value = true
  } catch (e) {
    ElMessage.error(e.message)
    loadCart()
  } finally {
    creating.value = false
  }
}

const onPay = async () => {
  paying.value = true
  try {
    const order = await payOrder(pendingOrder.value.id)
    pendingOrder.value = order
    ElMessage.success('支付成功，请凭取货码到店取货')
    payDialog.value = false
    loadCart()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    paying.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="page-container">
      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <span class="card-title">我的购物车</span>
            <el-button text :icon="ArrowLeft" @click="router.push('/shop')">继续逛商城</el-button>
          </div>
        </template>

        <div v-loading="loading">
          <el-empty v-if="!loading && items.length === 0" description="购物车还是空的，快去挑选心仪的商品吧~">
            <el-button type="primary" :icon="ShoppingCart" @click="router.push('/shop')">去逛商城</el-button>
          </el-empty>

          <div v-for="group in groups" v-else :key="group.merchantId" class="shop-group">
            <div class="shop-group-header">
              <el-checkbox
                :model-value="isGroupAllChecked(group)"
                @change="(val) => toggleGroup(group, val)"
              >
                <span class="shop-name" @click="router.push(`/shop/store/${group.merchantId}`)">
                  🏪 {{ group.shopName }}
                </span>
              </el-checkbox>
            </div>

            <div v-for="item in group.items" :key="item.id" class="cart-item" :class="{ invalid: !item.valid }">
              <el-checkbox
                :model-value="isChecked(item)"
                :disabled="!item.valid"
                @change="(val) => toggleItem(item, val)"
              />
              <el-image :src="item.productImage || ''" fit="cover" class="item-img">
                <template #error>
                  <div class="img-placeholder">🛍️</div>
                </template>
              </el-image>
              <div class="item-info">
                <div class="item-name">{{ item.productName }}</div>
                <div v-if="!item.valid" class="invalid-tip">商品已失效（下架或售罄）</div>
                <div class="item-price">¥{{ item.price }}</div>
              </div>
              <el-input-number
                :model-value="item.quantity"
                :min="1"
                :max="Math.max(item.stock || 1, 1)"
                :disabled="!item.valid"
                size="small"
                @change="(val) => val && onQuantityChange(item, val)"
              />
              <div class="item-subtotal">¥{{ (Number(item.price) * item.quantity).toFixed(2) }}</div>
              <el-button type="danger" link @click="onRemove(item)">删除</el-button>
            </div>
          </div>
        </div>

        <!-- 底部结算栏 -->
        <div v-if="items.length > 0" class="checkout-bar">
          <div class="checkout-tip">仅支持到店自取，支付后凭取货码到店取货</div>
          <div class="checkout-right">
            <span class="checkout-total">
              合计：<em>¥{{ totalAmount }}</em>
              <span class="checked-count">（已选 {{ checkedItems.length }} 件商品）</span>
            </span>
            <el-button type="primary" size="large" :disabled="checkedItems.length === 0" @click="openCheckout">
              去结算
            </el-button>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 确认订单 -->
    <el-dialog v-model="checkoutDialog" title="确认订单" width="480px">
      <div class="confirm-body">
        <div class="confirm-shop">🏪 {{ checkedItems[0]?.shopName }} · 到店自取</div>
        <div v-for="item in checkedItems" :key="item.id" class="confirm-item">
          <span class="confirm-name">{{ item.productName }} × {{ item.quantity }}</span>
          <span class="confirm-amount">¥{{ (Number(item.price) * item.quantity).toFixed(2) }}</span>
        </div>
        <div class="confirm-total">
          应付金额：<em>¥{{ totalAmount }}</em>
        </div>
        <el-input
          v-model="remark"
          type="textarea"
          :rows="2"
          maxlength="200"
          show-word-limit
          placeholder="买家备注（选填），如期望取货时间等"
        />
      </div>
      <template #footer>
        <el-button @click="checkoutDialog = false">再想想</el-button>
        <el-button type="primary" :loading="creating" @click="onCreateOrder">提交订单</el-button>
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

/* 店铺分组 */
.shop-group {
  border: 1px solid var(--pv-border);
  border-radius: 12px;
  margin-bottom: 16px;
  overflow: hidden;
}
.shop-group-header {
  padding: 10px 16px;
  background: var(--pv-tint);
}
.shop-name {
  font-weight: 600;
  color: var(--pv-text);
  cursor: pointer;
}
.shop-name:hover {
  color: var(--pv-ink);
}

.cart-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-top: 1px solid var(--pv-border);
}
.cart-item.invalid {
  opacity: 0.55;
}
.item-img {
  width: 64px;
  height: 64px;
  border-radius: 10px;
  flex-shrink: 0;
  background: var(--pv-tint);
}
.img-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
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
.invalid-tip {
  font-size: 12px;
  color: #f56c6c;
  margin-top: 4px;
}
.item-price {
  margin-top: 6px;
  color: var(--pv-text-secondary);
  font-size: 13px;
}
.item-subtotal {
  color: #d4380d;
  font-weight: 600;
  min-width: 84px;
  text-align: right;
}

/* 结算栏 */
.checkout-bar {
  margin-top: 8px;
  padding: 14px 16px;
  border: 1px solid var(--pv-border);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  background: var(--pv-tint);
}
.checkout-tip {
  font-size: 13px;
  color: var(--pv-text-secondary);
}
.checkout-right {
  display: flex;
  align-items: center;
  gap: 18px;
}
.checkout-total {
  font-size: 14px;
  color: var(--pv-text);
}
.checkout-total em {
  font-style: normal;
  color: #d4380d;
  font-size: 20px;
  font-weight: 700;
}
.checked-count {
  font-size: 12px;
  color: var(--pv-text-secondary);
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
