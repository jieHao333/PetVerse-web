<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import { getMe, updateUser, uploadAvatar } from '@/api/user'
import { getMyPet, renamePet } from '@/api/pet'
import { getNotePage } from '@/api/note'

const router = useRouter()

const user = ref(null)
const pet = ref(null)
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

// 宠物改名弹窗状态
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

// 宠物升级进度百分比，满级或无升级需求时为 100%
const petProgress = computed(() => {
  if (!pet.value || !pet.value.nextLevelExp) return 100
  return Math.min(100, Math.round((pet.value.exp / pet.value.nextLevelExp) * 100))
})

// 我的笔记（仅当前用户，与笔记广场区分）
const myNotes = ref([])
const loadingNotes = ref(false)

const formatTime = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '')

const loadMyNotes = async (userId) => {
  loadingNotes.value = true
  try {
    const page = await getNotePage({ userId, pageNum: 1, pageSize: 20 })
    myNotes.value = page?.records || []
  } catch {
    myNotes.value = []
  } finally {
    loadingNotes.value = false
  }
}

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
    pet.value = await getMyPet()
  } catch {
    pet.value = null
  }
  // 加载我的笔记，失败不阻断页面
  if (user.value?.id) {
    loadMyNotes(user.value.id)
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

          <div v-if="pet" class="pet-block">
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
                  <el-button class="rename-btn" size="small" round @click="openRename">改名</el-button>
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

            <div class="pet-tips">每日签到、发布新笔记都可以为它获得经验升级</div>
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
            <div class="username">@{{ user?.username }}</div>
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

        <!-- 我的笔记 -->
        <el-card v-loading="loadingNotes" shadow="never">
          <template #header>
            <div class="notes-header">
              <span class="card-title">我的笔记</span>
              <el-button size="small" round @click="router.push('/notes')">去笔记广场</el-button>
            </div>
          </template>
          <div v-if="myNotes.length" class="my-note-list">
            <div v-for="note in myNotes" :key="note.id" class="my-note-item">
              <div class="my-note-title-row">
                <span class="my-note-title">{{ note.title }}</span>
                <el-tag v-if="note.category" size="small" round>{{ note.category }}</el-tag>
              </div>
              <div class="my-note-content">{{ note.content }}</div>
              <div class="my-note-time">{{ formatTime(note.createTime) }}</div>
            </div>
          </div>
          <p v-else class="my-notes-empty">还没有发布过笔记，去笔记广场写第一篇吧</p>
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

/* 我的笔记 */
.notes-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.my-note-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.my-note-item {
  border: 1px solid var(--pv-border);
  border-radius: 12px;
  padding: 14px 16px;
  background: #fff;
}
.my-note-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.my-note-title {
  font-weight: 600;
  color: var(--pv-text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.my-note-content {
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
.my-note-time {
  margin-top: 8px;
  font-size: 12px;
  color: var(--pv-text-secondary);
  text-align: right;
}
.my-notes-empty {
  color: var(--pv-text-secondary);
  text-align: center;
  padding: 18px 0;
}
</style>
