<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import AppHeader from '@/components/AppHeader.vue'
import { useIsMobile } from '@/utils/responsive'
import {
  applyWithdrawMerchant,
  cancelWithdrawMerchant,
  completeOrder,
  deleteProduct,
  getMerchantInfo,
  pageMerchantOrders,
  pageMyProducts,
  saveProduct,
  updateMerchantInfo,
  updateMerchantStatus,
  updateProduct,
  uploadShopImage,
} from '@/api/shop'

// 窄屏下 el-table 的 fixed 操作列会悬浮遮挡横向滚动内容，按端动态禁用
const isMobile = useIsMobile()

/* ==================== 店铺信息 ==================== */

const merchant = ref(null)
const infoDialog = ref(false)
const infoSaving = ref(false)
const logoUploading = ref(false)
const infoForm = reactive({
  shopName: '',
  shopLogo: '',
  description: '',
  contactPhone: '',
})

const loadMerchant = async () => {
  try {
    merchant.value = await getMerchantInfo()
  } catch (e) {
    merchant.value = null
    ElMessage.error(e.message)
  }
}

const merchantBanned = computed(() => merchant.value?.status === 2)
const merchantWithdrawing = computed(() => merchant.value?.withdrawStatus === 1)
// 封禁与撤销冷静期内不能改店铺信息/商品/营业状态；打烊可以随时恢复营业
const canManageStore = computed(() => !!merchant.value && !merchantBanned.value && !merchantWithdrawing.value)
// 封禁后禁止任何商家操作；打烊与撤销冷静期仍可处理已产生的订单
const canHandleOrders = computed(() => !!merchant.value && !merchantBanned.value)

const shopStatusMeta = computed(() => {
  if (!merchant.value) return { label: '', type: 'info' }
  if (merchantWithdrawing.value) return { label: '撤销中', type: 'warning' }
  if (merchantBanned.value) return { label: '已封禁', type: 'danger' }
  if (merchant.value.status === 1) return { label: '营业中', type: 'success' }
  return { label: '已打烊', type: 'info' }
})

const formatDateTime = (time) => (time ? String(time).replace('T', ' ').slice(0, 16) : '-')

const statusUpdating = ref(false)
const toggleShopStatus = async () => {
  if (!canManageStore.value) return
  const closing = merchant.value.status === 1
  try {
    await ElMessageBox.confirm(
      closing
        ? '打烊后店铺商品将从商城隐藏，买家无法加购和下单，已产生的订单仍可正常处理。'
        : '开始营业后店铺商品会重新在商城展示，买家可正常下单。',
      closing ? '确认打烊' : '确认营业',
      { type: 'warning', confirmButtonText: closing ? '确认打烊' : '开始营业', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  statusUpdating.value = true
  try {
    merchant.value = await updateMerchantStatus(closing ? 0 : 1)
    ElMessage.success(closing ? '店铺已打烊' : '店铺已开始营业')
    loadProducts()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    statusUpdating.value = false
  }
}

/* ==================== 撤销商家身份（5 天冷静期） ==================== */

const withdrawDialog = ref(false)
const withdrawAcknowledged = ref(false)
const withdrawing = ref(false)

const openWithdrawDialog = () => {
  withdrawAcknowledged.value = false
  withdrawDialog.value = true
}

const onApplyWithdraw = async () => {
  if (!withdrawAcknowledged.value) {
    ElMessage.warning('请先勾选确认，避免误触')
    return
  }
  // 二次确认：警告弹窗后还需要在确认框中再次点确认
  try {
    await ElMessageBox.confirm(
      '撤销申请提交后店铺将立即停止营业，5 天冷静期结束后所有商家数据将被永久清除且无法恢复。确定继续吗？',
      '再次确认撤销',
      {
        type: 'warning',
        confirmButtonText: '确认撤销商家身份',
        cancelButtonText: '我再想想',
      },
    )
  } catch {
    return
  }
  withdrawing.value = true
  try {
    merchant.value = await applyWithdrawMerchant()
    withdrawDialog.value = false
    ElMessage.success('已提交撤销申请，店铺已停止营业；5 天内可随时取消撤销')
    loadProducts()
    loadOrders()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    withdrawing.value = false
  }
}

const onCancelWithdraw = async () => {
  try {
    await ElMessageBox.confirm(
      '确定取消撤销商家身份并继续经营吗？店铺将恢复到撤销前的营业状态。',
      '继续经营',
      { type: 'success', confirmButtonText: '继续经营', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    merchant.value = await cancelWithdrawMerchant()
    ElMessage.success('已取消撤销，欢迎继续经营')
    loadProducts()
    loadOrders()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

const openInfoDialog = () => {
  if (!canManageStore.value) return
  Object.assign(infoForm, {
    shopName: merchant.value?.shopName || '',
    shopLogo: merchant.value?.shopLogo || '',
    description: merchant.value?.description || '',
    contactPhone: merchant.value?.contactPhone || '',
  })
  infoDialog.value = true
}

const onLogoChange = async (uploadFile) => {
  logoUploading.value = true
  try {
    infoForm.shopLogo = await uploadShopImage(uploadFile.raw)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    logoUploading.value = false
  }
}

const onSaveInfo = async () => {
  if (!canManageStore.value) {
    ElMessage.warning('当前店铺状态不可编辑信息')
    return
  }
  if (!infoForm.shopName.trim()) {
    ElMessage.warning('店铺名称不能为空')
    return
  }
  infoSaving.value = true
  try {
    merchant.value = await updateMerchantInfo({ ...infoForm })
    ElMessage.success('店铺信息已更新')
    infoDialog.value = false
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    infoSaving.value = false
  }
}

/* ==================== 商品管理 ==================== */

const products = ref([])
const total = ref(0)
const pageNum = ref(1)
const pageSize = ref(10)
const loading = ref(false)

// 商品类型：与后端 category 字段约定一致
const categories = [
  { value: 1, label: '宠物用品' },
  { value: 2, label: '宠物食品' },
  { value: 3, label: '活体宠物' },
]

const loadProducts = async () => {
  if (!merchant.value || merchantBanned.value) {
    products.value = []
    total.value = 0
    return
  }
  loading.value = true
  try {
    const data = await pageMyProducts({ pageNum: pageNum.value, pageSize: pageSize.value })
    products.value = data.records || []
    // 后端 Long 统一序列化为字符串，total 需还原为数字供分页组件使用
    total.value = Number(data.total || 0)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await loadMerchant()
  // 封禁店铺不能查询商品/订单，页面仅展示封禁状态
  if (merchant.value && !merchantBanned.value) {
    loadProducts()
    loadOrders()
  }
})

const onSizeChange = () => {
  pageNum.value = 1
  loadProducts()
}

// 商品编辑弹窗：editingId 为空表示新增
const productDialog = ref(false)
const productSaving = ref(false)
const imgUploading = ref(false)
const editingId = ref(null)
const productFormRef = ref()
const productForm = reactive({
  name: '',
  category: 1,
  price: 1,
  stock: 0,
  imageUrl: '',
  description: '',
})

const productRules = {
  name: [
    { required: true, message: '请输入商品名称', trigger: 'blur' },
    { max: 100, message: '商品名称不能超过100个字符', trigger: 'blur' },
  ],
  category: [{ required: true, message: '请选择商品类型', trigger: 'change' }],
  price: [{ required: true, message: '请输入售价', trigger: 'blur' }],
  stock: [{ required: true, message: '请输入库存', trigger: 'blur' }],
}

const openProductDialog = (row) => {
  if (!canManageStore.value) return
  editingId.value = row?.id || null
  Object.assign(productForm, {
    name: row?.name || '',
    category: row?.category || 1,
    price: row ? Number(row.price) : 1,
    stock: row?.stock ?? 0,
    imageUrl: row?.imageUrl || '',
    description: row?.description || '',
  })
  productDialog.value = true
}

const onProductImgChange = async (uploadFile) => {
  imgUploading.value = true
  try {
    productForm.imageUrl = await uploadShopImage(uploadFile.raw)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    imgUploading.value = false
  }
}

const onSaveProduct = async () => {
  if (!canManageStore.value) {
    ElMessage.warning('当前店铺状态不可编辑商品')
    return
  }
  await productFormRef.value.validate()
  productSaving.value = true
  try {
    if (editingId.value) {
      await updateProduct({ id: editingId.value, ...productForm })
      ElMessage.success('商品已更新')
    } else {
      await saveProduct({ ...productForm })
      ElMessage.success('商品已创建，默认为下架状态，编辑确认后可上架')
    }
    productDialog.value = false
    loadProducts()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    productSaving.value = false
  }
}

// 上架/下架切换
const onToggleStatus = async (row) => {
  if (!canManageStore.value) {
    ElMessage.warning('当前店铺状态不可编辑商品')
    return
  }
  const next = row.status === 1 ? 0 : 1
  try {
    await updateProduct({ id: row.id, status: next })
    ElMessage.success(next === 1 ? '商品已上架' : '商品已下架')
    loadProducts()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

const onDeleteProduct = async (row) => {
  if (!canManageStore.value) {
    ElMessage.warning('当前店铺状态不可编辑商品')
    return
  }
  try {
    await ElMessageBox.confirm(`确定删除商品「${row.name}」吗？`, '删除确认', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteProduct(row.id)
    ElMessage.success('商品已删除')
    loadProducts()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

/* ==================== 订单管理 ==================== */

const orders = ref([])
const orderTotal = ref(0)
const orderPageNum = ref(1)
const orderPageSize = ref(10)
const orderLoading = ref(false)
const orderStatus = ref('')

const orderStatusOptions = [
  { value: 0, label: '待支付' },
  { value: 1, label: '待取货' },
  { value: 2, label: '已完成' },
  { value: 3, label: '已取消' },
]

const orderStatusTagType = (code) => ({ 0: 'warning', 1: 'primary', 2: 'success', 3: 'info' })[code] || 'info'

const loadOrders = async () => {
  if (!merchant.value || merchantBanned.value) {
    orders.value = []
    orderTotal.value = 0
    return
  }
  orderLoading.value = true
  try {
    const data = await pageMerchantOrders({
      pageNum: orderPageNum.value,
      pageSize: orderPageSize.value,
      status: orderStatus.value === '' ? undefined : orderStatus.value,
    })
    orders.value = data.records || []
    orderTotal.value = Number(data.total || 0)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    orderLoading.value = false
  }
}

const onOrderStatusChange = () => {
  orderPageNum.value = 1
  loadOrders()
}

const onOrderSizeChange = () => {
  orderPageNum.value = 1
  loadOrders()
}

// 明细摘要：如「狗粮 ×2 等3件商品」
const itemSummary = (order) => {
  const items = order.items || []
  if (items.length === 0) {
    return '—'
  }
  const first = items[0]
  const count = items.reduce((sum, it) => sum + it.quantity, 0)
  return items.length === 1
    ? `${first.productName} ×${first.quantity}`
    : `${first.productName} ×${first.quantity} 等${count}件商品`
}

// 到店核销弹窗：核对买家出示的取货码后完成订单
const pickupDialog = ref(false)
const pickupSaving = ref(false)
const pickupOrder = ref(null)
const pickupCodeInput = ref('')

const openPickupDialog = (order) => {
  if (!canHandleOrders.value) {
    ElMessage.warning('当前店铺状态不可处理订单')
    return
  }
  pickupOrder.value = order
  pickupCodeInput.value = ''
  pickupDialog.value = true
}

const onCompleteOrder = async () => {
  if (!canHandleOrders.value) {
    ElMessage.warning('当前店铺状态不可处理订单')
    return
  }
  pickupSaving.value = true
  try {
    await completeOrder(pickupOrder.value.id, pickupCodeInput.value || undefined)
    ElMessage.success('订单已完成核销')
    pickupDialog.value = false
    loadOrders()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    pickupSaving.value = false
  }
}
</script>

<template>
  <div class="page">
    <AppHeader title="商家中心" show-back />

    <div class="page-container">
      <!-- 店铺信息 -->
      <el-card shadow="never" class="section">
        <template #header>
          <div class="card-header">
            <span class="card-title">我的店铺</span>
            <div v-if="merchant" class="shop-actions">
              <el-button v-if="canManageStore" text type="primary" @click="openInfoDialog">编辑店铺</el-button>
              <el-button
                v-if="canManageStore"
                text
                :type="merchant.status === 1 ? 'warning' : 'success'"
                :loading="statusUpdating"
                @click="toggleShopStatus"
              >
                {{ merchant.status === 1 ? '打烊休息' : '开始营业' }}
              </el-button>
            </div>
          </div>
        </template>
        <el-alert
          v-if="merchantBanned"
          type="error"
          show-icon
          :closable="false"
          class="status-alert"
          title="店铺已被平台封禁"
          :description="`封禁原因：${merchant.banReason || '未填写'}；封禁时间：${formatDateTime(merchant.banTime)}。封禁期间商品不会在商城展示，买家无法加购或下单。`"
        />
        <el-alert
          v-else-if="merchantWithdrawing"
          type="warning"
          show-icon
          :closable="false"
          class="status-alert"
          title="商家身份撤销冷静期中，店铺已停止营业"
          :description="`冷静期截止：${formatDateTime(merchant.withdrawDeadline)}。到期后店铺、商品、评价等商家数据将被永久清除；在此之前可取消撤销继续经营。`"
        />
        <div v-if="merchant" class="shop-info">
          <el-avatar :size="64" :src="merchant.shopLogo || ''" shape="square" class="shop-logo">
            {{ (merchant.shopName || '店')[0] }}
          </el-avatar>
          <div class="shop-meta">
            <div class="shop-name-line">
              <span class="shop-name">{{ merchant.shopName }}</span>
              <el-tag :type="shopStatusMeta.type" size="small" effect="plain">
                {{ shopStatusMeta.label }}
              </el-tag>
            </div>
            <div class="shop-desc">{{ merchant.description || '暂无店铺简介' }}</div>
            <div class="shop-sub">联系电话：{{ merchant.contactPhone }} · 开店时间：{{ merchant.createTime }}</div>
          </div>
        </div>
        <el-empty v-else description="未查询到店铺信息" :image-size="80" />
      </el-card>

      <!-- 商品管理 -->
      <el-card v-if="!merchantBanned" shadow="never" class="section">
        <template #header>
          <div class="card-header">
            <span class="card-title">商品管理</span>
            <el-button type="primary" :icon="Plus" :disabled="!canManageStore" @click="openProductDialog(null)">
              新增商品
            </el-button>
          </div>
        </template>

        <el-table v-loading="loading" :data="products" stripe>
          <el-table-column label="商品" min-width="220">
            <template #default="{ row }">
              <div class="product-cell">
                <el-image :src="row.imageUrl || ''" fit="cover" class="product-thumb">
                  <template #error>
                    <div class="thumb-placeholder">🛍️</div>
                  </template>
                </el-image>
                <span class="product-name">{{ row.name }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="categoryName" label="类型" width="100" />
          <el-table-column label="售价" width="110">
            <template #default="{ row }">
              <span class="price">¥{{ row.price }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="stock" label="库存" width="90" />
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small" effect="plain">
                {{ row.status === 1 ? '上架中' : '已下架' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" :width="isMobile ? undefined : 180" :fixed="isMobile ? false : 'right'">
            <template #default="{ row }">
              <el-button type="primary" link :disabled="!canManageStore" @click="openProductDialog(row)">编辑</el-button>
              <el-button
                :type="row.status === 1 ? 'warning' : 'success'"
                link
                :disabled="!canManageStore"
                @click="onToggleStatus(row)"
              >
                {{ row.status === 1 ? '下架' : '上架' }}
              </el-button>
              <el-button type="danger" link :disabled="!canManageStore" @click="onDeleteProduct(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="pager">
          <span class="total-text">共 {{ total }} 件商品</span>
          <el-pagination
            v-model:current-page="pageNum"
            v-model:page-size="pageSize"
            :page-sizes="[10, 20, 50]"
            :total="Number(total)"
            layout="sizes, prev, pager, next"
            background
            @current-change="loadProducts"
            @size-change="onSizeChange"
          />
        </div>
      </el-card>

      <!-- 订单管理 -->
      <el-card v-if="!merchantBanned" shadow="never" class="section">
        <template #header>
          <div class="card-header">
            <span class="card-title">订单管理</span>
            <el-select
              v-model="orderStatus"
              placeholder="全部状态"
              clearable
              style="width: 140px"
              @change="onOrderStatusChange"
            >
              <el-option
                v-for="opt in orderStatusOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </div>
        </template>

        <el-table v-loading="orderLoading" :data="orders" stripe>
          <el-table-column prop="orderNo" label="订单号" min-width="170" show-overflow-tooltip />
          <el-table-column prop="createTime" label="下单时间" width="160" />
          <el-table-column label="商品明细" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">{{ itemSummary(row) }}</template>
          </el-table-column>
          <el-table-column label="金额" width="110">
            <template #default="{ row }">
              <span class="price">¥{{ row.totalAmount }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="orderStatusTagType(row.status)" size="small" effect="plain">
                {{ row.statusName }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" :width="isMobile ? undefined : 120" :fixed="isMobile ? false : 'right'">
            <template #default="{ row }">
              <el-button
                v-if="row.status === 1"
                type="primary"
                link
                :disabled="!canHandleOrders"
                @click="openPickupDialog(row)"
              >
                到店核销
              </el-button>
              <span v-else class="no-action">—</span>
            </template>
          </el-table-column>
        </el-table>

        <div class="pager">
          <span class="total-text">共 {{ orderTotal }} 笔订单</span>
          <el-pagination
            v-model:current-page="orderPageNum"
            v-model:page-size="orderPageSize"
            :page-sizes="[10, 20, 50]"
            :total="Number(orderTotal)"
            layout="sizes, prev, pager, next"
            background
            @current-change="loadOrders"
            @size-change="onOrderSizeChange"
          />
        </div>
      </el-card>

      <!-- 商家身份：撤销冷静期 / 撤销入口 -->
      <el-card v-if="merchant" shadow="never" class="section danger-card">
        <template #header>
          <div class="card-header">
            <span class="card-title">商家身份</span>
          </div>
        </template>
        <div v-if="merchantWithdrawing" class="danger-body">
          <div class="danger-text">
            已申请撤销商家身份，店铺处于停止营业状态。
            <strong>{{ formatDateTime(merchant.withdrawDeadline) }}</strong>
            后若未取消，店铺、商品、评价等商家数据将被永久清除。
          </div>
          <el-button type="success" @click="onCancelWithdraw">继续经营（取消撤销）</el-button>
        </div>
        <div v-else-if="merchantBanned" class="danger-body">
          <div class="danger-text">店铺当前处于封禁状态，无法申请撤销商家身份，请联系管理员处理。</div>
        </div>
        <div v-else class="danger-body">
          <div class="danger-text">
            不再在平台经营时，可申请撤销商家身份。提交后店铺立即停止营业，并进入
            <strong>5 天冷静期</strong>；冷静期内可随时取消撤销，到期后商家相关数据将被永久清除。
          </div>
          <el-button type="danger" plain @click="openWithdrawDialog">撤销商家身份</el-button>
        </div>
      </el-card>
    </div>
    <el-dialog v-model="infoDialog" title="编辑店铺信息" width="480px">
      <el-form :model="infoForm" label-width="90px">
        <el-form-item label="店铺名称" required>
          <el-input v-model="infoForm.shopName" maxlength="50" />
        </el-form-item>
        <el-form-item label="店铺LOGO">
          <el-upload
            :show-file-list="false"
            :auto-upload="false"
            accept="image/jpeg,image/png,image/webp,image/gif"
            @change="onLogoChange"
          >
            <div v-loading="logoUploading" class="logo-uploader">
              <el-image v-if="infoForm.shopLogo" :src="infoForm.shopLogo" fit="cover" class="logo-img" />
              <div v-else class="logo-empty">
                <el-icon><Plus /></el-icon>
              </div>
            </div>
          </el-upload>
        </el-form-item>
        <el-form-item label="联系电话">
          <el-input v-model="infoForm.contactPhone" maxlength="11" placeholder="11位手机号" />
        </el-form-item>
        <el-form-item label="店铺简介">
          <el-input
            v-model="infoForm.description"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="infoDialog = false">取消</el-button>
        <el-button type="primary" :loading="infoSaving" @click="onSaveInfo">保存</el-button>
      </template>
    </el-dialog>

    <!-- 新增/编辑商品 -->
    <el-dialog v-model="productDialog" :title="editingId ? '编辑商品' : '新增商品'" width="520px">
      <el-form ref="productFormRef" :model="productForm" :rules="productRules" label-width="90px">
        <el-form-item label="商品名称" prop="name">
          <el-input v-model="productForm.name" maxlength="100" placeholder="商品名称" />
        </el-form-item>
        <el-form-item label="商品类型" prop="category">
          <el-select v-model="productForm.category" style="width: 180px">
            <el-option v-for="c in categories" :key="c.value" :label="c.label" :value="c.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="售价(元)" prop="price">
          <el-input-number v-model="productForm.price" :min="0.01" :precision="2" :step="1" />
        </el-form-item>
        <el-form-item label="库存" prop="stock">
          <el-input-number v-model="productForm.stock" :min="0" :step="1" step-strictly />
        </el-form-item>
        <el-form-item label="商品主图">
          <el-upload
            :show-file-list="false"
            :auto-upload="false"
            accept="image/jpeg,image/png,image/webp,image/gif"
            @change="onProductImgChange"
          >
            <div v-loading="imgUploading" class="logo-uploader">
              <el-image v-if="productForm.imageUrl" :src="productForm.imageUrl" fit="cover" class="logo-img" />
              <div v-else class="logo-empty">
                <el-icon><Plus /></el-icon>
              </div>
            </div>
          </el-upload>
        </el-form-item>
        <el-form-item label="商品详情">
          <el-input
            v-model="productForm.description"
            type="textarea"
            :rows="3"
            maxlength="1000"
            show-word-limit
            placeholder="商品详情介绍（选填）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="productDialog = false">取消</el-button>
        <el-button type="primary" :loading="productSaving" @click="onSaveProduct">保存</el-button>
      </template>
    </el-dialog>
    <!-- 到店核销 -->
    <el-dialog v-model="pickupDialog" title="到店核销" width="420px">
      <div v-if="pickupOrder" class="pickup-body">
        <div class="pickup-row">
          <span class="pickup-label">订单号</span>
          <span>{{ pickupOrder.orderNo }}</span>
        </div>
        <div class="pickup-row">
          <span class="pickup-label">商品明细</span>
          <span>{{ itemSummary(pickupOrder) }}</span>
        </div>
        <div class="pickup-row">
          <span class="pickup-label">订单金额</span>
          <span class="price">¥{{ pickupOrder.totalAmount }}</span>
        </div>
        <el-input
          v-model="pickupCodeInput"
          maxlength="16"
          placeholder="核对买家出示的取货码后填入（选填）"
          class="pickup-input"
        />
        <div class="pickup-tip">确认后订单将标记为已完成，请确保买家已到店取货</div>
      </div>
      <template #footer>
        <el-button @click="pickupDialog = false">取消</el-button>
        <el-button type="primary" :loading="pickupSaving" @click="onCompleteOrder">确认核销</el-button>
      </template>
    </el-dialog>

    <!-- 撤销商家身份：警告 + 勾选确认 + 二次确认 -->
    <el-dialog
      v-model="withdrawDialog"
      title="撤销商家身份"
      width="520px"
      :close-on-click-modal="false"
    >
      <el-alert
        type="warning"
        show-icon
        :closable="false"
        title="该操作提交后立即生效，请确认不是误触"
      />
      <div class="withdraw-warning">
        <p>1. 提交后店铺立即停止营业，商品从商城隐藏，买家无法加购或下单；</p>
        <p>2. 进入 <strong>5 天冷静期</strong>，期间可点击「继续经营」随时取消撤销；</p>
        <p>3. 冷静期结束后，店铺、商品、评价等商家数据将被<strong>永久清除且无法恢复</strong>；</p>
        <p>4. 历史订单记录会保留，供买家查询与售后使用。</p>
        <el-checkbox v-model="withdrawAcknowledged">
          我已了解上述后果，确认本次操作不是误触
        </el-checkbox>
      </div>
      <template #footer>
        <el-button @click="withdrawDialog = false">取消</el-button>
        <el-button
          type="danger"
          :loading="withdrawing"
          :disabled="!withdrawAcknowledged"
          @click="onApplyWithdraw"
        >
          申请撤销
        </el-button>
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

/* 店铺信息 */
.shop-info {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}
.shop-logo {
  font-size: 24px;
  flex-shrink: 0;
  border-radius: 12px;
}
.shop-meta {
  min-width: 0;
}
.shop-name-line {
  display: flex;
  align-items: center;
  gap: 10px;
}
.shop-name {
  font-size: 17px;
  font-weight: 700;
  color: var(--pv-text);
}
.shop-desc {
  color: var(--pv-text-secondary);
  margin-top: 6px;
  line-height: 1.6;
}
.shop-sub {
  font-size: 12px;
  color: var(--pv-text-secondary);
  margin-top: 6px;
}
.status-alert {
  margin-bottom: 16px;
}
.shop-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 撤销商家身份 */
.danger-card :deep(.el-card__header) {
  border-bottom-color: #f3d6d1;
}
.danger-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 14px;
}
.danger-text {
  font-size: 13px;
  line-height: 1.8;
  color: var(--pv-text-secondary);
}
.danger-text strong {
  color: #d4380d;
}
.withdraw-warning {
  margin-top: 14px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--pv-text-secondary);
}
.withdraw-warning p {
  margin: 0 0 6px;
}
.withdraw-warning strong {
  color: #d4380d;
}
.withdraw-warning .el-checkbox {
  margin-top: 10px;
  color: var(--pv-text);
}

/* 商品表格 */
.product-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.product-thumb {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  flex-shrink: 0;
  background: var(--pv-tint);
}
.thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  background: var(--pv-tint);
}
.product-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.price {
  color: #d4380d;
  font-weight: 600;
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

/* 图片上传 */
.logo-uploader {
  width: 96px;
  height: 96px;
  border: 1px dashed var(--pv-border);
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.2s;
}
.logo-uploader:hover {
  border-color: var(--pv-ink);
}
.logo-img {
  width: 100%;
  height: 100%;
}
.logo-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--pv-text-secondary);
  font-size: 22px;
}
/* 订单管理 */
.no-action {
  color: var(--pv-text-secondary);
}
.pickup-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pickup-row {
  display: flex;
  gap: 12px;
  font-size: 13px;
}
.pickup-label {
  color: var(--pv-text-secondary);
  flex-shrink: 0;
  width: 64px;
}
.pickup-input {
  margin-top: 4px;
}
.pickup-tip {
  font-size: 12px;
  color: var(--pv-text-secondary);
}

@media (max-width: 768px) {
  .card-header {
    flex-wrap: wrap;
    gap: 10px;
  }
  .shop-info {
    gap: 12px;
  }
  .shop-info .shop-logo {
    width: 48px !important;
    height: 48px !important;
    font-size: 18px;
  }
  .shop-name {
    font-size: 15px;
  }
  .shop-name-line {
    flex-wrap: wrap;
  }
  /* 订单状态下拉窄屏撑满一行 */
  .card-header .el-select {
    width: 100% !important;
  }
}
</style>
