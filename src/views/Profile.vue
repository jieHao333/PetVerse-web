<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getMe, updateUser, uploadAvatar } from '@/api/user'
import { listMyPets, renamePet } from '@/api/pet'
import { DEFAULT_AVATAR } from '@/utils/avatar'

const router = useRouter()

const user = ref(null)
// 用户名下全部宠物，分真实宠物（纯档案）与虚拟宠物（等级/经验/签到）两类
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
    renameDialog.value = false
    ElMessage.success(`宠物已改名为 ${name}`)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    renaming.value = false
  }
}

// 拉取全部宠物，按类型在卡片中分真实/虚拟展示
const loadPets = async () => {
  pets.value = await listMyPets()
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
    await loadPets()
  } catch {
    pets.value = []
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
    <div class="page-container profile-container">
      <div class="profile-left">
        <!-- 宠物信息 -->
        <el-card shadow="never">
          <template #header>
            <span class="card-title">我的宠物</span>
          </template>

          <div v-if="pets.length" class="pet-list">
            <div v-for="p in pets" :key="p.id" class="pet-row">
              <el-avatar :size="44" :src="p.imageUrl || ''">{{ (p.name || '宠')[0] }}</el-avatar>
              <div class="pet-row-info">
                <div class="pet-row-name">
                  {{ p.name }}
                  <el-tag v-if="p.type === 'REAL'" size="small" effect="plain" round>真实</el-tag>
                  <span v-else class="pet-row-lv">Lv.{{ p.level }}</span>
                </div>
                <div class="pet-row-breed">
                  <template v-if="p.type === 'REAL'">
                    {{ p.species || '未填种类' }} · {{ p.genderName || '未填性别' }}
                  </template>
                  <template v-else>{{ p.species }} · {{ p.breed }}</template>
                </div>
              </div>
              <el-button
                v-if="p.type === 'REAL'"
                size="small"
                round
                type="primary"
                plain
                @click="router.push(`/pet/profile/${p.id}`)"
              >
                {{ p.cardIssueDate ? '修改信息' : '完善信息' }}
              </el-button>
              <el-button size="small" round class="rename-btn" @click="openRename(p)">改名</el-button>
            </div>
            <el-button class="adopt-btn" size="small" round @click="router.push('/claim')">
              领养虚拟宠物
            </el-button>
          </div>

          <div v-else class="pet-empty">
            <p>你还没有宠物，登记真实宠物或领养一只虚拟伙伴吧</p>
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
              <el-avatar :size="80" :src="profileForm.avatar || DEFAULT_AVATAR">
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
.rename-btn {
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
.pet-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 16px 0;
  color: var(--pv-text-secondary);
}
/* 宠物列表 */
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
.pet-row-info {
  flex: 1;
  min-width: 0;
}
.pet-row-name {
  display: flex;
  align-items: center;
  gap: 8px;
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
