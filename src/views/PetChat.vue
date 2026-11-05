<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { ArrowDown, Collection, Delete, Menu, Paperclip, Plus } from '@element-plus/icons-vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import PetOnboardingDialog from '@/components/PetOnboardingDialog.vue'
import { getMyPet, listMyPets } from '@/api/pet'
import {
  chatStream,
  getChatHistory,
  listChatSessions,
  deleteChatSession,
  getChatMemories,
  deleteChatMemory,
  uploadChatMedia,
} from '@/api/ai'
import { petAgeInfo, petHealthText, realPetMonths } from '@/utils/pet'

// 当前时间戳（秒），本地新消息使用
const nowSec = () => Math.floor(Date.now() / 1000)

// 消息时间戳（秒）转 HH:mm 小字
const formatMsgTime = (ts) => {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

// AI 回复是 markdown 文本，气泡内渲染成富文本；用户消息保持纯文本插值
const renderMd = (text) => (text ? DOMPurify.sanitize(marked.parse(text, { breaks: true })) : '')

// ---------- RAG 引用来源（回答气泡下方的「参考来源」折叠条） ----------
// 默认折叠，只展开用户主动点开的那条消息，避免长对话里满屏都是来源列表
const openedRefs = ref(new Set())
const toggleRefs = (idx) => {
  const next = new Set(openedRefs.value)
  if (next.has(idx)) next.delete(idx)
  else next.add(idx)
  openedRefs.value = next
}
// 文档类型标签：md / pdf / doc(x) 用不同色，来源列表里一眼分辨出处格式
const kbKindType = (kind) => ({ pdf: 'danger', doc: 'warning', docx: 'warning' }[kind] || 'success')
const kbKindLabel = (kind) => (kind || 'md').toUpperCase()
// 相关度展示：后端下发的是余弦相似度（0~1），转成百分比整数
const kbScoreText = (score) => `${Math.round((Number(score) || 0) * 100)}%`

// ---------- 多模态附件（图片 / 音频 / 视频） ----------
// 与后端 app/media.py 的判定规则对齐：MIME 主类型优先，扩展名兜底
const MEDIA_RULES = {
  image: {
    mimes: ['image/'],
    exts: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'],
    label: '图片', maxMB: 10, accept: 'image/*',
  },
  audio: {
    mimes: ['audio/'],
    exts: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'],
    label: '音频', maxMB: 20, accept: 'audio/*',
  },
  video: {
    mimes: ['video/'],
    exts: ['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'],
    label: '视频', maxMB: 50, accept: 'video/*',
  },
}
const MEDIA_ACCEPT = Object.values(MEDIA_RULES).map((r) => r.accept).join(',')
// 单条消息附件数上限（与后端 CHAT_MAX_ATTACHMENTS 一致）
const MAX_ATTACHMENTS = 4

const detectMediaKind = (file) => {
  const mime = file.type || ''
  for (const [kind, rule] of Object.entries(MEDIA_RULES)) {
    if (rule.mimes.some((m) => mime.startsWith(m))) return kind
  }
  const ext = (file.name || '').split('.').pop().toLowerCase()
  for (const [kind, rule] of Object.entries(MEDIA_RULES)) {
    if (rule.exts.includes(ext)) return kind
  }
  return null
}

const formatSize = (bytes) => {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

// 真实宠物按生日计算年龄，不足 1 岁展示月龄；虚拟宠物直接用年龄字段
const petAgeText = (p) => {
  if (p.type !== 'REAL') return p.age != null ? `${p.age} 岁` : ''
  const months = realPetMonths(p.birthday)
  if (months == null) return ''
  return months >= 12 ? `${Math.floor(months / 12)} 岁` : `${months} 个月`
}

// 宠物列表项的副标题：统一按「种类 · 品种 · 年龄」展示；未完善档案的真实宠物只展示种类
const petLine = (p) => {
  if (p.type === 'REAL' && !p.cardIssueDate) return p.species || '未填种类'
  return [p.species, p.breed, petAgeText(p)].filter(Boolean).join(' · ')
}

// ---------- 页面状态 ----------
const pets = ref([]) // 当前用户的全部宠物（切换咨询对象用）
const pet = ref(null) // 当前选中宠物
const sessions = ref([]) // 会话列表（用户与所有宠物的历史会话统一展示，最近活跃在前，每条带归属 petId）
const currentSessionId = ref(null) // 当前会话 ID；null 表示待创建的新会话
const loadingPet = ref(true) // 宠物信息加载中
const loadingSessions = ref(false) // 会话列表加载中
const loadingHistory = ref(false) // 历史对话加载中
// 会话消息列表：[{ role: 'user' | 'assistant', content, ts, thinking, stopped, error, failed }]
const messages = ref([])
const inputText = ref('') // 输入框内容
const sending = ref(false) // 是否正在流式生成中
const scrollbarRef = ref(null) // 消息区 el-scrollbar 实例
const inputRef = ref(null) // 输入框实例：点推荐问题后把焦点交还给它
let streamCtrl = null // 当前流式请求控制器（{ abort }）

/**
 * 消息分组视图：相邻同角色、且间隔小于 5 分钟的消息并为一组。
 * 组内间距收紧、换角色时拉开；AI 头像与「顾问名 + 时间」只在组首出现，
 * 用户侧时间只在组尾出现——长对话里不会每行都重复同一套信息。
 */
const GROUP_GAP_SEC = 5 * 60
const messageViews = computed(() =>
  messages.value.map((msg, idx) => {
    const prev = messages.value[idx - 1]
    const next = messages.value[idx + 1]
    const samePrev =
      !!prev &&
      prev.role === msg.role &&
      Math.abs((msg.ts || 0) - (prev.ts || 0)) < GROUP_GAP_SEC
    const sameNext =
      !!next &&
      next.role === msg.role &&
      Math.abs((next.ts || 0) - (msg.ts || 0)) < GROUP_GAP_SEC
    return { msg, idx, groupStart: !samePrev, groupEnd: !sameNext }
  }),
)

// 窄屏判定：手机上的输入框只有 200px 出头，长占位文案会撑成三行，换成短句
const narrowMq = window.matchMedia('(max-width: 768px)')
const isNarrow = ref(narrowMq.matches)
const onNarrowChange = (e) => {
  isNarrow.value = e.matches
}
narrowMq.addEventListener('change', onNarrowChange)
onUnmounted(() => narrowMq.removeEventListener('change', onNarrowChange))

// 空会话推荐问题：点一下填进输入框，省得用户对着空白框不知道从哪问起
const QUICK_PROMPTS = ['日常喂养要注意什么', '多久驱虫和打疫苗', '最近有点挑食怎么办']
const usePrompt = (q) => {
  inputText.value = q
  nextTick(() => inputRef.value?.focus())
}

// 输入框占位：桌面写全信息，窄屏只留最短的一句
const inputPlaceholder = computed(() =>
  isNarrow.value
    ? `咨询 ${pet.value?.name || '它'} 的健康问题…`
    : `咨询 ${pet.value?.name || '它'} 的健康、习性等问题，也可以直接发送照片 / 语音...`,
)

// ---------- 待发送附件（选择后立即上传，发送时一并携带） ----------
// pendingFiles 项：{ id, kind, name, size, previewUrl, uploading, failed, att }
// att 为后端返回的附件信息（上传成功后才有，发送时原样放进 chatStream.attachments）
const pendingFiles = ref([])
const fileInputRef = ref(null)
const readyAttachmentCount = computed(
  () => pendingFiles.value.filter((f) => f.att && !f.failed).length,
)
let fileIdSeq = 0

// 选择附件（点击回形针）：弹出系统文件选择器
const pickFiles = () => {
  if (sending.value) return
  fileInputRef.value?.click()
}

// 选中文件：本地校验（类型 / 大小 / 数量）后立即逐个上传，失败项留在列表中标红可移除
const onFilesChosen = (e) => {
  const files = Array.from(e.target.files || [])
  e.target.value = '' // 清空 value，重复选择同一文件也能触发 change
  for (const file of files) {
    if (pendingFiles.value.length >= MAX_ATTACHMENTS) {
      ElMessage.warning(`单条消息最多携带 ${MAX_ATTACHMENTS} 个附件`)
      break
    }
    const kind = detectMediaKind(file)
    if (!kind) {
      ElMessage.error(`「${file.name}」不是支持的图片 / 音频 / 视频文件`)
      continue
    }
    const rule = MEDIA_RULES[kind]
    if (file.size > rule.maxMB * 1024 * 1024) {
      ElMessage.error(`${rule.label}不能超过 ${rule.maxMB}MB`)
      continue
    }
    const item = {
      id: ++fileIdSeq,
      kind,
      name: file.name || '附件',
      size: file.size,
      // 图片用本地 blob 预览（上传成功后仍用该地址展示，回放 URL 只在历史消息里用）
      previewUrl: kind === 'image' ? URL.createObjectURL(file) : '',
      uploading: true,
      failed: false,
      att: null,
    }
    pendingFiles.value.push(item)
    // 取数组里的代理对象做后续回填：闭包直接持有原始对象的话，
    // att/uploading 的变更不会触发视图更新（Vue 3 深层代理只作用于经数组访问的引用）
    uploadPending(pendingFiles.value[pendingFiles.value.length - 1], file)
  }
}

// 上传单个附件：成功回填 att；失败标记 failed（保留在待发送条里，可手动移除后重试——重新选择）
const uploadPending = async (item, file) => {
  try {
    const att = await uploadChatMedia(file)
    item.att = att
    item.uploading = false
  } catch (err) {
    item.uploading = false
    item.failed = true
    ElMessage.error(`「${item.name}」上传失败：${err.message}`)
  }
}

// 移除待发送附件（释放本地 blob 预览的引用）
const removePendingFile = (item) => {
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
  pendingFiles.value = pendingFiles.value.filter((f) => f.id !== item.id)
}

// 发送后清空待发送附件（不 revoke previewUrl：乐观气泡继续用它渲染）
const clearPendingFiles = () => {
  pendingFiles.value = []
}

// 宠物激活态比较键：宠物 ID 为雪花 ID（后端 Long 序列化为字符串），用字符串比较避免 Number() 精度丢失
const petKey = (p) => (p == null ? null : String(p.id))
const isPetActive = (p) => petKey(p) === petKey(pet.value)
// 按 petId 解析消息归属的宠物对象（petId 为 0 / null 或宠物已删除时返回 null）；
// petId 后端以字符串下发（雪花 ID），全程用字符串比较，不能用 Number() 否则尾数截断
const petById = (id) => {
  const key = id == null ? '' : String(id)
  // '0' 表示该会话 / 消息未绑定宠物（历史脏数据），视为未知
  if (!key || key === '0') return null
  return pets.value.find((p) => petKey(p) === key) || null
}
// 消息展示用的宠物：优先按消息归属的 petId 回溯，找不到时回退当前选中宠物
const msgPet = (msg) => petById(msg.petId) || pet.value
// 会话激活态比较键：会话 ID 为 MySQL 自增小整数，转数字比较安全
const isSessionActive = (s) => currentSessionId.value != null && Number(s.id) === Number(currentSessionId.value)

// 新消息上屏 / 流式追加时把消息区滚到底部
const scrollToBottom = async () => {
  await nextTick()
  const toBottom = () => scrollbarRef.value?.setScrollTop?.(999999)
  toBottom()
  // 富文本与图片渲染会改变内容高度，等一帧再补一次，避免停在"差一屏"的位置
  requestAnimationFrame(toBottom)
}

// 结束一次流式交互：恢复输入态并停在最新消息
const finishStream = () => {
  sending.value = false
  streamCtrl = null
  scrollToBottom()
}

// ---------- 会话与历史 ----------
// 刷新会话列表（用户与所有宠物的历史会话统一展示，无需先选宠物）
const refreshSessions = async () => {
  loadingSessions.value = true
  try {
    const data = await listChatSessions()
    sessions.value = data?.sessions || []
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loadingSessions.value = false
  }
}

// 加载当前会话的历史对话（后端按时间正序返回）
const loadHistory = async (sessionId) => {
  loadingHistory.value = true
  try {
    const data = await getChatHistory(sessionId)
    // 守卫一：await 期间用户可能已切换到别的会话，跳过过期响应避免串会话
    if (currentSessionId.value == null || Number(currentSessionId.value) !== Number(sessionId)) return
    // 守卫二：await 期间用户可能已发送消息并在流式生成中（sending 为 true），
    // 此时整体覆盖 messages 会吞掉进行中的对话气泡，因此直接跳过本次覆盖、
    // 保留当前会话画面（历史不急于这一轮刷新，结束后重进会话即可看到）
    if (sending.value) return
    messages.value = (data?.messages || []).map((m) => ({
      role: m.role,
      content: m.content,
      petId: m.petId || null,
      ts: m.ts,
      // 被用户中止生成的回复在历史里恢复「（已停止）」标记，与停止当下的界面表现一致
      stopped: !!m.interrupted,
      // 多模态附件（仅用户消息，OSS 公网 URL 直接回放）
      attachments: (m.attachments || []).filter((a) => a && a.type && a.url).map((a) => ({ ...a })),
      // RAG 引用来源（仅助手消息）：历史回放同样显示「参考来源」
      refs: (m.refs || []).filter((r) => r && r.source),
    }))
    scrollToBottom()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loadingHistory.value = false
  }
}

// ---------- 初始化 ----------
// 拉取名下宠物与历史会话：默认选中代表宠物（优先虚拟宠物）并打开最近活跃的会话。
// 首次进入与引导弹窗登记成功后都复用这里，登记完即可直接开始咨询
const initPetState = async () => {
  try {
    const [myPet, myPets] = await Promise.all([
      getMyPet().catch(() => null),
      listMyPets().catch(() => []),
    ])
    pets.value = myPets || []
    pet.value =
      (myPet && pets.value.find((p) => petKey(p) === petKey(myPet))) || myPet || pets.value[0] || null
    if (pet.value) {
      await refreshSessions()
      // 默认打开最近活跃的会话（可能属于任意宠物）：同步选中其归属宠物；无会话则展示空咨询页
      if (sessions.value.length) {
        const owner = petById(sessions.value[0].petId)
        if (owner) pet.value = owner
        currentSessionId.value = Number(sessions.value[0].id)
        await loadHistory(currentSessionId.value)
      }
    }
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loadingPet.value = false
  }
}

onMounted(initPetState)

// ---------- 无宠物空态 ----------
// 引导弹窗：先让用户选择登记已有真实宠物还是去图鉴领养虚拟宠物，与首页表现一致
const onboardingVisible = ref(false)
const openOnboarding = () => {
  onboardingVisible.value = true
}

// 登记真实宠物成功后重新拉取宠物列表，页面随即进入可咨询状态
const onRegistered = async () => {
  loadingPet.value = true
  await initPetState()
}

// 组件卸载时中断未完成的流式请求
onUnmounted(() => {
  streamCtrl?.abort()
})

// ---------- 宠物切换 / 会话管理 ----------
// 跨宠物上下文切换的二次确认：当前正与一只宠物对话，切换后将从新对话开始，
// 用弹窗避免用户误触导致当前咨询上下文丢失（点取消保持原状）
const confirmSwitchContext = async () => {
  try {
    await ElMessageBox.confirm(
      '正在回答当前宠物的对话，切换宠物会切换新对话，确定更换吗？',
      '切换确认',
      {
        type: 'warning',
        confirmButtonText: '确定',
        cancelButtonText: '取消',
      },
    )
    return true
  } catch {
    return false
  }
}

// 切换宠物：会话仍按「用户 + 宠物」隔离，切换后进入该宠物的新对话待创建态（懒创建），
// 不立即调建会话接口——否则频繁切换会不断产生空的历史会话记录；
// 真正的会话在用户发出首条消息时由后端按当前宠物自动创建并通过 meta 事件回传。
// 历史会话无需先选宠物：侧栏统一展示与所有宠物的历史对话，点选即回到对应会话。
// 当前正与「绑定宠物」对话时（已打开其历史会话，或新对话里已有往来消息），
// 换宠物会丢弃这段对话并开启新对话，先弹窗确认再切；
// 注意比较基准是当前绑定宠物 pet.value（它始终跟随会话归属同步），
// 不去查会话列表——刚由 meta 创建的会话可能还没刷新进列表，会造成漏弹。
const switchPet = async (p) => {
  if (!p || isPetActive(p)) return
  // 走到这里 p 已确定不是当前绑定宠物；再看是否存在会被丢弃的对话
  if (currentSessionId.value != null || messages.value.length) {
    if (!(await confirmSwitchContext())) return
  }
  // 切换前中断进行中的流式生成，避免回复落入已切走的宠物会话画面
  if (sending.value) handleStop()
  pet.value = p
  currentSessionId.value = null
  messages.value = []
}

// 手动选择历史会话：统一列表跨宠物展示，会话本身绑定宠物，
// 选中时同步当前绑定宠物为该会话的归属宠物，保证顶部信息与后续提问的咨询上下文一致；
// 若目标会话归属的宠物与当前绑定宠物不同，先弹窗确认，确认后绑定宠物切到目标会话
const selectSession = async (s) => {
  if (isSessionActive(s)) return
  // 归属宠物已删除（owner 为 null）时无从比较，保持现有降级行为：直接打开会话
  const owner = petById(s.petId)
  if (owner && !isPetActive(owner)) {
    if (!(await confirmSwitchContext())) return
  }
  if (sending.value) handleStop()
  if (owner) pet.value = owner
  currentSessionId.value = Number(s.id)
  messages.value = []
  await loadHistory(currentSessionId.value)
}

// 新建会话：先置为待创建态，首条消息发送时由后端创建并通过 meta 回传会话 ID
const newSession = () => {
  if (sending.value) handleStop()
  currentSessionId.value = null
  messages.value = []
}

// 删除会话（连带会话下全部消息）
const onDeleteSession = async (s) => {
  try {
    await deleteChatSession(s.id)
    sessions.value = sessions.value.filter((x) => Number(x.id) !== Number(s.id))
    // 删除的是当前会话：自动落到列表中最近活跃的会话，没有则回到新对话待创建态
    if (isSessionActive(s)) {
      if (sending.value) handleStop()
      messages.value = []
      if (sessions.value.length) {
        currentSessionId.value = Number(sessions.value[0].id)
        await loadHistory(currentSessionId.value)
      } else {
        currentSessionId.value = null
      }
    }
    ElMessage.success('会话已删除')
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// ---------- 移动端会话/宠物选择面板 ----------
// 手机布局直接展示对话，咨询对象与会话记录收进右上角弹层；
// 选择后统一收起面板，避免遮挡聊天内容
const mobilePanelVisible = ref(false)
const onMobileSwitchPet = async (p) => {
  await switchPet(p)
  mobilePanelVisible.value = false
}
const onMobileSelectSession = async (s) => {
  await selectSession(s)
  mobilePanelVisible.value = false
}
const onMobileNewSession = () => {
  newSession()
  mobilePanelVisible.value = false
}
const onMobileMemories = () => {
  mobilePanelVisible.value = false
  openMemories()
}
// 弹层与确认框叠层：先确认再删除，删除后收起面板
const onMobileDeleteSession = async (s) => {
  try {
    await ElMessageBox.confirm('删除该会话及全部记录？', '删除会话', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  mobilePanelVisible.value = false
  await onDeleteSession(s)
}

// ---------- 长期记忆管理 ----------
const memoryVisible = ref(false) // 记忆管理弹窗可见
const loadingMemories = ref(false) // 记忆列表加载中
const memories = ref([]) // 全部长期记忆（最近更新在前）

// 记忆归类标签（与后端 kind 枚举对应）
const KIND_LABELS = { preference: '偏好', habit: '习性', fact: '事实' }

// 记忆更新时间（秒）转 YYYY-MM-DD HH:mm
const formatMemoryTime = (ts) => {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 记忆分组：我的偏好（用户级）在前，宠物级按 petId 分组在后；
// 宠物名优先 petById 映射（实时），写入时快照 petName 兼，宠物已删除时归「通用记忆」
const memoryGroups = computed(() => {
  const groups = []
  const mine = memories.value.filter((m) => m.scope === 'user')
  if (mine.length) {
    groups.push({ title: '我的偏好', items: mine })
  }
  const petMap = new Map()
  for (const m of memories.value) {
    if (m.scope !== 'pet') continue
    const key = String(m.petId || '0')
    if (!petMap.has(key)) petMap.set(key, [])
    petMap.get(key).push(m)
  }
  for (const [petId, items] of petMap) {
    const p = petById(petId)
    groups.push({ title: p ? `${p.name}的记忆` : '通用记忆', items })
  }
  return groups
})

// 打开记忆弹窗：拉取最新列表
const openMemories = async () => {
  memoryVisible.value = true
  loadingMemories.value = true
  try {
    const data = await getChatMemories()
    memories.value = data?.memories || []
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loadingMemories.value = false
  }
}

// 删除单条长期记忆（带确认）
const onDeleteMemory = async (m) => {
  try {
    await ElMessageBox.confirm('删除这条记忆后，AI 将不再记得该信息，确定删除？', '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await deleteChatMemory(m.key, m.scope, m.scope === 'pet' ? m.petId : undefined)
    memories.value = memories.value.filter((x) => x.key !== m.key)
    if (!memories.value.length) ElMessage.success('记忆已删除')
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// ---------- 发送与流式渲染 ----------
const handleSend = () => {
  const text = inputText.value.trim()
  // 生成中不允许再次发送；文字与已上传成功的附件至少其一
  const readyFiles = pendingFiles.value.filter((f) => f.att && !f.failed)
  if (sending.value || !pet.value) return
  if (!text && !readyFiles.length) return
  inputText.value = ''
  const attachments = readyFiles.map((f) => ({ ...f.att }))
  clearPendingFiles()
  sendText(text, attachments)
}

// 失败重发：移除尾部失败的这一轮（失败的助手气泡 + 其对应的用户消息）后重新发送原文。
// 说明：后端发 error 事件时不会落库本轮内容，重发不会造成重复；
// 网络中断场景后端可能已兑底保存部分回复，重发会在历史中多出一条记录，属可接受的轻量代价。
const regenerate = (idx) => {
  if (sending.value) return
  const msg = messages.value[idx]
  if (!msg || msg.role !== 'assistant' || !msg.failed) return
  // 向前找本轮对应的用户消息（重发时一并移除，避免消息重复上屏）
  let userIdx = -1
  for (let i = idx - 1; i >= 0; i--) {
    if (messages.value[i].role === 'user') { userIdx = i; break }
  }
  if (userIdx < 0) return
  const userMsg = messages.value[userIdx]
  const text = (userMsg.content || '').trim()
  // 重发携带原轮的全部附件（附件已上传过，直接复用附件信息）
  if (!text && !(userMsg.attachments || []).length) return
  messages.value.splice(userIdx)
  sendText(text, (userMsg.attachments || []).map((a) => ({ ...a })))
}

const sendText = (text, attachments = []) => {
  // 用户消息立即上屏（乐观渲染），并写入本地会话状态数组；petId 用于回显本轮咨询的宠物
  messages.value.push({
    role: 'user', content: text, petId: pet.value.id, ts: nowSec(),
    attachments: attachments.filter((a) => a && a.type && a.url),
  })
  // 顾问侧先出现「思考中」占位气泡，首个 delta 到达后替换为流式文本
  messages.value.push({ role: 'assistant', content: '', thinking: true, refs: [], ts: nowSec() })
  sending.value = true
  scrollToBottom()

  // 按后端接口契约组装宠物画像（作为咨询上下文）
  const petPayload = {
    id: pet.value.id,
    name: pet.value.name,
    species: pet.value.species,
    breed: pet.value.breed,
    // 档案年龄按生日换算后精确下发（age 整岁 + ageText 含月龄文本，与身份卡展示一致）；
    // 真实宠物的 pet.age 列恒为 0，直接下发会让 AI 误判成 0 岁
    ...petAgeInfo(pet.value),
    level: pet.value.level,
    signStreak: pet.value.signStreak,
    description: pet.value.description,
    // 健康信息（猫/狗身份卡维护）随咨询上下文一并发送，供顾问给出针对性建议；
    // 未填写的字段为 null / 空串，过滤掉后再发送，避免后端参数校验失败
    health: Object.fromEntries(
      Object.entries({
        weight: petHealthText(pet.value, 'weight', true),
        bcs: petHealthText(pet.value, 'bcs', true),
        deworming: petHealthText(pet.value, 'deworming', true),
        specialPeriod: petHealthText(pet.value, 'specialPeriod', true),
        vaccine: petHealthText(pet.value, 'vaccine', true),
        rearingMethod: petHealthText(pet.value, 'rearingMethod', true),
        medicalHistory: petHealthText(pet.value, 'medicalHistory', true),
      }).filter(([, v]) => v != null && v !== ''),
    ),
  }

  streamCtrl = chatStream({
    message: text,
    pet: petPayload,
    sessionId: currentSessionId.value,
    attachments,
    onMeta: ({ sessionId }) => {
      // 首帧 meta：后端自动新建会话后回传会话 ID，前端绑定并刷新会话列表
      if (sessionId == null) return
      currentSessionId.value = Number(sessionId)
      refreshSessions()
    },
    onRefs: (items) => {
      // RAG 检索来源（在答案首字之前到达）：挂到当前助手气泡上，渲染「参考来源」
      const last = messages.value[messages.value.length - 1]
      if (last?.role === 'assistant') last.refs = items || []
    },
    onDelta: (content) => {
      const last = messages.value[messages.value.length - 1]
      if (!last || last.role !== 'assistant') return
      // 首个增量：把「思考中」气泡切换为文本气泡
      if (last.thinking) {
        last.thinking = false
        last.content = ''
      }
      // 打字机效果：逐段追加流式文本
      last.content += content
      scrollToBottom()
    },
    onDone: () => {
      // 结束时仍无任何内容：移除空气泡并轻提示
      const last = messages.value[messages.value.length - 1]
      if (last?.role === 'assistant' && !last.content && !last.error) {
        messages.value.pop()
        ElMessage.warning('顾问暂时没有回应，换个说法试试吧')
      }
      finishStream()
      // 会话标题由后端用首条消息自动命名，结束后刷新列表展示最新标题
      refreshSessions()
    },
    onRetry: (attempt) => {
      // 连接阶段自动重连（网络闪断）：轻提示安抚，不打断界面
      ElMessage({ message: `网络波动，正在自动重连（第 ${attempt} 次）...`, type: 'info', duration: 2000 })
    },
    onError: (msg) => {
      // 失败时保留气泡并标记 failed，提供「重新生成」入口：
      // 思考占位气泡转为失败态，已有部分内容的气泡追加错误说明
      const last = messages.value[messages.value.length - 1]
      if (last?.role === 'assistant') {
        last.thinking = false
        last.error = msg
        last.failed = true
      }
      ElMessage.error(msg)
      finishStream()
    },
  })
}

// 停止生成：中断请求，保留已生成的部分并标注「（已停止）」
const handleStop = () => {
  streamCtrl?.abort()
  const last = messages.value[messages.value.length - 1]
  if (last?.role === 'assistant') {
    if (last.thinking) {
      // 还在思考中就被停止：直接移除占位气泡
      messages.value.pop()
    } else {
      last.stopped = true
    }
  }
  finishStream()
}

// Enter 发送、Shift+Enter 换行；输入法组合确认的 Enter 不触发发送
const onEnterKey = (e) => {
  if (e.isComposing || e.keyCode === 229) return
  if (e.shiftKey) return
  e.preventDefault()
  handleSend()
}
</script>

<template>
  <div class="page">
    <div class="page-container">
      <!-- 宠物信息加载中 -->
      <el-card v-if="loadingPet" shadow="never" class="chat-card">
        <el-skeleton :rows="6" animated />
      </el-card>

      <!-- 无宠物：引导登记已有宠物或去图鉴领养 -->
      <el-card v-else-if="!pet" shadow="never" class="chat-card empty-card">
        <el-result
          icon="info"
          title="还没有宠物"
          sub-title="登记你已有的宠物，或从图鉴领养一只虚拟伙伴，再回来咨询它的健康与习性"
        >
          <template #extra>
            <el-button type="primary" size="large" round @click="openOnboarding">
              去领养宠物
            </el-button>
          </template>
        </el-result>
      </el-card>

      <!-- 对话主体：左侧宠物 / 会话侧栏 + 右侧聊天区 -->
      <el-card v-else shadow="never" class="chat-card">
        <div class="chat-layout">
          <!-- 侧栏：宠物切换（咨询对象） + 用户与所有宠物的统一会话列表 -->
          <aside class="chat-sidebar">
            <div class="side-section">
              <div class="side-title">咨询对象</div>
              <el-scrollbar class="pet-scroll">
                <div
                  v-for="p in pets"
                  :key="p.id"
                  class="pet-item"
                  :class="{ active: isPetActive(p) }"
                  @click="switchPet(p)"
                >
                  <el-avatar :size="34" :src="p.imageUrl || ''" class="pet-item-avatar">
                    {{ (p.name || '宠')[0] }}
                  </el-avatar>
                  <div class="pet-item-info">
                    <div class="pet-item-name">{{ p.name }}</div>
                    <div class="pet-item-sub">{{ petLine(p) }}</div>
                  </div>
                </div>
              </el-scrollbar>
            </div>

            <div class="side-section session-section">
              <div class="side-title-row">
                <span class="side-title">会话记录</span>
                <div class="side-actions">
                  <el-tooltip content="长期记忆" placement="top">
                    <el-button size="small" round :icon="Collection" @click="openMemories" />
                  </el-tooltip>
                  <el-button size="small" round :icon="Plus" @click="newSession">新会话</el-button>
                </div>
              </div>
              <el-scrollbar class="session-scroll">
                <div v-if="loadingSessions" class="session-empty">加载中...</div>
                <div v-else-if="!sessions.length" class="session-empty">暂无历史会话</div>
                <div
                  v-for="s in sessions"
                  :key="s.id"
                  class="session-item"
                  :class="{ active: isSessionActive(s) }"
                  @click="selectSession(s)"
                >
                  <span v-if="petById(s.petId)" class="session-pet">
                    {{ petById(s.petId).name }}
                  </span>
                  <span class="session-title">{{ s.title || '新会话' }}</span>
                  <el-popconfirm
                    title="删除该会话及全部记录？"
                    confirm-button-text="删除"
                    cancel-button-text="取消"
                    width="220"
                    @confirm="onDeleteSession(s)"
                  >
                    <template #reference>
                      <el-icon class="session-del" @click.stop><Delete /></el-icon>
                    </template>
                  </el-popconfirm>
                </div>
              </el-scrollbar>
            </div>
          </aside>

          <!-- 右侧聊天区 -->
          <div class="chat-main">
            <!-- 顶部宠物信息条 -->
            <div class="chat-topbar">
              <div class="pet-avatar-wrap">
                <el-avatar :size="44" :src="pet.imageUrl || ''" class="pet-avatar">
                  {{ (pet.name || '宠')[0] }}
                </el-avatar>
                <!-- 可用状态点：纯装饰，表示顾问随时可以咨询 -->
                <span class="pet-online" aria-hidden="true"></span>
              </div>
              <div class="pet-brief">
                <div class="name-row">
                  <span class="pet-name">{{ pet.name }}</span>
                  <!-- 真实宠物为纯档案，不展示等级 -->
                  <el-tag v-if="pet.type !== 'REAL'" effect="dark" round class="lv-tag">
                    Lv.{{ pet.level }}
                  </el-tag>
                </div>
                <p class="pet-sub">AI 养宠顾问 · 健康、喂养、行为问题随时问</p>
              </div>

              <!-- 手机端：咨询对象 + 会话记录收进右上角弹层，页面主体直接展示对话 -->
              <el-popover
                v-model:visible="mobilePanelVisible"
                placement="bottom-end"
                trigger="click"
                :width="300"
                :offset="8"
                popper-class="petchat-mobile-popover"
              >
                <template #reference>
                  <el-button
                    class="mobile-panel-btn"
                    round
                    :icon="Menu"
                    aria-label="打开咨询对象与会话记录"
                  >
                    会话
                  </el-button>
                </template>

                <div class="mobile-panel">
                  <div class="mp-section">
                    <div class="mp-title">咨询对象</div>
                    <div class="mp-pets">
                      <button
                        v-for="p in pets"
                        :key="p.id"
                        type="button"
                        class="mp-pet"
                        :class="{ active: isPetActive(p) }"
                        @click="onMobileSwitchPet(p)"
                      >
                        <el-avatar :size="32" :src="p.imageUrl || ''" class="pet-item-avatar">
                          {{ (p.name || '宠')[0] }}
                        </el-avatar>
                        <span class="mp-pet-info">
                          <span class="mp-pet-name">{{ p.name }}</span>
                          <span class="mp-pet-sub">{{ petLine(p) }}</span>
                        </span>
                        <span v-if="isPetActive(p)" class="mp-pet-current">当前</span>
                      </button>
                    </div>
                  </div>

                  <div class="mp-section">
                    <div class="mp-title-row">
                      <span class="mp-title">会话记录</span>
                      <div class="mp-actions">
                        <el-button
                          size="small"
                          round
                          :icon="Collection"
                          aria-label="长期记忆"
                          @click="onMobileMemories"
                        >
                          记忆
                        </el-button>
                        <el-button size="small" round :icon="Plus" @click="onMobileNewSession">
                          新会话
                        </el-button>
                      </div>
                    </div>
                    <div class="mp-sessions">
                      <div v-if="loadingSessions" class="session-empty">加载中...</div>
                      <div v-else-if="!sessions.length" class="session-empty">暂无历史会话</div>
                      <button
                        v-for="s in sessions"
                        :key="s.id"
                        type="button"
                        class="mp-session"
                        :class="{ active: isSessionActive(s) }"
                        @click="onMobileSelectSession(s)"
                      >
                        <span v-if="petById(s.petId)" class="session-pet">
                          {{ petById(s.petId).name }}
                        </span>
                        <span class="session-title">{{ s.title || '新会话' }}</span>
                        <el-icon
                          class="session-del mp-session-del"
                          aria-label="删除会话"
                          @click.stop="onMobileDeleteSession(s)"
                        >
                          <Delete />
                        </el-icon>
                      </button>
                    </div>
                  </div>
                </div>
              </el-popover>
            </div>

            <!-- 消息列表 -->
            <div class="chat-body">
              <el-skeleton v-if="loadingHistory" :rows="5" animated class="history-skeleton" />
              <el-scrollbar v-else ref="scrollbarRef" class="msg-scroll">
                <!-- 空会话欢迎占位：头像 + 引导文案 + 推荐问题 -->
                <div v-if="!messages.length" class="empty-talk">
                  <el-avatar :size="76" :src="pet.imageUrl || ''" class="empty-avatar">
                    {{ (pet.name || '宠')[0] }}
                  </el-avatar>
                  <p class="empty-title">开始一段新的咨询</p>
                  <p class="empty-sub">
                    向 AI 养宠顾问咨询 {{ pet.name }} 的健康、习性、喂养等问题吧
                  </p>
                  <div class="empty-suggests">
                    <button
                      v-for="q in QUICK_PROMPTS"
                      :key="q"
                      type="button"
                      class="suggest-chip"
                      @click="usePrompt(q)"
                    >
                      {{ q }}
                    </button>
                  </div>
                </div>

                <!-- 消息气泡：按角色分组，组首给身份与时间，组尾给用户侧时间 -->
                <div
                  v-for="view in messageViews"
                  :key="view.idx"
                  class="msg-row"
                  :class="[
                    view.msg.role === 'user' ? 'mine' : 'ai',
                    { 'group-start': view.groupStart, 'group-end': view.groupEnd },
                  ]"
                >
                  <!-- AI 头像：只在组首出现，其余行用等宽占位保持气泡左对齐 -->
                  <div v-if="view.msg.role === 'assistant'" class="msg-avatar-slot">
                    <div v-if="view.groupStart" class="msg-avatar-wrap">
                      <el-avatar
                        :size="34"
                        :src="msgPet(view.msg)?.imageUrl || ''"
                        class="msg-avatar"
                      >
                        {{ (msgPet(view.msg)?.name || '宠')[0] }}
                      </el-avatar>
                      <span class="msg-avatar-badge" aria-hidden="true">AI</span>
                    </div>
                  </div>
                  <div class="bubble-col">
                    <!-- 顾问身份行：只在组首出现，避免长回答下方重复同一行信息 -->
                    <div v-if="view.msg.role === 'assistant' && view.groupStart" class="msg-meta">
                      <span class="msg-role">AI 养宠顾问</span>
                      <span v-if="view.msg.ts" class="msg-time">{{ formatMsgTime(view.msg.ts) }}</span>
                    </div>
                    <div class="bubble" :class="{ thinking: view.msg.thinking, failed: view.msg.failed }">
                      <!-- 思考中：三个跳动圆点 -->
                      <template v-if="view.msg.thinking">
                        <span class="dot"></span>
                        <span class="dot"></span>
                        <span class="dot"></span>
                      </template>
                      <template v-else>
                        <!-- 用户消息的多模态附件：图片（点击放大）/ 视频 / 音频（含转写文本） -->
                        <div
                          v-if="view.msg.role === 'user' && view.msg.attachments?.length"
                          class="bubble-media"
                        >
                          <template v-for="(att, aIdx) in view.msg.attachments" :key="aIdx">
                            <el-image
                              v-if="att.type === 'image'"
                              :src="att.url"
                              :preview-src-list="[att.url]"
                              fit="cover"
                              hide-on-click-modal
                              class="media-img"
                              preview-teleported
                            />
                            <video
                              v-else-if="att.type === 'video'"
                              :src="att.url"
                              controls
                              preload="metadata"
                              class="media-video"
                            ></video>
                            <div v-else-if="att.type === 'audio'" class="media-audio">
                              <div class="audio-name">{{ att.name || '语音消息' }}</div>
                              <audio :src="att.url" controls preload="metadata" class="audio-player"></audio>
                              <div v-if="att.transcript" class="audio-transcript">
                                转写：{{ att.transcript }}
                              </div>
                            </div>
                          </template>
                        </div>
                        <span v-if="view.msg.content && view.msg.role === 'user'" class="bubble-text">{{ view.msg.content }}</span>
                        <!-- eslint-disable-next-line vue/no-v-html -- 内容已过 DOMPurify -->
                        <div v-else-if="view.msg.content" class="bubble-md" v-html="renderMd(view.msg.content)"></div>
                        <span v-if="view.msg.stopped" class="stop-mark">（已停止）</span>
                        <span v-if="view.msg.error" class="err-mark">{{ view.msg.error }}</span>
                      </template>
                    </div>
                    <!-- RAG 引用来源：这条回答依据的知识库文档（文档名 / 类型 / 小节 / 相关度） -->
                    <div
                      v-if="view.msg.role === 'assistant' && !view.msg.thinking && view.msg.refs?.length"
                      class="refs"
                    >
                      <button type="button" class="refs-toggle" @click="toggleRefs(view.idx)">
                        <el-icon><Collection /></el-icon>
                        <span>参考来源 {{ view.msg.refs.length }} 篇</span>
                        <el-icon class="refs-arrow" :class="{ open: openedRefs.has(view.idx) }">
                          <ArrowDown />
                        </el-icon>
                      </button>
                      <div v-show="openedRefs.has(view.idx)" class="refs-list">
                        <div v-for="r in view.msg.refs" :key="r.rank" class="ref-item">
                          <span class="ref-rank">[{{ r.rank }}]</span>
                          <div class="ref-main">
                            <div class="ref-head">
                              <el-tag size="small" effect="plain" :type="kbKindType(r.kind)">
                                {{ kbKindLabel(r.kind) }}
                              </el-tag>
                              <span class="ref-title">{{ r.docTitle }}</span>
                              <span class="ref-score">相关度 {{ kbScoreText(r.score) }}</span>
                            </div>
                            <div v-if="r.section || r.category" class="ref-section">
                              {{ [r.category, r.section].filter(Boolean).join(' · ') }}
                            </div>
                            <div v-if="r.snippet" class="ref-snippet">{{ r.snippet }}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <!-- 失败气泡：一键重新生成本轮回复 -->
                    <el-button
                      v-if="view.msg.failed && !sending"
                      size="small"
                      round
                      class="regen-btn"
                      @click="regenerate(view.idx)"
                    >重新生成</el-button>
                    <!-- 用户侧只给时间，不给头像与昵称：不展示任何个人信息 -->
                    <span
                      v-if="view.msg.role === 'user' && view.groupEnd && view.msg.ts"
                      class="msg-time msg-time-mine"
                    >{{ formatMsgTime(view.msg.ts) }}</span>
                  </div>
                </div>
              </el-scrollbar>
            </div>

            <!-- 底部输入区：墨色玻璃胶囊（深色磨砂 + 高光描边，呼应参考稿的输入条质感） -->
            <div class="chat-input pv-glass-ink">
              <!-- 待发送附件条：选择后立即上传，全部就绪即可随消息一并发出 -->
              <div v-if="pendingFiles.length" class="pending-files">
                <div
                  v-for="f in pendingFiles"
                  :key="f.id"
                  class="pending-file"
                  :class="{ failed: f.failed }"
                >
                  <img v-if="f.kind === 'image' && f.previewUrl" :src="f.previewUrl" class="pf-thumb" alt="" />
                  <div v-else class="pf-kind">{{ MEDIA_RULES[f.kind]?.label || '附件' }}</div>
                  <div class="pf-info">
                    <div class="pf-name">{{ f.name }}</div>
                    <div class="pf-sub">
                      {{ MEDIA_RULES[f.kind]?.label }} · {{ formatSize(f.size) }}
                    </div>
                  </div>
                  <span v-if="f.uploading" class="pf-state">上传中...</span>
                  <span v-else-if="f.failed" class="pf-state failed">上传失败</span>
                  <el-icon class="pf-remove" @click="removePendingFile(f)"><Delete /></el-icon>
                </div>
              </div>
              <div class="input-row">
                <el-tooltip content="添加图片 / 音频 / 视频" placement="top">
                  <el-button
                    round
                    :icon="Paperclip"
                    class="attach-btn"
                    :disabled="sending"
                    aria-label="添加图片、音频或视频"
                    @click="pickFiles"
                  />
                </el-tooltip>
                <el-input
                  ref="inputRef"
                  v-model="inputText"
                  type="textarea"
                  :autosize="{ minRows: 1, maxRows: 4 }"
                  resize="none"
                  maxlength="2000"
                  :placeholder="inputPlaceholder"
                  class="chat-textarea"
                  @keydown.enter="onEnterKey"
                />
                <el-button
                  v-if="!sending"
                  type="primary"
                  round
                  class="send-btn"
                  :disabled="!inputText.trim() && !readyAttachmentCount"
                  @click="handleSend"
                >
                  发送
                </el-button>
                <el-button v-else round class="send-btn stop-btn" @click="handleStop">停止</el-button>
              </div>
              <!-- 输入提示行：桌面端给快捷键与字数；移动端只在有内容时显示字数，
                   空输入时整行收起，避免胶囊底部多出一条空白 -->
              <div v-if="inputText.length || !isNarrow" class="composer-hint">
                <span class="hint-keys">Enter 发送 · Shift + Enter 换行</span>
                <span v-if="inputText.length" class="hint-count">{{ inputText.length }}/2000</span>
              </div>
              <!-- 隐藏的附件选择输入框（accept 限定图片 / 音频 / 视频，可多选） -->
              <input
                ref="fileInputRef"
                type="file"
                :accept="MEDIA_ACCEPT"
                multiple
                hidden
                @change="onFilesChosen"
              />
            </div>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 长期记忆管理弹窗：AI 跨会话记住的用户 / 宠物偏好，可查看与删除 -->
    <el-dialog
      v-model="memoryVisible"
      title="AI 长期记忆"
      width="560px"
      append-to-body
    >
      <div v-loading="loadingMemories" class="memory-body">
        <p class="memory-tip">AI 在对话中沉淀的长期记忆（跨会话生效），删除后不再被引用</p>
        <template v-if="memoryGroups.length">
          <div v-for="group in memoryGroups" :key="group.title" class="memory-group">
            <div class="memory-group-title">{{ group.title }}</div>
            <div v-for="m in group.items" :key="m.key" class="memory-item">
              <el-tag size="small" effect="plain" round class="memory-kind">
                {{ KIND_LABELS[m.kind] || '偏好' }}
              </el-tag>
              <span class="memory-content">{{ m.content }}</span>
              <span class="memory-time">{{ formatMemoryTime(m.updatedAt) }}</span>
              <el-icon class="memory-del" @click="onDeleteMemory(m)"><Delete /></el-icon>
            </div>
          </div>
        </template>
        <div v-else-if="!loadingMemories" class="memory-empty">
          多和 AI 聊聊，它会慢慢记住你和宠物的偏好
        </div>
      </div>
    </el-dialog>

    <!-- 无宠物时的引导弹窗：选择登记真实宠物或跳转图鉴领养虚拟宠物 -->
    <PetOnboardingDialog
      v-model="onboardingVisible"
      :add-mode="pets.length > 0"
      @registered="onRegistered"
    />
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
}
.chat-card {
  overflow: hidden;
}
.chat-card :deep(.el-card__body) {
  padding: 0;
}
.empty-card :deep(.el-card__body) {
  padding: 48px 24px;
}

/* ---------- 整体布局：左侧栏 + 右聊天区 ---------- */
/* 固定为视口高度：侧栏会话再多也只在其内部滚动，不会撑高页面把右侧聊天区顶上去 */
.chat-layout {
  display: flex;
  align-items: stretch;
  height: calc(100vh - 162px);
  min-height: 480px;
}

/* ---------- 侧栏 ---------- */
/* 侧栏是"目录"层：比聊天区更轻，避免与消息抢注意力 */
.chat-sidebar {
  width: 256px;
  flex-shrink: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid var(--pv-border);
  background: rgba(255, 255, 255, 0.32);
}
.side-section {
  padding: 16px 12px;
}
.session-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--pv-border);
}
.side-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: var(--pv-text-secondary);
  padding: 0 4px;
  margin-bottom: 10px;
}
.side-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
  margin-bottom: 10px;
}
.side-title-row .side-title {
  margin-bottom: 0;
}
.side-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 宠物列表项 */
.pet-scroll {
  max-height: 190px;
}
.pet-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 10px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.15s;
}
.pet-item:hover {
  background: rgba(255, 255, 255, 0.55);
}
/* 选中态做成一片浮起来的小玻璃：底色 + 高光边 + 轻投影，比单纯变色更明确 */
.pet-item.active {
  background: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 0 1px rgba(104, 120, 150, 0.12), 0 8px 18px -14px rgba(24, 32, 48, 0.5);
}
.pet-item-avatar {
  flex-shrink: 0;
  font-size: 13px;
}
.pet-item-info {
  flex: 1;
  min-width: 0;
}
.pet-item-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--pv-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pet-item-sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--pv-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 会话列表项：占满侧栏剩余高度，条目多时仅在其内部滚动 */
.session-scroll {
  flex: 1;
  min-height: 0;
}
.session-empty {
  padding: 10px 6px;
  font-size: 12px;
  color: var(--pv-text-secondary);
  text-align: center;
}
.session-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 10px;
  margin-bottom: 4px;
  border-radius: 10px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.15s, border-color 0.15s;
}
.session-item:hover {
  background: rgba(255, 255, 255, 0.55);
}
.session-item.active {
  background: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 0 1px rgba(104, 120, 150, 0.1);
}
/* 当前会话的左侧墨色竖条：列表里一眼定位"正在看哪一条" */
.session-item.active::before {
  content: '';
  position: absolute;
  left: 3px;
  top: 50%;
  width: 3px;
  height: 16px;
  border-radius: 2px;
  background: var(--pv-ink);
  transform: translateY(-50%);
}
.session-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--pv-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 会话归属宠物小标签：统一列表跨宠物展示，标注该会话属于哪只宠物 */
.session-pet {
  flex-shrink: 0;
  max-width: 64px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 18px;
  padding: 0 6px;
  border-radius: 6px;
  color: var(--pv-text-secondary);
  background: var(--pv-tint);
  border: 1px solid var(--pv-border);
}
.session-item.active .session-title {
  font-weight: 600;
}
.session-del {
  flex-shrink: 0;
  font-size: 14px;
  color: var(--pv-text-secondary);
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}
.session-item:hover .session-del {
  opacity: 1;
}
.session-del:hover {
  color: var(--el-color-danger, #c45656);
}

/* ---------- 右侧聊天区 ---------- */
.chat-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 顶部宠物信息条 */
.chat-topbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 24px;
  border-bottom: 1px solid var(--pv-border);
}
.pet-avatar-wrap {
  position: relative;
  flex-shrink: 0;
  display: flex;
}
.pet-avatar {
  flex-shrink: 0;
  border: 3px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 10px 22px -14px rgba(24, 32, 48, 0.5), 0 0 0 1px rgba(104, 120, 150, 0.1);
  font-size: 16px;
}
/* 可用状态点：压在头像右下角，给标题条一点"活着"的细节 */
.pet-online {
  position: absolute;
  right: 1px;
  bottom: 1px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #45a97a;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.95);
}
.pet-brief {
  flex: 1;
  min-width: 0;
}
.name-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
  min-width: 0;
}
.pet-name {
  min-width: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--pv-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lv-tag {
  background: var(--pv-ink);
  border: none;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.pet-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--pv-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- 手机端右上角入口 + 选择面板 ---------- */
.mobile-panel-btn {
  display: none;
  flex-shrink: 0;
}
.mobile-panel {
  width: 100%;
}
.mp-section + .mp-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--pv-border);
}
.mp-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--pv-text-secondary);
  margin-bottom: 8px;
}
.mp-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.mp-title-row .mp-title {
  margin-bottom: 0;
}
.mp-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mp-actions .el-button + .el-button {
  margin-left: 0;
}
.mp-pets,
.mp-sessions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}
.mp-pets {
  max-height: 176px;
}
.mp-sessions {
  max-height: 220px;
}
.mp-pet,
.mp-session {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  font: inherit;
  color: var(--pv-text);
  text-align: left;
  cursor: pointer;
}
.mp-pet:hover,
.mp-session:hover {
  background: var(--pv-tint);
}
.mp-pet.active,
.mp-session.active {
  background: var(--pv-tint);
  border-color: var(--pv-border);
}
.mp-pet-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mp-pet-name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mp-pet-sub {
  font-size: 11px;
  color: var(--pv-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mp-pet-current {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--pv-text-secondary);
  background: var(--pv-tint);
  border: 1px solid var(--pv-border);
}
.mp-session {
  padding: 9px 10px;
}
.mp-session .mp-session-del {
  opacity: 1;
}
.mp-session.active .session-title {
  font-weight: 600;
}

/* ---------- 消息列表 ---------- */
/* 消息区：占满右栏剩余高度，消息多时仅在其内部滚动 */
.chat-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 24px 4px;
}
.history-skeleton {
  padding: 8px 0;
}
/* 宽屏下把对话收进 880px：一行文字过长会明显影响阅读效率 */
.msg-scroll {
  flex: 1;
  min-height: 0;
  width: 100%;
  max-width: 880px;
  margin: 0 auto;
}
/* 让内容在消息区里纵向铺满：空态可以真正居中，消息多时又照常撑高 */
.msg-scroll :deep(.el-scrollbar__view) {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: 8px 4px 8px;
}

/* 空会话欢迎占位 */
.empty-talk {
  flex: 1;
  min-height: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  text-align: center;
}
.empty-avatar {
  border: 3px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 20px 44px -22px rgba(24, 32, 48, 0.55), 0 0 0 1px rgba(104, 120, 150, 0.12);
  font-size: 26px;
  margin-bottom: 16px;
}
.empty-title {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.2px;
  color: var(--pv-text);
}
.empty-sub {
  margin-top: 6px;
  max-width: 420px;
  font-size: 13px;
  line-height: 1.65;
  color: var(--pv-text-secondary);
}
/* 推荐问题：把"不知道问什么"的空白成本降到一次点击 */
.empty-suggests {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 20px;
  max-width: 480px;
}
.suggest-chip {
  padding: 8px 15px;
  border-radius: 999px;
  border: 1px solid var(--pv-border);
  background: rgba(255, 255, 255, 0.66);
  color: var(--pv-text);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: transform 0.18s ease, background 0.18s ease, border-color 0.18s ease,
    box-shadow 0.18s ease;
}
.suggest-chip:hover {
  background: #fff;
  border-color: var(--pv-ink);
  transform: translateY(-1px);
  box-shadow: 0 10px 22px -16px rgba(24, 32, 48, 0.6);
}
.suggest-chip:active {
  transform: translateY(0);
}
.suggest-chip:focus-visible {
  outline: 2px solid rgba(23, 24, 28, 0.55);
  outline-offset: 2px;
}

/* ---------- 气泡行 ---------- */
/* 间距节奏：同角色连续消息贴紧（8px），换角色时拉开（22px），一屏里能看出"谁在说" */
.msg-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.msg-row + .msg-row {
  margin-top: 8px;
}
.msg-row + .msg-row.group-start {
  margin-top: 22px;
}
.msg-row.mine {
  justify-content: flex-end;
}

/* 头像槽：组内后续消息不重复显示头像，但保留等宽占位，气泡左缘始终对齐 */
.msg-avatar-slot {
  width: 34px;
  flex-shrink: 0;
  /* 与「顾问名 + 时间」那一行等高，头像顶边正好贴在气泡顶边 */
  padding-top: 24px;
}
.msg-avatar-wrap {
  position: relative;
  width: 34px;
  height: 34px;
}
.msg-avatar {
  font-size: 13px;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.9), 0 6px 14px -10px rgba(24, 32, 48, 0.5);
}
/* 头像角标：把"这是 AI 说的"标在身份标记上，而不是靠气泡颜色猜 */
.msg-avatar-badge {
  position: absolute;
  right: -4px;
  bottom: -4px;
  padding: 0 4px;
  height: 14px;
  line-height: 14px;
  border-radius: 7px;
  background: var(--pv-ink);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.2px;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.95);
}

.bubble-col {
  display: flex;
  flex-direction: column;
  max-width: 74%;
  min-width: 0;
}
.msg-row.mine .bubble-col {
  align-items: flex-end;
}

/* 顾问身份行：只在组首出现 */
.msg-meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 6px 2px;
}
.msg-role {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.3px;
  color: var(--pv-text-secondary);
}

/* 气泡本体：统一的圆角尺度与行高，只靠"材质 + 朝向"区分角色 */
.bubble {
  padding: 11px 15px;
  border-radius: 18px;
  font-size: 14px;
  line-height: 1.68;
  word-break: break-word;
  white-space: pre-wrap;
}
/* 顾问气泡：奶白玻璃纸，靠左，靠近头像的一角收紧 */
.msg-row.ai .bubble {
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.9);
  border-radius: 6px 18px 18px 18px;
  color: var(--pv-text);
  box-shadow: 0 0 0 1px rgba(104, 120, 150, 0.1), 0 12px 26px -20px rgba(24, 32, 48, 0.5);
}
/* 用户气泡：墨色实心，靠右，右下角收紧并带一层内高光 */
.msg-row.mine .bubble {
  background: linear-gradient(145deg, #2d313c 0%, #14161c 100%);
  border-radius: 18px 18px 6px 18px;
  color: #f6f7fa;
  box-shadow: 0 12px 26px -16px rgba(18, 22, 32, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.14);
}
/* AI 回复的 markdown 富文本：覆盖气泡的 pre-wrap，避免段落间出现多余空行 */
.bubble-md {
  white-space: normal;
}
.bubble-md :deep(*) {
  margin-top: 0;
}
.bubble-md :deep(* + *) {
  margin-top: 6px;
}
.bubble-md :deep(ul),
.bubble-md :deep(ol) {
  padding-left: 20px;
  margin: 6px 0;
}
.bubble-md :deep(li + li) {
  margin-top: 2px;
}
.bubble-md :deep(h1),
.bubble-md :deep(h2),
.bubble-md :deep(h3),
.bubble-md :deep(h4) {
  margin: 12px 0 4px;
  font-size: 15px;
  font-weight: 700;
  color: var(--pv-text);
}
.bubble-md :deep(h1:first-child),
.bubble-md :deep(h2:first-child),
.bubble-md :deep(h3:first-child) {
  margin-top: 0;
}
.bubble-md :deep(table) {
  width: 100%;
  margin: 8px 0;
  border-collapse: collapse;
  font-size: 13px;
  display: block;
  overflow-x: auto;
}
.bubble-md :deep(th),
.bubble-md :deep(td) {
  padding: 5px 8px;
  border: 1px solid var(--pv-border);
  text-align: left;
  vertical-align: top;
}
.bubble-md :deep(th) {
  background: var(--pv-tint);
}
.bubble-md :deep(code) {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--pv-tint);
  font-size: 12.5px;
}
.bubble-md :deep(pre) {
  margin: 8px 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--pv-tint);
  overflow-x: auto;
}
.bubble-md :deep(pre code) {
  padding: 0;
  background: transparent;
  white-space: pre;
}
.bubble-md :deep(img) {
  max-width: 100%;
  height: auto;
}
.bubble-md :deep(hr) {
  margin: 12px 0;
  border: none;
  border-top: 1px solid var(--pv-border);
}
/* 时间戳：等宽数字，弱化成"元信息"而不是正文 */
.msg-time {
  font-size: 11px;
  color: var(--pv-text-secondary);
  opacity: 0.72;
  font-variant-numeric: tabular-nums;
}
.msg-time-mine {
  margin-top: 5px;
  padding-right: 3px;
}
/* 停止 / 出错的小字标注 */
.stop-mark {
  font-size: 12px;
  opacity: 0.75;
}
.err-mark {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-color-danger, #c45656);
}
/* 失败气泡：醒目边框提示异常，配「重新生成」按钮一键重发 */
.bubble.failed {
  border-color: rgba(196, 86, 86, 0.45);
  box-shadow: 0 0 0 1px rgba(196, 86, 86, 0.18), 0 12px 26px -20px rgba(24, 32, 48, 0.5);
}
.regen-btn {
  margin-top: 6px;
  margin-left: 0;
  font-size: 12px;
}

/* RAG 引用来源：回答下方的折叠条（文档名 / 类型 / 小节 / 相关度 / 摘要） */
.refs {
  margin-top: 6px;
}
.refs-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--pv-border);
  border-radius: 999px;
  background: transparent;
  color: var(--pv-text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: color 0.18s, border-color 0.18s;
}
.refs-toggle:hover {
  color: var(--pv-ink);
  border-color: var(--pv-ink);
}
.refs-arrow {
  transition: transform 0.18s;
}
.refs-arrow.open {
  transform: rotate(180deg);
}
.refs-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 8px;
  padding: 10px;
  border: 1px solid var(--pv-border);
  border-radius: 12px;
  background: var(--pv-tint);
}
.ref-item {
  display: flex;
  gap: 8px;
  font-size: 12px;
}
.ref-rank {
  color: var(--pv-text-secondary);
  font-variant-numeric: tabular-nums;
}
.ref-main {
  flex: 1;
  min-width: 0;
}
.ref-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.ref-title {
  color: var(--pv-ink);
  font-weight: 600;
}
.ref-score {
  margin-left: auto;
  color: var(--pv-text-secondary);
  font-size: 11px;
}
.ref-section {
  margin-top: 3px;
  color: var(--pv-text-secondary);
}
.ref-snippet {
  margin-top: 4px;
  line-height: 1.55;
  color: var(--pv-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 思考中三个跳动圆点 */
.bubble.thinking {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 14px 16px;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--pv-text-secondary);
  animation: dot-bounce 1.2s infinite ease-in-out;
}
.dot:nth-child(2) {
  animation-delay: 0.15s;
}
.dot:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes dot-bounce {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

/* ---------- 底部输入区 ---------- */
.chat-input {
  position: relative;
  margin: 0 20px 20px;
  padding: 10px 12px 8px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 24px;
  overflow: hidden;
  transition: border-color 0.22s ease, box-shadow 0.22s ease;
}
/* 悬停：描边亮一档，整块输入面显得可交互 */
.chat-input:hover {
  border-color: rgba(255, 255, 255, 0.28);
}
/* 聚焦（焦点在输入框或按钮上）：深一度投影 + 一圈中性色外环。
   这里不能用白色外发光——胶囊压在浅色卡片上，白光等于看不见 */
.chat-input:focus-within {
  border-color: rgba(255, 255, 255, 0.44);
  box-shadow: 0 26px 56px -22px rgba(8, 12, 22, 0.72), 0 0 0 3px rgba(20, 22, 28, 0.16),
    inset 0 1px 0 rgba(255, 255, 255, 0.22);
}
/* 输入框在墨色玻璃上「消失」，只留文字与光标，胶囊本身就是输入框 */
.chat-input :deep(.el-textarea__inner) {
  background-color: transparent;
  background-image: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  box-shadow: none;
  color: #fff;
  caret-color: #fff;
  padding: 9px 4px;
  font-size: 14px;
  line-height: 1.62;
}
.chat-input :deep(.el-textarea__inner::placeholder) {
  color: rgba(255, 255, 255, 0.46);
}
.chat-input :deep(.el-textarea__inner:focus) {
  background-color: transparent;
  box-shadow: none;
}
/* 待发送附件条：深底上换成更轻的玻璃片 */
.chat-input .pending-file {
  background-color: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.18);
  color: rgba(255, 255, 255, 0.92);
}
.chat-input .pending-file .pf-name {
  color: #fff;
}
.chat-input .pending-file .pf-sub,
.chat-input .pending-file .pf-state {
  color: rgba(255, 255, 255, 0.6);
}
.input-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}
/* 回形针：小圆钮，颜色由 .pv-glass-ink 统一反相，这里只管尺寸与按压反馈 */
.attach-btn {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  margin-bottom: 2px;
  border-radius: 50%;
  transition: transform 0.16s ease, background-color 0.18s ease, border-color 0.18s ease,
    color 0.18s ease;
}
.attach-btn:active:not(.is-disabled) {
  transform: scale(0.94);
}
.attach-btn.is-disabled {
  cursor: not-allowed;
}
.chat-textarea {
  flex: 1;
}
/* 发送按钮：默认 / 悬停 / 聚焦 / 按下 / 禁用 五态自成一套，
   不依赖全局墨色反相规则（EP 的按钮变量会在状态切换时互相覆盖，白底白字会直接看不见） */
.send-btn {
  flex-shrink: 0;
  width: 88px;
  height: 38px;
  margin-bottom: 1px;
  font-weight: 600;
  letter-spacing: 0.5px;
  background: #fff !important;
  border-color: #fff !important;
  color: var(--pv-ink) !important;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.34), inset 0 1px 0 #fff !important;
  transition: transform 0.18s ease, box-shadow 0.2s ease, background-color 0.2s ease,
    color 0.2s ease;
}
.send-btn:hover:not(.is-disabled) {
  transform: translateY(-1px);
  box-shadow: 0 12px 26px rgba(0, 0, 0, 0.42), inset 0 1px 0 #fff !important;
}
.send-btn:active:not(.is-disabled) {
  transform: translateY(0) scale(0.97);
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.3), inset 0 1px 0 #fff !important;
}
.send-btn:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.6);
  outline-offset: 2px;
}
/* 禁用：退成半透明幽灵按钮，仍保留"这里有个发送键"的位置感 */
.send-btn.is-disabled,
.send-btn.is-disabled:hover,
.send-btn.is-disabled:active {
  background: rgba(255, 255, 255, 0.12) !important;
  border-color: rgba(255, 255, 255, 0.18) !important;
  color: rgba(255, 255, 255, 0.42) !important;
  box-shadow: none !important;
  transform: none !important;
  cursor: not-allowed;
}
/* 「停止」是同一位置的次要动作：留白底但降一档，和「发送」区分主次 */
.stop-btn {
  font-weight: 600;
  background: rgba(255, 255, 255, 0.9) !important;
  border-color: rgba(255, 255, 255, 0.9) !important;
  color: var(--pv-ink) !important;
}

/* 输入提示行：桌面给快捷键，移动端只留字数 */
.composer-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 14px;
  padding: 0 2px;
  font-size: 11px;
  line-height: 14px;
  color: rgba(255, 255, 255, 0.42);
  user-select: none;
}
.hint-count {
  color: rgba(255, 255, 255, 0.55);
  font-variant-numeric: tabular-nums;
}

/* 待发送附件条 */
.pending-files {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.pending-file {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 10px;
  background: var(--pv-tint, #fafafa);
  border: 1px solid var(--pv-border);
  max-width: 240px;
}
.pending-file.failed {
  border-color: var(--el-color-danger-light-5, #fbc4c4);
}
.pf-thumb {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
}
.pf-kind {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--pv-text-secondary);
  background: var(--pv-tint);
}
.pf-info {
  min-width: 0;
}
.pf-name {
  font-size: 12px;
  color: var(--pv-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
}
.pf-sub {
  font-size: 11px;
  color: var(--pv-text-secondary);
  margin-top: 2px;
}
.pf-state {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--pv-text-secondary);
}
.pf-state.failed {
  color: var(--el-color-danger, #c45656);
}
.pf-remove {
  flex-shrink: 0;
  font-size: 14px;
  color: var(--pv-text-secondary);
  cursor: pointer;
  transition: color 0.15s;
}
.pf-remove:hover {
  color: var(--el-color-danger, #c45656);
}

/* 气泡内多模态附件 */
.bubble-media {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
  max-width: 100%;
}
.media-img {
  width: 200px;
  max-width: 100%;
  height: auto;
  max-height: 240px;
  border-radius: 10px;
  cursor: zoom-in;
  display: block;
}
/* el-image 的内层 img 需要显式约束宽高，否则按原图尺寸溢出气泡 */
.media-img :deep(img) {
  width: 100%;
  height: auto;
  max-height: 240px;
  object-fit: contain;
}
.media-video {
  width: 240px;
  max-width: 100%;
  max-height: 200px;
  border-radius: 10px;
  display: block;
  background: #000;
}
.media-audio {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}
.audio-name {
  font-size: 12px;
  opacity: 0.85;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.audio-player {
  width: 100%;
  height: 36px;
}
.audio-transcript {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  opacity: 0.85;
}

/* ---------- 长期记忆弹窗 ---------- */
.memory-body {
  min-height: 120px;
  max-height: 56vh;
  overflow-y: auto;
  padding-right: 4px;
}
.memory-tip {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.memory-group {
  margin-bottom: 14px;
}
.memory-group-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--pv-text);
  margin-bottom: 8px;
}
.memory-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  margin-bottom: 6px;
  border-radius: 10px;
  background: var(--pv-tint, #fafafa);
  border: 1px solid var(--pv-border);
}
.memory-kind {
  flex-shrink: 0;
}
.memory-content {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--pv-text);
  line-height: 1.5;
}
.memory-time {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--pv-text-secondary);
}
.memory-del {
  flex-shrink: 0;
  font-size: 14px;
  color: var(--pv-text-secondary);
  cursor: pointer;
  transition: color 0.15s;
}
.memory-del:hover {
  color: var(--el-color-danger, #c45656);
}
.memory-empty {
  padding: 40px 0;
  text-align: center;
  font-size: 13px;
  color: var(--pv-text-secondary);
}

/* ---------- 平板（≤1024px）：侧栏收窄，气泡放宽 ---------- */
@media (max-width: 1024px) {
  .chat-sidebar {
    width: 220px;
  }
  .bubble-col {
    max-width: 78%;
  }
  .chat-body {
    padding: 12px 18px 4px;
  }
}

/* ---------- 移动端 ---------- */
@media (max-width: 768px) {
  /* 手机端直接展示对话：侧栏收进右上角弹层，聊天区与输入框占满剩余视口高度 */
  .page {
    min-height: 0;
  }
  .page-container {
    min-height: 0;
    padding: 10px 12px;
  }
  .chat-layout {
    height: calc(100vh - 98px);
    height: calc(100dvh - 98px);
    min-height: 0;
  }
  .chat-sidebar {
    display: none;
  }
  .chat-main {
    width: 100%;
  }
  .chat-topbar {
    gap: 12px;
    padding: 10px 14px;
  }
  .pet-avatar :deep(img) {
    border-radius: 50%;
  }
  .pet-name {
    font-size: 16px;
  }
  .pet-sub {
    font-size: 11px;
  }
  .mobile-panel-btn {
    display: inline-flex;
  }
  .chat-body {
    min-height: 0;
    padding: 8px 12px 0;
  }
  .msg-scroll {
    max-width: none;
    height: auto;
    min-height: 0;
  }
  .msg-scroll :deep(.el-scrollbar__view) {
    padding: 4px 2px 8px;
  }
  /* 窄屏上"组间 22px / 组内 8px"的对比保留，但整体收紧一档 */
  .msg-row + .msg-row {
    margin-top: 6px;
  }
  .msg-row + .msg-row.group-start {
    margin-top: 16px;
  }
  .msg-avatar-slot {
    width: 30px;
    padding-top: 22px;
  }
  .msg-avatar-wrap {
    width: 30px;
    height: 30px;
  }
  .bubble-col {
    max-width: 86%;
  }
  .bubble {
    padding: 10px 13px;
    font-size: 14px;
  }
  .empty-talk {
    min-height: 0;
    padding: 16px 8px;
  }
  .msg-scroll :deep(.el-scrollbar__view) {
    min-height: 100%;
  }
  .empty-suggests {
    gap: 6px;
    margin-top: 16px;
  }
  .suggest-chip {
    padding: 7px 12px;
    font-size: 12px;
  }
  .chat-input {
    margin: 0 12px 12px;
    padding: 8px 10px 6px 12px;
    border-radius: 20px;
  }
  .input-row {
    gap: 8px;
  }
  .send-btn {
    width: 66px;
    height: 36px;
  }
  .attach-btn {
    width: 34px;
    height: 34px;
  }
  /* 触屏没有 Enter 键，去掉快捷键提示，只保留字数 */
  .hint-keys {
    display: none;
  }
  .composer-hint {
    justify-content: flex-end;
  }
}
</style>

<style>
/* 弹层由 Element Plus teleport 到 body，根节点样式需放在全局作用域 */
.petchat-mobile-popover.el-popper {
  width: min(300px, calc(100vw - 40px)) !important;
  max-width: calc(100vw - 24px);
  padding: 12px;
  border-radius: 14px;
}
</style>
