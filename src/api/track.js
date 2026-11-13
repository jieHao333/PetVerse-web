import { getToken } from '@/utils/auth'

// 埋点上报独立于业务 axios 实例：用 fetch keepalive 携带令牌，
// 既能在页面卸载时兜底送达，又不会因 401 触发业务侧的登录态清理与登录弹窗。
export const trackEvents = (events) => {
  const token = getToken()
  return fetch('/api/data/track', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ events }),
    keepalive: true,
  })
}