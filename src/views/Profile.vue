<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import { getMe, updateUser, uploadAvatar } from '@/api/user'
import { listMyPets, renamePet, setActivePet } from '@/api/pet'

const router = useRouter()

const user = ref(null)
const pet = ref(null)
// 用户名下全部宠物，一用户可多宠，仅一只出场
const pets = ref([])
const profileForm = reactive({ nickname: '', avatar: '' })
const pwdForm = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })
const savingProfile = ref(false)
const savingPwd = ref(false)

// 头像上传状态
const uploadingAvatar = ref(false)

// 上传头像到阿里云 OSS，成功后即时刷新展示与本地用户信息
const onUploadAvatar = async ({ file }) => {
  if (uploadingAvatar.value) return
  uploadingAvatar.value = true
  try {
    user.value = await uploadAvatar(file)
    profileForm.avatar = user.value.avatar || ''
    localStorage.setItem('user', JSON.stringify(user.value))
    ElMessage.success('头像已更新')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    uploadingAvatar.value = false
  }
}

// 宠物改名弹窗状态，支持对任意一只宠物改名
const renameDialog = ref(false)
const renameTarget = ref(null)
const newName = ref('')
const renaming = ref(false)
// 正在切换出场的宠物ID，防止并发点击
const switchingId = ref(null)

const openRename = (target) => {
  renameTarget.value = target
  newName.value = target?.name || ''
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
    const updated = await renamePet(renameTarget.value.id, name)
    const idx = pets.value.findIndex((p) => p.id === updated.id)
    if (idx > -1) pets.value[idx] = updated
    if (pet.value?.id === updated.id) pet.value = updated
    renameDialog.value = false
    ElMessage.success(`宠物已改名为 ${name}`)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    renaming.value = false
  }
}

// 拉取全部宠物，出场宠物作为卡片主体展示；兼容存量数据无出场标记时取第一只
const loadPets = async () => {
  pets.value = await listMyPets()
  pet.value = pets.value.find((p) => p.active) || pets.value[0] || null
}

// 切换出场宠物：发布动态等经验只发放给出场宠物
const onSetActive = async (target) => {
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

// 宠物升级进度百分比，满级或无升级需求时为 100%
const petProgress = computed(() => {
  if (!pet.value || !pet.value.nextLevelExp) return 100
  return Math.min(100, Math.round((pet.value.exp / pet.value.nextLevelExp) * 100))
})

onMounted(async () => {
  try {
    user.value = await getMe()
    profileForm.nickname = user.value.nickname || ''
    profileForm.avatar = user.value.avatar || ''
  } catch (e) {
    ElMessage.error(e.message)
  }
  // 加载宠物信息，无宠物时展示领养入口，失败不阻断页面
  try {
    await loadPets()
  } catch {
    pets.value = []
    pet.value = null
  }
})

const onSaveProfile = async () => {
  savingProfile.value = true
  try {
    await updateUser({ nickname: profileForm.nickname, avatar: profileForm.avatar })
    const me = await getMe()
    user.value = me
    localStorage.setItem('user', JSON.stringify(me))
    ElMessage.success('资料已保存')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    savingProfile.value = false
  }
}

const onSavePassword = async () => {
  if (pwdForm.newPassword !== pwdForm.confirmPassword) {
    ElMessage.warning('两次输入的新密码不一致')
    return
  }
  savingPwd.value = true
  try {
    await updateUser({
      oldPassword: pwdForm.oldPassword,
      newPassword: pwdForm.newPassword,
    })
    pwdForm.oldPassword = ''
    pwdForm.newPassword = ''
    pwdForm.confirmPassword = ''
    ElMessage.success('密码修改成功')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    savingPwd.value = false
  }
}
</script>

<template>
  <div class="page">
    <AppHeader title="个人资料" show-nav />

    <div class="page-container profile-container">
      <div class="profile-left">
        <!-- 宠物信息 -->
        <el-card shadow="never">
          <template #header>
            <span class="card-title">我的宠物</span>
          </template>

          <div v-if="pets.length" class="pet-block">
            <div class="pet-head">
              <div class="avatar-ring">
                <el-avatar :size="72" :src="pet.imageUrl || ''">
                  {{ (pet.name || '宠')[0] }}
                </el-avatar>
              </div>
              <div>
                <div class="pet-name-row">
                  <span class="name">{{ pet.name }}</span>
                  <el-tag effect="dark" round class="lv-tag">Lv.{{ pet.level }}</el-tag>
                  <el-button class="rename-btn" size="small" round @click="openRename(pet)">改名</el-button>
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

            <div class="pet-tips">每日签到为所有宠物增加经验，发布动态只为出场宠物增加经验</div>

            <!-- 全部宠物：切换出场/改名 -->
            <div class="pet-list">
              <div v-for="p in pets" :key="p.id" class="pet-row" :class="{ active: p.active }">
                <el-avatar :size="40" :src="p.imageUrl || ''">{{ (p.name || '宠')[0] }}</el-avatar>
                <div class="pet-row-info">
                  <div class="pet-row-name">
                    {{ p.name }} <span class="pet-row-lv">Lv.{{ p.level }}</span>
                  </div>
                  <div class="pet-row-breed">{{ p.species }} · {{ p.breed }}</div>
                </div>
                <el-tag v-if="p.active" effect="dark" round size="small">出场中</el-tag>
                <el-button
                  v-else
                  size="small"
                  round
                  :loading="switchingId === p.id"
                  @click="onSetActive(p)"
                >
                  设为出场
                </el-button>
                <el-button size="small" round class="rename-btn" @click="openRename(p)">改名</el-button>
              </div>
              <el-button class="adopt-btn" size="small" round @click="router.push('/claim')">
                领养新宠物
              </el-button>
            </div>
          </div>

          <div v-else class="pet-empty">
            <p>你还没有宠物，领养一只作为你的社交形象吧</p>
            <el-button type="primary" @click="router.push('/claim')">去领养宠物</el-button>
          </div>
        </el-card>

        <!-- 基本资料 -->
        <el-card shadow="never">
          <template #header>
            <span class="card-title">基本资料</span>
          </template>

          <div class="user-head">
          <el-upload
            class="avatar-uploader"
            :show-file-list="false"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            :http-request="onUploadAvatar"
          >
            <div class="avatar-ring">
              <el-avatar :size="80" :src="profileForm.avatar || ''">
                {{ (profileForm.nickname || user?.username || 'U')[0].toUpperCase() }}
              </el-avatar>
            </div>
            <div class="avatar-tip">{{ uploadingAvatar ? '上传中...' : '点击更换头像' }}</div>
          </el-upload>
          <div>
            <div class="name">{{ profileForm.nickname || user?.nickname || '未设置' }}</div>
            <div class="username">账号: {{ user?.username }}</div>
          </div>
        </div>

        <el-form :model="profileForm" label-width="80px">
          <el-form-item label="昵称">
            <el-input v-model.trim="profileForm.nickname" placeholder="你的社交展示名" maxlength="30" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="savingProfile" @click="onSaveProfile">
              保存资料
            </el-button>
          </el-form-item>
        </el-form>
        </el-card>
      </div>

      <!-- 修改密码 -->
      <el-card shadow="never">
        <template #header>
          <span class="card-title">修改密码</span>
        </template>

        <el-form :model="pwdForm" label-width="80px">
          <el-form-item label="原密码" required>
            <el-input
              v-model="pwdForm.oldPassword"
              type="password"
              placeholder="请输入原密码"
              show-password
              autocomplete="current-password"
            />
          </el-form-item>
          <el-form-item label="新密码" required>
            <el-input
              v-model="pwdForm.newPassword"
              type="password"
              placeholder="6-32位"
              show-password
              autocomplete="new-password"
            />
          </el-form-item>
          <el-form-item label="确认密码" required>
            <el-input
              v-model="pwdForm.confirmPassword"
              type="password"
              placeholder="请再次输入新密码"
              show-password
              autocomplete="new-password"
            />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="savingPwd" @click="onSavePassword">
              修改密码
            </el-button>
          </el-form-item>
        </el-form>
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
.profile-container {
  max-width: none;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: start;
}
.profile-left {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}
@media (max-width: 860px) {
  .profile-container {
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
.user-head {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 24px;
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
.avatar-uploader {
  cursor: pointer;
  text-align: center;
  flex-shrink: 0;
}
.avatar-uploader:hover .avatar-ring {
  opacity: 0.85;
}
.avatar-tip {
  font-size: 12px;
  color: var(--pv-text-secondary);
  margin-top: 6px;
}
.name {
  font-size: 22px;
  font-weight: 700;
  color: var(--pv-text);
}
.username {
  color: var(--pv-text-secondary);
  margin-top: 4px;
}

/* 宠物信息卡片 */
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
.pet-name-row .name {
  font-size: 20px;
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
.pet-tips {
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.pet-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 16px 0;
  color: var(--pv-text-secondary);
}
/* 全部宠物列表 */
.pet-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pet-row {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--pv-border);
  border-radius: 12px;
  padding: 10px 14px;
  background: #fff;
}
.pet-row.active {
  border-color: transparent;
  box-shadow: 0 0 0 2px var(--pv-ink);
}
.pet-row-info {
  flex: 1;
  min-width: 0;
}
.pet-row-name {
  font-weight: 600;
  color: var(--pv-text);
}
.pet-row-lv {
  font-size: 12px;
  color: var(--pv-text-secondary);
  font-weight: 500;
}
.pet-row-breed {
  font-size: 12px;
  color: var(--pv-text-secondary);
  margin-top: 2px;
}
.adopt-btn {
  align-self: flex-start;
  font-weight: 600;
  color: var(--pv-text-secondary);
  border-color: var(--pv-border);
}
</style>
