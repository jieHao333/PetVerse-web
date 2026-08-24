<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowDown, ArrowLeft } from '@element-plus/icons-vue'

const route = useRoute()
const router = useRouter()

defineProps({
  /** 页面标题 */
  title: { type: String, default: 'PetVerse' },
  /** 是否显示主导航菜单 */
  showNav: { type: Boolean, default: false },
  /** 是否显示返回按钮 */
  showBack: { type: Boolean, default: false },
})

const user = computed(() => JSON.parse(localStorage.getItem('user') || 'null'))

const onLogout = () => {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  router.push({ name: 'login' })
}
</script>

<template>
  <header class="app-header">
    <div class="header-inner">
      <div class="left">
        <el-button v-if="showBack" text :icon="ArrowLeft" @click="router.back()">返回</el-button>
        <span class="logo">
          <span class="logo-mark">🐾</span>
          <span class="logo-text">{{ title }}</span>
        </span>
      </div>

      <el-menu
        v-if="showNav"
        mode="horizontal"
        :default-active="route.path"
        :ellipsis="false"
        router
        class="nav-menu"
      >
        <el-menu-item index="/">我的宠物</el-menu-item>
        <el-menu-item index="/space">宠域空间</el-menu-item>
        <el-menu-item index="/friends">好友</el-menu-item>
        <el-menu-item index="/profile">个人资料</el-menu-item>
      </el-menu>

      <div class="right">
        <el-dropdown trigger="click">
          <span class="user-trigger">
            <el-avatar :size="30" :src="user?.avatar || ''">
              {{ (user?.nickname || user?.username || 'U')[0].toUpperCase() }}
            </el-avatar>
            <span class="nickname">{{ user?.nickname || user?.username }}</span>
            <el-icon class="arrow"><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="router.push('/profile')">个人资料</el-dropdown-item>
              <el-dropdown-item divided @click="onLogout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  background: #fff;
  border-bottom: 1px solid var(--pv-border);
  position: sticky;
  top: 0;
  z-index: 100;
}
.header-inner {
  width: 100%;
  margin: 0;
  padding: 0 40px;
  height: 60px;
  display: flex;
  align-items: center;
  gap: 16px;
}
@media (max-width: 768px) {
  .header-inner {
    padding: 0 16px;
  }
}
.left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.logo {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo-mark {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--pv-ink);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}
.logo-text {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.3px;
  color: var(--pv-text);
}
.nav-menu {
  flex: 1;
  border-bottom: none;
  background: transparent;
  /* 菜单项在顶栏内垂直居中，保证上下间距一致 */
  display: flex;
  align-items: center;
  --el-menu-active-color: var(--pv-ink);
  --el-menu-hover-text-color: var(--pv-ink);
  --el-menu-text-color: #5f646d;
}
.nav-menu :deep(.el-menu-item) {
  display: inline-flex;
  align-items: center;
  height: 38px;
  line-height: 38px;
  margin: 0 4px;
  padding: 0 16px !important;
  border-radius: 999px;
  border-bottom: none !important;
  font-weight: 500;
  transition: background 0.2s, color 0.2s;
}
.nav-menu :deep(.el-menu-item:hover) {
  background: var(--pv-tint);
}
.nav-menu :deep(.el-menu-item.is-active) {
  background: var(--pv-tint);
  font-weight: 600;
}
.right {
  flex-shrink: 0;
}
.user-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  outline: none;
  color: var(--pv-text);
  padding: 4px 8px;
  border-radius: 999px;
  transition: background 0.2s;
}
.user-trigger:hover {
  background: var(--pv-tint);
}
.nickname {
  font-size: 14px;
  font-weight: 500;
  color: var(--pv-text);
}
.arrow {
  color: #909399;
  font-size: 12px;
}
</style>
