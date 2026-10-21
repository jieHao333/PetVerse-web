<script setup>
import { onMounted, reactive, ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { useIsMobile } from '@/utils/responsive'
import {
  createCoupon,
  deleteCoupon,
  getCoupon,
  issueCoupon,
  pageCouponCodes,
  pageCoupons,
  pauseCoupon,
} from '@/api/coupon'

const isMobile = useIsMobile()

/* ==================== 字典与格式化 ==================== */

const DISCOUNT_TYPES = {
  1: '每满减',
  2: '折扣',
  3: '无门槛',
  4: '满减',
}
const typeOptions = Object.entries(DISCOUNT_TYPES).map(([value, label]) => ({
  value: Number(value),
  label,
}))

const STATUS_META = {
  1: { label: '待发放', type: 'info' },
  2: { label: '未开始', type: 'warning' },
  3: { label: '发放中', type: 'success' },
  4: { label: '发放结束', type: 'info' },
  5: { label: '已暂停', type: 'danger' },
}
const statusOptions = Object.entries(STATUS_META).map(([value, meta]) => ({
  value: Number(value),
  label: meta.label,
}))

const CATEGORY_OPTIONS = [
  { value: 1, label: '宠物用品' },
  { value: 2, label: '宠物食品' },
  { value: 3, label: '活体宠物' },
]

const yuan = (cents) => ((Number(cents) || 0) / 100).toFixed(2)

const fmt = (value) => (value ? String(value).replace('T', ' ').slice(0, 19) : '-')

const ruleText = (row) => {
  const threshold = yuan(row.thresholdAmount)
  const value = yuan(row.discountValue)
  const max = yuan(row.maxDiscountAmount)
  switch (row.discountType) {
    case 1:
      return `每满${threshold}元减${value}元，上限${max}元`
    case 2:
      return `满${threshold}元打${(Number(row.discountValue) / 10).toFixed(1)}折，上限${max}元`
    case 3:
      return `无门槛抵${value}元`
    default:
      return `满${threshold}元减${value}元`
  }
}

const validityText = (row) => {
  if (row.termDays) return `领取后${row.termDays}天`
  if (row.termBeginTime) {
    return `${fmt(row.termBeginTime).slice(0, 10)} ~ ${fmt(row.termEndTime).slice(0, 10)}`
  }
  return '-'
}

const issueWindowText = (row) => {
  if (!row.issueBeginTime && !row.issueEndTime) return '-'
  return `${fmt(row.issueBeginTime)} ~ ${fmt(row.issueEndTime)}`
}

const canIssue = (row) => row.status === 1 || row.status === 5
const canPause = (row) => row.status === 2 || row.status === 3
const canDelete = (row) => row.status === 1

/* ==================== 列表 ==================== */

const coupons = ref([])
const total = ref(0)
const pageNum = ref(1)
const pageSize = ref(10)
const filters = reactive({ name: '', status: '', type: '' })
const loading = ref(false)

const loadCoupons = async () => {
  loading.value = true
  try {
    const data = await pageCoupons({
      pageNum: pageNum.value,
      pageSize: pageSize.value,
      name: filters.name || undefined,
      status: filters.status === '' ? undefined : filters.status,
      type: filters.type === '' ? undefined : filters.type,
    })
    coupons.value = data.records || []
    total.value = Number(data.total || 0)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

onMounted(loadCoupons)

const onSearch = () => {
  pageNum.value = 1
  loadCoupons()
}

const onSizeChange = () => {
  pageNum.value = 1
  loadCoupons()
}

/* ==================== 新建优惠券 ==================== */

const toIso = (date) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
}

const createVisible = ref(false)
const creating = ref(false)
const createForm = reactive({
  name: '',
  discountType: 4,
  thresholdYuan: 10,
  discountYuan: 3,
  discountRate: 8,
  maxYuan: 0,
  totalNum: 100,
  userLimit: 1,
  obtainWay: 1,
  scopeMode: 'all',
  categoryIds: [],
  productIdsText: '',
})

const openCreate = () => {
  Object.assign(createForm, {
    name: '',
    discountType: 4,
    thresholdYuan: 10,
    discountYuan: 3,
    discountRate: 8,
    maxYuan: 0,
    totalNum: 100,
    userLimit: 1,
    obtainWay: 1,
    scopeMode: 'all',
    categoryIds: [],
    productIdsText: '',
  })
  createVisible.value = true
}

const parseIds = (text) =>
  String(text || '')
    .split(/[,，\s]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)

const submitCreate = async () => {
  const name = createForm.name.trim()
  if (name.length < 4 || name.length > 20) {
    ElMessage.warning('优惠券名称需为 4~20 个字符')
    return
  }
  const type = createForm.discountType
  if (type === 1 && !(createForm.thresholdYuan > 0)) {
    ElMessage.warning('每满减券的每满金额必须大于 0')
    return
  }
  if (type !== 3 && !(createForm.thresholdYuan >= 0)) {
    ElMessage.warning('请填写有效的使用门槛')
    return
  }
  if (type === 2) {
    if (!(createForm.discountRate > 0 && createForm.discountRate < 10)) {
      ElMessage.warning('折扣需在 1~9.9 折之间')
      return
    }
  } else if (!(createForm.discountYuan > 0)) {
    ElMessage.warning('优惠金额必须大于 0')
    return
  }
  if ((type === 1 || type === 2) && !(createForm.maxYuan > 0)) {
    ElMessage.warning('每满减/折扣券必须填写最高优惠金额')
    return
  }
  if (!(createForm.totalNum >= 1 && createForm.totalNum <= 5000)) {
    ElMessage.warning('优惠券总量需在 1~5000 之间')
    return
  }
  if (!(createForm.userLimit >= 1 && createForm.userLimit <= 10)) {
    ElMessage.warning('每人限领数量需在 1~10 之间')
    return
  }

  let specific = false
  let scopeType = 0
  let scopes = []
  if (createForm.scopeMode === 'category') {
    if (!createForm.categoryIds.length) {
      ElMessage.warning('请选择限定的商品分类')
      return
    }
    specific = true
    scopeType = 1
    scopes = [...createForm.categoryIds]
  } else if (createForm.scopeMode === 'product') {
    scopes = parseIds(createForm.productIdsText)
    if (!scopes.length) {
      ElMessage.warning('请填写限定的商品ID（逗号分隔）')
      return
    }
    specific = true
    scopeType = 2
  }

  const payload = {
    name,
    specific,
    scopeType,
    scopes,
    discountType: type,
    thresholdAmount: type === 3 ? 0 : Math.round(createForm.thresholdYuan * 100),
    discountValue:
      type === 2 ? Math.round(createForm.discountRate * 10) : Math.round(createForm.discountYuan * 100),
    maxDiscountAmount:
      type === 1 || type === 2 ? Math.round(createForm.maxYuan * 100) : 0,
    totalNum: Math.round(createForm.totalNum),
    userLimit: Math.round(createForm.userLimit),
    obtainWay: createForm.obtainWay,
  }

  creating.value = true
  try {
    await createCoupon(payload)
    ElMessage.success('优惠券已创建，当前为待发放状态')
    createVisible.value = false
    pageNum.value = 1
    loadCoupons()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    creating.value = false
  }
}

/* ==================== 发放优惠券 ==================== */

const issueVisible = ref(false)
const issuing = ref(false)
const issueTarget = ref(null)
const issueForm = reactive({
  immediate: true,
  issueBeginTime: '',
  issueEndTime: '',
  validityMode: 'days',
  termDays: 30,
  termBeginTime: '',
  termEndTime: '',
})

const openIssue = (row) => {
  const end = new Date()
  end.setDate(end.getDate() + 7)
  end.setSeconds(0, 0)
  const begin = new Date()
  begin.setDate(begin.getDate() + 1)
  begin.setSeconds(0, 0)
  issueTarget.value = row
  Object.assign(issueForm, {
    immediate: true,
    issueBeginTime: toIso(begin),
    issueEndTime: toIso(end),
    validityMode: 'days',
    termDays: 30,
    termBeginTime: '',
    termEndTime: '',
  })
  issueVisible.value = true
}

const submitIssue = async () => {
  const now = new Date()
  const end = issueForm.issueEndTime ? new Date(issueForm.issueEndTime) : null
  if (!end || Number.isNaN(end.getTime()) || end <= now) {
    ElMessage.warning('发放结束时间必须晚于当前时间')
    return
  }
  if (!issueForm.immediate) {
    const begin = issueForm.issueBeginTime ? new Date(issueForm.issueBeginTime) : null
    if (!begin || Number.isNaN(begin.getTime()) || begin <= now) {
      ElMessage.warning('定时发放的开始时间必须晚于当前时间')
      return
    }
    if (begin >= end) {
      ElMessage.warning('发放开始时间必须早于结束时间')
      return
    }
  }
  if (issueForm.validityMode === 'days') {
    if (!(issueForm.termDays >= 1)) {
      ElMessage.warning('有效天数必须大于等于 1')
      return
    }
  } else {
    const begin = issueForm.termBeginTime ? new Date(issueForm.termBeginTime) : null
    const termEnd = issueForm.termEndTime ? new Date(issueForm.termEndTime) : null
    if (!begin || !termEnd || termEnd <= begin) {
      ElMessage.warning('请填写正确的有效期起止时间')
      return
    }
  }

  const payload = {
    // Long 主键由后端序列化为字符串，避免 Snowflake ID 转 Number 精度丢失
    id: issueTarget.value.id,
    issueEndTime: issueForm.issueEndTime,
  }
  if (!issueForm.immediate) {
    payload.issueBeginTime = issueForm.issueBeginTime
  }
  if (issueForm.validityMode === 'days') {
    payload.termDays = Math.round(issueForm.termDays)
  } else {
    payload.termBeginTime = issueForm.termBeginTime
    payload.termEndTime = issueForm.termEndTime
  }

  issuing.value = true
  try {
    await issueCoupon(issueTarget.value.id, payload)
    ElMessage.success(issueForm.immediate ? '已开始发放，用户可在领券页领取' : '已设置定时发放，到点自动开始')
    issueVisible.value = false
    loadCoupons()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    issuing.value = false
  }
}

/* ==================== 暂停 / 删除 ==================== */

const onPause = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确定暂停发放「${row.name}」吗？暂停后用户将无法继续领取，已领取的券仍可正常使用。`,
      '暂停发放',
      { type: 'warning', confirmButtonText: '确认暂停', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await pauseCoupon(row.id)
    ElMessage.success('已暂停发放')
    loadCoupons()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

const onDelete = async (row) => {
  try {
    await ElMessageBox.confirm(`确定删除「${row.name}」吗？仅待发放的优惠券可以删除。`, '删除优惠券', {
      type: 'warning',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await deleteCoupon(row.id)
    ElMessage.success('已删除')
    loadCoupons()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

/* ==================== 详情 ==================== */

const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref(null)

const openDetail = async (row) => {
  detailVisible.value = true
  detailLoading.value = true
  detail.value = null
  try {
    detail.value = await getCoupon(row.id)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    detailLoading.value = false
  }
}

/* ==================== 兑换码 ==================== */

const codesVisible = ref(false)
const codesLoading = ref(false)
const codes = ref([])
const codesTotal = ref(0)
const codePageNum = ref(1)
const codePageSize = ref(10)
const codeStatus = ref(1)
const codesCoupon = ref(null)

const loadCodes = async () => {
  if (!codesCoupon.value) return
  codesLoading.value = true
  try {
    const data = await pageCouponCodes({
      couponId: codesCoupon.value.id,
      status: codeStatus.value,
      pageNum: codePageNum.value,
      pageSize: codePageSize.value,
    })
    codes.value = data.records || []
    codesTotal.value = Number(data.total || 0)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    codesLoading.value = false
  }
}

const openCodes = (row) => {
  codesCoupon.value = row
  codePageNum.value = 1
  codeStatus.value = 1
  codesVisible.value = true
  loadCodes()
}

const onCodeStatusChange = () => {
  codePageNum.value = 1
  loadCodes()
}

const onCodeSizeChange = () => {
  codePageNum.value = 1
  loadCodes()
}

const copyCode = async (code) => {
  try {
    await navigator.clipboard.writeText(code)
    ElMessage.success('兑换码已复制')
  } catch {
    ElMessage.warning(`复制失败，请手动复制：${code}`)
  }
}
</script>

<template>
  <div class="page">
    <div class="page-container">
      <el-alert
        type="info"
        show-icon
        :closable="false"
        title="优惠券发放与兑换码"
        description="新建优惠券后处于「待发放」，点击「发放」立即或定时开始；兑换码券在发放时会异步生成兑换码，可在列表中查看。暂停后已领取的券仍可使用，删除仅限待发放状态。"
        class="top-alert"
      />

      <el-card shadow="never" class="section">
        <template #header>
          <div class="card-header">
            <span class="card-title">优惠券列表</span>
            <div class="filters">
              <el-select
                v-model="filters.status"
                placeholder="全部状态"
                clearable
                style="width: 130px"
                @change="onSearch"
              >
                <el-option
                  v-for="s in statusOptions"
                  :key="s.value"
                  :label="s.label"
                  :value="s.value"
                />
              </el-select>
              <el-select
                v-model="filters.type"
                placeholder="全部类型"
                clearable
                style="width: 130px"
                @change="onSearch"
              >
                <el-option
                  v-for="t in typeOptions"
                  :key="t.value"
                  :label="t.label"
                  :value="t.value"
                />
              </el-select>
              <el-input
                v-model="filters.name"
                placeholder="搜索优惠券名称"
                clearable
                style="width: 200px"
                :prefix-icon="Search"
                @keyup.enter="onSearch"
                @clear="onSearch"
              />
              <el-button type="primary" @click="onSearch">搜索</el-button>
              <el-button type="success" @click="openCreate">新建优惠券</el-button>
            </div>
          </div>
        </template>

        <el-table v-loading="loading" :data="coupons" stripe>
          <el-table-column label="优惠券" min-width="190">
            <template #default="{ row }">
              <div class="coupon-name">{{ row.name }}</div>
              <div class="coupon-sub">{{ DISCOUNT_TYPES[row.discountType] }} · {{ row.obtainWay === 1 ? '手动领取' : '兑换码' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="优惠规则" min-width="200">
            <template #default="{ row }">
              <span class="rule-text">{{ ruleText(row) }}</span>
              <el-tag v-if="row.specific" size="small" type="info" effect="plain" class="scope-tag">
                限定范围
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="发放进度" width="150">
            <template #default="{ row }">
              <span class="progress-text">{{ row.issueNum || 0 }} / {{ row.totalNum }}</span>
              <span class="progress-sub">已使用 {{ row.usedNum || 0 }}</span>
            </template>
          </el-table-column>
          <el-table-column label="有效期" min-width="130">
            <template #default="{ row }">{{ validityText(row) }}</template>
          </el-table-column>
          <el-table-column label="发放时间" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">{{ issueWindowText(row) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="STATUS_META[row.status]?.type || 'info'" size="small" effect="plain">
                {{ STATUS_META[row.status]?.label || '-' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            label="操作"
            :width="isMobile ? 230 : 250"
            :fixed="isMobile ? false : 'right'"
          >
            <template #default="{ row }">
              <el-button v-if="canIssue(row)" link type="primary" @click="openIssue(row)">
                发放
              </el-button>
              <el-button v-if="canPause(row)" link type="warning" @click="onPause(row)">
                暂停
              </el-button>
              <el-button v-if="row.obtainWay === 2" link type="primary" @click="openCodes(row)">
                兑换码
              </el-button>
              <el-button link @click="openDetail(row)">详情</el-button>
              <el-button v-if="canDelete(row)" link type="danger" @click="onDelete(row)">
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="pager">
          <span class="total-text">共 {{ total }} 张优惠券</span>
          <el-pagination
            v-model:current-page="pageNum"
            v-model:page-size="pageSize"
            :page-sizes="[10, 20, 50]"
            :total="Number(total)"
            layout="sizes, prev, pager, next"
            background
            @current-change="loadCoupons"
            @size-change="onSizeChange"
          />
        </div>
      </el-card>
    </div>

    <!-- 新建优惠券 -->
    <el-dialog
      v-model="createVisible"
      title="新建优惠券"
      width="680px"
      :close-on-click-modal="false"
    >
      <el-form label-width="120px">
        <el-form-item label="优惠券名称" required>
          <el-input
            v-model="createForm.name"
            maxlength="20"
            show-word-limit
            placeholder="4~20 个字符，例如：新人满100减30"
          />
        </el-form-item>
        <el-form-item label="优惠类型" required>
          <el-select v-model="createForm.discountType" style="width: 100%">
            <el-option
              v-for="t in typeOptions"
              :key="t.value"
              :label="t.label"
              :value="t.value"
            />
          </el-select>
          <div class="form-hint">
            {{
              createForm.discountType === 1
                ? '每满 X 元减 Y 元，可叠加，优惠金额不超过上限'
                : createForm.discountType === 2
                  ? '满 X 元享折扣，优惠金额不超过上限'
                  : createForm.discountType === 3
                    ? '无门槛直接抵扣，订单金额需大于优惠金额'
                    : '满 X 元减 Y 元'
            }}
          </div>
        </el-form-item>
        <el-form-item v-if="createForm.discountType !== 3" label="使用门槛（元）" required>
          <el-input-number
            v-model="createForm.thresholdYuan"
            :min="0"
            :precision="2"
            :step="10"
            style="width: 220px"
          />
        </el-form-item>
        <el-form-item
          v-if="createForm.discountType === 2"
          label="折扣（折）"
          required
        >
          <el-input-number
            v-model="createForm.discountRate"
            :min="1"
            :max="9.9"
            :precision="1"
            :step="0.5"
            style="width: 220px"
          />
          <span class="form-suffix">例如 8.5 表示 85 折</span>
        </el-form-item>
        <el-form-item v-else label="优惠金额（元）" required>
          <el-input-number
            v-model="createForm.discountYuan"
            :min="0"
            :precision="2"
            :step="5"
            style="width: 220px"
          />
        </el-form-item>
        <el-form-item
          v-if="createForm.discountType === 1 || createForm.discountType === 2"
          label="最高优惠（元）"
          required
        >
          <el-input-number
            v-model="createForm.maxYuan"
            :min="0"
            :precision="2"
            :step="5"
            style="width: 220px"
          />
        </el-form-item>
        <el-form-item label="发放总量" required>
          <el-input-number
            v-model="createForm.totalNum"
            :min="1"
            :max="5000"
            :step="10"
            style="width: 220px"
          />
          <span class="form-suffix">最多 5000 张</span>
        </el-form-item>
        <el-form-item label="每人限领" required>
          <el-input-number
            v-model="createForm.userLimit"
            :min="1"
            :max="10"
            style="width: 220px"
          />
          <span class="form-suffix">最多 10 张</span>
        </el-form-item>
        <el-form-item label="获取方式" required>
          <el-radio-group v-model="createForm.obtainWay">
            <el-radio :value="1">手动领取</el-radio>
            <el-radio :value="2">兑换码兑换</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="使用范围">
          <el-radio-group v-model="createForm.scopeMode">
            <el-radio value="all">全场通用</el-radio>
            <el-radio value="category">限定分类</el-radio>
            <el-radio value="product">指定商品</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="createForm.scopeMode === 'category'" label="限定分类" required>
          <el-select
            v-model="createForm.categoryIds"
            multiple
            placeholder="请选择商品分类"
            style="width: 100%"
          >
            <el-option
              v-for="c in CATEGORY_OPTIONS"
              :key="c.value"
              :label="c.label"
              :value="c.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item v-if="createForm.scopeMode === 'product'" label="商品ID" required>
          <el-input
            v-model="createForm.productIdsText"
            type="textarea"
            :rows="2"
            placeholder="多个商品ID用逗号分隔，例如：123456789,987654321"
          />
          <div class="form-hint">需填写商城中已存在的商品ID，否则详情页无法展示商品名称</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- 发放优惠券 -->
    <el-dialog
      v-model="issueVisible"
      :title="`发放优惠券${issueTarget ? '：' + issueTarget.name : ''}`"
      width="560px"
      :close-on-click-modal="false"
    >
      <el-form label-width="120px">
        <el-form-item label="发放方式">
          <el-radio-group v-model="issueForm.immediate">
            <el-radio :value="true">立即发放</el-radio>
            <el-radio :value="false">定时发放</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="!issueForm.immediate" label="发放开始时间" required>
          <el-date-picker
            v-model="issueForm.issueBeginTime"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss"
            placeholder="选择开始时间"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="发放结束时间" required>
          <el-date-picker
            v-model="issueForm.issueEndTime"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss"
            placeholder="选择结束时间"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="券有效期">
          <el-radio-group v-model="issueForm.validityMode">
            <el-radio value="days">领取后 N 天</el-radio>
            <el-radio value="fixed">固定起止时间</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="issueForm.validityMode === 'days'" label="有效天数" required>
          <el-input-number v-model="issueForm.termDays" :min="1" :max="3650" style="width: 200px" />
        </el-form-item>
        <template v-else>
          <el-form-item label="有效期开始" required>
            <el-date-picker
              v-model="issueForm.termBeginTime"
              type="datetime"
              value-format="YYYY-MM-DDTHH:mm:ss"
              placeholder="选择开始时间"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="有效期结束" required>
            <el-date-picker
              v-model="issueForm.termEndTime"
              type="datetime"
              value-format="YYYY-MM-DDTHH:mm:ss"
              placeholder="选择结束时间"
              style="width: 100%"
            />
          </el-form-item>
        </template>
        <el-alert
          v-if="issueTarget && issueTarget.obtainWay === 2"
          type="warning"
          show-icon
          :closable="false"
          title="兑换码券"
          description="首次发放时会按发放总量异步生成兑换码，可在列表「兑换码」中查看。"
        />
      </el-form>
      <template #footer>
        <el-button @click="issueVisible = false">取消</el-button>
        <el-button type="primary" :loading="issuing" @click="submitIssue">确认发放</el-button>
      </template>
    </el-dialog>

    <!-- 优惠券详情 -->
    <el-dialog v-model="detailVisible" title="优惠券详情" width="620px">
      <div v-loading="detailLoading">
        <el-descriptions v-if="detail" :column="2" border>
          <el-descriptions-item label="名称" :span="2">{{ detail.name }}</el-descriptions-item>
          <el-descriptions-item label="优惠类型">
            {{ DISCOUNT_TYPES[detail.discountType] }}
          </el-descriptions-item>
          <el-descriptions-item label="获取方式">
            {{ detail.obtainWay === 1 ? '手动领取' : '兑换码兑换' }}
          </el-descriptions-item>
          <el-descriptions-item label="优惠规则" :span="2">{{ ruleText(detail) }}</el-descriptions-item>
          <el-descriptions-item label="发放总量">{{ detail.totalNum }}</el-descriptions-item>
          <el-descriptions-item label="每人限领">{{ detail.userLimit }}</el-descriptions-item>
          <el-descriptions-item label="发放时间" :span="2">
            {{ issueWindowText(detail) }}
          </el-descriptions-item>
          <el-descriptions-item label="有效期" :span="2">{{ validityText(detail) }}</el-descriptions-item>
          <el-descriptions-item label="使用范围" :span="2">
            <template v-if="!detail.specific">全场通用</template>
            <template v-else-if="detail.scopes && detail.scopes.length">
              <el-tag
                v-for="scope in detail.scopes"
                :key="scope.id"
                size="small"
                effect="plain"
                class="scope-item"
              >
                {{ scope.name }}
              </el-tag>
            </template>
            <template v-else>已限定范围</template>
          </el-descriptions-item>
        </el-descriptions>
      </div>
      <template #footer>
        <el-button type="primary" @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 兑换码列表 -->
    <el-dialog
      v-model="codesVisible"
      :title="`兑换码${codesCoupon ? '：' + codesCoupon.name : ''}`"
      width="560px"
    >
      <div class="codes-toolbar">
        <el-select
          v-model="codeStatus"
          style="width: 140px"
          @change="onCodeStatusChange"
        >
          <el-option label="待兑换" :value="1" />
          <el-option label="已兑换" :value="2" />
        </el-select>
        <span class="codes-total">共 {{ codesTotal }} 个</span>
      </div>
      <el-table v-loading="codesLoading" :data="codes" stripe max-height="360">
        <el-table-column prop="id" label="序列号" width="100" />
        <el-table-column label="兑换码" min-width="180">
          <template #default="{ row }">
            <span class="code-text">{{ row.code }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90">
          <template #default="{ row }">
            <el-button link type="primary" @click="copyCode(row.code)">复制</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          v-model:current-page="codePageNum"
          v-model:page-size="codePageSize"
          :page-sizes="[10, 20, 50]"
          :total="Number(codesTotal)"
          layout="sizes, prev, pager, next"
          background
          @current-change="loadCodes"
          @size-change="onCodeSizeChange"
        />
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.section {
  margin-bottom: 24px;
}
.top-alert {
  margin-bottom: 18px;
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
.filters {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.coupon-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.coupon-sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.rule-text {
  display: inline-block;
  margin-right: 6px;
}
.scope-tag {
  margin-left: 2px;
}
.progress-text {
  display: block;
  font-weight: 600;
}
.progress-sub {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--pv-text-secondary);
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
.form-hint {
  width: 100%;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--pv-text-secondary);
}
.form-suffix {
  margin-left: 10px;
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.scope-item {
  margin: 2px 6px 2px 0;
}
.codes-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.codes-total {
  font-size: 13px;
  color: var(--pv-text-secondary);
}
.code-text {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 1px;
}

@media (max-width: 768px) {
  .card-header .el-select,
  .card-header .el-input {
    width: 100% !important;
  }
}
</style>
