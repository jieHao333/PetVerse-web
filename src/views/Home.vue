<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import { getMe } from '@/api/user'
import { getMyPet, renamePet, signIn } from '@/api/pet'

const router = useRouter()

const pet = ref(null)
const loading = ref(true)
const signing = ref(false)

// 改名弹窗状态
const renameDialog = ref(false)
const newName = ref('')
const renaming = ref(false)

const openRename = () => {
  newName.value = pet.value?.name || ''
  renameDialog.value = true
}

const onRename = async () => {
  const name = newName.value.trim()
  if (!name) {
    ElMessage.warning('宠物名称不能为空')
    return
  }
  renaming.value = true
  try {
    pet.value = await renamePet(name)
    renameDialog.value = false
    ElMessage.success(`宠物已改名为 ${name}`)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    renaming.value = false
  }
}

// 升级进度百分比
const progress = computed(() => {
  if (!pet.value || !pet.value.nextLevelExp) return 100
  return Math.min(100, Math.round((pet.value.exp / pet.value.nextLevelExp) * 100))
})

onMounted(async () => {
  try {
    const me = await getMe()
    localStorage.setItem('user', JSON.stringify(me))
    pet.value = await getMyPet()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
})

const onSignIn = async () => {
  signing.value = true
  try {
    const res = await signIn()
    pet.value = await getMyPet()
    if (res.leveledUp) {
      ElMessage.success(`签到成功！+${res.gainedExp} 经验，宠物升级到 Lv.${res.level}`)
    } else {
      ElMessage.success(`签到成功！+${res.gainedExp} 经验，连续签到 ${res.signStreak} 天`)
    }
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    signing.value = false
  }
}
</script>

<template>
  <div class="page">
    <AppHeader title="PetVerse" show-nav />

    <div class="page-container">
      <el-card v-if="loading" shadow="never" class="pet-card">
        <el-skeleton :rows="6" animated />
      </el-card>

      <el-card v-else-if="!pet" shadow="never" class="pet-card empty-card">
        <el-result
          icon="info"
          title="你还没有宠物"
          sub-title="作为新用户，你可以随机抽取或自选一只心仪的宠物作为社交形象"
        >
          <template #extra>
            <el-button type="primary" size="large" round @click="router.push('/claim')">
              去领养宠物
            </el-button>
          </template>
        </el-result>
      </el-card>

      <el-card v-else shadow="never" class="pet-card">
        <div class="hero-banner">
          <div class="hero-greeting">
            <div class="hello">欢迎回来 👋</div>
            <div class="sub">今天也要好好陪伴你的伙伴哦</div>
          </div>
        </div>

        <div class="hero-body">
          <el-avatar :size="104" :src="pet.imageUrl || ''" class="pet-avatar">
            {{ (pet.name || '宠')[0] }}
          </el-avatar>
          <div class="pet-meta">
            <div class="name-row">
              <span class="pet-name">{{ pet.name }}</span>
              <el-tag effect="dark" round class="lv-tag">Lv.{{ pet.level }}</el-tag>
              <el-button class="rename-btn" size="small" round @click="openRename">改名</el-button>
            </div>
            <p class="desc">{{ pet.species }} · {{ pet.breed }}</p>
          </div>
          <div class="stat-chips">
            <div class="chip">
              <span class="chip-value">{{ pet.signStreak }}</span>
              <span class="chip-label">连续签到（天）</span>
            </div>
            <div class="chip">
              <span class="chip-value">{{ pet.exp }}</span>
              <span class="chip-label">当前经验</span>
            </div>
            <div class="chip">
              <span class="chip-value">{{ pet.nextLevelExp || 'MAX' }}</span>
              <span class="chip-label">升级所需</span>
            </div>
          </div>
        </div>

        <div class="exp-block">
          <div class="exp-label">
            <span>升级进度</span>
            <span>{{ pet.exp }} / {{ pet.nextLevelExp || '已满级' }}</span>
          </div>
          <el-progress :percentage="progress" :stroke-width="12" :show-text="false" />
        </div>

        <el-button type="primary" size="large" class="sign-btn" :loading="signing" @click="onSignIn">
          每日签到 · 领取经验
        </el-button>
      </el-card>
    </div>

    <!-- 修改宠物名字 -->
    <el-dialog v-model="renameDialog" title="修改宠物名字" width="380px">
      <el-input
        v-model="newName"
        maxlength="50"
        show-word-limit
        placeholder="给它取个新名字吧"
        clearable
      />
      <template #footer>
        <el-button @click="renameDialog = false">取消</el-button>
        <el-button type="primary" :loading="renaming" @click="onRename">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
}
.pet-card {
  max-width: none;
  margin: 0;
  overflow: hidden;
}
.pet-card :deep(.el-card__body) {
  padding: 0;
}
.empty-card :deep(.el-card__body) {
  padding: 48px 24px;
}

.hero-banner {
  background: var(--pv-ink);
  position: relative;
  padding: 30px 32px;
  overflow: hidden;
}
.hero-banner::before,
.hero-banner::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.hero-banner::before {
  width: 240px;
  height: 240px;
  top: -100px;
  right: -60px;
}
.hero-banner::after {
  width: 130px;
  height: 130px;
  bottom: -70px;
  right: 150px;
}
.hello {
  color: #fff;
  font-size: 22px;
  font-weight: 700;
}
.sub {
  color: rgba(255, 255, 255, 0.6);
  margin-top: 6px;
  font-size: 13px;
}

.hero-body {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  column-gap: 24px;
  padding: 26px 32px 4px;
  align-items: end;
  position: relative;
}
.pet-avatar {
  flex-shrink: 0;
  border: 4px solid #fff;
  box-shadow: 0 10px 24px rgba(23, 24, 28, 0.16);
  font-size: 34px;
}
.pet-meta {
  min-width: 0;
  padding-bottom: 8px;
}
.name-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.rename-btn {
  margin-left: 2px;
  font-weight: 600;
  color: var(--pv-text-secondary);
  border-color: var(--pv-border);
}
.rename-btn:hover,
.rename-btn:focus {
  color: var(--pv-ink);
  border-color: var(--pv-ink);
  background: var(--pv-tint);
}
.pet-name {
  font-size: 26px;
  font-weight: 700;
  color: var(--pv-text);
}
.lv-tag {
  background: var(--pv-ink);
  border: none;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.desc {
  margin: 6px 0 0;
  color: var(--pv-text-secondary);
}
.stat-chips {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(3, minmax(160px, 1fr));
  gap: 12px;
  margin-top: 20px;
}
.chip {
  background: var(--pv-tint);
  border: 1px solid var(--pv-border);
  border-radius: 12px;
  padding: 10px 18px;
  display: flex;
  flex-direction: column;
}
.chip-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--pv-text);
}
.chip-label {
  font-size: 12px;
  color: var(--pv-text-secondary);
  margin-top: 2px;
}

.exp-block {
  margin: 28px 32px 0;
}
.exp-label {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--pv-text-secondary);
  margin-bottom: 10px;
}
.exp-block :deep(.el-progress-bar__outer) {
  background-color: #ecebe8;
}
.exp-block :deep(.el-progress-bar__inner) {
  background: var(--pv-ink);
}

.sign-btn {
  width: 280px;
  margin: 26px 32px 32px;
  letter-spacing: 2px;
}
@media (max-width: 900px) {
  .stat-chips {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 768px) {
  .sign-btn {
    width: calc(100% - 64px);
  }
}
</style>
