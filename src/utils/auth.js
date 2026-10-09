/**
 * 登录态工具
 * 圈子与商城对游客开放浏览，其余页面和所有写操作统一在这里拦截引导登录。
 * 本模块不 import router，避免与 router/index.js 形成循环依赖：
 * 路由守卫用 confirmLogin 自行决定导航去向，页面按钮用 requireLogin 传入自身 useRouter 实例。
 */

/** 未登录确认框：用户点「去登录」返回 true，点取消或关闭返回 false */
export async function confirmLogin(tip = '登录后才能进行该操作，现在去登录吗？') {
  try {
    await ElMessageBox.confirm(tip, '请先登录', {
      confirmButtonText: '去登录',
      cancelButtonText: '取消',
      type: 'warning',
    })
    return true
  } catch {
    return false
  }
}

/** 读取本地登录令牌 */
export const getToken = () => localStorage.getItem('token')

/** 是否已登录 */
export const isLoggedIn = () => !!getToken()

/** 读取本地缓存的登录用户信息（登录时写入，未登录为 null） */
export const currentUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null')
  } catch {
    return null
  }
}

/**
 * 校验登录后回跳地址：只接受站内相对路径，
 * 防住 //evil.com 这类把 redirect 参数当跳板的外部跳转
 */
export const safeRedirect = (raw) => {
  const path = Array.isArray(raw) ? raw[0] : raw
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return ''
  return path
}

/**
 * 页面内操作拦截：已登录返回 true 可继续执行；
 * 未登录弹确认框，点「去登录」则带 redirect 跳登录页，两种情况都返回 false 让调用方中止操作
 */
export async function requireLogin(router, redirect, tip) {
  if (isLoggedIn()) return true
  if (await confirmLogin(tip)) {
    router.push({ name: 'login', query: redirect ? { redirect } : undefined })
  }
  return false
}
