<script setup>
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { registerPet } from '@/api/pet'

const props = defineProps({
  /** 是否显示弹窗，配合 v-model 使用 */
  modelValue: { type: Boolean, default: false },
  /** 添加模式：名下已有宠物时为 true，文案切换为「添加宠物」而非新人欢迎引导 */
  addMode: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'registered'])

const router = useRouter()

// 步骤：choose-选择是否已有宠物；form-登记真实宠物名称与收养时间
const step = ref('choose')
const submitting = ref(false)
const form = reactive({ name: '', adoptionDate: '' })

// 根据名下是否已有宠物切换文案：无宠物为新人欢迎引导，有宠物为「添加宠物」
const dialogTitle = computed(() => (props.addMode ? '添加宠物' : '欢迎来到 PetVerse'))
const chooseTip = computed(() =>
  props.addMode ? '选择要添加的宠物类型' : '先告诉我们，你现在是否已经养了宠物？',
)
const realOptionTitle = computed(() => (props.addMode ? '登记真实宠物' : '我已有宠物'))
const realOptionDesc = computed(() =>
  props.addMode ? '记录它的名字与收养时间' : '登记它的名字与收养时间',
)
const virtualOptionTitle = computed(() => (props.addMode ? '领养虚拟宠物' : '我还没有宠物'))
const virtualOptionDesc = computed(() =>
  props.addMode ? '从图鉴抽卡领养一只伙伴' : '从图鉴领养一只虚拟伙伴',
)

const close = () => emit('update:modelValue', false)

// 选择「已有宠物」，进入登记表单
const onHasPet = () => {
  step.value = 'form'
}

// 选择「未有宠物」，关闭弹窗并跳转原图鉴抽卡领养流程
const onNoPet = () => {
  close()
  router.push('/claim')
}

// 返回上一步重新选择
const onBack = () => {
  step.value = 'choose'
}

// 提交登记真实宠物，成功后通知父组件刷新并关闭
const onSubmit = async () => {
  const name = form.name.trim()
  if (!name) {
    ElMessage.warning('请先给宠物取个名字')
    return
  }
  if (name.length > 50) {
    ElMessage.warning('宠物名称不能超过50个字符')
    return
  }
  submitting.value = true
  try {
    const pet = await registerPet({
      name,
      adoptionDate: form.adoptionDate || undefined,
    })
    ElMessage.success(`已登记 ${name}，可在首页完善它的信息`)
    form.name = ''
    form.adoptionDate = ''
    step.value = 'choose'
    emit('registered', pet)
    close()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    width="460px"
    align-center
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    class="onboarding-dialog"
  >
    <template #header>
      <div class="ob-header">
        <span class="ob-logo-wrap"><img :src="logo" alt="PetVerse" class="ob-logo" /></span>
        <span class="ob-title">{{ dialogTitle }}</span>
      </div>
    </template>

    <!-- 第一步：选择是否已有宠物 -->
    <div v-if="step === 'choose'" class="ob-body">
      <p class="ob-tip">{{ chooseTip }}</p>
      <div class="ob-options">
        <div class="ob-option" @click="onHasPet">
          <span class="ob-option-icon">🏡</span>
          <div class="ob-option-text">
            <div class="ob-option-title">{{ realOptionTitle }}</div>
            <div class="ob-option-desc">{{ realOptionDesc }}</div>
          </div>
        </div>
        <div class="ob-option" @click="onNoPet">
          <span class="ob-option-icon">🎲</span>
          <div class="ob-option-text">
            <div class="ob-option-title">{{ virtualOptionTitle }}</div>
            <div class="ob-option-desc">{{ virtualOptionDesc }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 第二步：登记真实宠物 -->
    <div v-else class="ob-body">
      <p class="ob-tip">登记你的宠物，名称必填，收养时间可选</p>
      <el-form label-position="top" size="large" @submit.prevent="onSubmit">
        <el-form-item label="宠物名称" required>
          <el-input v-model="form.name" maxlength="50" placeholder="给它取个名字吧" clearable />
        </el-form-item>
        <el-form-item label="收养时间">
          <el-date-picker
            v-model="form.adoptionDate"
            type="date"
            placeholder="选择收养日期（可选）"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <template v-if="step === 'form'">
        <el-button @click="onBack">返回</el-button>
        <el-button type="primary" :loading="submitting" @click="onSubmit">完成登记</el-button>
      </template>
      <el-button v-else @click="close">稍后再说</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ob-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ob-logo {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  object-fit: cover;
  display: block;
}
.ob-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--pv-text);
}
.ob-body {
  padding: 4px 0;
}
.ob-tip {
  color: var(--pv-text-secondary);
  margin: 0 0 18px;
}
.ob-options {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ob-option {
  display: flex;
  align-items: center;
  gap: 16px;
  border: 1px solid var(--pv-border);
  border-radius: 14px;
  padding: 18px 20px;
  cursor: pointer;
  transition: transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease;
}
.ob-option:hover {
  transform: translateY(-2px);
  border-color: var(--pv-ink);
  box-shadow: var(--pv-shadow);
}
.ob-option-icon {
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  border-radius: 12px;
  background: var(--pv-tint);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
}
.ob-option-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--pv-text);
}
.ob-option-desc {
  font-size: 13px;
  color: var(--pv-text-secondary);
  margin-top: 4px;
}
</style>
