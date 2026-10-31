/**
 * 登录态工具（全站唯一数据源）
 *
 * 设计要点：
 * 1. 登录态放在响应式 store 里，组件用 computed 订阅（authUser / isLoggedIn），
 *    令牌失效时顶栏头像、首页推荐等会立刻跟着回落为游客态；
 *    旧实现用 computed 直接读 localStorage，没有响应式依赖，值会被永久缓存。
 * 2. 打开页面时先做一次本地校验：JWT 自带 exp，过期即视为未登录并清场，
 *    不必先发请求、等 401 回来才纠正，避免「已是游客却先渲染出旧身份内容」的闪烁。
 * 3. clearAuth 统一负责清理 token / user / 按用户隔离的本地缓存，
 *    401、主动退出、跨标签退出都走同一条路径，避免各处漏清。
 *
 * 本模块不 import router，避免与 router/index.js 形成循环依赖：
 * 路由守卫用 confirmLogin 自行决定导航去向，页面按钮用 requireLogin 传入自身 useRouter 实例。
 */
import { computed, reactive } from 'vue'
import { purgeUserScopedCache } from './userCache.js'

/** localStorage 中存放令牌与用户信息的键名 */
const TOKEN_KEY = 'token'
const USER_KEY = 'user'

/** 令牌提前判废的时钟偏移：临近过期就不再当作有效会话，少一次必然失败的请求 */
const EXPIRY_SKEW_MS = 30 * 1000

const readStoredToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

const readStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null')
  } catch {
    return null
  }
}

/**
 * 解析 JWT 载荷（只读，不验签）
 * 用 TextDecoder 解码保证中文声明（如 username）不乱码，解不出来返回 null
 */
export const decodeTokenPayload = (token) => {
  const segment = String(token || '').split('.')[1]
  if (!segment) return null
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

/**
 * 令牌是否已失效
 * 无 exp 声明或无法解析的令牌一律按失效处理：签名与有效期最终仍由后端裁决，
 * 前端提前判废只是为了让界面尽早回到游客态，不会放宽任何权限
 */
export const isTokenExpired = (token) => {
  if (!token) return true
  const payload = decodeTokenPayload(token)
  if (!payload) return true
  if (typeof payload.exp !== 'number') return true
  return payload.exp * 1000 - EXPIRY_SKEW_MS <= Date.now()
}

/** 登录态：token 为唯一判定依据，user 仅作展示用的资料快照 */
const state = reactive({
  token: readStoredToken(),
  user: readStoredUser(),
  /**
   * 登录态代次：每次登录 / 退出生效自增
   * 页面用它判断异步请求返回时身份是否已经变了（变了就丢弃结果，避免旧身份数据回写）
   */
  version: 0,
})

/**
 * 清空内存与 localStorage 中的用户态，并清除按用户隔离的缓存
 * @returns {boolean} 是否真的发生了状态变化（游客重复调用不会重复自增代次）
 */
const wipeSession = () => {
  const changed = !!state.token || state.user !== null
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  } catch {
    // 隐私模式下存储不可用，内存态仍需清干净
  }
  // 推荐快照等用户级缓存不属于「展示层」，必须一起清掉，否则换个身份打开还能命中旧数据
  purgeUserScopedCache()
  state.token = ''
  state.user = null
  if (changed) state.version += 1
  return changed
}

/**
 * 启动自检：把「存储里有令牌，但令牌早已失效」这种状态在首屏渲染前修正掉
 * 顺带清理「没有令牌却残留 user」的脏数据，保证游客态一定是干净的
 */
const bootstrapSession = () => {
  if (state.token) {
    if (isTokenExpired(state.token)) wipeSession()
    return
  }
  if (state.user) wipeSession()
}

bootstrapSession()

/** 读取本地登录令牌（保留函数式写法，供守卫、请求拦截器这类非组件环境使用） */
export const getToken = () => state.token

/** 是否已登录（响应式：在 computed / 模板中调用会随登录态变化重新求值） */
export const isLoggedIn = () => !!state.token

/** 当前登录用户资料（响应式，未登录为 null） */
export const authUser = computed(() => state.user)

/** 登录态代次（响应式） */
export const authVersion = computed(() => state.version)

/** 读取当前登录用户信息（非响应式取值场景，如事件回调内的一次性判断） */
export const currentUser = () => state.user

/** 登录 / 注册成功后写入登录态 */
export const setAuth = (token, user) => {
  try {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, JSON.stringify(user ?? null))
  } catch {
    // 存储不可用时仅保留内存态，刷新后需要重新登录
  }
  state.token = token || ''
  state.user = user ?? null
  state.version += 1
}

/** 资料更新（改昵称、换头像）后同步内存与 localStorage，顶栏头像即时刷新 */
export const updateAuthUser = (user) => {
  // 会话已失效时不接受回写，避免把过期身份的资料又塞回本地
  if (!state.token) return
  state.user = user ?? null
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user ?? null))
  } catch {
    // 忽略写入失败
  }
}

/**
 * 清除登录态：401、主动退出、跨标签退出统一入口
 * 只清理状态与缓存，不负责跳转，导航交给调用方决定
 */
export const clearAuth = () => wipeSession()

// 跨标签同步：一个标签退出登录，其它已打开的页面不再停留在「伪登录」状态。
// storage 事件只在其它标签触发，这里不会再触发写回，不存在循环。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== TOKEN_KEY && event.key !== USER_KEY) return
    const token = readStoredToken()
    if (!token) {
      wipeSession()
      return
    }
    if (token === state.token) {
      // 仅资料变更（如换头像），同步展示用快照即可，不动代次
      state.user = readStoredUser()
      return
    }
    state.token = token
    state.user = readStoredUser()
    state.version += 1
  })
}

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
  // 点击时令牌已过期：先按游客处理再弹引导，避免操作提交后才被后端 401 驳回
  const token = getToken()
  if (token && isTokenExpired(token)) clearAuth()
  if (isLoggedIn()) return true
  if (await confirmLogin(tip)) {
    router.push({ name: 'login', query: redirect ? { redirect } : undefined })
  }
  return false
}
