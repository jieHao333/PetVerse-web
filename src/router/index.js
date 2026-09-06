import { createRouter, createWebHistory } from 'vue-router'

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
        { path: 'space', name: 'space', component: () => import('@/views/Space.vue') },
        { path: 'friends', name: 'friends', component: () => import('@/views/Friends.vue') },
        { path: 'pet-chat', name: 'petChat', component: () => import('@/views/PetChat.vue') },
        { path: 'shop', name: 'shop', component: () => import('@/views/Shop.vue') },
        { path: 'shop/product/:id', name: 'productDetail', component: () => import('@/views/ProductDetail.vue') },
        { path: 'shop/product/:id/review', name: 'productReview', component: () => import('@/views/ProductReview.vue') },
        { path: 'shop/store/:id', name: 'shopStore', component: () => import('@/views/ShopStore.vue') },
        { path: 'shop/cart', name: 'shopCart', component: () => import('@/views/Cart.vue') },
        { path: 'shop/orders', name: 'shopOrders', component: () => import('@/views/MyOrders.vue') },
        { path: 'profile', name: 'profile', component: () => import('@/views/Profile.vue') },
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
