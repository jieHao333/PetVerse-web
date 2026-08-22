<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Lock, User } from '@element-plus/icons-vue'
import { register } from '@/api/user'

const router = useRouter()

const formRef = ref()
const form = reactive({ username: '', password: '', confirmPassword: '', nickname: '' })
const loading = ref(false)

const validateConfirm = (rule, value, callback) => {
  if (!value) {
    callback(new Error('请再次输入密码'))
  } else if (value !== form.password) {
    callback(new Error('两次输入的密码不一致'))
  } else {
    callback()
  }
}

const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { pattern: /^[a-zA-Z0-9_]{4,20}$/, message: '用户名需为4-20位字母、数字或下划线', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, max: 32, message: '密码长度需为6-32位', trigger: 'blur' },
  ],
  confirmPassword: [{ validator: validateConfirm, trigger: 'blur' }],
}

const onSubmit = async () => {
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  loading.value = true
  try {
    const data = await register({
      username: form.username,
      password: form.password,
      nickname: form.nickname || undefined,
    })
    localStorage.setItem('token', data.token)
    localStorage.setItem('user', JSON.stringify(data.user))
    ElMessage.success('注册成功，欢迎加入 PetVerse')
    router.push({ name: 'home' })
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="register-page">
    <div class="register-card">
      <div class="brand">
        <div class="brand-mark">🐾</div>
        <h1>注册账号</h1>
        <p>开启你的宠物之旅</p>
      </div>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        size="large"
        @submit.prevent="onSubmit"
      >
        <el-form-item prop="username">
          <el-input v-model.trim="form.username" placeholder="用户名（4-20位字母/数字/下划线）" :prefix-icon="User" />
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="密码（6-32位）"
            :prefix-icon="Lock"
            show-password
          />
        </el-form-item>
        <el-form-item prop="confirmPassword">
          <el-input
            v-model="form.confirmPassword"
            type="password"
            placeholder="确认密码"
            :prefix-icon="Lock"
            show-password
          />
        </el-form-item>
        <el-form-item prop="nickname">
          <el-input v-model.trim="form.nickname" placeholder="昵称（选填，最多30字）" />
        </el-form-item>
        <el-button type="primary" size="large" class="submit-btn" :loading="loading" native-type="submit">
          注 册
        </el-button>
      </el-form>

      <div class="footer">
        已有账号？<router-link to="/login">去登录</router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.register-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background-color: var(--pv-bg);
}
.register-card {
  width: 420px;
  max-width: 100%;
  background: #fff;
  border: 1px solid var(--pv-border);
  border-radius: 20px;
  box-shadow: var(--pv-shadow);
  padding: 44px 40px 36px;
}
.brand {
  text-align: center;
  margin-bottom: 30px;
}
.brand-mark {
  width: 52px;
  height: 52px;
  margin: 0 auto 16px;
  border-radius: 14px;
  background: var(--pv-ink);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
}
.brand h1 {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: var(--pv-text);
  margin: 0 0 8px;
}
.brand p {
  color: var(--pv-text-secondary);
  margin: 0;
  font-size: 13px;
}
.submit-btn {
  width: 100%;
  margin-top: 8px;
  letter-spacing: 8px;
  font-weight: 600;
}
.footer {
  text-align: center;
  margin-top: 24px;
  color: var(--pv-text-secondary);
  font-size: 13px;
}
.footer a {
  font-weight: 500;
}
</style>
