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
      path: '/user/:id',
      name: 'userProfile',
      component: () => import('@/views/UserProfile.vue'),
      meta: { requiresAuth: true },
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

// 全局路由守卫：未登录跳转登录页
router.beforeEach((to) => {
  const token = localStorage.getItem('token')
  if (to.meta.requiresAuth && !token) {
    return { name: 'login' }
  }
  if ((to.name === 'login' || to.name === 'register') && token) {
    return { name: 'home' }
  }
  return true
})

export default router
