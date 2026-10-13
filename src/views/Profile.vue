<script setup>
import { onMounted, reactive, ref } from 'vue'
import { Camera } from '@element-plus/icons-vue'
import { getMe, updateUser, uploadAvatar } from '@/api/user'
import { DEFAULT_AVATAR } from '@/utils/avatar'

const user = ref(null)
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

// 日期展示：2026-08-22T13:58 -> 2026-08-22
const formatDate = (t) => (t ? String(t).replace('T', ' ').slice(0, 10) : '')

onMounted(async () => {
  try {
    user.value = await getMe()
    profileForm.nickname = user.value.nickname || ''
    profileForm.avatar = user.value.avatar || ''
  } catch (e) {
    ElMessage.error(e.message)
  }
})

// 保存昵称与头像地址；账号(username)是登录凭据，只读展示不可改
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
    <!-- 单列卡片流，与用户主页保持同一套视觉 -->
    <div class="page-container up-container">
      <!-- 账号信息 -->
      <el-card shadow="never">
        <template #header>
          <span class="card-title">账号信息</span>
        </template>
        <div class="up-head">
          <!-- 头像即换头像入口：悬停显示蒙层，点击选择图片 -->
          <el-upload
            class="avatar-uploader"
            :class="{ 'is-busy': uploadingAvatar }"
            :show-file-list="false"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            :http-request="onUploadAvatar"
          >
            <div class="avatar-ring">
              <el-avatar :size="80" :src="profileForm.avatar || DEFAULT_AVATAR">
                {{ (profileForm.nickname || user?.username || 'U')[0].toUpperCase() }}
              </el-avatar>
              <div class="avatar-mask">
                <el-icon :size="18"><Camera /></el-icon>
                <span>{{ uploadingAvatar ? '上传中…' : '更换头像' }}</span>
              </div>
            </div>
          </el-upload>
          <div>
            <div class="up-name">{{ profileForm.nickname || user?.username || '未设置' }}</div>
            <div class="up-account">账号: {{ user?.username || '-' }}</div>
            <div class="up-meta">注册于 {{ formatDate(user?.createTime) || '—' }}</div>
          </div>
        </div>
      </el-card>

      <!-- 修改昵称 -->
      <el-card shadow="never">
        <template #header>
          <span class="card-title">修改昵称</span>
        </template>
        <el-form class="setting-form" :model="profileForm" label-width="80px" @submit.prevent>
          <el-form-item label="昵称">
            <el-input
              v-model.trim="profileForm.nickname"
              placeholder="你的社交展示名"
              maxlength="30"
              show-word-limit
            />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="savingProfile" @click="onSaveProfile">
              保存资料
            </el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- 修改密码 -->
      <el-card shadow="never">
        <template #header>
          <span class="card-title">修改密码</span>
        </template>
        <el-form class="setting-form" :model="pwdForm" label-width="80px" @submit.prevent>
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
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
}
.up-container {
  max-width: none;
  display: flex;
  flex-direction: column;
  gap: 20px;
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
.avatar-uploader {
  cursor: pointer;
  flex-shrink: 0;
}
.avatar-ring {
  position: relative;
  padding: 3px;
  border-radius: 50%;
  background: var(--pv-ink);
}
.avatar-ring :deep(.el-avatar) {
  border: 3px solid #fff;
  font-size: 26px;
  display: block;
}
/* 悬停/上传中在头像上盖一层提示，点击即弹图片选择 */
.avatar-mask {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: rgba(23, 24, 28, 0.58);
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-size: 11px;
  opacity: 0;
  transition: opacity 0.18s ease;
}
.avatar-uploader:hover .avatar-mask,
.avatar-uploader.is-busy .avatar-mask {
  opacity: 1;
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
/* 单行表单：输入框不随卡片拉满整行 */
.setting-form :deep(.el-input) {
  max-width: 380px;
}
</style>
