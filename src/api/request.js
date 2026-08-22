import axios from 'axios'
import router from '@/router'

/**
 * axios 统一封装
 * - 请求自动携带 Authorization: Bearer <token>
 * - 响应统一解包后端 Result，401 自动跳转登录页
 */
const request = axios.create({
  baseURL: '/api',
  timeout: 10000,
})

// 请求拦截器：附加令牌
request.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

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
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      router.push({ name: 'login' })
      return Promise.reject(new Error('登录已失效，请重新登录'))
    }
    const msg = error.response?.data?.msg || error.message || '网络异常'
    return Promise.reject(new Error(msg))
  }
)

export default request
