import { createRouter, createWebHistory } from 'vue-router'
import { confirmLogin, getToken, safeRedirect } from '@/utils/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      // 主布局：顶栏仅挂载一次（logo 固定 PetVerse、导航列表固定），
      // 导航页作为子路由，切换时只重新加载下方内容区
      path: '/',
      component: () => import('@/layouts/MainLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', name: 'home', component: () => import('@/views/Home.vue') },
        // 圈子与商城为游客开放只读浏览（public），写操作由页面内 requireLogin 拦截
        { path: 'space', name: 'space', component: () => import('@/views/Space.vue'), meta: { public: true } },
        { path: 'space/:id', name: 'spaceDetail', component: () => import('@/views/SpaceDetail.vue'), meta: { public: true } },
        { path: 'friends', name: 'friends', component: () => import('@/views/Friends.vue') },
        { path: 'pet-chat', name: 'petChat', component: () => import('@/views/PetChat.vue') },
        { path: 'shop', name: 'shop', component: () => import('@/views/Shop.vue'), meta: { public: true } },
        { path: 'shop/product/:id', name: 'productDetail', component: () => import('@/views/ProductDetail.vue'), meta: { public: true } },
        { path: 'shop/product/:id/review', name: 'productReview', component: () => import('@/views/ProductReview.vue') },
        { path: 'shop/my-reviews', name: 'myReviews', component: () => import('@/views/MyReviews.vue') },
        { path: 'shop/store/:id', name: 'shopStore', component: () => import('@/views/ShopStore.vue'), meta: { public: true } },
        { path: 'shop/cart', name: 'shopCart', component: () => import('@/views/Cart.vue') },
        { path: 'shop/orders', name: 'shopOrders', component: () => import('@/views/MyOrders.vue') },
        { path: 'profile', name: 'profile', component: () => import('@/views/Profile.vue') },
        { path: 'notifications', name: 'notifications', component: () => import('@/views/Notifications.vue') },
        { path: 'user/:id', name: 'userProfile', component: () => import('@/views/UserProfile.vue') },
      ],
    },
    {
      path: '/claim',
      name: 'claim',
      component: () => import('@/views/Claim.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/pet/profile/:id',
      name: 'petProfileEdit',
      component: () => import('@/views/PetProfileEdit.vue'),
      meta: { requiresAuth: true },
    },
    {
      // 宠物身份证页：可选 ID，未指定时展示首只已签发身份卡的宠物
      path: '/pet/identity/:id?',
      name: 'petIdentity',
      component: () => import('@/views/PetIdentity.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/my-spaces',
      name: 'mySpaces',
      component: () => import('@/views/MySpaces.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/merchant-apply',
      name: 'merchantApply',
      component: () => import('@/views/MerchantApply.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/merchant-center',
      name: 'merchantCenter',
      component: () => import('@/views/MerchantCenter.vue'),
      meta: { requiresAuth: true, roles: ['MERCHANT', 'ADMIN'] },
    },
    {
      path: '/admin/merchant-audit',
      name: 'adminMerchantAudit',
      component: () => import('@/views/AdminMerchantAudit.vue'),
      meta: { requiresAuth: true, roles: ['ADMIN'] },
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/Login.vue'),
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('@/views/Register.vue'),
    },
  ],
})

// 全局路由守卫（后端网关也会校验，此处仅优化体验）：
// 游客可免登录浏览圈子与商城（meta.public），进入其他页面才提示登录并记录回跳地址；
// 角色不足回首页。未登录跳登录页时带 redirect，登录成功后回到操作前那一页
router.beforeEach(async (to, from) => {
  if (getToken()) {
    if (to.name === 'login' || to.name === 'register') {
      return safeRedirect(to.query.redirect) || { name: 'home' }
    }
    if (to.meta.roles) {
      const user = JSON.parse(localStorage.getItem('user') || 'null')
      if (!to.meta.roles.includes(user?.role || 'USER')) {
        return { name: 'home' }
      }
    }
    return true
  }
  if (!to.meta.requiresAuth || to.meta.public) {
    return true
  }
  // 首次进站落到可浏览的圈子，而不是直接踢去登录页；站内点「首页」仍按下面的拦截走
  if (to.name === 'home' && !from.name) {
    return { name: 'space' }
  }
  const redirect = to.fullPath
  // 新标签页首次导航没有来源页，取消导航只会留下一张空白页，因此直接带去登录页
  if (!from.name) {
    return { name: 'login', query: { redirect } }
  }
  // 站内跳转：取消本次导航让用户留在当前页，确认「去登录」后再跳
  return (await confirmLogin()) ? { name: 'login', query: { redirect } } : false
})

export default router
