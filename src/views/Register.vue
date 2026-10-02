<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Lock, User } from '@element-plus/icons-vue'
import { register } from '@/api/user'
import logo from '@/assets/logo.jpg'

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
  <div class="auth-page">
    <div class="bg-glow" aria-hidden="true"></div>
    <div class="grain" aria-hidden="true"></div>

    <aside class="brand-side">
      <div class="brand-logo glass-tile">
        <img :src="logo" alt="PetVerse" />
      </div>
      <h1 class="brand-name">PetVerse</h1>
      <p class="brand-tag">加入宠物社交空间 · 开启你的宠物之旅</p>

      <ul class="brand-points">
        <li class="glass-chip">宠物档案</li>
        <li class="glass-chip">萌友社区</li>
        <li class="glass-chip">优选商城</li>
      </ul>

      <span class="orb orb-a" aria-hidden="true"></span>
      <span class="orb orb-b" aria-hidden="true"></span>
    </aside>

    <main class="form-side">
      <section class="glass-card">
        <h2 class="card-title">创建账号</h2>
        <p class="card-sub">只需几步，即可开始使用</p>

        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          label-position="top"
          size="large"
          class="glass-form"
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
      </section>
    </main>
  </div>
</template>

<style scoped>
.auth-page {
  position: relative;
  min-height: 100vh;
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  overflow: hidden;
  background:
    radial-gradient(55% 75% at 12% 16%, rgba(255, 210, 224, 0.5), transparent 62%),
    radial-gradient(50% 70% at 88% 10%, rgba(190, 218, 255, 0.5), transparent 62%),
    radial-gradient(55% 75% at 82% 88%, rgba(198, 242, 222, 0.45), transparent 62%),
    radial-gradient(45% 65% at 14% 88%, rgba(255, 234, 198, 0.5), transparent 62%),
    #fbfaf8;
}

.bg-glow {
  position: absolute;
  inset: -10%;
  background:
    radial-gradient(40% 50% at 30% 30%, rgba(255, 255, 255, 0.7), transparent 70%),
    radial-gradient(35% 45% at 72% 62%, rgba(255, 255, 255, 0.55), transparent 70%);
  filter: blur(30px);
  animation: breathe 14s ease-in-out infinite;
  pointer-events: none;
}
@keyframes breathe {
  0%, 100% { transform: scale(1) translateY(0); opacity: 0.85; }
  50% { transform: scale(1.08) translateY(-2%); opacity: 1; }
}

.grain {
  position: absolute;
  inset: 0;
  opacity: 0.035;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

.brand-side {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 64px 8vw 64px 10vw;
}
.brand-logo {
  margin-bottom: 28px;
}
.glass-tile {
  width: 92px;
  height: 92px;
  padding: 5px;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 16px 40px rgba(60, 66, 90, 0.14), inset 0 1px 1px rgba(255, 255, 255, 0.9);
}
.glass-tile img {
  width: 100%;
  height: 100%;
  border-radius: 22px;
  object-fit: cover;
  display: block;
}
.brand-name {
  font-size: 52px;
  font-weight: 800;
  letter-spacing: 1px;
  color: var(--pv-ink);
  margin: 0 0 14px;
  line-height: 1.1;
}
.brand-tag {
  font-size: 16px;
  color: var(--pv-text-secondary);
  margin: 0 0 36px;
  max-width: 30ch;
  line-height: 1.7;
}
.brand-points {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 0;
  padding: 0;
}
.glass-chip {
  padding: 9px 18px;
  border-radius: 999px;
  font-size: 13px;
  color: var(--pv-ink-soft);
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 6px 18px rgba(60, 66, 90, 0.08), inset 0 1px 1px rgba(255, 255, 255, 0.8);
}

.orb {
  position: absolute;
  border-radius: 50%;
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.75), rgba(255, 255, 255, 0.15));
  border: 1px solid rgba(255, 255, 255, 0.8);
  box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.9), 0 18px 40px rgba(60, 66, 90, 0.12);
  pointer-events: none;
}
.orb-a {
  width: 120px;
  height: 120px;
  right: 12%;
  top: 16%;
  animation: drift 12s ease-in-out infinite;
}
.orb-b {
  width: 64px;
  height: 64px;
  right: 26%;
  bottom: 18%;
  animation: drift 9s ease-in-out infinite reverse;
}
@keyframes drift {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-18px); }
}

.form-side {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 8vw 48px 2vw;
}
.glass-card {
  position: relative;
  width: 440px;
  max-width: 100%;
  padding: 40px 40px 34px;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(26px) saturate(170%);
  -webkit-backdrop-filter: blur(26px) saturate(170%);
  border: 1px solid rgba(255, 255, 255, 0.85);
  box-shadow:
    0 24px 60px rgba(60, 66, 90, 0.16),
    inset 0 1px 1px rgba(255, 255, 255, 0.9);
  overflow: hidden;
  animation: card-in 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes card-in {
  from { opacity: 0; transform: translateY(24px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.card-title {
  font-size: 26px;
  font-weight: 800;
  color: var(--pv-ink);
  margin: 0 0 8px;
}
.card-sub {
  font-size: 13.5px;
  color: var(--pv-text-secondary);
  margin: 0 0 24px;
}

.glass-form :deep(.el-input__wrapper) {
  background: rgba(255, 255, 255, 0.6);
  box-shadow: inset 0 0 0 1px rgba(23, 24, 28, 0.08);
  border-radius: 14px;
  backdrop-filter: blur(8px);
  transition: all 0.25s ease;
}
.glass-form :deep(.el-input__wrapper:hover) {
  background: rgba(255, 255, 255, 0.8);
  box-shadow: inset 0 0 0 1px rgba(23, 24, 28, 0.16);
}
.glass-form :deep(.el-input__wrapper.is-focus) {
  background: #fff;
  box-shadow:
    inset 0 0 0 1px var(--pv-ink),
    0 0 0 4px rgba(23, 24, 28, 0.06);
}
.glass-form :deep(.el-input__inner) {
  color: var(--pv-ink);
}
.glass-form :deep(.el-input__inner::placeholder) {
  color: rgba(23, 24, 28, 0.4);
}
.glass-form :deep(.el-input__prefix),
.glass-form :deep(.el-input__suffix) {
  color: rgba(23, 24, 28, 0.5);
}

.submit-btn.el-button--primary:not(.is-plain):not(.is-text):not(.is-link) {
  width: 100%;
  height: 50px;
  margin-top: 12px;
  letter-spacing: 8px;
  font-weight: 700;
  font-size: 16px;
  border: none;
  border-radius: 14px;
  color: #fff;
  background: linear-gradient(145deg, #2b2d33, #17181c);
  box-shadow: 0 12px 28px rgba(23, 24, 28, 0.28), inset 0 1px 1px rgba(255, 255, 255, 0.25);
  transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease;
}
.submit-btn.el-button--primary:not(.is-plain):not(.is-text):not(.is-link):hover,
.submit-btn.el-button--primary:not(.is-plain):not(.is-text):not(.is-link):focus {
  transform: translateY(-2px);
  filter: brightness(1.1);
  color: #fff;
  background: linear-gradient(145deg, #2b2d33, #17181c);
  box-shadow: 0 18px 38px rgba(23, 24, 28, 0.34), inset 0 1px 1px rgba(255, 255, 255, 0.25);
}
.submit-btn.el-button--primary:not(.is-plain):not(.is-text):not(.is-link):active {
  transform: translateY(0);
}

.footer {
  position: relative;
  text-align: center;
  margin-top: 22px;
  color: var(--pv-text-secondary);
  font-size: 13px;
}
.footer a {
  color: var(--pv-ink);
  font-weight: 600;
  border-bottom: 1px solid rgba(23, 24, 28, 0.3);
  padding-bottom: 1px;
}
.footer a:hover {
  opacity: 1;
  border-bottom-color: var(--pv-ink);
}

@media (max-width: 900px) {
  .auth-page {
    grid-template-columns: minmax(0, 1fr);
  }
  /* 固定 440px 的卡片在小屏改为撑满列宽，避免把 grid 列撑出视口 */
  .glass-card {
    width: 100%;
  }
  .brand-side {
    padding: 48px 24px 8px;
    align-items: center;
    text-align: center;
  }
  .brand-name { font-size: 34px; }
  .brand-tag { margin-bottom: 20px; }
  .brand-points { justify-content: center; }
  .orb { display: none; }
  .form-side { padding: 20px 16px 48px; }
}

/* 手机端收紧品牌区与卡片内边距，注册表单较长需尽快进入首屏 */
@media (max-width: 768px) {
  .brand-side {
    padding: 36px 20px 0;
  }
  .brand-logo {
    width: 64px;
    height: 64px;
  }
  .brand-name {
    font-size: 28px;
  }
  .brand-tag {
    margin-bottom: 16px;
    font-size: 14px;
  }
  .brand-points {
    display: none;
  }
  .glass-card {
    padding: 26px 20px 22px;
    border-radius: 22px;
  }
  .card-title {
    font-size: 22px;
  }
  .card-sub {
    margin-bottom: 18px;
  }
  .submit-btn.el-button--primary:not(.is-plain):not(.is-text):not(.is-link) {
    letter-spacing: 5px;
    height: 46px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .bg-glow, .orb, .glass-card { animation: none; }
}
</style>
