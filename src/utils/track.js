import { trackEvents } from '@/api/track'
import { isLoggedIn } from '@/utils/auth'

// 轻量行为埋点 SDK：本地队列 + 定时/满批/卸载兜底上报。
// 仅登录用户上报；任何失败都静默吞掉，绝不影响业务浏览。
const QUEUE = []
const MAX_BATCH = 20
const FLUSH_INTERVAL = 5000
let timer = null

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

/** 通用埋点入口 */
export function track(eventType, payload = {}) {
  if (!isLoggedIn()) return
  QUEUE.push({ eventId: genId(), eventType, eventTime: Date.now(), ...payload })
  if (QUEUE.length >= MAX_BATCH) flush()
}

/** 立即上报队列中的事件 */
export function flush() {
  if (!QUEUE.length) return
  const events = QUEUE.splice(0, QUEUE.length)
  try {
    const p = trackEvents(events)
    if (p && typeof p.catch === 'function') p.catch(() => {})
  } catch (e) {
    /* 埋点失败不影响业务 */
  }
}

/** 初始化：定时上报 + 路由页面浏览 + 页面隐藏/卸载兜底 */
export function initTracker(router) {
  if (timer) return
  timer = setInterval(flush, FLUSH_INTERVAL)
  router.afterEach((to) => {
    track('page_view', {
      targetType: 'page',
      scene: to.name ? String(to.name) : to.path,
      keyword: to.path,
    })
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
  window.addEventListener('pagehide', flush)
}

/** 推荐/内容曝光 */
export const trackExposure = (targetType, targetId, scene, position, species) =>
  track('exposure', { targetType, targetId, scene, position, species })

/** 推荐/内容点击 */
export const trackClick = (targetType, targetId, scene, position, species) =>
  track('click', { targetType, targetId, scene, position, species })

/** 搜索 */
export const trackSearch = (keyword, scene, species) =>
  track('search', { keyword, scene, species })

/** 下单（商品） */
export const trackOrder = (productId, species) =>
  track('order', { targetType: 'product', targetId: productId, scene: 'shop', species })

/** AI 回答反馈：feedback=1 有用 / -1 无用 */
export const trackAiFeedback = (sessionId, messageId, feedback) =>
  track('ai_feedback', {
    targetType: 'ai_message',
    targetId: messageId,
    scene: 'pet_chat',
    feedback,
    keyword: sessionId ? String(sessionId) : undefined,
  })