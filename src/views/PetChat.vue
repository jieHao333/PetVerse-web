<script setup>
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import { getMyPet } from '@/api/pet'
import { chatStream, getChatHistory, clearChatHistory } from '@/api/ai'

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

// ---------- 页面状态 ----------
const pet = ref(null) // 当前出场宠物
const loadingPet = ref(true) // 宠物信息加载中
const loadingHistory = ref(false) // 历史对话加载中
// 会话消息列表：[{ role: 'user' | 'assistant', content, ts, thinking, stopped, error }]
const messages = ref([])
const inputText = ref('') // 输入框内容
const sending = ref(false) // 是否正在流式生成中
const scrollbarRef = ref(null) // 消息区 el-scrollbar 实例
let streamCtrl = null // 当前流式请求控制器（{ abort }）

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

// ---------- 初始化 ----------
// 加载历史对话（后端按时间正序返回）
const loadHistory = async () => {
  loadingHistory.value = true
  try {
    const data = await getChatHistory(pet.value.id)
    // 守卫：await 期间用户可能已发送消息并在流式生成中（sending 为 true），
    // 此时整体覆盖 messages 会吞掉进行中的对话气泡，因此直接跳过本次覆盖、
    // 保留当前会话画面（历史不急于这一轮刷新，结束后重进页面即可看到）
    if (sending.value) return
    messages.value = (data?.messages || []).map((m) => ({
      role: m.role,
      content: m.content,
      ts: m.ts,
    }))
    scrollToBottom()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loadingHistory.value = false
  }
}

onMounted(async () => {
  try {
    pet.value = await getMyPet()
    if (pet.value) await loadHistory()
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

// ---------- 发送与流式渲染 ----------
const handleSend = () => {
  const text = inputText.value.trim()
  // 生成中不允许再次发送
  if (!text || sending.value || !pet.value) return

  // 用户消息立即上屏（乐观渲染），并写入本地会话状态数组
  messages.value.push({ role: 'user', content: text, ts: nowSec() })
  inputText.value = ''
  // 宠物侧先出现「思考中」占位气泡，首个 delta 到达后替换为流式文本
  messages.value.push({ role: 'assistant', content: '', thinking: true, ts: nowSec() })
  sending.value = true
  scrollToBottom()

  // 按后端接口契约组装宠物画像
  const petPayload = {
    id: pet.value.id,
    name: pet.value.name,
    species: pet.value.species,
    breed: pet.value.breed,
    age: pet.value.age,
    level: pet.value.level,
    signStreak: pet.value.signStreak,
    description: pet.value.description,
  }

  streamCtrl = chatStream({
    message: text,
    pet: petPayload,
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
        ElMessage.warning('宠物没有回应，换个说法试试吧')
      }
      finishStream()
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

// ---------- 清空对话 ----------
const onClear = async () => {
  if (!pet.value) return
  try {
    await ElMessageBox.confirm(`确定清空和 ${pet.value.name} 的全部对话记录吗？`, '清空对话', {
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return // 用户取消
  }
  // 若仍在生成中，先停止当前流
  if (sending.value) handleStop()
  try {
    await clearChatHistory(pet.value.id)
    messages.value = []
    ElMessage.success('对话已清空')
  } catch (e) {
    ElMessage.error(e.message)
  }
}
</script>

<template>
  <div class="page">
    <AppHeader title="PetVerse" show-nav />

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
          sub-title="先去领养一只心仪的宠物，再回来和你的 AI 伙伴聊天吧"
        >
          <template #extra>
            <el-button type="primary" size="large" round @click="router.push('/claim')">
              去领养宠物
            </el-button>
          </template>
        </el-result>
      </el-card>

      <!-- 对话主体 -->
      <el-card v-else shadow="never" class="chat-card">
        <!-- 顶部宠物信息条 -->
        <div class="chat-topbar">
          <el-avatar :size="44" :src="pet.imageUrl || ''" class="pet-avatar">
            {{ (pet.name || '宠')[0] }}
          </el-avatar>
          <div class="pet-brief">
            <div class="name-row">
              <span class="pet-name">{{ pet.name }}</span>
              <el-tag effect="dark" round class="lv-tag">Lv.{{ pet.level }}</el-tag>
            </div>
            <p class="pet-sub">{{ pet.species }} · {{ pet.breed }} · {{ pet.age }} 岁</p>
          </div>
          <el-button size="small" round class="clear-btn" @click="onClear">清空对话</el-button>
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
              <p class="empty-title">和 {{ pet.name }} 聊聊吧~</p>
              <p class="empty-sub">它记得你们说过的话，越聊越懂你</p>
            </div>

            <!-- 消息气泡 -->
            <div
              v-for="(msg, idx) in messages"
              :key="idx"
              class="msg-row"
              :class="msg.role === 'user' ? 'mine' : 'pet'"
            >
              <el-avatar
                v-if="msg.role === 'assistant'"
                :size="34"
                :src="pet.imageUrl || ''"
                class="msg-avatar"
              >
                {{ (pet.name || '宠')[0] }}
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
            :placeholder="`和 ${pet.name} 说点什么...`"
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

/* ---------- 顶部宠物信息条 ---------- */
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
.clear-btn {
  font-weight: 600;
  color: var(--pv-text-secondary);
  border-color: var(--pv-border);
}
.clear-btn:hover,
.clear-btn:focus {
  color: var(--pv-ink);
  border-color: var(--pv-ink);
  background: var(--pv-tint);
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
/* 宠物气泡：靠左，浅底 */
.msg-row.pet .bubble {
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
