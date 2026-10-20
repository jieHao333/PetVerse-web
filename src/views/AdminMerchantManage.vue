<script setup>
import { onMounted, ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { useIsMobile } from '@/utils/responsive'
import { banMerchant, pageAdminMerchants, unbanMerchant } from '@/api/shop'

// 窄屏下 el-table 的 fixed 操作列会悬浮遮挡横向滚动内容，按端动态禁用
const isMobile = useIsMobile()

const merchants = ref([])
const total = ref(0)
const pageNum = ref(1)
const pageSize = ref(10)
const state = ref('')
const shopName = ref('')
const loading = ref(false)

// 状态筛选：撤销中单独作为一个维度，其余对应 merchant.status
const stateOptions = [
  { value: 'open', label: '营业中' },
  { value: 'closed', label: '已打烊' },
  { value: 'banned', label: '已封禁' },
  { value: 'withdrawing', label: '撤销中' },
]

const statusMeta = (row) => {
  if (row.withdrawStatus === 1) {
    return { label: '撤销中', type: 'warning' }
  }
  if (row.status === 2) {
    return { label: '已封禁', type: 'danger' }
  }
  if (row.status === 1) {
    return { label: '营业中', type: 'success' }
  }
  return { label: '已打烊', type: 'info' }
}

// 状态补充信息：封禁展示原因/时间，撤销中展示冷静期截止时间
const statusExtra = (row) => {
  if (row.status === 2) {
    return `封禁原因：${row.banReason || '未填写'}${row.banTime ? `（${row.banTime}）` : ''}`
  }
  if (row.withdrawStatus === 1) {
    return `冷静期截止：${row.withdrawDeadline || '-'}`
  }
  return '—'
}

const loadMerchants = async () => {
  loading.value = true
  try {
    const params = {
      pageNum: pageNum.value,
      pageSize: pageSize.value,
      shopName: shopName.value || undefined,
    }
    if (state.value === 'withdrawing') {
      params.withdrawing = true
    } else if (state.value) {
      params.withdrawing = false
      params.status = { open: 1, closed: 0, banned: 2 }[state.value]
    }
    const data = await pageAdminMerchants(params)
    merchants.value = data.records || []
    // 后端 Long 统一序列化为字符串，total 需还原为数字供分页组件使用
    total.value = Number(data.total || 0)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

onMounted(loadMerchants)

const onSearch = () => {
  pageNum.value = 1
  loadMerchants()
}

const onSizeChange = () => {
  pageNum.value = 1
  loadMerchants()
}

const viewStore = (row) => {
  window.open(`/shop/store/${row.id}`, '_blank')
}

// 封禁弹窗：必须填写原因，提示封禁影响范围
const banDialog = ref(false)
const banTarget = ref(null)
const banReason = ref('')
const banning = ref(false)

const openBanDialog = (row) => {
  banTarget.value = row
  banReason.value = ''
  banDialog.value = true
}

const onBan = async () => {
  if (!banReason.value.trim()) {
    ElMessage.warning('请填写封禁原因')
    return
  }
  banning.value = true
  try {
    await banMerchant(banTarget.value.id, banReason.value.trim())
    ElMessage.success('已封禁，该店铺商品已从商城隐藏')
    banDialog.value = false
    loadMerchants()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    banning.value = false
  }
}

const onUnban = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确定解封店铺「${row.shopName}」吗？解封后店铺将恢复为打烊状态，需商家自行重新营业。`,
      '解封确认',
      { type: 'warning', confirmButtonText: '确认解封', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await unbanMerchant(row.id)
    ElMessage.success('已解封，店铺当前为打烊状态')
    loadMerchants()
  } catch (e) {
    ElMessage.error(e.message)
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
        title="商家违规可直接封禁"
        description="封禁后该商家全部商品会从商城隐藏，买家无法加购或下单，店铺页面会展示封禁提示；解封后店铺恢复为打烊状态。"
        class="top-alert"
      />

      <el-card shadow="never" class="section">
        <template #header>
          <div class="card-header">
            <span class="card-title">商家店铺</span>
            <div class="filters">
              <el-select
                v-model="state"
                placeholder="全部状态"
                clearable
                style="width: 130px"
                @change="onSearch"
              >
                <el-option
                  v-for="s in stateOptions"
                  :key="s.value"
                  :label="s.label"
                  :value="s.value"
                />
              </el-select>
              <el-input
                v-model="shopName"
                placeholder="搜索店铺名称"
                clearable
                style="width: 200px"
                :prefix-icon="Search"
                @keyup.enter="onSearch"
                @clear="onSearch"
              />
              <el-button type="primary" @click="onSearch">搜索</el-button>
            </div>
          </div>
        </template>

        <el-table v-loading="loading" :data="merchants" stripe>
          <el-table-column label="店铺" min-width="200">
            <template #default="{ row }">
              <div class="shop-cell">
                <el-avatar :size="38" :src="row.shopLogo || ''" shape="square" class="shop-logo">
                  {{ (row.shopName || '店')[0] }}
                </el-avatar>
                <span class="shop-name">{{ row.shopName }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="店主" width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ row.ownerNickname || row.userId }}</template>
          </el-table-column>
          <el-table-column prop="contactPhone" label="联系电话" width="130">
            <template #default="{ row }">{{ row.contactPhone || '-' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="statusMeta(row).type" size="small" effect="plain">
                {{ statusMeta(row).label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态说明" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">{{ statusExtra(row) }}</template>
          </el-table-column>
          <el-table-column prop="createTime" label="开店时间" width="170" />
          <el-table-column label="操作" :width="isMobile ? undefined : 190" :fixed="isMobile ? false : 'right'">
            <template #default="{ row }">
              <el-button link type="primary" @click="viewStore(row)">查看店铺</el-button>
              <el-button
                v-if="row.status === 2"
                link
                type="success"
                @click="onUnban(row)"
              >
                解封
              </el-button>
              <el-button
                v-else-if="row.withdrawStatus !== 1"
                link
                type="danger"
                @click="openBanDialog(row)"
              >
                封禁
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="pager">
          <span class="total-text">共 {{ total }} 家店铺</span>
          <el-pagination
            v-model:current-page="pageNum"
            v-model:page-size="pageSize"
            :page-sizes="[10, 20, 50]"
            :total="Number(total)"
            layout="sizes, prev, pager, next"
            background
            @current-change="loadMerchants"
            @size-change="onSizeChange"
          />
        </div>
      </el-card>
    </div>

    <!-- 封禁确认弹窗 -->
    <el-dialog v-model="banDialog" title="封禁商家" width="480px">
      <div v-if="banTarget" class="ban-body">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="店铺名称">{{ banTarget.shopName }}</el-descriptions-item>
          <el-descriptions-item label="店主">
            {{ banTarget.ownerNickname || banTarget.userId }}
          </el-descriptions-item>
          <el-descriptions-item label="当前状态">{{ statusMeta(banTarget).label }}</el-descriptions-item>
        </el-descriptions>
        <el-alert
          type="warning"
          show-icon
          :closable="false"
          title="封禁后立即生效"
          description="该店铺全部商品将从商城和搜索结果中隐藏，买家无法加购、下单，店铺页面会展示“该商家已被封禁”。"
        />
        <el-input
          v-model="banReason"
          type="textarea"
          :rows="3"
          maxlength="200"
          show-word-limit
          placeholder="请填写封禁原因，将展示给商家"
        />
      </div>
      <template #footer>
        <el-button @click="banDialog = false">取消</el-button>
        <el-button type="danger" :loading="banning" @click="onBan">确认封禁</el-button>
      </template>
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
.shop-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.shop-logo {
  flex-shrink: 0;
  border-radius: 8px;
  font-size: 15px;
}
.shop-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
.ban-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

@media (max-width: 768px) {
  .card-header .el-select,
  .card-header .el-input {
    width: 100% !important;
  }
}
</style>
