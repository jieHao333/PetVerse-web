import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { getMe } from './api/user'
import { isLoggedIn, updateAuthUser } from './utils/auth'
import { initTracker } from './utils/track'

createApp(App).use(router).mount('#app')

// 行为埋点：页面浏览 + 定时/满批/卸载兜底上报，供数据中台采集（失败静默，不影响业务）
initTracker(router)

/**
 * 启动时静默校验一次登录态
 *
 * 本地只能判断令牌是否过期（JWT exp），签名错误、密钥轮换、账号被删这类「未过期但已失效」
 * 的令牌得由后端裁决。这里打开页面就探活一次：401 由拦截器统一清场并清除用户级缓存，
 * 页面随即按游客渲染，不必等到用户点了某个功能才发现登录已失效。
 *
 * 只处理 401：网络失败、服务 5xx 一律不动登录态，避免后端抖动把正常用户踢下线。
 * 探活同时刷新本地用户资料（昵称、头像），保证展示与后端一致。
 */
const verifySession = async () => {
  if (!isLoggedIn()) return
  try {
    const me = await getMe({ silentAuth: true })
    updateAuthUser(me)
  } catch {
    // 登录态失效已在拦截器中清理；其余失败忽略
  }
}

verifySession()
