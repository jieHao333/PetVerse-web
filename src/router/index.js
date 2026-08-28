import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/Home.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/claim',
      name: 'claim',
      component: () => import('@/views/Claim.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/space',
      name: 'space',
      component: () => import('@/views/Space.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/friends',
      name: 'friends',
      component: () => import('@/views/Friends.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/profile',
      name: 'profile',
      component: () => import('@/views/Profile.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/my-spaces',
      name: 'mySpaces',
      component: () => import('@/views/MySpaces.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/pet-chat',
      name: 'petChat',
      component: () => import('@/views/PetChat.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/user/:id',
      name: 'userProfile',
      component: () => import('@/views/UserProfile.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/shop',
      name: 'shop',
      component: () => import('@/views/Shop.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/shop/store/:id',
      name: 'shopStore',
      component: () => import('@/views/ShopStore.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/shop/cart',
      name: 'shopCart',
      component: () => import('@/views/Cart.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/shop/orders',
      name: 'shopOrders',
      component: () => import('@/views/MyOrders.vue'),
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

// 全局路由守卫：未登录跳转登录页，角色不足回首页（后端网关也会校验，此处仅优化体验）
router.beforeEach((to) => {
  const token = localStorage.getItem('token')
  if (to.meta.requiresAuth && !token) {
    return { name: 'login' }
  }
  if ((to.name === 'login' || to.name === 'register') && token) {
    return { name: 'home' }
  }
  if (to.meta.roles) {
    const user = JSON.parse(localStorage.getItem('user') || 'null')
    if (!to.meta.roles.includes(user?.role || 'USER')) {
      return { name: 'home' }
    }
  }
  return true
})

export default router
