<script setup>
import { onMounted, reactive, ref } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import AppHeader from '@/components/AppHeader.vue'
import { getMyApply, resubmitApply, submitApply, uploadShopImage } from '@/api/shop'

const loading = ref(true)
const submitting = ref(false)
const uploading = ref(false)

// 当前用户最新的申请单，null 表示从未申请过
const apply = ref(null)
// 是否处于表单编辑态（首次申请 / 驳回后重新编辑）
const editing = ref(false)

const formRef = ref()
const form = reactive({
  shopName: '',
  contactName: '',
  contactPhone: '',
  licenseNo: '',
  licenseUrl: '',
  description: '',
})

const rules = {
  shopName: [
    { required: true, message: '请输入店铺名称', trigger: 'blur' },
    { max: 50, message: '店铺名称不能超过50个字符', trigger: 'blur' },
  ],
  contactName: [
    { required: true, message: '请输入联系人姓名', trigger: 'blur' },
    { max: 30, message: '联系人姓名不能超过30个字符', trigger: 'blur' },
  ],
  contactPhone: [
    { required: true, message: '请输入联系电话', trigger: 'blur' },
    { pattern: /^1[3-9]\d{9}$/, message: '联系电话格式不正确', trigger: 'blur' },
  ],
  licenseNo: [
    { required: true, message: '请输入营业执照号', trigger: 'blur' },
    { max: 50, message: '营业执照号不能超过50个字符', trigger: 'blur' },
  ],
  licenseUrl: [{ required: true, message: '请上传营业执照图片', trigger: 'change' }],
}

// 审批状态：0-待审核 1-已通过 2-已驳回
const statusMap = {
  0: { label: '待审核', type: 'warning' },
  1: { label: '已通过', type: 'success' },
  2: { label: '已驳回', type: 'danger' },
}

const loadMyApply = async () => {
  loading.value = true
  try {
    apply.value = await getMyApply()
    editing.value = !apply.value
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

onMounted(loadMyApply)

// 驳回后修改重提：回填原申请内容进入编辑态
const startResubmit = () => {
  Object.assign(form, {
    shopName: apply.value.shopName,
    contactName: apply.value.contactName,
    contactPhone: apply.value.contactPhone,
    licenseNo: apply.value.licenseNo,
    licenseUrl: apply.value.licenseUrl,
    description: apply.value.description || '',
  })
  editing.value = true
}

// 上传营业执照图片到OSS
const onLicenseChange = async (uploadFile) => {
  uploading.value = true
  try {
    form.licenseUrl = await uploadShopImage(uploadFile.raw)
    formRef.value?.validateField('licenseUrl')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    uploading.value = false
  }
}

const onSubmit = async () => {
  await formRef.value.validate()
  submitting.value = true
  try {
    if (apply.value && apply.value.status === 2) {
      await resubmitApply({ id: apply.value.id, ...form })
    } else {
      await submitApply({ ...form })
    }
    ElMessage.success('申请已提交，请耐心等待管理员审核')
    await loadMyApply()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="page">
    <AppHeader title="商家入驻" show-back />

    <div class="page-container narrow">
      <div v-loading="loading">
        <!-- 已有申请：展示最新申请状态 -->
        <el-card v-if="apply && !editing" shadow="never" class="section">
          <template #header>
            <div class="card-header">
              <span class="card-title">我的入驻申请</span>
              <el-tag :type="statusMap[apply.status]?.type" effect="plain">
                {{ statusMap[apply.status]?.label }}
              </el-tag>
            </div>
          </template>

          <el-alert
            v-if="apply.status === 0"
            title="申请已提交，管理员审核中，请耐心等待"
            type="warning"
            :closable="false"
            show-icon
            class="status-alert"
          />
          <el-alert
            v-else-if="apply.status === 1"
            title="恭喜，入驻申请已通过！请退出并重新登录以启用商家身份，然后进入商家中心管理店铺"
            type="success"
            :closable="false"
            show-icon
            class="status-alert"
          />
          <el-alert
            v-else-if="apply.status === 2"
            :title="`申请被驳回：${apply.rejectReason || '未填写原因'}`"
            type="error"
            :closable="false"
            show-icon
            class="status-alert"
          />

          <el-descriptions :column="1" border>
            <el-descriptions-item label="店铺名称">{{ apply.shopName }}</el-descriptions-item>
            <el-descriptions-item label="联系人">{{ apply.contactName }}</el-descriptions-item>
            <el-descriptions-item label="联系电话">{{ apply.contactPhone }}</el-descriptions-item>
            <el-descriptions-item label="营业执照号">{{ apply.licenseNo }}</el-descriptions-item>
            <el-descriptions-item label="营业执照">
              <el-image
                :src="apply.licenseUrl"
                fit="cover"
                class="license-thumb"
                :preview-src-list="[apply.licenseUrl]"
                preview-teleported
              />
            </el-descriptions-item>
            <el-descriptions-item label="店铺简介">{{ apply.description || '-' }}</el-descriptions-item>
            <el-descriptions-item label="申请时间">{{ apply.createTime }}</el-descriptions-item>
            <el-descriptions-item v-if="apply.auditTime" label="审批时间">
              {{ apply.auditTime }}
            </el-descriptions-item>
          </el-descriptions>

          <div v-if="apply.status === 2" class="actions">
            <el-button type="primary" size="large" @click="startResubmit">修改并重新提交</el-button>
          </div>
        </el-card>

        <!-- 首次申请 / 驳回后重提：入驻表单 -->
        <el-card v-else-if="!loading" shadow="never" class="section">
          <template #header>
            <span class="card-title">{{ apply ? '修改入驻申请' : '申请成为商家' }}</span>
          </template>
          <p class="tip">
            入驻后可在宠物商城售卖宠物用品、宠物食品及活体宠物，提交后需等待管理员审核
          </p>

          <el-form
            ref="formRef"
            :model="form"
            :rules="rules"
            label-width="100px"
            class="apply-form"
          >
            <el-form-item label="店铺名称" prop="shopName">
              <el-input v-model="form.shopName" maxlength="50" placeholder="给你的店铺取个名字" />
            </el-form-item>
            <el-form-item label="联系人" prop="contactName">
              <el-input v-model="form.contactName" maxlength="30" placeholder="联系人姓名" />
            </el-form-item>
            <el-form-item label="联系电话" prop="contactPhone">
              <el-input v-model="form.contactPhone" maxlength="11" placeholder="11位手机号" />
            </el-form-item>
            <el-form-item label="营业执照号" prop="licenseNo">
              <el-input v-model="form.licenseNo" maxlength="50" placeholder="统一社会信用代码" />
            </el-form-item>
            <el-form-item label="营业执照" prop="licenseUrl">
              <el-upload
                :show-file-list="false"
                :auto-upload="false"
                accept="image/jpeg,image/png,image/webp,image/gif"
                @change="onLicenseChange"
              >
                <div v-loading="uploading" class="license-uploader">
                  <el-image v-if="form.licenseUrl" :src="form.licenseUrl" fit="cover" class="license-img" />
                  <div v-else class="license-empty">
                    <el-icon><Plus /></el-icon>
                    <span>上传执照图片</span>
                  </div>
                </div>
              </el-upload>
            </el-form-item>
            <el-form-item label="店铺简介" prop="description">
              <el-input
                v-model="form.description"
                type="textarea"
                :rows="3"
                maxlength="500"
                show-word-limit
                placeholder="介绍一下你的店铺（选填）"
              />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" size="large" :loading="submitting" @click="onSubmit">
                提交申请
              </el-button>
              <el-button v-if="apply" size="large" @click="editing = false">取消</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
}
.narrow {
  max-width: 720px;
  margin: 0 auto;
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
.tip {
  color: var(--pv-text-secondary);
  margin: 0 0 18px;
}
.status-alert {
  margin-bottom: 18px;
}
.license-thumb {
  width: 120px;
  height: 84px;
  border-radius: 8px;
  cursor: pointer;
}
.actions {
  margin-top: 20px;
  text-align: center;
}
.apply-form {
  max-width: 560px;
  margin: 0 auto;
}
.license-uploader {
  width: 180px;
  height: 126px;
  border: 1px dashed var(--pv-border);
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.2s;
}
.license-uploader:hover {
  border-color: var(--pv-ink);
}
.license-img {
  width: 100%;
  height: 100%;
}
.license-empty {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--pv-text-secondary);
  font-size: 13px;
}
.license-empty .el-icon {
  font-size: 24px;
}
</style>
