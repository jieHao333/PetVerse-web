<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import { getUserById } from '@/api/user'
import { getPetByUserId } from '@/api/pet'
import { getNotePage } from '@/api/note'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const user = ref(null)
const pet = ref(null)
const notes = ref([])

const displayName = computed(() => user.value?.nickname || user.value?.username || '用户')

// 宠物升级进度百分比，满级或无升级需求时为 100%
const petProgress = computed(() => {
  if (!pet.value || !pet.value.nextLevelExp) return 100
  return Math.min(100, Math.round((pet.value.exp / pet.value.nextLevelExp) * 100))
})

// 时间格式化：2026-08-22T13:58 -> 2026-08-22 13:58
const formatTime = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '')

// 三个数据源独立容错：用户不存在直接提示返回，宠物/笔记失败仅置空不阻断
onMounted(async () => {
  const userId = route.params.id
  try {
    user.value = await getUserById(userId)
  } catch (e) {
    ElMessage.error(e.message)
  }
  if (!user.value) {
    ElMessage.error('用户不存在')
    router.back()
    return
  }
  loading.value = false
  try {
    pet.value = await getPetByUserId(userId)
  } catch {
    pet.value = null
  }
  try {
    const page = await getNotePage({ userId, pageNum: 1, pageSize: 50 })
    notes.value = page?.records || []
  } catch {
    notes.value = []
  }
})
</script>

<template>
  <div class="page">
    <AppHeader title="用户主页" show-nav />

    <div v-loading="loading" class="page-container up-container">
      <div class="up-left">
        <!-- 账号信息 -->
        <el-card shadow="never">
          <template #header>
            <span class="card-title">账号信息</span>
          </template>
          <div v-if="user" class="up-head">
            <div class="avatar-ring">
              <el-avatar :size="80" :src="user.avatar || ''">
                {{ (user.nickname || user.username || 'U')[0].toUpperCase() }}
              </el-avatar>
            </div>
            <div>
              <div class="up-name">{{ displayName }}</div>
              <div class="up-account">账号：{{ user.username }}</div>
              <div class="up-meta">注册于 {{ formatTime(user.createTime) }}</div>
            </div>
          </div>
        </el-card>

        <!-- 宠物信息 -->
        <el-card shadow="never">
          <template #header>
            <span class="card-title">TA 的宠物</span>
          </template>
          <div v-if="pet" class="pet-block">
            <div class="pet-head">
              <div class="avatar-ring">
                <el-avatar :size="64" :src="pet.imageUrl || ''">
                  {{ (pet.name || '宠')[0] }}
                </el-avatar>
              </div>
              <div>
                <div class="pet-name-row">
                  <span class="pet-name">{{ pet.name }}</span>
                  <el-tag effect="dark" round class="lv-tag">Lv.{{ pet.level }}</el-tag>
                </div>
                <div class="pet-breed">{{ pet.species }} · {{ pet.breed }}</div>
              </div>
            </div>
            <div class="pet-exp">
              <div class="exp-label">
                <span>升级进度</span>
                <span>{{ pet.exp }} / {{ pet.nextLevelExp || '已满级' }}</span>
              </div>
              <el-progress :percentage="petProgress" :stroke-width="10" :show-text="false" />
            </div>
          </div>
          <p v-else class="empty-tip">TA 还没有宠物</p>
        </el-card>
      </div>

      <!-- 发布的笔记 -->
      <el-card shadow="never">
        <template #header>
          <span class="card-title">TA 的笔记</span>
        </template>
        <div v-if="notes.length" class="note-list">
          <div v-for="note in notes" :key="note.id" class="note-item">
            <div class="note-title-row">
              <span class="note-title">{{ note.title }}</span>
              <el-tag v-if="note.category" size="small" round>{{ note.category }}</el-tag>
            </div>
            <div class="note-content">{{ note.content }}</div>
            <div class="note-time">{{ formatTime(note.createTime) }}</div>
          </div>
        </div>
        <p v-else class="empty-tip">还没有发布过笔记</p>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
}
.up-container {
  max-width: none;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: start;
}
.up-left {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}
@media (max-width: 860px) {
  .up-container {
    grid-template-columns: 1fr;
  }
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
.up-head {
  display: flex;
  align-items: center;
  gap: 20px;
}
.avatar-ring {
  padding: 3px;
  border-radius: 50%;
  background: var(--pv-ink);
  flex-shrink: 0;
}
.avatar-ring :deep(.el-avatar) {
  border: 3px solid #fff;
  font-size: 26px;
}
.up-name {
  font-size: 22px;
  font-weight: 700;
  color: var(--pv-text);
}
.up-account {
  color: var(--pv-text-secondary);
  margin-top: 4px;
}
.up-meta {
  font-size: 12px;
  color: var(--pv-text-secondary);
  margin-top: 6px;
}

/* 宠物信息 */
.pet-block {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.pet-head {
  display: flex;
  align-items: center;
  gap: 16px;
}
.pet-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pet-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--pv-text);
}
.lv-tag {
  background: var(--pv-ink);
  border: none;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.pet-breed {
  color: var(--pv-text-secondary);
  margin-top: 4px;
  font-size: 13px;
}
.pet-exp {
  background: var(--pv-tint);
  border: 1px solid var(--pv-border);
  border-radius: 12px;
  padding: 12px 16px;
}
.exp-label {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--pv-text-secondary);
  margin-bottom: 8px;
}
.pet-exp :deep(.el-progress-bar__outer) {
  background-color: #e4e4e0;
}
.pet-exp :deep(.el-progress-bar__inner) {
  background: var(--pv-ink);
}

/* 笔记列表 */
.note-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.note-item {
  border: 1px solid var(--pv-border);
  border-radius: 12px;
  padding: 14px 16px;
  background: #fff;
}
.note-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.note-title {
  font-weight: 600;
  color: var(--pv-text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.note-content {
  margin-top: 8px;
  font-size: 13px;
  color: var(--pv-text-secondary);
  line-height: 1.7;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
}
.note-time {
  margin-top: 8px;
  font-size: 12px;
  color: var(--pv-text-secondary);
  text-align: right;
}
.empty-tip {
  color: var(--pv-text-secondary);
  text-align: center;
  padding: 18px 0;
}
</style>
