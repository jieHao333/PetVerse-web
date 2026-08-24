<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import { getMe } from '@/api/user'
import { listMyPets, renamePet, setActivePet, signIn } from '@/api/pet'

const router = useRouter()

const pet = ref(null)
// 用户名下全部宠物，一用户可多宠，仅一只出场
const pets = ref([])
const loading = ref(true)
const signing = ref(false)
// 正在切换出场的宠物ID，防止并发点击
const switchingId = ref(null)

// 改名弹窗状态
const renameDialog = ref(false)
const newName = ref('')
const renaming = ref(false)

// 拉取全部宠物，出场宠物作为主卡片展示；兼容存量数据无出场标记时取第一只
const loadPets = async () => {
  pets.value = await listMyPets()
  pet.value = pets.value.find((p) => p.active) || pets.value[0] || null
}

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
    const updated = await renamePet(pet.value.id, name)
    const idx = pets.value.findIndex((p) => p.id === updated.id)
    if (idx > -1) pets.value[idx] = updated
    pet.value = updated
    renameDialog.value = false
    ElMessage.success(`宠物已改名为 ${name}`)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    renaming.value = false
  }
}

// 切换出场宠物：发布动态等经验只发放给出场宠物
const onSwitch = async (target) => {
  if (target.active || switchingId.value) return
  switchingId.value = target.id
  try {
    await setActivePet(target.id)
    await loadPets()
    ElMessage.success(`已切换 ${target.name} 出场`)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    switchingId.value = null
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
    await loadPets()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
})

// 签到为所有宠物增加经验，提示中标注升级的宠物
const onSignIn = async () => {
  signing.value = true
  try {
    const res = await signIn()
    await loadPets()
    const leveled = (res.pets || []).filter((i) => i.leveledUp)
    if (leveled.length) {
      ElMessage.success(
        `签到成功！+${res.gainedExp} 经验，全部 ${res.pets.length} 只宠物已领取，${leveled
          .map((i) => i.name)
          .join('、')} 升级啦`
      )
    } else {
      ElMessage.success(
        `签到成功！+${res.gainedExp} 经验，全部 ${res.pets.length} 只宠物已领取，连续签到 ${res.signStreak} 天`
      )
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
          每日签到 · 为所有宠物领取经验
        </el-button>
      </el-card>

      <!-- 我的宠物列表：可切换出场、前往领养新宠 -->
      <el-card v-if="!loading && pets.length" shadow="never" class="pets-card">
        <template #header>
          <div class="pets-header">
            <span class="card-title">我的宠物（{{ pets.length }}）</span>
            <el-button size="small" round @click="router.push('/claim')">领养新宠物</el-button>
          </div>
        </template>
        <div class="pets-row">
          <div v-for="p in pets" :key="p.id" class="pet-chip" :class="{ active: p.active }">
            <el-avatar :size="48" :src="p.imageUrl || ''">{{ (p.name || '宠')[0] }}</el-avatar>
            <div class="pet-chip-info">
              <div class="pet-chip-name">
                {{ p.name }} <span class="pet-chip-lv">Lv.{{ p.level }}</span>
              </div>
              <div class="pet-chip-breed">{{ p.species }} · {{ p.breed }}</div>
            </div>
            <el-tag v-if="p.active" effect="dark" round size="small">出场中</el-tag>
            <el-button
              v-else
              size="small"
              round
              :loading="switchingId === p.id"
              @click="onSwitch(p)"
            >
              设为出场
            </el-button>
          </div>
        </div>
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

/* 我的宠物列表 */
.pets-card {
  margin-top: 20px;
}
.pets-header {
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
.pets-row {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pet-chip {
  display: flex;
  align-items: center;
  gap: 14px;
  border: 1px solid var(--pv-border);
  border-radius: 12px;
  padding: 12px 16px;
  background: #fff;
}
.pet-chip.active {
  border-color: transparent;
  box-shadow: 0 0 0 2px var(--pv-ink);
}
.pet-chip-info {
  flex: 1;
  min-width: 0;
}
.pet-chip-name {
  font-weight: 600;
  color: var(--pv-text);
}
.pet-chip-lv {
  font-size: 12px;
  color: var(--pv-text-secondary);
  font-weight: 500;
}
.pet-chip-breed {
  font-size: 12px;
  color: var(--pv-text-secondary);
  margin-top: 2px;
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
