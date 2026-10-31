import axios from 'axios'
import router from '@/router'
import { clearAuth, confirmLogin, getToken, isLoggedIn } from '@/utils/auth'

/**
 * axios 统一封装
 * - 请求自动携带 Authorization: Bearer <token>
 * - 响应统一解包后端 Result；登录态失效统一走 clearAuth，并按需引导登录
 *
 * 令牌失效有两种到达方式，都要拦：
 * 1. 网关直接返回 HTTP 401（受保护接口、令牌解析失败）；
 * 2. 下游服务抛出 BusinessException(401)，GlobalExceptionHandler 包成 HTTP 200 + body.code=401。
 *    旧实现只处理了第 1 种，第 2 种会被当成普通业务错误抛给页面，登录态一直不清。
 *
 * 请求可传 { silentAuth: true } 表示「后台/非交互请求」：
 * 这类请求（推荐、未读数轮询、登录态探活）401 时只清状态、不弹登录确认框，
 * 否则游客打开商城、圈子这类公开页面会被个性化接口的 401 反过来弹一脸登录框。
 */
const request = axios.create({
  baseURL: '/api',
  timeout: 10000,
})

// 请求拦截器：附加令牌
request.interceptors.request.use((config) => {
  const token = getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 页面挂载常并行发多个请求，401 会成批到达，只引导一次登录，避免确认框叠层
let authPrompting = false

const promptLogin = async (tip) => {
  if (authPrompting) return
  authPrompting = true
  try {
    const redirect = router.currentRoute.value.fullPath
    if (await confirmLogin(tip)) {
      await router.push({ name: 'login', query: { redirect } })
    }
  } finally {
    authPrompting = false
  }
}

/** 构造带标记的错误：isAuth=true 便于页面区分「登录态问题」和普通业务失败，跳过重复提示 */
const authError = (msg, expired) => {
  const error = new Error(msg)
  error.isAuth = true
  error.expired = expired
  return error
}

/**
 * 处理登录态失效：清凭证 + 清用户级缓存，交互请求才引导登录
 * @param {boolean} silentAuth 是否静默处理（不弹登录框）
 */
const handleUnauthorized = (silentAuth) => {
  // 必须在 clearAuth 之前判断：此前是否持有令牌，决定提示语是「已失效」还是「请先登录」
  const expired = isLoggedIn()
  clearAuth()
  if (!silentAuth) {
    promptLogin(expired ? '登录已失效，请重新登录后继续，现在去登录吗？' : undefined)
  }
  return authError(expired ? '登录已失效，请重新登录' : '请先登录', expired)
}

// 响应拦截器：解包 Result、处理错误
request.interceptors.response.use(
  (response) => {
    const res = response.data
    if (res.code === 200) {
      return res.data
    }
    // 业务码 401：下游服务判定身份无效（HTTP 状态仍是 200），与网关 401 同等对待
    if (res.code === 401) {
      return Promise.reject(handleUnauthorized(response.config?.silentAuth))
    }
    return Promise.reject(new Error(res.msg || '请求失败'))
  },
  (error) => {
    const status = error.response?.status
    if (status === 401) {
      return Promise.reject(handleUnauthorized(error.config?.silentAuth))
    }
    // axios 超时（error.code=ECONNABORTED）时 response 为空，e.message 是英文技术文案，转成中文提示
    if (error.code === 'ECONNABORTED') {
      return Promise.reject(new Error('请求超时，请稍后重试'))
    }
    const msg = error.response?.data?.msg || error.message || '网络异常'
    return Promise.reject(new Error(msg))
  }
)

export default request
