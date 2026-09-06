<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Search, ShoppingCart } from '@element-plus/icons-vue'
import { pageProducts } from '@/api/shop'

const router = useRouter()

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

const loadProducts = async () => {
  loading.value = true
  try {
    const data = await pageProducts({
      pageNum: pageNum.value,
      pageSize: pageSize.value,
      keyword: keyword.value || undefined,
      category: category.value || undefined,
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

onMounted(loadProducts)

const onSearch = () => {
  pageNum.value = 1
  loadProducts()
}

const onSizeChange = () => {
  pageNum.value = 1
  loadProducts()
}

// 点击商品新标签页打开商品详情页（加购/直接购买/评价均在详情页内完成）
const openDetail = (item) => {
  const { href } = router.resolve(`/shop/product/${item.id}`)
  window.open(href, '_blank')
}

// 点击店铺名进入店家页面，浏览该店铺的全部商品
const goStore = (item) => {
  router.push(`/shop/store/${item.merchantId}`)
}

// 点击「我的评价」新标签页展示当前用户评价过的商品列表
const openMyReviews = () => {
  const { href } = router.resolve('/shop/my-reviews')
  window.open(href, '_blank')
}
</script>

<template>
  <div class="page">
    <div class="page-container">
      <el-card shadow="never" class="section">
        <template #header>
          <div class="card-header">
            <span class="card-title">宠物商城</span>
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
                placeholder="搜索商品名/详情/店铺"
                clearable
                style="width: 220px"
                :prefix-icon="Search"
                @keyup.enter="onSearch"
                @clear="onSearch"
              />
              <el-button type="primary" @click="onSearch">搜索</el-button>
              <el-button :icon="ShoppingCart" plain @click="router.push('/shop/cart')">购物车</el-button>
              <el-button plain @click="openMyReviews">我的评价</el-button>
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
              <div class="product-shop" @click.stop="goStore(item)">🏪 {{ item.shopName }}</div>
              <div class="product-bottom">
                <span class="price">¥{{ item.price }}</span>
                <span class="stock">库存 {{ item.stock }}</span>
              </div>
            </div>
          </div>

          <el-empty v-if="!loading && products.length === 0" description="暂无商品" class="empty" />
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
.product-shop {
  font-size: 12px;
  color: var(--pv-text-secondary);
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.product-shop:hover {
  color: var(--pv-ink);
  text-decoration: underline;
}
.product-bottom {
  margin-top: 10px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
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
</style>
