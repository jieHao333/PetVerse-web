<script setup>
import { computed, onUnmounted, ref, useAttrs, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowDown, ArrowLeft, Bell } from '@element-plus/icons-vue'
import logo from '@/assets/logo.jpg'
import { NOTIF_SOURCE, getUnreadCount, markRead, pageNotifications } from '@/api/notification'
import { DEFAULT_AVATAR } from '@/utils/avatar'

const route = useRoute()
const router = useRouter()

// 返回按钮：父组件监听了 back 事件则交给父组件自定义处理（如新标签页关闭当前标签），否则默认历史回退
const attrs = useAttrs()
const onBack = () => {
  if (attrs.onBack) {
    attrs.onBack()
    return
  }
  router.back()
}

defineProps({
  /** 页面标题 */
  title: { type: String, default: 'PetVerse' },
  /** 是否显示主导航菜单 */
  showNav: { type: Boolean, default: false },
  /** 是否显示返回按钮 */
  showBack: { type: Boolean, default: false },
})

const user = computed(() => JSON.parse(localStorage.getItem('user') || 'null'))

// 当前用户角色：USER/MERCHANT/ADMIN，存量用户无 role 时默认 USER
const role = computed(() => user.value?.role || 'USER')

const onLogout = () => {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  router.push({ name: 'login' })
}

// 新标签页打开「我的动态」独立页面（仅展示本人动态，不含账号/宠物信息）
const openMySpaces = () => {
  window.open(router.resolve('/my-spaces').href, '_blank')
}

// ===== 消息通知铃铛：未读红点轮询 + 最近通知弹层 =====
const unreadCount = ref(0)
const recentList = ref([])
const recentLoading = ref(false)
const bellVisible = ref(false)
let pollTimer = null

const isLoggedIn = () => !!localStorage.getItem('token')

// 拉取未读数（后端 Long 序列化为字符串，用 Number 还原）
const loadUnreadCount = async () => {
  if (!isLoggedIn()) {
    unreadCount.value = 0
    return
  }
  try {
    const count = await getUnreadCount()
    unreadCount.value = Number(count || 0)
  } catch {
    // 轮询失败静默，避免打断主流程
  }
}

// 展开弹层时拉取最近若干条通知
const loadRecent = async () => {
  recentLoading.value = true
  try {
    const data = await pageNotifications({ pageNum: 1, pageSize: 8 })
    recentList.value = data.records || []
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    recentLoading.value = false
  }
}

const onBellVisibleChange = (visible) => {
  if (visible) loadRecent()
}

const onOpenNotif = async (item) => {
  bellVisible.value = false
  if (Number(item.isRead) === 0) {
    try {
      await markRead(item.id)
      item.isRead = 1
      unreadCount.value = Math.max(0, unreadCount.value - 1)
    } catch {
      // 标记失败不阻断跳转
    }
  }
  if (item.source === NOTIF_SOURCE.SHOP_REVIEW && item.targetId) {
    router.push(`/shop/product/${item.targetId}`)
  } else {
    router.push('/space')
  }
}

const goNotifications = () => {
  bellVisible.value = false
  router.push('/notifications')
}

const startPolling = () => {
  stopPolling()
  loadUnreadCount()
  // 每 30s 轮询一次未读数
  pollTimer = setInterval(loadUnreadCount, 30000)
}

const stopPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

// 登录态变化时启停轮询；切换路由（如从通知页返回）时刷新未读数
watch(
  () => user.value?.id,
  (id) => {
    if (id) startPolling()
    else stopPolling()
  },
  { immediate: true },
)

watch(
  () => route.path,
  () => {
    if (isLoggedIn()) loadUnreadCount()
  },
)

onUnmounted(stopPolling)
</script>

<template>
  <header class="app-header">
    <div class="header-inner">
      <div class="left">
        <el-button v-if="showBack" text :icon="ArrowLeft" @click="onBack">返回</el-button>
        <span class="logo">
          <img :src="logo" alt="PetVerse" class="logo-mark" />
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
        <el-menu-item index="/">首页</el-menu-item>
        <el-menu-item index="/space">圈子</el-menu-item>
        <el-menu-item index="/friends">好友</el-menu-item>
        <el-menu-item index="/pet-chat">AI养宠</el-menu-item>
        <el-menu-item index="/shop">宠物商城</el-menu-item>
        <el-menu-item index="/profile">个人资料</el-menu-item>
      </el-menu>

      <div class="right">
        <el-popover
          v-model:visible="bellVisible"
          placement="bottom-end"
          trigger="click"
          :width="320"
          popper-class="notif-popover"
          @show="onBellVisibleChange(true)"
        >
          <template #reference>
            <el-badge :value="unreadCount" :hidden="!unreadCount" :max="99" class="bell-badge">
              <el-icon class="bell-icon"><Bell /></el-icon>
            </el-badge>
          </template>
          <div v-loading="recentLoading" class="notif-pop">
            <div class="notif-pop-title">最近消息</div>
            <el-empty v-if="!recentLoading && recentList.length === 0" description="暂无消息" :image-size="60" />
            <div
              v-for="item in recentList"
              :key="item.id"
              class="notif-pop-item"
              @click="onOpenNotif(item)"
            >
              <el-avatar :size="32" :src="item.actorAvatar || DEFAULT_AVATAR">
                {{ (item.actorNickname || '宠').slice(0, 1) }}
              </el-avatar>
              <div class="notif-pop-body">
                <div class="notif-pop-line">
                  <span class="notif-pop-actor">{{ item.actorNickname || `用户${item.actorUserId}` }}</span>
                  <el-tag :type="item.source === NOTIF_SOURCE.SHOP_REVIEW ? 'warning' : 'primary'" size="small" effect="plain" round>
                    {{ item.sourceText }}
                  </el-tag>
                </div>
                <div class="notif-pop-text">{{ item.content || item.typeText }}</div>
              </div>
              <span v-if="Number(item.isRead) === 0" class="notif-pop-dot"></span>
            </div>
            <div class="notif-pop-footer" @click="goNotifications">查看全部消息</div>
          </div>
        </el-popover>
        <el-dropdown trigger="click">
          <span class="user-trigger">
            <el-avatar :size="30" :src="user?.avatar || DEFAULT_AVATAR">
              {{ (user?.nickname || user?.username || 'U')[0].toUpperCase() }}
            </el-avatar>
            <span class="nickname">{{ user?.nickname || user?.username }}</span>
            <el-icon class="arrow"><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="router.push('/profile')">个人资料</el-dropdown-item>
              <el-dropdown-item @click="openMySpaces">我的动态</el-dropdown-item>
              <el-dropdown-item @click="router.push('/shop/cart')">购物车</el-dropdown-item>
              <el-dropdown-item @click="router.push('/shop/orders')">我的订单</el-dropdown-item>
              <el-dropdown-item v-if="role === 'USER'" @click="router.push('/merchant-apply')">
                商家入驻
              </el-dropdown-item>
              <el-dropdown-item v-if="role === 'MERCHANT' || role === 'ADMIN'" @click="router.push('/merchant-center')">
                商家中心
              </el-dropdown-item>
              <el-dropdown-item v-if="role === 'ADMIN'" @click="router.push('/admin/merchant-audit')">
                入驻审批
              </el-dropdown-item>
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
  object-fit: cover;
  display: block;
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
  /* 无导航菜单的页面（返回页）也将账号下拉推到顶栏最右侧 */
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 20px;
}
.bell-badge {
  display: inline-flex;
  align-items: center;
}
.bell-icon {
  font-size: 20px;
  color: var(--pv-text-secondary);
  cursor: pointer;
  padding: 6px;
  border-radius: 999px;
  transition: background 0.2s, color 0.2s;
}
.bell-icon:hover {
  background: var(--pv-tint);
  color: var(--pv-ink);
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

<style>
/* 铃铛弹层内容经 teleport 挂到 body，scoped 样式无法命中，故用全局作用域 */
.notif-popover.el-popper {
  padding: 0;
}
.notif-pop {
  max-height: 380px;
  overflow-y: auto;
}
.notif-pop-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--pv-text);
  padding: 10px 14px;
  border-bottom: 1px solid var(--pv-border);
}
.notif-pop-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background 0.2s;
}
.notif-pop-item:hover {
  background: var(--pv-tint);
}
.notif-pop-body {
  flex: 1;
  min-width: 0;
}
.notif-pop-line {
  display: flex;
  align-items: center;
  gap: 6px;
}
.notif-pop-actor {
  font-size: 13px;
  font-weight: 600;
  color: var(--pv-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}
.notif-pop-text {
  margin-top: 4px;
  font-size: 12px;
  color: var(--pv-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.notif-pop-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-color-danger);
  margin-top: 6px;
}
.notif-pop-footer {
  text-align: center;
  font-size: 13px;
  color: var(--el-color-primary);
  padding: 10px;
  border-top: 1px solid var(--pv-border);
  cursor: pointer;
}
.notif-pop-footer:hover {
  background: var(--pv-tint);
}
</style>
