import request from './request'
import router from '@/router'

/**
 * AI养宠 · 流式对话（SSE）
 *
 * 为什么不用现有 axios 封装：request.js 有 10s 超时且响应拦截器只解包 JSON Result，
 * 与 text/event-stream 流式响应不兼容；EventSource 又不支持 POST，故用原生 fetch。
 *
 * 响应帧格式（事件之间以空行 \n\n 分隔，每行 data: 开头，可能夹杂以 : 开头的心跳注释行）：
 *   data: {"type":"meta","sessionId":1}       首帧会话元信息（后端自动新建会话时前端据此绑定）
 *   data: {"type":"delta","content":"你好"}   增量内容（多次）
 *   data: {"type":"done"}                    正常结束
 *   data: {"type":"error","msg":"..."}      服务端异常
 *
 * 网络韧性设计（覆盖生产环境的短暂断网等特殊情况）：
 * 1. 连接阶段重试：fetch 尚未收到响应头就失败（典型如 WiFi 切换、网络闪断）时，
 *    自动带退避重试最多 2 次（总尝试 3 次），期间通过 onRetry 回调提示用户；
 *    已收到响应头后不再自动重试——服务端可能已开始生成甚至已落库，重发会造成重复。
 * 2. 连接阶段看门狗：fetch 挂起（TCP 半开、代理不回包）超过 10s 主动中断并按网络故障处理。
 * 3. 流阶段看门狗：服务端每 15s 发心跳，若连续 25s 未收到任何字节（网络静默中断），
 *    主动 abort 并给出中文提示，避免界面永远卡在「生成中」。
 * 4. 网络类异常统一中文话术，不透出 "Failed to fetch" 这类英文技术信息。
 *
 * @param {Object} options
 * @param {string} options.message 用户消息
 * @param {Object} options.pet 当前咨询的宠物画像（id/name/species/breed/age 等）
 * @param {number|string|null} [options.sessionId] 会话 ID；缺省时后端自动新建会话并通过 meta 事件回传
 * @param {Function} [options.onMeta] 会话元信息回调：({ sessionId }) => void
 * @param {Function} [options.onDelta] 增量回调：(content) => void
 * @param {Function} [options.onDone] 正常结束回调：() => void
 * @param {Function} [options.onError] 异常回调：(msg) => void
 * @param {Function} [options.onRetry] 连接阶段自动重连回调：(attempt) => void，attempt 从 1 开始
 * @returns {{ abort: () => void }} 中断控制器，供「停止生成」按钮调用
 */
export function chatStream({ message, pet, sessionId, onMeta, onDelta, onDone, onError, onRetry }) {
  const controller = new AbortController()

  // 连接阶段重试的退避间隔（ms）：总尝试次数 = 间隔数 + 1
  const RETRY_DELAYS = [1000, 2000]
  // 连接阶段看门狗：超过该时长未拿到响应头视为网络故障（fetch 本身可能无限挂起）
  const CONNECT_TIMEOUT_MS = 10000
  // 流阶段看门狗：服务端心跳间隔为 15s，超过 25s 没有任何字节说明链路已静默中断
  const STREAM_WATCHDOG_MS = 25000

  let gotResponse = false   // 是否已收到响应头（收到后不再自动重试）
  let gotEvent = false      // 是否已收到任何 SSE 事件（用于区分中断话术）
  let watchdogFired = false // 本次 abort 是否由看门狗触发（区分用户主动停止）

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  const attemptOnce = async () => {
    // 连接阶段看门狗：fetch 未返回前挂起则主动 abort，交给外层按网络故障重试
    const connectTimer = setTimeout(() => {
      watchdogFired = true
      controller.abort()
    }, CONNECT_TIMEOUT_MS)

    let response
    try {
      const token = localStorage.getItem('token')
      response = await fetch('/api/ai/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message,
          pet,
          ...(sessionId != null ? { sessionId: Number(sessionId) } : {}),
        }),
        signal: controller.signal,
      })
      gotResponse = true
    } finally {
      clearTimeout(connectTimer)
    }

    // 非 2xx：401 清登录态并跳登录页（与 request.js 行为一致），其余提示服务暂不可用
    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        router.push({ name: 'login' })
        onError?.('登录已失效，请重新登录')
      } else {
        onError?.('AI 服务暂时不可用，请稍后再试')
      }
      return
    }

    // HTTP 200 但不是 SSE 流：后端业务错误（未登录 / 参数错误等）走 JSON Result
    // {"code":401/400,"msg":...}，若不拦截会被当成 SSE 解析然后静默丢失
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/event-stream')) {
      let result = null
      try {
        result = await response.json()
      } catch {
        // 非 JSON 兑底：按服务暂不可用处理
      }
      if (result?.code === 401) {
        // 与上方 401 分支保持一致：清登录态并跳登录页
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        router.push({ name: 'login' })
        onError?.('登录已失效，请重新登录')
      } else {
        onError?.(result?.msg || 'AI 服务暂时不可用，请稍后再试')
      }
      return
    }

    if (!response.body) {
      onError?.('当前浏览器不支持流式对话')
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    // 事件残余缓冲区：一次 read 可能包含多个事件或半个事件
    let buffer = ''
    // 是否已收到终止事件（done / error）
    let terminated = false

    // 流阶段看门狗：每次收到字节（含心跳）就续期；静默超时则 abort 中断挂死的 read
    let streamTimer = null
    const armStreamWatchdog = () => {
      clearTimeout(streamTimer)
      streamTimer = setTimeout(() => {
        watchdogFired = true
        controller.abort()
      }, STREAM_WATCHDOG_MS)
    }

    // 解析单个事件块（可能多行），按事件类型触发回调
    const dispatchBlock = (block) => {
      for (const rawLine of block.split('\n')) {
        const line = rawLine.trim()
        // 跳过空行与以 : 开头的心跳注释行
        if (!line || line.startsWith(':') || !line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload) continue
        let evt
        try {
          evt = JSON.parse(payload)
        } catch {
          continue // 非 JSON 数据行，忽略
        }
        gotEvent = true
        if (evt.type === 'meta') {
          onMeta?.({ sessionId: evt.sessionId })
        } else if (evt.type === 'delta') {
          onDelta?.(evt.content || '')
        } else if (evt.type === 'done') {
          terminated = true
          onDone?.()
        } else if (evt.type === 'error') {
          terminated = true
          onError?.(evt.msg || 'AI 服务暂时开小差了')
        }
      }
    }

    try {
      armStreamWatchdog()
      while (!terminated) {
        const { done, value } = await reader.read()
        if (done) break
        armStreamWatchdog()
        buffer += decoder.decode(value, { stream: true })
        // 事件之间以空行（\n\n）分隔；最后一段可能是不完整事件，留在缓冲区等待下轮拼接
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() || ''
        for (const block of blocks) {
          if (terminated) break
          dispatchBlock(block)
        }
      }
    } finally {
      clearTimeout(streamTimer)
    }

    // 已收到终止事件：取消底层流并结束（回调已在 dispatchBlock 中触发）
    if (terminated) {
      reader.cancel().catch(() => {})
      return
    }

    // 流被服务端提前关闭：flush 解码器并解析残余缓冲区中可能存在的最后一段事件
    buffer += decoder.decode()
    if (buffer.trim()) dispatchBlock(buffer)

    // 未显式收到 done 事件也视为完成，避免调用方界面停留在「生成中」
    if (!terminated) onDone?.()
  }

  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        await attemptOnce()
        return
      } catch (e) {
        // 用户主动 abort 不视为错误，界面状态由调用方的停止逻辑负责恢复
        if (e?.name === 'AbortError' && !watchdogFired) return

        // 网络类异常判定：fetch 网络错误是 TypeError；看门狗触发后 abort 也是网络故障信号
        const isNetworkError = e instanceof TypeError || watchdogFired || navigator.onLine === false
        // 仅在「尚未收到响应头」时自动重试：此时服务端还未开始生成，重发是安全的；
        // 已收到响应头则不重试（后端可能已建会话 / 已开始生成），交给用户手动重新生成
        if (!gotResponse && isNetworkError && attempt < RETRY_DELAYS.length) {
          watchdogFired = false
          onRetry?.(attempt + 1)
          await sleep(RETRY_DELAYS[attempt])
          continue
        }

        const msg = isNetworkError
          ? (gotEvent ? '网络连接中断，请检查网络后点击重新生成' : '网络连接异常，请稍后重试')
          : (e?.message || '网络异常，请稍后重试')
        onError?.(msg)
        return
      }
    }
  }

  run()

  return {
    abort: () => controller.abort(),
  }
}

/** 查询指定会话的历史对话（时间正序），data 为 { sessionId, messages: [{ role, content, petId, ts }] } */
export const getChatHistory = (sessionId) =>
  request.get('/ai/chat/history', { params: { sessionId } })

/** 查询当前用户的全部会话（跨宠物统一展示，最近活跃在前），data 为 { sessions: [{ id, petId, title, createTime, updateTime }] } */
export const listChatSessions = () =>
  request.get('/ai/chat/sessions')

/** 删除会话（连带会话下全部消息） */
export const deleteChatSession = (sessionId) =>
  request.delete(`/ai/chat/sessions/${sessionId}`)

/* ---------------- 以下为新增 AI 能力（均为普通 JSON 接口，走 axios 封装） ---------------- */

/**
 * 宠物健康智能评估
 * @param {Object} pet 宠物档案（字段与对话接口的 pet 一致，含 health 子对象）
 * @returns {Promise<Object>} { score, level, summary, risks, suggestions, carePlan, reminders, disclaimer }
 */
export const assessPetHealth = (pet) => request.post('/ai/health/assess', pet)

/** 查询某宠物的历史健康评估（时间倒序），data 为 { reports: [...] } */
export const getHealthHistory = (petId, limit = 10) =>
  request.get('/ai/health/history', { params: { petId, limit } })

/**
 * 商品评论 AI 摘要
 * @param {number|string} productId 商品 ID
 * @returns {Promise<Object>} { sentiment, one_line, pros, cons, keywords, count }
 */
export const summarizeProductReviews = (productId) =>
  request.post('/ai/shop/review/summary', { productId: Number(productId) })

/**
 * 个性化推荐流
 * @param {string} scene home 首页 / shop 商城
 * @param {boolean} refresh 是否跳过缓存强制刷新
 * @returns {Promise<Object>} { items: [{ id, type, title, image, price, reason, score, ... }], summary }
 */
export const getRecommendations = (scene = 'home', refresh = false) =>
  request.get('/ai/recommend/feed', { params: { scene, refresh } })
