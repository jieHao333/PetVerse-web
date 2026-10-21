<script setup>
import { onMounted, ref } from 'vue'
import { exchangeCoupon, getIssuingCoupons, pageMyCoupons, receiveCoupon } from '@/api/coupon'

const DISCOUNT_TYPES = {
  1: '每满减',
  2: '折扣',
  3: '无门槛',
  4: '满减',
}

const MY_STATUS = {
  1: { label: '未使用', type: 'success' },
  2: { label: '已使用', type: 'info' },
  3: { label: '已过期', type: 'danger' },
}

const yuan = (cents) => (Number(cents) || 0) / 100

const fmtDate = (value) => (value ? String(value).replace('T', ' ').slice(0, 10) : '')

/** 主展示值：折扣券显示折数，其余显示抵扣金额 */
const mainValue = (coupon) =>
  coupon.discountType === 2
    ? `${(Number(coupon.discountValue) / 10).toFixed(1)}折`
    : `¥${yuan(coupon.discountValue).toFixed(2)}`

const conditionText = (coupon) => {
  if (coupon.discountType === 3) return '无门槛可用'
  if (coupon.discountType === 1) return `每满${yuan(coupon.thresholdAmount)}元可用`
  return `满${yuan(coupon.thresholdAmount)}元可用`
}

const ruleText = (coupon) => {
  const threshold = yuan(coupon.thresholdAmount).toFixed(2)
  const value = yuan(coupon.discountValue).toFixed(2)
  const max = yuan(coupon.maxDiscountAmount).toFixed(2)
  switch (coupon.discountType) {
    case 1:
      return `每满${threshold}元减${value}元，上限${max}元`
    case 2:
      return `满${threshold}元打${(Number(coupon.discountValue) / 10).toFixed(1)}折，上限${max}元`
    case 3:
      return `无门槛抵${value}元`
    default:
      return `满${threshold}元减${value}元`
  }
}

const validityText = (coupon) => {
  if (coupon.termEndTime) return `有效期至 ${fmtDate(coupon.termEndTime)}`
  if (coupon.termDays) return `领取后 ${coupon.termDays} 天有效`
  return '长期有效'
}

const activeTab = ref('center')

/* ==================== 兑换码兑换 ==================== */

const exchangeCode = ref('')
const exchanging = ref(false)
const CODE_PATTERN = /^[6CSB7H8DAKXZF3N95RTMVUQG2YE4JWPL]{10}$/

const onExchange = async () => {
  const code = exchangeCode.value.trim().toUpperCase()
  if (!CODE_PATTERN.test(code)) {
    ElMessage.warning('请输入 10 位有效兑换码')
    return
  }
  exchanging.value = true
  try {
    await exchangeCoupon(code)
    ElMessage.success('兑换成功，可在「我的优惠券」查看')
    exchangeCode.value = ''
    if (activeTab.value === 'mine') {
      loadMine()
    }
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    exchanging.value = false
  }
}

/* ==================== 领券中心 ==================== */

const issuing = ref([])
const loadingIssuing = ref(false)
const claimingId = ref(null)

const loadIssuing = async () => {
  loadingIssuing.value = true
  try {
    const data = await getIssuingCoupons()
    // 只展示当前用户还能领取的券：已抢光或已达每人限领数量的不再展示
    issuing.value = (data || []).filter((coupon) => coupon.available)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loadingIssuing.value = false
  }
}

const onClaim = async (coupon) => {
  claimingId.value = coupon.id
  try {
    await receiveCoupon(coupon.id)
    ElMessage.success('领取成功，可在「我的优惠券」查看')
    // 先从列表移除，避免异步落库延迟导致已领券仍短暂显示
    issuing.value = issuing.value.filter((item) => item.id !== coupon.id)
    // 稍后按服务端最新可领状态刷新：每人限领多张且仍可领取的券会重新出现
    setTimeout(loadIssuing, 1200)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    claimingId.value = null
  }
}

const claimText = (coupon) => (coupon.received ? '再领一张' : '立即领取')

/* ==================== 我的优惠券 ==================== */

const myCoupons = ref([])
const myTotal = ref(0)
const myPageNum = ref(1)
const myPageSize = ref(10)
const myStatus = ref(1)
const loadingMine = ref(false)

const loadMine = async () => {
  loadingMine.value = true
  try {
    const data = await pageMyCoupons({
      status: myStatus.value,
      pageNum: myPageNum.value,
      pageSize: myPageSize.value,
    })
    myCoupons.value = data.records || []
    myTotal.value = Number(data.total || 0)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loadingMine.value = false
  }
}

const onTabChange = (name) => {
  if (name === 'mine') {
    myPageNum.value = 1
    loadMine()
  }
}

const onStatusChange = () => {
  myPageNum.value = 1
  loadMine()
}

const onMySizeChange = () => {
  myPageNum.value = 1
  loadMine()
}

onMounted(loadIssuing)
</script>

<template>
  <div class="page">
    <div class="page-container">
      <el-alert
        type="info"
        show-icon
        :closable="false"
        title="领券中心"
        description="领取的优惠券会放入「我的优惠券」，下单结算时可直接抵扣。每张券有领取上限，先到先得。"
        class="top-alert"
      />

      <div class="exchange-card">
        <div class="exchange-info">
          <div class="exchange-title">🎟️ 兑换码兑换</div>
          <div class="exchange-desc">输入兑换码领取指定优惠券，兑换码不区分大小写</div>
        </div>
        <div class="exchange-form">
          <el-input
            v-model="exchangeCode"
            maxlength="10"
            clearable
            placeholder="请输入 10 位兑换码"
            @keyup.enter="onExchange"
          />
          <el-button type="primary" :loading="exchanging" @click="onExchange">立即兑换</el-button>
        </div>
      </div>

      <el-tabs v-model="activeTab" class="coupon-tabs" @tab-change="onTabChange">
        <el-tab-pane label="领券中心" name="center">
          <div v-loading="loadingIssuing" class="coupon-panel">
            <div v-if="issuing.length" class="coupon-grid">
              <div
                v-for="coupon in issuing"
                :key="coupon.id"
                class="coupon-card"
                :class="{ inactive: coupon.received || !coupon.available }"
              >
                <div class="coupon-left">
                  <div class="coupon-value">{{ mainValue(coupon) }}</div>
                  <div class="coupon-condition">{{ conditionText(coupon) }}</div>
                </div>
                <div class="coupon-body">
                  <div class="coupon-head">
                    <span class="coupon-name">{{ coupon.name }}</span>
                    <el-tag v-if="coupon.specific" size="small" type="info" effect="plain">限定范围</el-tag>
                  </div>
                  <div class="coupon-rule">{{ ruleText(coupon) }}</div>
                  <div class="coupon-meta">
                    <span>{{ validityText(coupon) }}</span>
                    <span>{{ DISCOUNT_TYPES[coupon.discountType] }}</span>
                  </div>
                  <el-button
                    class="coupon-btn"
                    type="primary"
                    round
                    size="small"
                    :loading="claimingId === coupon.id"
                    @click="onClaim(coupon)"
                  >
                    {{ claimText(coupon) }}
                  </el-button>
                </div>
              </div>
            </div>
            <el-empty v-else-if="!loadingIssuing" description="暂无可领取的优惠券，去商城逛逛吧" />
          </div>
        </el-tab-pane>

        <el-tab-pane label="我的优惠券" name="mine">
          <div class="my-toolbar">
            <el-radio-group v-model="myStatus" @change="onStatusChange">
              <el-radio-button :value="1">未使用</el-radio-button>
              <el-radio-button :value="2">已使用</el-radio-button>
              <el-radio-button :value="3">已过期</el-radio-button>
            </el-radio-group>
            <span class="my-total">共 {{ myTotal }} 张</span>
          </div>

          <div v-loading="loadingMine" class="coupon-panel">
            <div v-if="myCoupons.length" class="coupon-grid">
              <div
                v-for="coupon in myCoupons"
                :key="coupon.id"
                class="coupon-card"
                :class="{ inactive: myStatus !== 1 }"
              >
                <div class="coupon-left">
                  <div class="coupon-value">{{ mainValue(coupon) }}</div>
                  <div class="coupon-condition">{{ conditionText(coupon) }}</div>
                </div>
                <div class="coupon-body">
                  <div class="coupon-head">
                    <span class="coupon-name">{{ coupon.name }}</span>
                    <el-tag size="small" :type="MY_STATUS[myStatus].type" effect="plain">
                      {{ MY_STATUS[myStatus].label }}
                    </el-tag>
                  </div>
                  <div class="coupon-rule">{{ ruleText(coupon) }}</div>
                  <div class="coupon-meta">
                    <span>{{ validityText(coupon) }}</span>
                    <span>{{ DISCOUNT_TYPES[coupon.discountType] }}</span>
                  </div>
                </div>
              </div>
            </div>
            <el-empty v-else-if="!loadingMine" :description="`暂无${MY_STATUS[myStatus].label}的优惠券`" />
          </div>

          <div v-if="myTotal > myPageSize" class="pager">
            <el-pagination
              v-model:current-page="myPageNum"
              v-model:page-size="myPageSize"
              :page-sizes="[10, 20, 50]"
              :total="myTotal"
              layout="sizes, prev, pager, next"
              background
              @current-change="loadMine"
              @size-change="onMySizeChange"
            />
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<style scoped>
.top-alert {
  margin-bottom: 16px;
}
.exchange-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 16px 20px;
  margin-bottom: 16px;
  border-radius: 14px;
  border: 1px dashed var(--pv-border);
  background: var(--pv-tint);
}
.exchange-info {
  min-width: 0;
}
.exchange-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--pv-text);
}
.exchange-desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.exchange-form {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 360px;
  max-width: 100%;
}
.exchange-form :deep(.el-input) {
  flex: 1;
}
.coupon-tabs :deep(.el-tabs__header) {
  margin-bottom: 18px;
}
.coupon-panel {
  min-height: 180px;
}
.coupon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: 16px;
}
.coupon-card {
  display: flex;
  min-height: 132px;
  border-radius: 14px;
  overflow: hidden;
  background: var(--pv-glass-strong);
  border: 1px solid var(--pv-border);
  box-shadow: var(--pv-shadow-sm);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.coupon-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--pv-shadow);
}
.coupon-card.inactive {
  opacity: 0.62;
}
.coupon-left {
  flex-shrink: 0;
  width: 118px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 16px 8px;
  background: var(--pv-ink);
  color: #fff;
  position: relative;
}
.coupon-left::after {
  content: '';
  position: absolute;
  right: -1px;
  top: 0;
  bottom: 0;
  border-right: 1px dashed rgba(255, 255, 255, 0.35);
}
.coupon-value {
  font-size: 24px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.5px;
}
.coupon-condition {
  font-size: 11px;
  opacity: 0.72;
  text-align: center;
}
.coupon-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
}
.coupon-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.coupon-name {
  font-size: 14px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.coupon-rule {
  font-size: 12px;
  color: var(--pv-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.coupon-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--pv-text-secondary);
}
.coupon-btn {
  margin-top: auto;
  align-self: flex-end;
}
.my-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 12px;
  flex-wrap: wrap;
}
.my-total {
  font-size: 13px;
  color: var(--pv-text-secondary);
}
.pager {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 768px) {
  .coupon-grid {
    grid-template-columns: 1fr;
  }
  .coupon-value {
    font-size: 21px;
  }
}
</style>
