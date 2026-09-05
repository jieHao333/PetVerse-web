<script setup>
import { computed, ref, watch } from 'vue'
import { deletePet } from '@/api/pet'

const props = defineProps({
  /** 是否显示弹窗，配合 v-model 使用 */
  modelValue: { type: Boolean, default: false },
  /** 待删除的宠物对象，需包含 id 与 name */
  pet: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue', 'deleted'])

const inputText = ref('')
const submitting = ref(false)

// 需用户手动逐字输入的确认文案，防止误删
const confirmText = computed(() => (props.pet ? `我确定删除${props.pet.name}这个宠物` : ''))
const matched = computed(() => !!inputText.value && inputText.value === confirmText.value)

// 每次打开弹窗重置输入与提交状态
watch(
  () => props.modelValue,
  (val) => {
    if (val) {
      inputText.value = ''
      submitting.value = false
    }
  },
)

const close = () => emit('update:modelValue', false)

// 仅当输入内容与指定文案完全一致时才允许删除
const onConfirm = async () => {
  if (!matched.value || !props.pet) return
  submitting.value = true
  try {
    await deletePet(props.pet.id)
    ElMessage.success(`已删除宠物 ${props.pet.name}`)
    emit('deleted', props.pet)
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
    title="删除宠物"
    width="440px"
    align-center
    class="delete-dialog"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <div class="dd-body">
      <el-alert
        type="error"
        :closable="false"
        show-icon
        title="删除后不可恢复"
        :description="`将永久删除宠物「${pet?.name || ''}」及其档案，请谨慎操作。`"
      />
      <p class="dd-tip">
        请输入以下内容以确认删除：
        <code class="dd-required">{{ confirmText }}</code>
      </p>
      <el-input v-model="inputText" :placeholder="`请输入：${confirmText}`" clearable />
      <p v-if="inputText && !matched" class="dd-error">输入内容不匹配，无法删除</p>
    </div>

    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="danger" :loading="submitting" :disabled="!matched" @click="onConfirm">
        确认删除
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dd-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.dd-tip {
  margin: 0;
  color: var(--pv-text-secondary);
  font-size: 13px;
}
.dd-required {
  display: inline-block;
  margin-left: 4px;
  padding: 1px 8px;
  border-radius: 6px;
  background: var(--pv-tint);
  border: 1px solid var(--pv-border);
  color: var(--pv-ink);
  font-weight: 600;
}
.dd-error {
  margin: -8px 0 0;
  color: var(--el-color-danger, #c45656);
  font-size: 12px;
}
</style>
