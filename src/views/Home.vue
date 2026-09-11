<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import PetOnboardingDialog from '@/components/PetOnboardingDialog.vue'
import PetDeleteDialog from '@/components/PetDeleteDialog.vue'
import { getMe } from '@/api/user'
import { listMyPets, renamePet, signIn } from '@/api/pet'
import { getRecommendations } from '@/api/ai'

const router = useRouter()

// 用户名下全部宠物，分真实宠物（纯档案）与虚拟宠物（等级/经验/签到）两类
const pets = ref([])
const loading = ref(true)
const signing = ref(false)

// 引导弹窗：名下无任何宠物时弹出，让用户登记真实宠物或领养虚拟宠物
const onboardingVisible = ref(false)

// 虚拟宠物参与签到与经验，真实宠物为纯档案
const virtualPets = computed(() => pets.value.filter((p) => p.type === 'VIRTUAL'))
const realPets = computed(() => pets.value.filter((p) => p.type === 'REAL'))

// 改名弹窗，支持对任意一只宠物改名
const renameDialog = ref(false)
const renameTarget = ref(null)
const newName = ref('')
const renaming = ref(false)

// 删除确认弹窗：需手动逐字输入指定文案才能删除，防止误删
const deleteDialog = ref(false)
const deleteTarget = ref(null)

const loadPets = async () => {
  pets.value = await listMyPets()
}

const openRename = (target) => {
  renameTarget.value = target
  newName.value = target?.name || ''
  renameDialog.value = true
}

// 打开删除确认弹窗
const openDelete = (target) => {
  deleteTarget.value = target
  deleteDialog.value = true
}

// 删除成功后刷新宠物列表
const onDeleted = async () => {
  await loadPets()
}

const onRename = async () => {
  const name = newName.value.trim()
  if (!name) {
    ElMessage.warning('宠物名称不能为空')
    return
  }
  renaming.value = true
  try {
    const updated = await renamePet(renameTarget.value.id, name)
    const idx = pets.value.findIndex((p) => p.id === updated.id)
    if (idx > -1) pets.value[idx] = updated
    renameDialog.value = false
    ElMessage.success(`宠物已改名为 ${name}`)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    renaming.value = false
  }
}

// 点击宠物头像：新标签页打开该宠物的身份证详情页（切换头像在身份卡页内完成）
const openIdentity = (pet) => {
  window.open(router.resolve(`/pet/identity/${pet.id}`).href, '_blank')
}

// 虚拟宠物升级进度百分比，满级或无升级需求时为 100%
const petProgress = (p) => {
  if (!p || !p.nextLevelExp) return 100
  return Math.min(100, Math.round((p.exp / p.nextLevelExp) * 100))
}

// 打开引导弹窗（登记新的真实宠物 / 领养虚拟宠物）
const openOnboarding = () => {
  onboardingVisible.value = true
}

// 引导弹窗登记真实宠物成功后刷新列表
const onRegistered = async () => {
  await loadPets()
}

// 前往完善/修改真实宠物信息（已签发身份卡即已完善，进入后数据全部回显）
const goProfile = (pet) => {
  router.push(`/pet/profile/${pet.id}`)
}

onMounted(async () => {
  try {
    const me = await getMe()
    localStorage.setItem('user', JSON.stringify(me))
    await loadPets()
    // 名下无任何宠物时弹出引导，用户可登记真实宠物或领养虚拟宠物
    if (!pets.value.length) {
      onboardingVisible.value = true
    }
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
  // 推荐单独加载：失败静默降级，不阻塞首页主内容
  loadRecommend()
})

/* ==================== 为你推荐（LangGraph 个性化推荐） ==================== */

const recommendItems = ref([])
const recommendSummary = ref('')
const recommendLoading = ref(false)

const loadRecommend = async () => {
  recommendLoading.value = true
  try {
    const data = await getRecommendations('home')
    recommendItems.value = data.items || []
    recommendSummary.value = data.summary || ''
  } catch {
    // 推荐失败不影响首页主流程，静默降级为空态
    recommendItems.value = []
  } finally {
    recommendLoading.value = false
  }
}

// 点击推荐项：商品进详情页，动态进圈子
const openRecommend = (item) => {
  if (item.type === 'product') {
    router.push(`/shop/product/${item.id}`)
  } else {
    router.push('/space')
  }
}

// 每日签到为所有虚拟宠物增加经验，提示中标注升级的宠物
const onSignIn = async () => {
  signing.value = true
  try {
    const res = await signIn()
    await loadPets()
    const leveled = (res.pets || []).filter((i) => i.leveledUp)
    if (leveled.length) {
      ElMessage.success(
        `签到成功！+${res.gainedExp} 经验，全部 ${res.pets.length} 只虚拟宠物已领取，${leveled
          .map((i) => i.name)
          .join('、')} 升级啦`
      )
    } else {
      ElMessage.success(
        `签到成功！+${res.gainedExp} 经验，全部 ${res.pets.length} 只虚拟宠物已领取，连续签到 ${res.signStreak} 天`
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
    <div class="page-container">
      <!-- 欢迎 banner -->
      <div class="hero-banner">
        <div class="hello">欢迎回来 👋</div>
        <div class="sub">这里是你和宠物们的小窝</div>
      </div>

      <el-card v-if="loading" shadow="never" class="section">
        <el-skeleton :rows="6" animated />
      </el-card>

      <template v-else>
        <!-- 签到：仅当存在虚拟宠物 -->
        <el-card v-if="virtualPets.length" shadow="never" class="section sign-card">
          <div class="sign-row">
            <div class="sign-copy">
              <div class="sign-title">每日签到</div>
              <div class="sign-tip">为全部 {{ virtualPets.length }} 只虚拟宠物领取经验</div>
            </div>
            <el-button type="primary" size="large" round :loading="signing" @click="onSignIn">
              立即签到
            </el-button>
          </div>
        </el-card>

        <!-- 我的宠物：真实与虚拟统一展示，单一「添加宠物」入口 -->
        <el-card v-if="pets.length" shadow="never" class="section">
          <template #header>
            <div class="section-header">
              <span class="card-title">我的宠物（{{ pets.length }}）</span>
              <el-button size="small" round type="primary" @click="openOnboarding">
                添加宠物
              </el-button>
            </div>
          </template>

          <!-- 真实宠物分组 -->
          <div v-if="realPets.length" class="pet-group">
            <div class="group-label">真实宠物（{{ realPets.length }}）</div>
            <div class="pet-list">
              <div v-for="p in realPets" :key="p.id" class="pet-row">
                <div class="row-avatar-wrap" title="点击查看宠物身份证" @click="openIdentity(p)">
                  <el-avatar :size="56" :src="p.imageUrl || ''" class="row-avatar">
                    {{ (p.name || '宠')[0] }}
                  </el-avatar>
                  <div class="avatar-mask">身份卡</div>
                </div>
                <div class="row-main">
                  <div class="row-name-line">
                    <span class="row-name">{{ p.name }}</span>
                    <el-tag size="small" effect="plain" round>真实宠物</el-tag>
                  </div>
                  <div class="row-profile">
                    <span v-if="p.species">种类：{{ p.species }}</span>
                    <span v-if="p.genderName">性别：{{ p.genderName }}</span>
                    <span v-if="p.birthday">生日：{{ p.birthday }}</span>
                    <span>绝育：{{ p.sterilized ? '已绝育' : '未绝育' }}</span>
                    <span v-if="p.adoptionDate">收养：{{ p.adoptionDate }}</span>
                  </div>
                </div>
                <div class="row-actions">
                  <el-button size="small" round type="primary" plain @click="goProfile(p)">
                    {{ p.cardIssueDate ? '修改宠物信息' : '完善宠物信息' }}
                  </el-button>
                  <el-button size="small" round class="ghost-btn" @click="openRename(p)">改名</el-button>
                  <el-button size="small" round class="ghost-btn danger-btn" @click="openDelete(p)">删除</el-button>
                </div>
              </div>
            </div>
          </div>

          <!-- 虚拟宠物分组 -->
          <div v-if="virtualPets.length" class="pet-group">
            <div class="group-label">虚拟宠物（{{ virtualPets.length }}）</div>
            <div class="pet-list">
              <div v-for="p in virtualPets" :key="p.id" class="pet-row">
                <div class="row-avatar-wrap" title="点击查看宠物身份证" @click="openIdentity(p)">
                  <el-avatar :size="56" :src="p.imageUrl || ''" class="row-avatar">
                    {{ (p.name || '宠')[0] }}
                  </el-avatar>
                  <div class="avatar-mask">身份卡</div>
                </div>
                <div class="row-main">
                  <div class="row-name-line">
                    <span class="row-name">{{ p.name }}</span>
                    <el-tag size="small" effect="dark" round class="lv-tag">Lv.{{ p.level }}</el-tag>
                    <span class="row-breed">{{ p.species }} · {{ p.breed }}</span>
                  </div>
                  <div class="row-exp">
                    <div class="exp-label">
                      <span>升级进度</span>
                      <span>{{ p.exp }} / {{ p.nextLevelExp || '已满级' }}</span>
                    </div>
                    <el-progress :percentage="petProgress(p)" :stroke-width="8" :show-text="false" />
                  </div>
                </div>
                <div class="row-actions">
                  <el-button size="small" round class="ghost-btn" @click="openRename(p)">改名</el-button>
                  <el-button size="small" round class="ghost-btn danger-btn" @click="openDelete(p)">删除</el-button>
                </div>
              </div>
            </div>
          </div>
        </el-card>

        <!-- 空状态：无任何宠物，单一「添加宠物」入口 -->
        <el-card v-else shadow="never" class="section empty-card">
          <el-result
            icon="info"
            title="你还没有宠物"
            sub-title="登记你的真实宠物，或从图鉴领养一只虚拟伙伴"
          >
            <template #extra>
              <el-button type="primary" size="large" round @click="openOnboarding">
                添加宠物
              </el-button>
            </template>
          </el-result>
        </el-card>
      </template>

      <!-- 为你推荐：AI 结合宠物画像与浏览行为生成（失败/空态自动隐藏） -->
      <el-card v-if="!loading && recommendItems.length" shadow="never" class="section">
        <template #header>
          <div class="section-header">
            <span class="card-title">✨ 为你推荐</span>
            <span v-if="recommendSummary" class="recommend-summary">{{ recommendSummary }}</span>
          </div>
        </template>
        <div v-loading="recommendLoading" class="recommend-grid">
          <div
            v-for="item in recommendItems"
            :key="`${item.type}-${item.id}`"
            class="recommend-card"
            @click="openRecommend(item)"
          >
            <div class="recommend-cover">
              <el-image v-if="item.image" :src="item.image" fit="cover" class="recommend-img">
                <template #error><div class="recommend-ph">{{ item.type === 'product' ? '🛍️' : '🐾' }}</div></template>
              </el-image>
              <div v-else class="recommend-ph">{{ item.type === 'product' ? '🛍️' : '🐾' }}</div>
              <el-tag size="small" effect="dark" class="recommend-type">
                {{ item.type === 'product' ? '好物' : '动态' }}
              </el-tag>
            </div>
            <div class="recommend-title">{{ item.title || '—' }}</div>
            <div class="recommend-reason">{{ item.reason }}</div>
            <div v-if="item.type === 'product'" class="recommend-price">¥{{ item.price }}</div>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 引导 / 添加宠物弹窗：名下已有宠物时切换为「添加」文案 -->
    <PetOnboardingDialog
      v-model="onboardingVisible"
      :add-mode="pets.length > 0"
      @registered="onRegistered"
    />

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

    <!-- 删除宠物确认弹窗：需逐字输入指定文案方可删除 -->
    <PetDeleteDialog v-model="deleteDialog" :pet="deleteTarget" @deleted="onDeleted" />

  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
}
.hero-banner {
  background: var(--pv-ink);
  position: relative;
  padding: 28px 32px;
  overflow: hidden;
  border-radius: var(--pv-radius);
  margin-bottom: 20px;
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
  position: relative;
  z-index: 1;
}
.sub {
  color: rgba(255, 255, 255, 0.6);
  margin-top: 6px;
  font-size: 13px;
  position: relative;
  z-index: 1;
}
.section {
  margin-bottom: 20px;
}
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
/* 宠物分组：真实与虚拟在同一张卡片内分组展示 */
.pet-group + .pet-group {
  margin-top: 22px;
}
.group-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--pv-text-secondary);
  margin-bottom: 12px;
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

/* 签到卡片 */
.sign-card :deep(.el-card__body) {
  padding: 20px 24px;
}
.sign-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.sign-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--pv-text);
}
.sign-tip {
  font-size: 13px;
  color: var(--pv-text-secondary);
  margin-top: 4px;
}

/* 宠物列表 */
.pet-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.pet-row {
  display: flex;
  align-items: center;
  gap: 16px;
  border: 1px solid var(--pv-border);
  border-radius: 14px;
  padding: 16px 18px;
  background: #fff;
}
.row-avatar {
  flex-shrink: 0;
  font-size: 20px;
  box-shadow: 0 6px 14px rgba(23, 24, 28, 0.1);
}
/* 宠物行头像：悬停显示更换蒙层，点击选择图片上传 */
.row-avatar-wrap {
  position: relative;
  flex-shrink: 0;
  cursor: pointer;
  border-radius: 50%;
}
.avatar-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #fff;
  background: rgba(23, 24, 28, 0.45);
  border-radius: 50%;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.row-avatar-wrap:hover .avatar-mask {
  opacity: 1;
}
.row-main {
  flex: 1;
  min-width: 0;
}
.row-name-line {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.row-name {
  font-size: 17px;
  font-weight: 700;
  color: var(--pv-text);
}
.row-breed {
  font-size: 13px;
  color: var(--pv-text-secondary);
}
.lv-tag {
  background: var(--pv-ink);
  border: none;
  font-weight: 600;
}
.row-profile {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  margin-top: 8px;
  font-size: 13px;
  color: var(--pv-text-secondary);
}
.row-exp {
  margin-top: 10px;
}
.exp-label {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--pv-text-secondary);
  margin-bottom: 6px;
}
.row-exp :deep(.el-progress-bar__outer) {
  background-color: #ecebe8;
}
.row-exp :deep(.el-progress-bar__inner) {
  background: var(--pv-ink);
}
.row-actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  flex-shrink: 0;
}
.ghost-btn {
  font-weight: 600;
  color: var(--pv-text-secondary);
  border-color: var(--pv-border);
}
.ghost-btn:hover,
.ghost-btn:focus {
  color: var(--pv-ink);
  border-color: var(--pv-ink);
  background: var(--pv-tint);
}
/* 删除按钮：在单色基础上以危险色区分破坏性操作 */
.danger-btn {
  color: var(--el-color-danger, #c45656);
}
.danger-btn:hover,
.danger-btn:focus {
  color: var(--el-color-danger, #c45656);
  border-color: var(--el-color-danger, #c45656);
  background: rgba(196, 86, 86, 0.08);
}
.empty-card :deep(.el-card__body) {
  padding: 40px 24px;
}

/* 为你推荐 */
.recommend-summary {
  font-size: 12px;
  color: var(--pv-text-secondary);
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recommend-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 14px;
}
.recommend-card {
  border: 1px solid var(--pv-border);
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  cursor: pointer;
  transition: box-shadow 0.15s ease, transform 0.15s ease;
}
.recommend-card:hover {
  box-shadow: var(--pv-shadow);
  transform: translateY(-2px);
}
.recommend-cover {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  background: #f6f5f2;
}
.recommend-img {
  width: 100%;
  height: 100%;
}
.recommend-ph {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  color: var(--pv-text-secondary);
}
.recommend-type {
  position: absolute;
  top: 8px;
  left: 8px;
}
.recommend-title {
  padding: 10px 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--pv-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 38px;
}
.recommend-reason {
  padding: 6px 12px 0;
  font-size: 12px;
  color: #6b4fd8;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.recommend-price {
  padding: 6px 12px 12px;
  font-size: 15px;
  font-weight: 700;
  color: #d4380d;
}
@media (max-width: 768px) {
  .pet-row {
    flex-wrap: wrap;
  }
  .row-actions {
    flex-direction: row;
    width: 100%;
  }
}
</style>
