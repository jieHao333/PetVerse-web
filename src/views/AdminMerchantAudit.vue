<script setup>
import { onMounted, reactive, ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import AppHeader from '@/components/AppHeader.vue'
import { auditApply, pageApply } from '@/api/shop'

const applies = ref([])
const total = ref(0)
const pageNum = ref(1)
const pageSize = ref(10)
const status = ref('')
const shopName = ref('')
const loading = ref(false)

// 审批状态：0-待审核 1-已通过 2-已驳回
const statusOptions = [
  { value: 0, label: '待审核' },
  { value: 1, label: '已通过' },
  { value: 2, label: '已驳回' },
]
const statusMap = {
  0: { label: '待审核', type: 'warning' },
  1: { label: '已通过', type: 'success' },
  2: { label: '已驳回', type: 'danger' },
}

// 审批弹窗
const auditDialog = ref(false)
const current = ref(null)
const auditing = ref(false)
const auditForm = reactive({
  approved: true,
  rejectReason: '',
})

const loadApplies = async () => {
  loading.value = true
  try {
    const data = await pageApply({
      pageNum: pageNum.value,
      pageSize: pageSize.value,
      status: status.value === '' ? undefined : status.value,
      shopName: shopName.value || undefined,
    })
    applies.value = data.records || []
    // 后端 Long 统一序列化为字符串，total 需还原为数字供分页组件使用
    total.value = Number(data.total || 0)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

onMounted(loadApplies)

const onSearch = () => {
  pageNum.value = 1
  loadApplies()
}

const onSizeChange = () => {
  pageNum.value = 1
  loadApplies()
}

// 打开审批弹窗（查看详情 + 通过/驳回）
const openAudit = (row) => {
  current.value = row
  auditForm.approved = true
  auditForm.rejectReason = ''
  auditDialog.value = true
}

const onAudit = async () => {
  if (!auditForm.approved && !auditForm.rejectReason.trim()) {
    ElMessage.warning('驳回时必须填写驳回原因')
    return
  }
  auditing.value = true
  try {
    await auditApply({
      id: current.value.id,
      approved: auditForm.approved,
      rejectReason: auditForm.approved ? undefined : auditForm.rejectReason.trim(),
    })
    ElMessage.success(auditForm.approved ? '已通过，该用户已升级为商家' : '已驳回')
    auditDialog.value = false
    loadApplies()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    auditing.value = false
  }
}
</script>

<template>
  <div class="page">
    <AppHeader title="入驻审批" show-back />

    <div class="page-container">
      <el-card shadow="never" class="section">
        <template #header>
          <div class="card-header">
            <span class="card-title">商家入驻申请</span>
            <div class="filters">
              <el-select
                v-model="status"
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

        <el-table v-loading="loading" :data="applies" stripe>
          <el-table-column prop="shopName" label="店铺名称" min-width="140" show-overflow-tooltip />
          <el-table-column prop="applicantNickname" label="申请人" width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ row.applicantNickname || row.userId }}</template>
          </el-table-column>
          <el-table-column prop="contactName" label="联系人" width="100" />
          <el-table-column prop="contactPhone" label="联系电话" width="130" />
          <el-table-column prop="createTime" label="申请时间" width="170" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="statusMap[row.status]?.type" size="small" effect="plain">
                {{ statusMap[row.status]?.label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="{ row }">
              <el-button v-if="row.status === 0" type="primary" link @click="openAudit(row)">
                审批
              </el-button>
              <el-button v-else link @click="openAudit(row)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="pager">
          <span class="total-text">共 {{ total }} 条</span>
          <el-pagination
            v-model:current-page="pageNum"
            v-model:page-size="pageSize"
            :page-sizes="[10, 20, 50]"
            :total="Number(total)"
            layout="sizes, prev, pager, next"
            background
            @current-change="loadApplies"
            @size-change="onSizeChange"
          />
        </div>
      </el-card>
    </div>

    <!-- 审批/详情弹窗 -->
    <el-dialog v-model="auditDialog" :title="current?.status === 0 ? '审批入驻申请' : '申请详情'" width="520px">
      <div v-if="current">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="店铺名称">{{ current.shopName }}</el-descriptions-item>
          <el-descriptions-item label="申请人">
            {{ current.applicantNickname || current.userId }}
          </el-descriptions-item>
          <el-descriptions-item label="联系人">{{ current.contactName }}</el-descriptions-item>
          <el-descriptions-item label="联系电话">{{ current.contactPhone }}</el-descriptions-item>
          <el-descriptions-item label="营业执照号">{{ current.licenseNo }}</el-descriptions-item>
          <el-descriptions-item label="营业执照">
            <el-image
              :src="current.licenseUrl"
              fit="cover"
              class="license-thumb"
              :preview-src-list="[current.licenseUrl]"
              preview-teleported
            />
          </el-descriptions-item>
          <el-descriptions-item label="店铺简介">{{ current.description || '-' }}</el-descriptions-item>
          <el-descriptions-item label="申请时间">{{ current.createTime }}</el-descriptions-item>
          <el-descriptions-item v-if="current.status === 2" label="驳回原因">
            {{ current.rejectReason }}
          </el-descriptions-item>
        </el-descriptions>

        <!-- 仅待审核状态展示审批操作 -->
        <div v-if="current.status === 0" class="audit-area">
          <el-radio-group v-model="auditForm.approved">
            <el-radio :value="true">通过（创建店铺并升级为商家）</el-radio>
            <el-radio :value="false">驳回</el-radio>
          </el-radio-group>
          <el-input
            v-if="!auditForm.approved"
            v-model="auditForm.rejectReason"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
            placeholder="请填写驳回原因，将展示给申请人"
            class="reject-input"
          />
        </div>
      </div>
      <template v-if="current?.status === 0" #footer>
        <el-button @click="auditDialog = false">取消</el-button>
        <el-button
          :type="auditForm.approved ? 'success' : 'danger'"
          :loading="auditing"
          @click="onAudit"
        >
          {{ auditForm.approved ? '确认通过' : '确认驳回' }}
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
.license-thumb {
  width: 120px;
  height: 84px;
  border-radius: 8px;
  cursor: pointer;
}
.audit-area {
  margin-top: 18px;
  padding: 14px 16px;
  background: var(--pv-tint);
  border-radius: 10px;
}
.reject-input {
  margin-top: 12px;
}
</style>
