<script setup>
import { onMounted, reactive, ref } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import AppHeader from '@/components/AppHeader.vue'
import {
  completeOrder,
  deleteProduct,
  getMerchantInfo,
  pageMerchantOrders,
  pageMyProducts,
  saveProduct,
  updateMerchantInfo,
  updateProduct,
  uploadShopImage,
} from '@/api/shop'

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
    ElMessage.error(e.message)
  }
}

const openInfoDialog = () => {
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

onMounted(() => {
  loadMerchant()
  loadProducts()
  loadOrders()
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
  pickupOrder.value = order
  pickupCodeInput.value = ''
  pickupDialog.value = true
}

const onCompleteOrder = async () => {
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
            <el-button v-if="merchant" text type="primary" @click="openInfoDialog">编辑店铺</el-button>
          </div>
        </template>
        <div v-if="merchant" class="shop-info">
          <el-avatar :size="64" :src="merchant.shopLogo || ''" shape="square" class="shop-logo">
            {{ (merchant.shopName || '店')[0] }}
          </el-avatar>
          <div class="shop-meta">
            <div class="shop-name-line">
              <span class="shop-name">{{ merchant.shopName }}</span>
              <el-tag :type="merchant.status === 1 ? 'success' : 'danger'" size="small" effect="plain">
                {{ merchant.status === 1 ? '营业中' : '已封禁' }}
              </el-tag>
            </div>
            <div class="shop-desc">{{ merchant.description || '暂无店铺简介' }}</div>
            <div class="shop-sub">联系电话：{{ merchant.contactPhone }} · 开店时间：{{ merchant.createTime }}</div>
          </div>
        </div>
        <el-empty v-else description="未查询到店铺信息" :image-size="80" />
      </el-card>

      <!-- 商品管理 -->
      <el-card shadow="never" class="section">
        <template #header>
          <div class="card-header">
            <span class="card-title">商品管理</span>
            <el-button type="primary" :icon="Plus" @click="openProductDialog(null)">新增商品</el-button>
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
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <el-button type="primary" link @click="openProductDialog(row)">编辑</el-button>
              <el-button :type="row.status === 1 ? 'warning' : 'success'" link @click="onToggleStatus(row)">
                {{ row.status === 1 ? '下架' : '上架' }}
              </el-button>
              <el-button type="danger" link @click="onDeleteProduct(row)">删除</el-button>
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
      <el-card shadow="never" class="section">
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
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="{ row }">
              <el-button v-if="row.status === 1" type="primary" link @click="openPickupDialog(row)">
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
    </div>

    <!-- 编辑店铺信息 -->
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
</style>
