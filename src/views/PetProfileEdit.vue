<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import { getPetById, updatePetProfile } from '@/api/pet'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const saving = ref(false)
const pet = ref(null)
// 完善档案表单：种类、性别(1-弟弟 2-妹妹)、生日、是否绝育(1-是 0-否)
const form = reactive({
  species: '',
  gender: null,
  birthday: '',
  sterilized: 0,
})

onMounted(async () => {
  try {
    const data = await getPetById(route.params.id)
    pet.value = data
    if (data) {
      form.species = data.species || ''
      form.gender = data.gender ?? null
      form.birthday = data.birthday || ''
      form.sterilized = data.sterilized ? 1 : 0
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
      species: form.species || undefined,
      gender: form.gender ?? undefined,
      birthday: form.birthday || undefined,
      sterilized: form.sterilized,
    })
    ElMessage.success('宠物信息已完善')
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
    <AppHeader title="完善宠物信息" show-back />

    <div class="page-container">
      <el-card v-loading="loading" shadow="never" class="form-card">
        <template #header>
          <span class="card-title">{{ pet?.name || '宠物' }} 的档案</span>
        </template>

        <el-form :model="form" label-width="90px" size="large" class="profile-form">
          <el-form-item label="宠物名称">
            <el-input :model-value="pet?.name" disabled />
          </el-form-item>
          <el-form-item label="宠物种类">
            <el-input v-model.trim="form.species" maxlength="50" placeholder="如：猫、狗" clearable />
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
</style>
