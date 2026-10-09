import axios from 'axios'
import router from '@/router'
import { confirmLogin, getToken, isLoggedIn } from '@/utils/auth'

/**
 * axios 统一封装
 * - 请求自动携带 Authorization: Bearer <token>
 * - 响应统一解包后端 Result，401 提示后跳登录页并记录回跳地址
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

// 响应拦截器：解包 Result、处理错误
request.interceptors.response.use(
  (response) => {
    const res = response.data
    if (res.code === 200) {
      return res.data
    }
    return Promise.reject(new Error(res.msg || '请求失败'))
  },
  (error) => {
    const status = error.response?.status
    if (status === 401) {
      // 令牌失效与游客越权分开提示：前者要说清是过期，后者只是引导登录
      const expired = isLoggedIn()
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      promptLogin(expired ? '登录已失效，请重新登录后继续，现在去登录吗？' : undefined)
      return Promise.reject(new Error(expired ? '登录已失效，请重新登录' : '请先登录'))
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
