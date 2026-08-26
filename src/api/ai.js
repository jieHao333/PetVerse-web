import request from './request'
import router from '@/router'

/**
 * 宠物 AI 伙伴 · 流式对话（SSE）
 *
 * 为什么不用现有 axios 封装：request.js 有 10s 超时且响应拦截器只解包 JSON Result，
 * 与 text/event-stream 流式响应不兼容；EventSource 又不支持 POST，故用原生 fetch。
 *
 * 响应帧格式（事件之间以空行 \n\n 分隔，每行 data: 开头，可能夹杂以 : 开头的心跳注释行）：
 *   data: {"type":"delta","content":"喵"}  增量内容（多次）
 *   data: {"type":"done"}                   正常结束
 *   data: {"type":"error","msg":"..."}      服务端异常
 *
 * @param {Object} options
 * @param {string} options.message 用户消息
 * @param {Object} options.pet 出场宠物画像（id/name/species/breed/age/level/signStreak/description）
 * @param {Function} [options.onDelta] 增量回调：(content) => void
 * @param {Function} [options.onDone] 正常结束回调：() => void
 * @param {Function} [options.onError] 异常回调：(msg) => void
 * @returns {{ abort: () => void }} 中断控制器，供「停止生成」按钮调用
 */
export function chatStream({ message, pet, onDelta, onDone, onError }) {
  const controller = new AbortController()

  const run = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/ai/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message, pet }),
        signal: controller.signal,
      })

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
          // 非 JSON 兜底：按服务暂不可用处理
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
          if (evt.type === 'delta') {
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

      while (!terminated) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // 事件之间以空行（\n\n）分隔；最后一段可能是不完整事件，留在缓冲区等待下轮拼接
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() || ''
        for (const block of blocks) {
          if (terminated) break
          dispatchBlock(block)
        }
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
    } catch (e) {
      // 用户主动 abort 不视为错误，界面状态由调用方的停止逻辑负责恢复
      if (e?.name === 'AbortError') return
      onError?.(e?.message || '网络异常，请稍后再试')
    }
  }

  run()

  return {
    abort: () => controller.abort(),
  }
}

/** 查询与指定宠物的历史对话（时间正序），data 为 { petId, messages: [{ role, content, ts }] } */
export const getChatHistory = (petId) => request.get('/ai/chat/history', { params: { petId } })

/** 清空与指定宠物的历史对话 */
export const clearChatHistory = (petId) => request.delete('/ai/chat/history', { params: { petId } })
