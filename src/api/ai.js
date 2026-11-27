import request from './request'
import router from '@/router'
import { clearAuth, currentUser, getToken } from '@/utils/auth'
import { userScopedKey } from '@/utils/userCache'

// 流阶段看门狗时长（ms）：服务端心跳间隔 15s，超过 25s 没有任何字节说明链路已静默中断
const STREAM_WATCHDOG_MS = 25000

/**
 * 分发一个 SSE 事件块（可能含多行 data:），把事件转成对应回调。
 *
 * 抽成独立函数是为了让「发起对话」与「审批续流」两条链路共用同一套事件语义：
 * 新增事件类型只改这里，不会出现一边认识、另一边把它当未知事件丢掉的情况。
 *
 * @param {string} block 以空行分隔的单个事件块
 * @param {Object} handlers 回调集合（onMeta / onRefs / onDelta / onApproval / onDone / onError）
 * @returns {{ seen: boolean, terminated: boolean }} seen 表示块内存在可解析事件；
 *   terminated 表示已收到终止事件（done / error / approval），调用方应停止读取
 */
function dispatchSseBlock(block, handlers) {
  const { onMeta, onRefs, onDelta, onApproval, onDone, onError } = handlers
  let seen = false
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
    seen = true
    if (evt.type === 'meta') {
      onMeta?.({ sessionId: evt.sessionId })
    } else if (evt.type === 'refs') {
      // RAG 检索来源：在答案首字之前到达，同一轮可能收到多次（以最后一次为准）
      onRefs?.(evt.items || [])
    } else if (evt.type === 'delta') {
      onDelta?.(evt.content || '')
    } else if (evt.type === 'approval') {
      // 敏感操作挂起：这是本轮的终止帧（没有 done），等用户审批后由 approveChat 续流
      onApproval?.(evt)
      return { seen, terminated: true }
    } else if (evt.type === 'done') {
      onDone?.()
      return { seen, terminated: true }
    } else if (evt.type === 'error') {
      onError?.(evt.msg || 'AI 服务暂时开小差了')
      return { seen, terminated: true }
    }
  }
  return { seen, terminated: false }
}

/**
 * AI养宠 · 流式对话（SSE）
 *
 * 为什么不用现有 axios 封装：request.js 有 10s 超时且响应拦截器只解包 JSON Result，
 * 与 text/event-stream 流式响应不兼容；EventSource 又不支持 POST，故用原生 fetch。
 *
 * 响应帧格式（事件之间以空行 \n\n 分隔，每行 data: 开头，可能夹杂以 : 开头的心跳注释行）：
 *   data: {"type":"meta","sessionId":1}       首帧会话元信息（后端自动新建会话时前端据此绑定）
 *   data: {"type":"delta","content":"你好"}   增量内容（多次）
 *   data: {"type":"approval","title":...}    敏感操作挂起，等待用户审批（本轮没有 done）
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
 * @param {string} options.message 用户消息（纯附件发送时可为空串）
 * @param {Object} options.pet 当前咨询的宠物画像（id/name/species/breed/age 等）
 * @param {number|string|null} [options.sessionId] 会话 ID；缺省时后端自动新建会话并通过 meta 事件回传
 * @param {Array} [options.attachments] 图片附件列表 [{ type, url, mime, name, size }]，
 *   由 uploadChatMedia 上传后获得；当前生效模型支持视觉时图片会直接送给模型
 * @param {Function} [options.onMeta] 会话元信息回调：({ sessionId }) => void
 * @param {Function} [options.onRefs] RAG 引用回调：(items) => void
 * @param {Function} [options.onDelta] 增量回调：(content) => void
 * @param {Function} [options.onApproval] 人工审批挂起回调：(evt) => void，evt 含 approvalId/title/summary
 * @param {Function} [options.onDone] 正常结束回调：() => void
 * @param {Function} [options.onError] 异常回调：(msg) => void
 * @param {Function} [options.onRetry] 连接阶段自动重连回调：(attempt) => void，attempt 从 1 开始
 * @returns {{ abort: () => void }} 中断控制器，供「停止生成」按钮调用
 */
export function chatStream({ message, pet, sessionId, attachments, onMeta, onRefs, onDelta, onApproval, onDone, onError, onRetry }) {
  const controller = new AbortController()

  // 连接阶段重试的退避间隔（ms）：总尝试次数 = 间隔数 + 1
  const RETRY_DELAYS = [1000, 2000]
  // 连接阶段看门狗：超过该时长未拿到响应头视为网络故障（fetch 本身可能无限挂起）
  const CONNECT_TIMEOUT_MS = 10000

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
      const token = getToken()
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
          ...(attachments?.length ? { attachments } : {}),
        }),
        signal: controller.signal,
      })
      gotResponse = true
    } finally {
      clearTimeout(connectTimer)
    }

    // 非 2xx：401 走 clearAuth 统一清登录态与用户级缓存，再带 redirect 跳登录页，其余提示服务暂不可用
    if (!response.ok) {
      if (response.status === 401) {
        clearAuth()
        router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } })
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
        // 与上方 401 分支保持一致：clearAuth 统一清理后带 redirect 跳登录页
        clearAuth()
        router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } })
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

    // 解析单个事件块（可能多行），按事件类型触发回调；事件语义统一见 dispatchSseBlock
    const dispatchBlock = (block) => {
      const result = dispatchSseBlock(block, { onMeta, onRefs, onDelta, onApproval, onDone, onError })
      if (result.seen) gotEvent = true
      if (result.terminated) terminated = true
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

/**
 * AI养宠 · 人工审批敏感操作，并从挂起点继续这一轮对话（SSE）
 *
 * 服务端在工具真正写库前调用 `interrupt()` 挂起整张图，通过 `approval` 帧把「要做什么、
 * 对象是谁、内容是什么」下发；用户点「同意 / 拒绝」后由本函数提交决定，并继续接收
 * 剩余回答的 delta。**审批发生在一次独立的用户请求里，模型无法自己「点同意」。**
 *
 * 不做自动重试：审批是有副作用的动作，重发可能对应两次决定；失败时交由用户重新点击。
 *
 * @param {Object} options
 * @param {number|string} options.sessionId 会话 ID（approval 帧所属会话）
 * @param {string} [options.approvalId] 审批单 ID（approval 帧的 approvalId，用于防重放）
 * @param {boolean} options.approved 是否批准
 * @param {string} [options.reason] 拒绝原因（可选），会转述给用户与模型，最多 200 字
 * @param {Function} [options.onMeta] 会话元信息回调
 * @param {Function} [options.onRefs] RAG 引用回调
 * @param {Function} [options.onDelta] 续流增量回调：(content) => void
 * @param {Function} [options.onApproval] 续流中再次挂起时的回调
 * @param {Function} [options.onDone] 续流结束回调
 * @param {Function} [options.onError] 异常回调：(msg, opts) => void；
 *   opts.fatal=true 表示审批单已失效 / 已被消费，重试没有意义，调用方应收起审批卡片
 * @returns {{ abort: () => void }} 中断控制器
 */
export function approveChat({ sessionId, approvalId, approved, reason = '', onMeta, onRefs, onDelta, onApproval, onDone, onError }) {
  const controller = new AbortController()
  const handlers = { onMeta, onRefs, onDelta, onApproval, onDone, onError }
  let gotEvent = false

  const run = async () => {
    let response
    try {
      const token = getToken()
      response = await fetch('/api/ai/chat/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          sessionId: Number(sessionId),
          approvalId: approvalId || '',
          approved: !!approved,
          reason: (reason || '').slice(0, 200),
        }),
        signal: controller.signal,
      })
    } catch (e) {
      // 看门狗超时也会走这里：不能静默返回，否则界面会永远停在「执行中」
      onError?.(e?.name === 'AbortError' ? '审批响应超时，请重试' : '网络异常，审批未提交，请重试')
      return
    }

    if (!response.ok) {
      if (response.status === 401) {
        clearAuth()
        router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } })
        onError?.('登录已失效，请重新登录', { fatal: true })
      } else {
        // 4xx 是请求本身的问题（如审批单不存在），重试也不会成功；5xx 允许重试
        onError?.('AI 服务暂时不可用，请稍后再试',
          { fatal: response.status >= 400 && response.status < 500 })
      }
      return
    }

    // 非 SSE：审批单过期 / 已被处理等业务错误走 JSON Result，需要把 msg 透传给用户
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/event-stream')) {
      let result = null
      try {
        result = await response.json()
      } catch {
        // 非 JSON 兜底：按服务暂不可用处理
      }
      onError?.(result?.msg || '审批已失效，请重新发送消息', { fatal: true })
      return
    }

    if (!response.body) {
      onError?.('当前浏览器不支持流式对话')
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let terminated = false
    let streamTimer = null
    const armStreamWatchdog = () => {
      clearTimeout(streamTimer)
      streamTimer = setTimeout(() => controller.abort(), STREAM_WATCHDOG_MS)
    }

    try {
      armStreamWatchdog()
      while (!terminated) {
        const { done, value } = await reader.read()
        if (done) break
        armStreamWatchdog()
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() || ''
        for (const block of blocks) {
          if (terminated) break
          const result = dispatchSseBlock(block, handlers)
          if (result.seen) gotEvent = true
          if (result.terminated) terminated = true
        }
      }
    } catch (e) {
      if (e?.name === 'AbortError') {
        // 看门狗超时：审批可能已经送达并执行，不能静默收场
        onError?.('审批响应超时，结果未知，请刷新会话确认')
        return
      }
      // 已收到过事件说明审批大概率已被消费，重试只会拿到「没有待审批」
      onError?.(
        gotEvent ? '网络连接中断，审批结果未知，请刷新会话确认' : '网络异常，审批未提交，请重试',
        { fatal: gotEvent },
      )
      return
    } finally {
      clearTimeout(streamTimer)
    }

    if (terminated) {
      reader.cancel().catch(() => {})
      return
    }
    buffer += decoder.decode()
    if (buffer.trim()) {
      const result = dispatchSseBlock(buffer, handlers)
      if (result.terminated) terminated = true
    }
    if (!terminated) onDone?.()
  }

  run()

  return {
    abort: () => controller.abort(),
  }
}

/**
 * 上传对话图片附件（仅支持图片）
 * 超时放宽到 120s 与项目内其他上传接口一致；大小上限由后端校验（默认 10MB），
 * 超限返回业务错误 message
 * @param {File} file 原始图片文件
 * @returns {Promise<Object>} { type, url, mime, name, size }，原样放入 chatStream 的 attachments
 */
export const uploadChatMedia = (file) => {
  const form = new FormData()
  form.append('file', file)
  return request.post('/ai/chat/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  })
}

/** 查询指定会话的历史对话（时间正序），data 为 { sessionId, messages: [{ role, content, petId, ts, attachments }] } */
export const getChatHistory = (sessionId) =>
  request.get('/ai/chat/history', { params: { sessionId } })

/** 查询当前用户的全部会话（跨宠物统一展示，最近活跃在前），data 为 { sessions: [{ id, petId, title, createTime, updateTime }] } */
export const listChatSessions = () =>
  request.get('/ai/chat/sessions')

/** 删除会话（连带会话下全部消息） */
export const deleteChatSession = (sessionId) =>
  request.delete(`/ai/chat/sessions/${sessionId}`)

/**
 * 查询当前用户的全部长期记忆（跨会话，最近更新在前）
 * data 为 { memories: [{ key, scope, petId, petName, kind, content, createdAt, updatedAt }] }
 */
export const getChatMemories = () => request.get('/ai/chat/memories')

/**
 * 删除单条长期记忆
 * @param {string} key 记忆标识（列表项的 key）
 * @param {string} scope 归属：user 用户级 / pet 宠物级
 * @param {number|string} [petId] 宠物级记忆的归属宠物 ID（scope=pet 时必传）
 */
export const deleteChatMemory = (key, scope, petId) =>
  request.delete(`/ai/chat/memories/${key}`, { params: { scope, petId } })

/* ---------------- 知识库管理（RAG 语料文档，管理员限定） ----------------
 * 鉴权由网关注入的 X-User-Role 承担（ADMIN 才能调用），浏览器侧无需额外凭证；
 * 不经网关直连 ai-service 的运维脚本可改带 X-Kb-Admin 令牌，见 app/kb_api.py
 */

/**
 * 知识库文档列表（服务端分页）
 * @param {Object} [params] { page=1, size=20, keyword='' }
 * data 为 { items: [{ docId, name, source, kind, category, species, tags, chunkCount,
 *        charCount, origin, sha256, filePath, updatedAt }],
 *        total, page, size, pages, totalDocuments, totalChunks, totalChars, supportedKinds }
 */
export const listKbDocuments = ({ page = 1, size = 20, keyword = '' } = {}) =>
  request.get('/ai/kb/documents', { params: { page, size, keyword } })

/**
 * 文档在线预览：正文（重解析原文，原文缺失时后端回退为片段拼接）+ 入库片段清单
 * data 为 { docId, name, source, kind, format: 'markdown'|'text', content,
 *           contentFrom: 'file'|'chunks', hasFile, chunks: [{ chunkIndex, section, content, chars, tokenCount }] }
 */
export const getKbPreview = (docId) =>
  request.get(`/ai/kb/documents/${encodeURIComponent(docId)}/preview`)

/**
 * 取文档原文的 blob URL（PDF 交给浏览器内置查看器渲染）
 *
 * 走原生 fetch 而不是 axios 封装：响应拦截器会按 Result 结构解包，二进制流没有
 * code 字段会被判成失败；iframe 也不能自己带 Authorization 头，所以在这里取回
 * 二进制再转 object URL。调用方用完必须 revokeObjectURL，否则内存不释放。
 * @returns {Promise<{ url: string, mime: string }>}
 */
export async function fetchKbFileUrl(docId) {
  const token = getToken()
  const response = await fetch(`/api/ai/kb/documents/${encodeURIComponent(docId)}/file`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) throw new Error(`原文读取失败（HTTP ${response.status}）`)
  const blob = await response.blob()
  return {
    url: URL.createObjectURL(blob),
    mime: response.headers.get('Content-Type') || blob.type || '',
  }
}

/**
 * 上传一篇知识文档（md / pdf / docx / doc），后端解析切分后立即入库
 * @param {File} file 文档文件
 * @param {Object} [meta] { title, category, species }，species 为逗号分隔字符串
 */
export const uploadKbDocument = (file, meta = {}) => {
  const form = new FormData()
  form.append('file', file)
  if (meta.title) form.append('title', meta.title)
  if (meta.category) form.append('category', meta.category)
  if (meta.species) form.append('species', meta.species)
  return request.post('/ai/kb/documents', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // 上传后要走解析 + 批量 Embedding，耗时随文档长度线性增长
    timeout: 300000,
  })
}

/** 删除一篇文档及其全部知识片段（docId 可能含中文，需编码） */
export const deleteKbDocument = (docId) =>
  request.delete(`/ai/kb/documents/${encodeURIComponent(docId)}`)

/** 用仓库语料目录全量重建知识库（耗时较长，超时放宽到 10 分钟） */
export const reindexKb = () =>
  request.post('/ai/kb/reindex', null, { timeout: 600000 })

/* ---------------- AI 扩展管理（MCP 服务 / Skill 技能，管理员限定） ----------------
 * 网关对 /api/ai/admin/** 做 ADMIN 角色校验，ai-service 内再做一次同款校验（纵深防御）；
 * 写操作成功后后端立即失效运行时缓存，下一轮对话即生效。
 */

/** MCP 服务列表（含停用项），data 为 { items: [{ id, name, transport, url, command, args, env, headers, description, enabled, createTime, updateTime }] } */
export const listMcpServers = () => request.get('/ai/admin/mcp/servers')

/** 新增 MCP 服务，data 为完整配置（McpServerUpsert），返回创建后的配置 */
export const createMcpServer = (data) => request.post('/ai/admin/mcp/servers', data)

/** 整体更新 MCP 服务（启停开关也走这里，提交完整配置） */
export const updateMcpServer = (id, data) => request.put(`/ai/admin/mcp/servers/${id}`, data)

/** 删除 MCP 服务 */
export const deleteMcpServer = (id) => request.delete(`/ai/admin/mcp/servers/${id}`)

/** 测试 MCP 连通性并列出其工具（连接 + 握手可能较慢，超时放宽到 30s），data 为 { toolCount, tools: [{ name, description }] } */
export const testMcpServer = (id) =>
  request.post(`/ai/admin/mcp/servers/${id}/test`, null, { timeout: 30000 })

/** Skill 技能包列表（含停用项与正文），data 为 { items: [{ name, description, enabled, content, bodyLines, resources, updateTime }] } */
export const listSkills = () => request.get('/ai/admin/skills')

/** 新增 Skill 技能包，data 为 { name(hyphen-case), description(单行), content, enabled }，落地为 skills/<name>/SKILL.md */
export const createSkill = (data) => request.post('/ai/admin/skills', data)

/** 整体更新 Skill（按技能名；启停开关也走这里，提交完整配置；改名时后端迁移目录） */
export const updateSkill = (name, data) => request.put(`/ai/admin/skills/${encodeURIComponent(name)}`, data)

/** 删除 Skill 技能包（按技能名，整目录删除） */
export const deleteSkill = (name) => request.delete(`/ai/admin/skills/${encodeURIComponent(name)}`)

/* ---------------- 模型管理（供应商 + 当前生效模型，管理员限定） ----------------
 * 结构参照 ZCode / Zed：供应商描述「协议 + Base URL + Key」，其下挂多个模型；
 * 全局只有一个「当前生效模型」，切换后下一轮对话立即生效（后端缓存同步失效）。
 */

/**
 * 模型供应商列表 + 当前生效模型 + 运行时实际配置
 * data 为 { items: [{ id, name, protocol, baseUrl, apiKeyMask, hasApiKey, models, description, enabled, createTime, updateTime }],
 *           active: { providerId, model },
 *           runtime: { source: 'db'|'env', providerName, protocol, baseUrl, model, vision, note },
 *           mock: 是否被 MOCK_CHAT 强制走模拟回复 }
 */
export const listModelProviders = () => request.get('/ai/admin/models')

/** 新增模型供应商（name / protocol / baseUrl / apiKey / models / description / enabled） */
export const createModelProvider = (data) => request.post('/ai/admin/models', data)

/** 整体更新模型供应商（启停开关也走这里；apiKey 留空表示沿用原 Key） */
export const updateModelProvider = (id, data) => request.put(`/ai/admin/models/${id}`, data)

/** 删除模型供应商（若它正是当前生效来源，指针会被一并清空） */
export const deleteModelProvider = (id) => request.delete(`/ai/admin/models/${id}`)

/** 切换当前生效模型（下一轮对话立即使用；data 为 { active, runtime }） */
export const activateModel = (providerId, model) =>
  request.post('/ai/admin/models/activate', { providerId, model })

/** 测试模型连通性（要真跑一次推理，超时放宽到 60s），data 为 { model, protocol, latencyMs, reply } */
export const testModel = (providerId, model) =>
  request.post('/ai/admin/models/test', { providerId, model }, { timeout: 60000 })

/* ---------------- 以下为新增 AI 能力（均为普通 JSON 接口，走 axios 封装） ---------------- */

/**
 * 宠物健康智能评估
 * 后端需调用大模型生成报告，耗时常常超过 axios 默认 10s，故单独放宽超时
 * @param {Object} pet 宠物档案（字段与对话接口的 pet 一致，含 health 子对象）
 * @returns {Promise<Object>} { score, level, summary, risks, suggestions, carePlan, reminders, disclaimer }
 */
export const assessPetHealth = (pet) =>
  request.post('/ai/health/assess', pet, { timeout: 120000 })

/** 查询某宠物的历史健康评估（时间倒序），data 为 { reports: [...] } */
export const getHealthHistory = (petId, limit = 10) =>
  request.get('/ai/health/history', { params: { petId, limit } })

/**
 * 商品评论 AI 摘要
 * 后端需聚合评论并调用大模型，耗时可能超过 axios 默认 10s，故放宽超时
 * @param {number|string} productId 商品 ID
 * @returns {Promise<Object>} { sentiment, one_line, pros, cons, keywords, count }
 */
export const summarizeProductReviews = (productId) =>
  request.post('/ai/shop/review/summary', { productId: Number(productId) }, { timeout: 120000 })

/**
 * 个性化推荐流
 * 冷启动 / 强制刷新时后端需调用大模型重算，耗时可能超过 axios 默认 10s，故放宽超时
 * 推荐属于「进页面顺手拉」的后台请求，默认静默：登录态失效时只清状态，不弹登录框打断浏览
 * @param {string} scene home 首页 / shop 商城
 * @param {boolean} refresh 是否跳过缓存强制刷新
 * @returns {Promise<Object>} { items: [{ id, type, title, image, price, reason, score, ... }], summary }
 */
export const getRecommendations = (scene = 'home', refresh = false) =>
  request.get('/ai/recommend/feed', {
    params: { scene, refresh },
    timeout: 120000,
    silentAuth: true,
  })

/* ---------------- 个性化推荐的本地快照（旧数据占位 + 每次请求校准） ---------------- */

// 本地快照只用于页面首屏先展示旧内容，不能作为最终数据源。
// 调用方每次进入页面都必须继续请求后端；成功后覆盖快照，失败才继续展示旧数据。
// 快照属于当前登录用户的个人化数据，统一放在 pv:user:<uid>: 命名空间下：
// 未登录时读写一律跳过，登录态失效时由 clearAuth 按前缀整体清除（见 utils/userCache.js）

const _recommendCacheKey = (scene) => userScopedKey(currentUser()?.id, 'recommend', scene)

/**
 * 读取本地推荐快照（{ items, summary, ts }）
 * 只用于立即渲染旧内容；调用方随后必须请求后端校准。
 * 无快照 / 未登录 / 数据残缺时返回 null；快照不设过期时间，ts 仅记录最近一次成功刷新时间
 */
export const readRecommendCache = (scene = 'home') => {
  const key = _recommendCacheKey(scene)
  if (!key) return null
  try {
    const cached = JSON.parse(localStorage.getItem(key) || 'null')
    if (!cached?.items?.length) return null
    return cached
  } catch {
    return null
  }
}

/** 用后端新结果覆盖本地推荐快照（只缓存非空结果；未登录或写失败静默忽略） */
export const writeRecommendCache = (scene, data) => {
  const key = _recommendCacheKey(scene)
  if (!key || !data?.items?.length) return
  try {
    localStorage.setItem(key, JSON.stringify({ items: data.items, summary: data.summary || '', ts: Date.now() }))
  } catch {
    // 隐私模式 / 容量满等写不进去就算了，不影响推荐主流程
  }
}
