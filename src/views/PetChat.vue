<script setup>
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Delete, Plus } from '@element-plus/icons-vue'
import { getMyPet, listMyPets } from '@/api/pet'
import {
  chatStream,
  getChatHistory,
  listChatSessions,
  deleteChatSession,
} from '@/api/ai'

const router = useRouter()

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

// 真实宠物按生日计算年龄，不足 1 岁展示月龄；虚拟宠物直接用年龄字段
const petAgeText = (p) => {
  if (p.type !== 'REAL') return p.age != null ? `${p.age} 岁` : ''
  if (!p.birthday) return ''
  const birth = new Date(p.birthday)
  const now = new Date()
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth())
  if (now.getDate() < birth.getDate()) months -= 1
  if (months < 0) months = 0
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
// 会话消息列表：[{ role: 'user' | 'assistant', content, ts, thinking, stopped, error }]
const messages = ref([])
const inputText = ref('') // 输入框内容
const sending = ref(false) // 是否正在流式生成中
const scrollbarRef = ref(null) // 消息区 el-scrollbar 实例
let streamCtrl = null // 当前流式请求控制器（{ abort }）

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
  scrollbarRef.value?.setScrollTop?.(999999)
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
    }))
    scrollToBottom()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loadingHistory.value = false
  }
}

// ---------- 初始化 ----------
onMounted(async () => {
  try {
    // 宠物列表 + 代表宠物并行加载：默认选中代表宠物（优先虚拟宠物）
    const [myPet, myPets] = await Promise.all([
      getMyPet().catch(() => null),
      listMyPets().catch(() => []),
    ])
    pets.value = myPets || []
    const target =
      (myPet && pets.value.find((p) => petKey(p) === petKey(myPet))) || myPet || pets.value[0] || null
    pet.value = target
    if (target) {
      await refreshSessions()
      // 进页面默认打开最近活跃的会话（可能属于任意宠物）：同步选中其归属宠物；无会话则展示空咨询页
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
})

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

// ---------- 发送与流式渲染 ----------
const handleSend = () => {
  const text = inputText.value.trim()
  // 生成中不允许再次发送
  if (!text || sending.value || !pet.value) return

  // 用户消息立即上屏（乐观渲染），并写入本地会话状态数组；petId 用于回显本轮咨询的宠物
  messages.value.push({ role: 'user', content: text, petId: pet.value.id, ts: nowSec() })
  inputText.value = ''
  // 顾问侧先出现「思考中」占位气泡，首个 delta 到达后替换为流式文本
  messages.value.push({ role: 'assistant', content: '', thinking: true, ts: nowSec() })
  sending.value = true
  scrollToBottom()

  // 按后端接口契约组装宠物画像（作为咨询上下文）
  const petPayload = {
    id: pet.value.id,
    name: pet.value.name,
    species: pet.value.species,
    breed: pet.value.breed,
    age: pet.value.age,
    level: pet.value.level,
    signStreak: pet.value.signStreak,
    description: pet.value.description,
    // 健康信息（猫/狗身份卡维护）随咨询上下文一并发送，供顾问给出针对性建议；
    // 未填写的字段为 null / 空串，过滤掉后再发送，避免后端参数校验失败
    health: Object.fromEntries(
      Object.entries({
        weight: pet.value.weight,
        bcs: pet.value.bcs,
        deworming: pet.value.deworming,
        specialPeriod: pet.value.specialPeriod,
        vaccine: pet.value.vaccine,
        rearingMethod: pet.value.rearingMethod,
        medicalHistory: pet.value.medicalHistory,
      }).filter(([, v]) => v != null && v !== ''),
    ),
  }

  streamCtrl = chatStream({
    message: text,
    pet: petPayload,
    sessionId: currentSessionId.value,
    onMeta: ({ sessionId }) => {
      // 首帧 meta：后端自动新建会话后回传会话 ID，前端绑定并刷新会话列表
      if (sessionId == null) return
      currentSessionId.value = Number(sessionId)
      refreshSessions()
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
    onError: (msg) => {
      const last = messages.value[messages.value.length - 1]
      const hasContent = last?.role === 'assistant' && !last.thinking && last.content
      if (hasContent) {
        // 已有部分流式内容：不打断，仅在气泡后补提示
        last.error = msg
      } else if (last?.role === 'assistant') {
        // 尚无内容：移除思考占位气泡
        messages.value.pop()
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

      <!-- 无宠物：引导去领养 -->
      <el-card v-else-if="!pet" shadow="never" class="chat-card empty-card">
        <el-result
          icon="info"
          title="还没有宠物"
          sub-title="先去领养一只心仪的宠物，再回来咨询它的健康与习性吧"
        >
          <template #extra>
            <el-button type="primary" size="large" round @click="router.push('/claim')">
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
                <el-button size="small" round :icon="Plus" @click="newSession">新会话</el-button>
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
              <el-avatar :size="44" :src="pet.imageUrl || ''" class="pet-avatar">
                {{ (pet.name || '宠')[0] }}
              </el-avatar>
              <div class="pet-brief">
                <div class="name-row">
                  <span class="pet-name">{{ pet.name }}</span>
                  <!-- 真实宠物为纯档案，不展示等级 -->
                  <el-tag v-if="pet.type !== 'REAL'" effect="dark" round class="lv-tag">
                    Lv.{{ pet.level }}
                  </el-tag>
                </div>
                <p class="pet-sub">AI 养宠顾问 · 咨询 {{ pet.name }} 的健康与习性</p>
              </div>
            </div>

            <!-- 消息列表 -->
            <div class="chat-body">
              <el-skeleton v-if="loadingHistory" :rows="5" animated class="history-skeleton" />
              <el-scrollbar v-else ref="scrollbarRef" class="msg-scroll">
                <!-- 空会话欢迎占位 -->
                <div v-if="!messages.length" class="empty-talk">
                  <el-avatar :size="72" :src="pet.imageUrl || ''" class="empty-avatar">
                    {{ (pet.name || '宠')[0] }}
                  </el-avatar>
                  <p class="empty-title">开始一段新的咨询</p>
                  <p class="empty-sub">
                    向 AI 养宠顾问咨询 {{ pet.name }} 的健康、习性、喂养等问题吧
                  </p>
                </div>

                <!-- 消息气泡 -->
                <div
                  v-for="(msg, idx) in messages"
                  :key="idx"
                  class="msg-row"
                  :class="msg.role === 'user' ? 'mine' : 'ai'"
                >
                  <el-avatar
                    v-if="msg.role === 'assistant'"
                    :size="34"
                    :src="msgPet(msg)?.imageUrl || ''"
                    class="msg-avatar"
                  >
                    {{ (msgPet(msg)?.name || '宠')[0] }}
                  </el-avatar>
                  <div class="bubble-col">
                    <div class="bubble" :class="{ thinking: msg.thinking }">
                      <!-- 思考中：三个跳动圆点 -->
                      <template v-if="msg.thinking">
                        <span class="dot"></span>
                        <span class="dot"></span>
                        <span class="dot"></span>
                      </template>
                      <template v-else>
                        <span class="bubble-text">{{ msg.content }}</span>
                        <span v-if="msg.stopped" class="stop-mark">（已停止）</span>
                        <span v-if="msg.error" class="err-mark">{{ msg.error }}</span>
                      </template>
                    </div>
                    <span v-if="msg.ts" class="msg-time">{{ formatMsgTime(msg.ts) }}</span>
                  </div>
                </div>
              </el-scrollbar>
            </div>

            <!-- 底部输入区 -->
            <div class="chat-input">
              <el-input
                v-model="inputText"
                type="textarea"
                :autosize="{ minRows: 1, maxRows: 3 }"
                resize="none"
                :placeholder="`咨询 ${pet.name} 的健康、习性等问题...`"
                class="chat-textarea"
                @keydown.enter="onEnterKey"
              />
              <el-button
                v-if="!sending"
                type="primary"
                round
                class="send-btn"
                :disabled="!inputText.trim()"
                @click="handleSend"
              >
                发送
              </el-button>
              <el-button v-else round class="send-btn stop-btn" @click="handleStop">停止</el-button>
            </div>
          </div>
        </div>
      </el-card>
    </div>
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
.chat-layout {
  display: flex;
  align-items: stretch;
}

/* ---------- 侧栏 ---------- */
.chat-sidebar {
  width: 248px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--pv-border);
  background: var(--pv-bg, #fafafa);
}
.side-section {
  padding: 14px 12px;
}
.session-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--pv-border);
}
.side-title {
  font-size: 13px;
  font-weight: 700;
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
  background: var(--pv-tint);
}
.pet-item.active {
  background: var(--pv-tint);
  border-color: var(--pv-border);
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

/* 会话列表项 */
.session-scroll {
  flex: 1;
  min-height: 120px;
}
.session-empty {
  padding: 10px 6px;
  font-size: 12px;
  color: var(--pv-text-secondary);
  text-align: center;
}
.session-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 10px;
  margin-bottom: 4px;
  border-radius: 10px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.15s;
}
.session-item:hover {
  background: var(--pv-tint);
}
.session-item.active {
  background: var(--pv-tint);
  border-color: var(--pv-border);
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
  display: flex;
  flex-direction: column;
}

/* 顶部宠物信息条 */
.chat-topbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--pv-border);
}
.pet-avatar {
  flex-shrink: 0;
  border: 3px solid #fff;
  box-shadow: var(--pv-shadow-sm);
  font-size: 16px;
}
.pet-brief {
  flex: 1;
  min-width: 0;
}
.name-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pet-name {
  font-size: 18px;
  font-weight: 700;
  color: var(--pv-text);
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
}

/* ---------- 消息列表 ---------- */
.chat-body {
  padding: 18px 24px;
}
.history-skeleton {
  padding: 8px 0;
}
.msg-scroll {
  height: 55vh;
}
.msg-scroll :deep(.el-scrollbar__view) {
  padding: 4px 4px 8px;
}

/* 空会话欢迎占位 */
.empty-talk {
  min-height: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.empty-avatar {
  border: 3px solid #fff;
  box-shadow: var(--pv-shadow);
  font-size: 24px;
  margin-bottom: 8px;
}
.empty-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--pv-text);
}
.empty-sub {
  font-size: 13px;
  color: var(--pv-text-secondary);
}

/* 气泡行 */
.msg-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  margin-bottom: 16px;
}
.msg-row.mine {
  justify-content: flex-end;
}
.msg-avatar {
  flex-shrink: 0;
  font-size: 13px;
}
.bubble-col {
  display: flex;
  flex-direction: column;
  max-width: 72%;
  min-width: 0;
}
.msg-row.mine .bubble-col {
  align-items: flex-end;
}
.bubble {
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.65;
  word-break: break-word;
  white-space: pre-wrap;
}
/* 顾问气泡：靠左，浅底 */
.msg-row.ai .bubble {
  background: var(--pv-tint);
  border: 1px solid var(--pv-border);
  border-bottom-left-radius: 4px;
  color: var(--pv-text);
}
/* 用户气泡：靠右，墨色底 */
.msg-row.mine .bubble {
  background: var(--pv-ink);
  border-bottom-right-radius: 4px;
  color: #fff;
}
.msg-time {
  margin-top: 4px;
  padding: 0 4px;
  font-size: 11px;
  color: var(--pv-text-secondary);
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
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding: 16px 24px 20px;
  border-top: 1px solid var(--pv-border);
}
.chat-textarea {
  flex: 1;
}
.send-btn {
  flex-shrink: 0;
  width: 88px;
}
.stop-btn {
  font-weight: 600;
}

/* ---------- 移动端 ---------- */
@media (max-width: 768px) {
  /* 侧栏改为顶部横向区块：宠物横滑一行，会话列表限高 */
  .chat-layout {
    flex-direction: column;
  }
  .chat-sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--pv-border);
  }
  .pet-scroll {
    max-height: none;
  }
  .pet-scroll :deep(.el-scrollbar__view) {
    display: flex;
    gap: 8px;
  }
  .pet-item {
    flex: 0 0 auto;
    width: 168px;
  }
  .session-scroll {
    max-height: 150px;
  }
  .session-del {
    opacity: 1;
  }
  .chat-topbar,
  .chat-body,
  .chat-input {
    padding-left: 14px;
    padding-right: 14px;
  }
  .bubble-col {
    max-width: 84%;
  }
  .send-btn {
    width: 72px;
  }
}
</style>
