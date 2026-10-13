<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Close, Document, Loading, Paperclip, UploadFilled } from '@element-plus/icons-vue'
import { getUserById } from '@/api/user'
import {
  acceptFriendRequest,
  getFriendRelation,
  getMessages,
  markChatRead,
  rejectFriendRequest,
  sendMessage,
  sendFriendRequest,
  uploadChatFile,
} from '@/api/social'
import { currentUser } from '@/utils/auth'
import { DEFAULT_AVATAR } from '@/utils/avatar'

const route = useRoute()
const router = useRouter()

const targetId = route.params.userId
const me = currentUser()

const loading = ref(true)
const target = ref(null)
// 好友关系：{ friend, requestSent, receivedRequestId }，拉取失败时为 null，此时不做非好友拦截提示
const relation = ref(null)
const messages = ref([])
const draft = ref('')
const sending = ref(false)
const friendActionLoading = ref(false)
const messageBox = ref(null)
let pollTimer = null

// 非好友的招呼额度，与后端 ChatServiceImpl.STRANGER_QUOTA 保持一致
const STRANGER_QUOTA = 1
const STRANGER_TIP = '你们还不是好友，对方回复前只能发送 1 条消息，添加好友后可继续聊天'

// 后端 Long 序列化为字符串，与本地缓存的 id 统一转字符串比较，避免类型不一致导致误判
const isMine = (msg) => String(msg.senderId) === String(me?.id)
const isFromTarget = (msg) => String(msg.senderId) === String(targetId)

const displayName = (u) => u?.nickname || u?.username || '用户'

const myAvatar = computed(() => me?.avatar || DEFAULT_AVATAR)
const myName = computed(() => displayName(me))
const targetAvatar = computed(() => target.value?.avatar || DEFAULT_AVATAR)

const isFriend = computed(() => relation.value?.friend === true)
// 对方回复过任意一条即视为双向沟通成立，之后不再限流
const repliedByTarget = computed(() => messages.value.some(isFromTarget))
// 非好友 + 对方未回复 + 我已发过消息 = 招呼额度用完
const quotaExhausted = computed(
  () =>
    !!relation.value &&
    !isFriend.value &&
    !repliedByTarget.value &&
    messages.value.filter(isMine).length >= STRANGER_QUOTA,
)
const canSend = computed(() => !!target.value && !quotaExhausted.value)

// 非好友会话的顶部说明：区分「还能打招呼」「额度已用完」「对方已回复」三种状态
const tipText = computed(() => {
  if (!relation.value || isFriend.value || !target.value) return ''
  if (quotaExhausted.value) return '你们还不是好友：对方回复前只能发送 1 条消息，这条招呼已经发完，等对方回复后再聊。'
  if (repliedByTarget.value) return '你们还不是好友，对方已回复，可以继续聊天；添加好友后随时都能找 TA。'
  return `你们还不是好友，对方回复前只能发送 ${STRANGER_QUOTA} 条打招呼消息。`
})

const timeLabel = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '')

// 消息时间解析：后端返回 2026-08-22T13:58 或带空格格式，统一转 Date 供间隔计算
const parseTime = (t) => (t ? new Date(String(t).replace(' ', 'T')) : null)

// 时间分隔条文案：今天显示时分，今年显示月日时分，更早显示完整日期（仿微信）
const dividerText = (date) => {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (date.toDateString() === now.toDateString()) return hm
  if (date.getFullYear() === now.getFullYear()) {
    return `${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${hm}`
  }
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${hm}`
}

// 消息展示列表：相邻消息间隔超过 5 分钟时插入时间分隔条
const chatList = computed(() => {
  const list = []
  let prev = null
  for (const msg of messages.value) {
    const cur = parseTime(msg.createTime)
    if (cur && (!prev || cur - prev > 5 * 60 * 1000)) {
      list.push({ type: 'divider', key: `d-${msg.id}`, text: dividerText(cur) })
    }
    list.push({ type: 'msg', key: msg.id, msg })
    if (cur) prev = cur
  }
  return list
})

const loadTarget = async () => {
  try {
    target.value = await getUserById(targetId)
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// 关系状态拉取失败时静默：仅少显示一条提示，不打断已经能进行的聊天
const loadRelation = async () => {
  try {
    relation.value = await getFriendRelation(targetId)
  } catch {
    relation.value = null
  }
}

// 最近一次消息指纹（末条ID:条数）：轮询无新消息时跳过重渲染与滚动，避免页面抖动
let lastMsgKey = ''

// 是否贴底：用户翻看历史（未贴底）时，新消息到达不强制拉回底部
let stickBottom = true

const onScroll = () => {
  const box = messageBox.value
  if (!box) return
  stickBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60
}

// 拉取聊天记录：指纹未变化时跳过重渲染；仅贴底时自动滚动
const refreshMessages = async (notify = true) => {
  try {
    const list = await getMessages(targetId)
    const key = list.length ? `${list[list.length - 1].id}:${list.length}` : ''
    if (key === lastMsgKey) return
    lastMsgKey = key
    messages.value = list
    await nextTick()
    if (messageBox.value && stickBottom) {
      messageBox.value.scrollTop = messageBox.value.scrollHeight
    }
  } catch (e) {
    if (notify) ElMessage.error(e.message)
  }
}

const markConversationRead = async () => {
  try {
    await markChatRead(targetId)
  } catch {
    /* 忽略已读标记失败 */
  }
}

const onSend = async () => {
  const content = draft.value.trim()
  const files = pendingFiles.value.filter((f) => !f.uploading && f.url)
  // 既无文本也无待发送文件，直接返回
  if (!content && !files.length) return
  if (quotaExhausted.value) {
    ElMessage.warning(STRANGER_TIP)
    return
  }
  sending.value = true
  try {
    // 先发送文本消息（在上）
    if (content) {
      await sendMessage({ receiverId: targetId, content })
      draft.value = ''
      await refreshMessages(true)
    }
    // 再逐个发送文件消息（在下）；失败时保留待发送区，便于直接重试
    for (const file of files) {
      await sendMessage({
        receiverId: targetId,
        content: file.url,
        msgType: file.msgType,
        fileName: file.fileName,
      })
      await refreshMessages(true)
    }
    pendingFiles.value = []
  } catch (err) {
    ElMessage.error(err.message)
  } finally {
    sending.value = false
  }
}

/* ==================== 好友关系操作 ==================== */

const onAddFriend = async () => {
  friendActionLoading.value = true
  try {
    await sendFriendRequest(targetId)
    ElMessage.success(`已向 ${displayName(target.value)} 发送好友申请`)
    await loadRelation()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    friendActionLoading.value = false
  }
}

// 对方申请中的待处理ID，同意/拒绝都就地完成，省得再跳好友页
const onAccept = async () => {
  friendActionLoading.value = true
  try {
    await acceptFriendRequest(relation.value.receivedRequestId)
    ElMessage.success(`已和 ${displayName(target.value)} 成为好友`)
    await loadRelation()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    friendActionLoading.value = false
  }
}

const onReject = async () => {
  friendActionLoading.value = true
  try {
    await rejectFriendRequest(relation.value.receivedRequestId)
    ElMessage.success('已拒绝该申请')
    await loadRelation()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    friendActionLoading.value = false
  }
}

const gotoProfile = () => {
  if (target.value) router.push(`/user/${targetId}`)
}

const goBack = () => {
  router.push('/friends')
}

/* ==================== 发送文件 ==================== */

const fileInput = ref(null)
const uploadingCount = ref(0)
const uploading = computed(() => uploadingCount.value > 0)
const MAX_CHAT_FILE_SIZE = 20 * 1024 * 1024

// 待发送文件列表：拖拽/选择后先上传 OSS 放这里，用户点发送才真正发出
const pendingFiles = ref([])
let pendingIdSeq = 0

const triggerFilePick = () => fileInput.value?.click()

// 上传文件到 OSS 并加入待发送区；超限文件跳过并提示，不阻断其余文件
const uploadFilesToPending = async (files) => {
  for (const file of files) {
    if (file.size > MAX_CHAT_FILE_SIZE) {
      ElMessage.warning(`「${file.name}」超过20MB，未添加`)
      continue
    }
    const id = ++pendingIdSeq
    pendingFiles.value.push({ id, fileName: file.name, uploading: true })
    uploadingCount.value += 1
    try {
      const res = await uploadChatFile(file)
      const item = pendingFiles.value.find((f) => f.id === id)
      if (item) {
        item.url = res.url
        item.msgType = res.msgType
        item.fileName = res.fileName
        item.uploading = false
      }
    } catch (err) {
      ElMessage.error(err.message)
      const idx = pendingFiles.value.findIndex((f) => f.id === id)
      if (idx >= 0) pendingFiles.value.splice(idx, 1)
    } finally {
      uploadingCount.value -= 1
    }
  }
}

const removePendingFile = (id) => {
  const idx = pendingFiles.value.findIndex((f) => f.id === id)
  if (idx >= 0) pendingFiles.value.splice(idx, 1)
}

const onFilePicked = async (e) => {
  const files = Array.from(e.target.files || [])
  e.target.value = ''
  if (!files.length || uploading.value) return
  await uploadFilesToPending(files)
}

// 拖拽发送（仿微信）：文件拖入聊天窗口显示蒙层，松手后上传到待发送区
const dragDepth = ref(0)
const dragging = computed(() => dragDepth.value > 0)

const onDragEnter = (e) => {
  if (e.dataTransfer?.types?.includes('Files')) {
    e.preventDefault()
    dragDepth.value += 1
  }
}

const onDragOver = (e) => {
  if (e.dataTransfer?.types?.includes('Files')) {
    e.preventDefault()
  }
}

const onDragLeave = () => {
  if (dragDepth.value > 0) dragDepth.value -= 1
}

const onDrop = async (e) => {
  e.preventDefault()
  dragDepth.value = 0
  const files = Array.from(e.dataTransfer?.files || [])
  if (!files.length || uploading.value) return
  await uploadFilesToPending(files)
}

// 视频按扩展名识别（后端文件消息统一为 msgType 2，前端细分渲染为可播放视频）
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'm4v']
const isVideo = (url) => VIDEO_EXTENSIONS.some((ext) => String(url || '').toLowerCase().endsWith('.' + ext))

// 图片/视频消息气泡透明化，直接展示媒体本体
const isMediaBubble = (msg) => msg.msgType === 1 || (msg.msgType === 2 && isVideo(msg.content))

// 图片/视频预览弹窗
const mediaPreviewDialog = ref(false)
const mediaPreview = ref(null)

const openMediaPreview = (url, type) => {
  mediaPreview.value = { url, type }
  mediaPreviewDialog.value = true
}

const saveMedia = () => {
  if (mediaPreview.value) {
    window.open(mediaPreview.value.url, '_blank')
  }
}

// 文件详情弹窗：点击文件消息显示文件信息，可取消或下载
const fileDetailDialog = ref(false)
const fileDetail = ref(null)

const openFileInfo = (msg) => {
  fileDetail.value = msg
  fileDetailDialog.value = true
}

const getFileExtension = (name) => {
  if (!name) return ''
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.substring(idx + 1).toUpperCase() : ''
}

const downloadFile = () => {
  if (fileDetail.value) {
    window.open(fileDetail.value.content, '_blank')
  }
}

onMounted(async () => {
  await Promise.all([loadTarget(), loadRelation()])
  loading.value = false
  if (!target.value) return
  await refreshMessages(true)
  markConversationRead()
  // 3 秒轮询新消息：本页正打开，抓到新消息就地标已读并刷新好友关系（对方可能刚同意申请）
  pollTimer = setInterval(async () => {
    const before = messages.value.length
    await refreshMessages(false)
    if (messages.value.length !== before) {
      markConversationRead()
      loadRelation()
    }
  }, 3000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="page chat-page">
    <div v-loading="loading" class="chat-shell pv-panel">
      <header class="chat-head">
        <el-button text class="chat-back" :icon="ArrowLeft" @click="goBack">消息列表</el-button>
        <el-avatar
          shape="square"
          :size="42"
          :src="targetAvatar"
          class="chat-head-avatar"
          @click="gotoProfile"
        >
          {{ (target?.nickname || target?.username || 'U')[0]?.toUpperCase() }}
        </el-avatar>
        <div class="chat-head-info">
          <div class="chat-head-name">{{ displayName(target) }}</div>
          <div class="chat-head-account">账号: {{ target?.username || '-' }}</div>
        </div>
        <div class="chat-head-actions">
          <el-tag v-if="isFriend" type="success" effect="plain" round>已是好友</el-tag>
          <template v-else-if="relation?.receivedRequestId">
            <el-button type="primary" size="small" round :loading="friendActionLoading" @click="onAccept">
              同意好友申请
            </el-button>
            <el-button size="small" round :disabled="friendActionLoading" @click="onReject">拒绝</el-button>
          </template>
          <el-button v-else-if="relation?.requestSent" size="small" round disabled>已申请</el-button>
          <el-button
            v-else
            type="primary"
            size="small"
            round
            :loading="friendActionLoading"
            :disabled="!target"
            @click="onAddFriend"
          >
            加好友
          </el-button>
        </div>
      </header>

      <p v-if="tipText" class="chat-tip" :class="{ 'chat-tip-stop': quotaExhausted }">
        {{ tipText }}
      </p>

      <div class="chat-body" @dragenter="onDragEnter" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
        <div v-if="dragging" class="chat-drop-mask">
          <el-icon :size="36"><UploadFilled /></el-icon>
          <p>松开即可发送文件</p>
        </div>
        <div v-if="!target && !loading" class="chat-empty">
          <p class="empty-tip">该用户不存在或已注销</p>
        </div>
        <div v-else ref="messageBox" class="chat-messages" @scroll="onScroll">
          <p v-if="!messages.length" class="empty-tip">
            {{ isFriend ? '还没有聊天记录，说点什么吧' : '还没有打过招呼，发一条让 TA 认识你' }}
          </p>
          <template v-for="item in chatList" :key="item.key">
            <div v-if="item.type === 'divider'" class="msg-divider">{{ item.text }}</div>
            <div v-else class="msg" :class="{ mine: isMine(item.msg) }">
              <el-avatar v-if="!isMine(item.msg)" class="msg-avatar" shape="square" :size="36" :src="targetAvatar">
                {{ (target?.nickname || target?.username || 'U')[0]?.toUpperCase() }}
              </el-avatar>
              <div
                class="bubble"
                :class="{ 'bubble-media': isMediaBubble(item.msg) }"
                :title="timeLabel(item.msg.createTime)"
              >
                <img
                  v-if="item.msg.msgType === 1"
                  class="bubble-img"
                  :src="item.msg.content"
                  alt="图片"
                  @click="openMediaPreview(item.msg.content, 'image')"
                />
                <template v-else-if="item.msg.msgType === 2">
                  <video
                    v-if="isVideo(item.msg.content)"
                    class="bubble-video"
                    :src="item.msg.content"
                    controls
                    preload="metadata"
                    @click="openMediaPreview(item.msg.content, 'video')"
                  />
                  <div v-else class="bubble-file" @click="openFileInfo(item.msg)">
                    <el-icon :size="26" class="bubble-file-icon"><Document /></el-icon>
                    <span class="bubble-file-name">{{ item.msg.fileName || '文件' }}</span>
                  </div>
                </template>
                <div v-else class="bubble-text">{{ item.msg.content }}</div>
              </div>
              <el-avatar v-if="isMine(item.msg)" class="msg-avatar" shape="square" :size="36" :src="myAvatar">
                {{ myName[0]?.toUpperCase() }}
              </el-avatar>
            </div>
          </template>
        </div>
      </div>

      <footer class="chat-foot">
        <div class="chat-toolbar">
          <el-tooltip content="发送图片或文件（也可直接拖入）" placement="top">
            <el-button
              text
              class="chat-attach-btn"
              :disabled="!canSend || sending || uploading"
              @click="triggerFilePick"
            >
              <el-icon :size="18"><Paperclip /></el-icon>
            </el-button>
          </el-tooltip>
          <span v-if="uploading" class="chat-upload-tip">文件上传中（{{ uploadingCount }}）…</span>
        </div>
        <div v-if="pendingFiles.length" class="pending-files">
          <div v-for="file in pendingFiles" :key="file.id" class="pending-item">
            <div v-if="file.uploading" class="pending-uploading">
              <el-icon class="is-loading" :size="20"><Loading /></el-icon>
              <span>上传中…</span>
            </div>
            <template v-else>
              <img v-if="file.msgType === 1" class="pending-img" :src="file.url" alt="图片" />
              <video v-else-if="isVideo(file.url)" class="pending-video" :src="file.url" preload="metadata" />
              <div v-else class="pending-file">
                <el-icon :size="24"><Document /></el-icon>
                <span class="pending-file-name">{{ file.fileName }}</span>
              </div>
            </template>
            <el-icon class="pending-remove" :size="16" @click="removePendingFile(file.id)"><Close /></el-icon>
          </div>
        </div>
        <div class="chat-input">
          <el-input
            v-model="draft"
            type="textarea"
            :rows="2"
            maxlength="500"
            show-word-limit
            resize="none"
            :disabled="!canSend || sending"
            :placeholder="quotaExhausted ? '对方回复或加好友后才能继续发送' : '输入消息，Enter 发送，Shift+Enter 换行'"
            @keydown.enter.exact.prevent="onSend"
          />
          <el-button
            type="primary"
            :loading="sending"
            :disabled="!canSend || (!draft.trim() && !pendingFiles.length)"
            @click="onSend"
          >
            {{ pendingFiles.length ? `发送 (${pendingFiles.length})` : '发送' }}
          </el-button>
        </div>
        <input ref="fileInput" type="file" multiple class="file-input-hidden" @change="onFilePicked" />
      </footer>
    </div>

    <!-- 文件详情弹窗 -->
    <el-dialog v-model="fileDetailDialog" title="文件详情" width="420px">
      <div v-if="fileDetail" class="file-detail">
        <el-icon :size="56" class="file-detail-icon"><Document /></el-icon>
        <div class="file-detail-info">
          <div class="file-detail-name">{{ fileDetail.fileName }}</div>
          <div class="file-detail-type">{{ getFileExtension(fileDetail.fileName) }} 文件</div>
        </div>
      </div>
      <template #footer>
        <el-button @click="fileDetailDialog = false">取消</el-button>
        <el-button type="primary" @click="downloadFile">下载</el-button>
      </template>
    </el-dialog>

    <!-- 图片/视频预览弹窗 -->
    <el-dialog v-model="mediaPreviewDialog" title="预览" width="80%" top="5vh">
      <div v-if="mediaPreview" class="media-preview">
        <img v-if="mediaPreview.type === 'image'" :src="mediaPreview.url" class="preview-img" />
        <video v-else :src="mediaPreview.url" class="preview-video" controls autoplay />
      </div>
      <template #footer>
        <el-button @click="mediaPreviewDialog = false">关闭</el-button>
        <el-button type="primary" @click="saveMedia">保存到本地</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.chat-page {
  height: calc(100vh - 60px);
  padding: 20px 40px;
  display: flex;
}
/* 聊天面板撑满剩余高度：头部固定、消息区滚动、输入区贴底 */
.chat-shell {
  flex: 1;
  width: 100%;
  max-width: 900px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.chat-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--pv-border);
  background: var(--pv-glass-strong);
}
.chat-back {
  color: var(--pv-text-secondary);
  flex-shrink: 0;
}
.chat-head-avatar {
  cursor: pointer;
  flex-shrink: 0;
  --el-avatar-border-radius: 8px;
}
.chat-head-info {
  flex: 1;
  min-width: 0;
}
.chat-head-name {
  font-weight: 700;
  font-size: 16px;
  color: var(--pv-text);
}
.chat-head-account {
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.chat-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.chat-tip {
  margin: 0;
  padding: 10px 20px;
  font-size: 13px;
  color: var(--pv-text-secondary);
  background: var(--pv-tint);
  border-bottom: 1px solid var(--pv-border);
}
.chat-tip-stop {
  color: var(--pv-ink);
  background: #fdf3e6;
}
.chat-body {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 18px 20px;
}
.chat-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.chat-foot {
  padding: 10px 20px 16px;
  border-top: 1px solid var(--pv-border);
  background: var(--pv-glass-strong);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* 时间分隔条：居中弱化显示（仿微信） */
.msg-divider {
  text-align: center;
  font-size: 12px;
  color: var(--pv-text-secondary);
  margin: 16px 0 12px;
}
.msg {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 14px;
}
.msg.mine {
  justify-content: flex-end;
}
.msg-avatar {
  flex-shrink: 0;
  --el-avatar-border-radius: 6px;
}
.bubble {
  position: relative;
  max-width: 65%;
  background: #fff;
  border-radius: 2px 10px 10px 10px;
  padding: 9px 12px;
  box-shadow: var(--pv-shadow-sm);
  animation: msg-in 0.18s ease-out;
}
@keyframes msg-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
/* 气泡小三角指向头像，仿微信效果 */
.bubble::before {
  content: '';
  position: absolute;
  top: 12px;
  border: 6px solid transparent;
}
.msg:not(.mine) .bubble::before {
  left: -11px;
  border-right-color: #fff;
}
.msg.mine .bubble {
  background: var(--pv-ink);
  border-radius: 10px 2px 10px 10px;
}
.msg.mine .bubble::before {
  right: -11px;
  border-left-color: var(--pv-ink);
}
.bubble-text {
  font-size: 14px;
  color: var(--pv-text);
  word-break: break-word;
  white-space: pre-wrap;
}
.msg.mine .bubble-text {
  color: #fff;
}
/* 图片消息：气泡透明化，直接展示图片本体 */
.bubble-media {
  padding: 0;
  background: transparent;
  box-shadow: none;
}
.bubble-media::before {
  display: none;
}
.bubble-img {
  display: block;
  max-width: 180px;
  max-height: 180px;
  border-radius: 8px;
  cursor: zoom-in;
}
/* 视频消息：气泡内直接播放 */
.bubble-video {
  display: block;
  max-width: 240px;
  max-height: 180px;
  border-radius: 8px;
  background: #000;
}
/* 文件消息卡片：图标 + 文件名，点击打开详情 */
.bubble-file {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 140px;
  max-width: 100%;
  color: inherit;
  text-decoration: none;
}
.bubble-file-icon {
  flex-shrink: 0;
  color: var(--pv-ink);
}
.bubble-file-name {
  font-size: 13px;
  word-break: break-all;
}
.msg.mine .bubble-file-icon,
.msg.mine .bubble-file-name {
  color: #fff;
}
.chat-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.chat-attach-btn {
  padding: 4px;
  color: var(--pv-text-secondary);
}
.chat-attach-btn:hover {
  color: var(--pv-ink);
}
.chat-upload-tip {
  font-size: 12px;
  color: var(--pv-text-secondary);
}
/* 待发送文件预览区 */
.pending-files {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 12px;
  background: var(--pv-tint);
  border: 1px solid var(--pv-border);
  border-radius: 10px;
}
.pending-item {
  position: relative;
  width: 90px;
  height: 90px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid var(--pv-border);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pending-uploading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.pending-img,
.pending-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.pending-file {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px;
  color: var(--pv-ink);
}
.pending-file-name {
  font-size: 11px;
  word-break: break-all;
  text-align: center;
  line-height: 1.3;
  max-height: 2.6em;
  overflow: hidden;
}
.pending-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  cursor: pointer;
  color: #fff;
  background: rgba(23, 24, 28, 0.6);
  border-radius: 50%;
  padding: 2px;
  transition: background 0.15s;
}
.pending-remove:hover {
  background: rgba(23, 24, 28, 0.9);
}
.file-input-hidden {
  display: none;
}
/* 拖拽蒙层：文件拖入时提示松手发送（仿微信） */
.chat-drop-mask {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--pv-ink);
  background: rgba(242, 242, 239, 0.92);
  border: 2px dashed var(--pv-ink);
  border-radius: 12px;
  font-size: 14px;
  pointer-events: none;
}
/* 文件详情弹窗 */
.file-detail {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 20px 0;
}
.file-detail-icon {
  color: var(--pv-ink);
  flex-shrink: 0;
}
.file-detail-info {
  flex: 1;
  min-width: 0;
}
.file-detail-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--pv-text);
  word-break: break-all;
  margin-bottom: 8px;
}
.file-detail-type {
  font-size: 13px;
  color: var(--pv-text-secondary);
}
/* 图片/视频预览弹窗 */
.media-preview {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 300px;
  background: #000;
  border-radius: 8px;
}
.preview-img {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
}
.preview-video {
  max-width: 100%;
  max-height: 70vh;
}
.chat-input {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}
.empty-tip {
  color: var(--pv-text-secondary);
  text-align: center;
  padding: 18px 0;
}
@media (max-width: 768px) {
  .chat-page {
    padding: 12px 16px;
  }
  .chat-head {
    flex-wrap: wrap;
    padding: 12px 14px;
  }
  .chat-input {
    flex-wrap: wrap;
  }
}
</style>
