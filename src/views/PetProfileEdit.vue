<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import { getPetById, updatePetProfile, uploadPetAvatar } from '@/api/pet'
import { PET_SPECIES, getBreedsBySpecies } from '@/data/petOptions'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const saving = ref(false)
const pet = ref(null)
// 完善/修改档案表单：种类、品种、性别(1-弟弟 2-妹妹)、生日、是否绝育(1-是 0-否)、收养时间
const form = reactive({
  species: '',
  breed: '',
  gender: null,
  birthday: '',
  sterilized: 0,
  adoptionDate: '',
})

// 载入时档案是否已完善（已签发身份卡）：决定标题与提示为「修改」还是「完善」
const isEdit = ref(false)
const pageTitle = computed(() => (isEdit.value ? '修改宠物信息' : '完善宠物信息'))

// 种类下拉选项：内置清单 + 当前已选值（兼容清单外的自定义/历史值，保证正常回显）
const speciesOptions = computed(() => {
  const list = [...PET_SPECIES]
  if (form.species && !list.includes(form.species)) list.unshift(form.species)
  return list
})

// 品种下拉选项：随所选种类联动 + 当前已选值（兼容自定义/历史值）
const breedOptions = computed(() => {
  const list = getBreedsBySpecies(form.species)
  if (form.breed && !list.includes(form.breed)) return [form.breed, ...list]
  return list
})

// 用户切换种类时，若已选品种不属于新种类则清空，避免种类与品种不匹配
const onSpeciesChange = () => {
  if (form.breed && !getBreedsBySpecies(form.species).includes(form.breed)) {
    form.breed = ''
  }
}

// 宠物头像上传状态：选中图片后立即上传 OSS 并更新展示
const uploadingAvatar = ref(false)

const onUploadAvatar = async ({ file }) => {
  if (uploadingAvatar.value) return
  uploadingAvatar.value = true
  try {
    const data = await uploadPetAvatar(route.params.id, file)
    pet.value = { ...pet.value, ...data }
    ElMessage.success('头像已更新')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    uploadingAvatar.value = false
  }
}

onMounted(async () => {
  try {
    const data = await getPetById(route.params.id)
    pet.value = data
    if (data) {
      // 已签发身份卡说明档案此前已完善，本次进入为「修改」模式
      isEdit.value = !!data.cardIssueDate
      form.species = data.species || ''
      form.breed = data.breed || ''
      form.gender = data.gender ?? null
      form.birthday = data.birthday || ''
      form.sterilized = data.sterilized ? 1 : 0
      form.adoptionDate = data.adoptionDate || ''
    }
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
})

const onSubmit = async () => {
  saving.value = true
  try {
    await updatePetProfile({
      petId: route.params.id,
      species: form.species?.trim() || undefined,
      breed: form.breed?.trim() || undefined,
      gender: form.gender ?? undefined,
      birthday: form.birthday || undefined,
      sterilized: form.sterilized,
      adoptionDate: form.adoptionDate || undefined,
    })
    ElMessage.success(isEdit.value ? '宠物信息已更新' : '宠物信息已完善')
    router.back()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="page">
    <AppHeader :title="pageTitle" show-back />

    <div class="page-container">
      <el-card v-loading="loading" shadow="never" class="form-card">
        <template #header>
          <span class="card-title">{{ pet?.name || '宠物' }} 的档案</span>
        </template>

        <div class="avatar-block">
          <el-upload
            class="avatar-uploader"
            :show-file-list="false"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            :http-request="onUploadAvatar"
          >
            <el-avatar :size="80" :src="pet?.imageUrl || ''">
              {{ (pet?.name || '宠')[0] }}
            </el-avatar>
            <div class="avatar-tip">{{ uploadingAvatar ? '上传中...' : '点击更换头像' }}</div>
          </el-upload>
        </div>

        <el-form :model="form" label-width="90px" size="large" class="profile-form">
          <el-form-item label="宠物名称">
            <el-input :model-value="pet?.name" disabled />
          </el-form-item>
          <el-form-item label="宠物种类">
            <el-select
              v-model="form.species"
              placeholder="请选择或输入宠物种类"
              filterable
              allow-create
              default-first-option
              :reserve-keyword="false"
              clearable
              style="width: 100%"
              @change="onSpeciesChange"
            >
              <el-option v-for="item in speciesOptions" :key="item" :label="item" :value="item" />
            </el-select>
          </el-form-item>
          <el-form-item label="宠物品种">
            <el-select
              v-model="form.breed"
              :placeholder="form.species ? '请选择或输入宠物品种' : '请先选择宠物种类'"
              :disabled="!form.species"
              filterable
              allow-create
              default-first-option
              :reserve-keyword="false"
              clearable
              style="width: 100%"
            >
              <el-option v-for="item in breedOptions" :key="item" :label="item" :value="item" />
            </el-select>
          </el-form-item>
          <el-form-item label="宠物性别">
            <el-radio-group v-model="form.gender">
              <el-radio :value="1">弟弟</el-radio>
              <el-radio :value="2">妹妹</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="宠物生日">
            <el-date-picker
              v-model="form.birthday"
              type="date"
              placeholder="选择出生年月日"
              value-format="YYYY-MM-DD"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="是否绝育">
            <el-radio-group v-model="form.sterilized">
              <el-radio :value="1">已绝育</el-radio>
              <el-radio :value="0">未绝育</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="收养时间">
            <el-date-picker
              v-model="form.adoptionDate"
              type="date"
              placeholder="选择收养日期"
              value-format="YYYY-MM-DD"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="saving" @click="onSubmit">保存信息</el-button>
            <el-button @click="router.back()">取消</el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
}
.form-card {
  max-width: 560px;
  margin: 0 auto;
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
.profile-form {
  margin-top: 8px;
}
/* 宠物头像上传：居中展示，悬停提示可点击更换 */
.avatar-block {
  display: flex;
  justify-content: center;
  margin-bottom: 18px;
}
.avatar-uploader {
  cursor: pointer;
  text-align: center;
}
.avatar-uploader:hover .el-avatar {
  opacity: 0.85;
}
.avatar-uploader :deep(.el-upload) {
  display: block;
}
.avatar-tip {
  font-size: 12px;
  color: var(--pv-text-secondary);
  margin-top: 6px;
}
</style>
