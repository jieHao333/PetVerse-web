<script setup>
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Search, ShoppingCart } from '@element-plus/icons-vue'
import AppHeader from '@/components/AppHeader.vue'
import { addCartItem, getProductDetail, getStoreInfo, pageProducts } from '@/api/shop'

const route = useRoute()
const router = useRouter()

const store = ref(null)
const storeLoading = ref(false)

const products = ref([])
const total = ref(0)
const pageNum = ref(1)
const pageSize = ref(12)
const keyword = ref('')
const category = ref('')
const loading = ref(false)

// 商品类型：与后端 category 字段约定一致
const categories = [
  { value: 1, label: '宠物用品' },
  { value: 2, label: '宠物食品' },
  { value: 3, label: '活体宠物' },
]

const categoryTagType = (code) => ({ 1: 'primary', 2: 'warning', 3: 'danger' })[code] || 'info'

const detailDialog = ref(false)
const detail = ref(null)
// 详情弹窗中的加购数量
const buyQuantity = ref(1)
const addingCart = ref(false)

// 加载店铺公开信息
const loadStore = async () => {
  storeLoading.value = true
  try {
    store.value = await getStoreInfo(route.params.id)
  } catch (e) {
    ElMessage.error(e.message)
    router.replace('/shop')
  } finally {
    storeLoading.value = false
  }
}

// 加载该店铺的上架商品
const loadProducts = async () => {
  loading.value = true
  try {
    const data = await pageProducts({
      pageNum: pageNum.value,
      pageSize: pageSize.value,
      keyword: keyword.value || undefined,
      category: category.value || undefined,
      merchantId: route.params.id,
    })
    products.value = data.records || []
    // 后端 Long 统一序列化为字符串，total 需还原为数字供分页组件使用
    total.value = Number(data.total || 0)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

const init = () => {
  pageNum.value = 1
  keyword.value = ''
  category.value = ''
  loadStore()
  loadProducts()
}

onMounted(init)

// 支持从一个店铺页跳到另一个店铺页时刷新数据
watch(() => route.params.id, (id) => {
  if (id && route.name === 'shopStore') {
    init()
  }
})

const onSearch = () => {
  pageNum.value = 1
  loadProducts()
}

const onSizeChange = () => {
  pageNum.value = 1
  loadProducts()
}

// 查看商品详情
const openDetail = async (item) => {
  try {
    detail.value = await getProductDetail(item.id)
    buyQuantity.value = 1
    detailDialog.value = true
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// 加入购物车（同一商品重复加购后端会累加数量）
const addToCart = async (productId, quantity) => {
  addingCart.value = true
  try {
    await addCartItem({ productId, quantity })
    ElMessage.success('已加入购物车')
    detailDialog.value = false
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    addingCart.value = false
  }
}
</script>

<template>
  <div class="page">
    <AppHeader show-nav />

    <div class="page-container">
      <!-- 店铺信息 -->
      <el-card v-loading="storeLoading" shadow="never" class="section store-card">
        <div v-if="store" class="store-header">
          <el-image :src="store.shopLogo || ''" fit="cover" class="store-logo">
            <template #error>
              <div class="logo-placeholder">🏪</div>
            </template>
          </el-image>
          <div class="store-info">
            <div class="store-name-row">
              <span class="store-name">{{ store.shopName }}</span>
              <el-tag type="success" size="small" effect="plain">营业中</el-tag>
            </div>
            <div class="store-desc">{{ store.description || '这家店铺很低调，还没有填写简介~' }}</div>
            <div class="store-meta">
              <span v-if="store.contactPhone">📞 {{ store.contactPhone }}</span>
              <span v-if="store.createTime">开店时间：{{ String(store.createTime).slice(0, 10) }}</span>
            </div>
          </div>
          <div class="store-actions">
            <el-button :icon="ShoppingCart" type="primary" plain @click="router.push('/shop/cart')">购物车</el-button>
            <el-button :icon="ArrowLeft" @click="router.push('/shop')">返回商城</el-button>
          </div>
        </div>
      </el-card>

      <!-- 店铺商品 -->
      <el-card shadow="never" class="section">
        <template #header>
          <div class="card-header">
            <span class="card-title">全部商品</span>
            <div class="filters">
              <el-select
                v-model="category"
                placeholder="全部类型"
                clearable
                style="width: 140px"
                @change="onSearch"
              >
                <el-option
                  v-for="c in categories"
                  :key="c.value"
                  :label="c.label"
                  :value="c.value"
                />
              </el-select>
              <el-input
                v-model="keyword"
                placeholder="搜索店内商品名或详情"
                clearable
                style="width: 220px"
                :prefix-icon="Search"
                @keyup.enter="onSearch"
                @clear="onSearch"
              />
              <el-button type="primary" @click="onSearch">搜索</el-button>
            </div>
          </div>
        </template>

        <div v-loading="loading" class="product-grid">
          <div
            v-for="item in products"
            :key="item.id"
            class="product-card"
            @click="openDetail(item)"
          >
            <div class="product-img">
              <el-image :src="item.imageUrl || ''" fit="cover" class="img">
                <template #error>
                  <div class="img-placeholder">🛍️</div>
                </template>
              </el-image>
              <el-tag :type="categoryTagType(item.category)" size="small" class="category-tag" effect="dark">
                {{ item.categoryName }}
              </el-tag>
            </div>
            <div class="product-body">
              <div class="product-name">{{ item.name }}</div>
              <div class="product-bottom">
                <span class="price">¥{{ item.price }}</span>
                <span class="stock">库存 {{ item.stock }}</span>
              </div>
              <el-button
                type="primary"
                size="small"
                class="add-cart-btn"
                :icon="ShoppingCart"
                plain
                @click.stop="addToCart(item.id, 1)"
              >
                加入购物车
              </el-button>
            </div>
          </div>

          <el-empty v-if="!loading && products.length === 0" description="该店铺暂无上架商品" class="empty" />
        </div>

        <div class="pager">
          <span class="total-text">共 {{ total }} 件商品</span>
          <el-pagination
            v-model:current-page="pageNum"
            v-model:page-size="pageSize"
            :page-sizes="[12, 24, 48]"
            :total="Number(total)"
            layout="sizes, prev, pager, next"
            background
            @current-change="loadProducts"
            @size-change="onSizeChange"
          />
        </div>
      </el-card>
    </div>

    <!-- 商品详情 -->
    <el-dialog v-model="detailDialog" title="商品详情" width="480px">
      <div v-if="detail" class="detail-body">
        <el-image :src="detail.imageUrl || ''" fit="cover" class="detail-img">
          <template #error>
            <div class="img-placeholder detail-placeholder">🛍️</div>
          </template>
        </el-image>
        <div class="detail-name">{{ detail.name }}</div>
        <div class="detail-tags">
          <el-tag :type="categoryTagType(detail.category)" size="small" effect="plain">
            {{ detail.categoryName }}
          </el-tag>
          <span class="detail-shop">{{ detail.shopName }}</span>
        </div>
        <div class="detail-price">
          <span class="price">¥{{ detail.price }}</span>
          <span class="stock">库存 {{ detail.stock }}</span>
        </div>
        <div v-if="detail.description" class="detail-desc">{{ detail.description }}</div>
      </div>
      <template #footer>
        <div v-if="detail" class="detail-footer">
          <el-input-number v-model="buyQuantity" :min="1" :max="Math.max(detail.stock || 1, 1)" />
          <el-button
            type="primary"
            :icon="ShoppingCart"
            :loading="addingCart"
            :disabled="!detail.stock"
            @click="addToCart(detail.id, buyQuantity)"
          >
            {{ detail.stock ? '加入购物车' : '已售罄' }}
          </el-button>
        </div>
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

/* 店铺信息头 */
.store-header {
  display: flex;
  align-items: center;
  gap: 18px;
}
.store-logo {
  width: 84px;
  height: 84px;
  border-radius: 16px;
  background: var(--pv-tint);
  flex-shrink: 0;
}
.logo-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 38px;
  background: var(--pv-tint);
  border-radius: 16px;
}
.store-info {
  flex: 1;
  min-width: 0;
}
.store-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.store-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--pv-text);
}
.store-desc {
  margin-top: 6px;
  font-size: 13px;
  color: var(--pv-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.store-meta {
  margin-top: 8px;
  display: flex;
  gap: 18px;
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.store-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
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

/* 商品网格 */
.product-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 16px;
  min-height: 120px;
  position: relative;
}
.empty {
  grid-column: 1 / -1;
}
.product-card {
  border: 1px solid var(--pv-border);
  background: #fff;
  border-radius: 14px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease;
}
.product-card:hover {
  transform: translateY(-4px);
  border-color: #c9c8c4;
  box-shadow: var(--pv-shadow-lg);
}
.product-img {
  position: relative;
  height: 160px;
  background: var(--pv-tint);
}
.img {
  width: 100%;
  height: 100%;
  display: block;
}
.img-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  background: var(--pv-tint);
}
.category-tag {
  position: absolute;
  top: 10px;
  left: 10px;
}
.product-body {
  padding: 12px 14px 14px;
}
.product-name {
  font-weight: 600;
  color: var(--pv-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.product-bottom {
  margin-top: 10px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.add-cart-btn {
  margin-top: 10px;
  width: 100%;
}
.price {
  color: #d4380d;
  font-size: 17px;
  font-weight: 700;
}
.stock {
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

/* 详情弹窗 */
.detail-body {
  text-align: center;
}
.detail-img {
  width: 100%;
  height: 240px;
  border-radius: 12px;
  background: var(--pv-tint);
}
.detail-placeholder {
  font-size: 56px;
  border-radius: 12px;
}
.detail-name {
  font-size: 18px;
  font-weight: 700;
  color: var(--pv-text);
  margin-top: 14px;
}
.detail-tags {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.detail-shop {
  font-size: 13px;
  color: var(--pv-text-secondary);
}
.detail-price {
  margin-top: 12px;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 14px;
}
.detail-desc {
  margin-top: 12px;
  color: var(--pv-text-secondary);
  line-height: 1.7;
  text-align: left;
  white-space: pre-wrap;
}
.detail-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
</style>
