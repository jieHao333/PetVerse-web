<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Lock, User } from '@element-plus/icons-vue'
import { login } from '@/api/user'

const router = useRouter()

const formRef = ref()
const form = reactive({ username: '', password: '' })
const loading = ref(false)

const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

const onSubmit = async () => {
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  loading.value = true
  try {
    const data = await login(form)
    localStorage.setItem('token', data.token)
    localStorage.setItem('user', JSON.stringify(data.user))
    ElMessage.success('登录成功')
    router.push({ name: 'home' })
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="brand">
        <div class="brand-mark">🐾</div>
        <h1>PetVerse</h1>
        <p>登录你的宠物社交空间</p>
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
          <el-input v-model.trim="form.username" placeholder="用户名" :prefix-icon="User" />
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="密码"
            :prefix-icon="Lock"
            show-password
            @keyup.enter="onSubmit"
          />
        </el-form-item>
        <el-button
          type="primary"
          size="large"
          class="submit-btn"
          :loading="loading"
          native-type="submit"
        >
          登 录
        </el-button>
      </el-form>

      <div class="footer">
        还没有账号？<router-link to="/register">立即注册</router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background-color: var(--pv-bg);
}
.login-card {
  width: 400px;
  max-width: 100%;
  background: #fff;
  border: 1px solid var(--pv-border);
  border-radius: 20px;
  box-shadow: var(--pv-shadow);
  padding: 44px 40px 36px;
}
.brand {
  text-align: center;
  margin-bottom: 32px;
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
  font-size: 25px;
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
