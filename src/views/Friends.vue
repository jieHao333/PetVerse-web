<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Close, Document, Loading, Paperclip, UploadFilled } from '@element-plus/icons-vue'
import { searchUsers } from '@/api/user'
import {
  acceptFriendRequest,
  deleteConversation,
  getConversations,
  getFriends,
  getMessages,
  getReceivedRequests,
  markChatRead,
  rejectFriendRequest,
  removeFriend,
  sendMessage,
  sendFriendRequest,
  uploadChatFile,
} from '@/api/social'
import { DEFAULT_AVATAR } from '@/utils/avatar'

const activeTab = ref('messages')

const router = useRouter()

// 点击用户名跳转用户主页（账号信息 + 宠物 + 动态）
const gotoProfile = (userId) => {
  if (userId) router.push(`/user/${userId}`)
}

// 判断搜索结果中的用户是否已是好友（ID 统一转字符串比较，避免类型不一致漏判）
const isFriendAlready = (user) =>
  friends.value.some((f) => String(f.userId) === String(user.id))

// 把搜索结果适配为好友结构，复用好友列表的聊天/删除交互
const asFriend = (user) => ({
  userId: user.id,
  username: user.username,
  nickname: user.nickname,
  avatar: user.avatar,
})

// 好友与申请数据
const friends = ref([])
const requests = ref([])
const loadingFriends = ref(false)
const loadingRequests = ref(false)

// 消息（会话）列表数据
const conversations = ref([])
const loadingConversations = ref(false)

// 未读消息总数（消息页签角标）
const totalUnread = computed(() =>
  conversations.value.reduce((sum, c) => sum + (Number(c.unreadCount) || 0), 0),
)

// 待处理申请数量（页签角标）
const pendingCount = computed(() => requests.value.filter((r) => r.status === 0).length)

// 搜索加好友
const keyword = ref('')
const searching = ref(false)
const searched = ref(false)
const results = ref([])
const applyingId = ref(null)

// 聊天弹窗
const chatDialog = ref(false)
const chatFriend = ref(null)
const messages = ref([])
const draft = ref('')
const sending = ref(false)
const messageBox = ref(null)
let chatTimer = null

const myId = computed(() => JSON.parse(localStorage.getItem('user') || 'null')?.id)

// 本人头像（本地登录信息）
const myUser = computed(() => JSON.parse(localStorage.getItem('user') || 'null'))
const myAvatar = computed(() => myUser.value?.avatar || DEFAULT_AVATAR)
const myName = computed(() => myUser.value?.nickname || myUser.value?.username || 'U')
// 对方头像（好友列表 8 秒轮询，头像变更会自动同步）
const friendAvatar = computed(() => chatFriend.value?.avatar || DEFAULT_AVATAR)

// 后端 Long 序列化为字符串，与本地缓存的 id 统一转字符串比较，避免类型不一致导致误判
const isMine = (msg) => String(msg.senderId) === String(myId.value)

const displayName = (u) => u?.nickname || u?.username || '用户'

// 时间格式化：2026-08-22T13:58 -> 2026-08-22 13:58
const formatTime = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '')

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

// 消息展示列表：相邻消息间隔超过 5 分钟时插入时间分隔条，渲染负担更轻、层次更清晰
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

const loadFriends = async (silent = false) => {
  loadingFriends.value = !silent
  try {
    friends.value = await getFriends()
  } catch (e) {
    if (!silent) ElMessage.error(e.message)
  } finally {
    loadingFriends.value = false
  }
}

const loadRequests = async (silent = false) => {
  loadingRequests.value = !silent
  try {
    requests.value = await getReceivedRequests()
  } catch (e) {
    if (!silent) ElMessage.error(e.message)
  } finally {
    loadingRequests.value = false
  }
}

const loadConversations = async (silent = false) => {
  loadingConversations.value = !silent
  try {
    conversations.value = await getConversations()
  } catch (e) {
    if (!silent) ElMessage.error(e.message)
  } finally {
    loadingConversations.value = false
  }
}

// 会话预览文案：图片/视频/文件按类型占位，文本直接展示内容
const conversationPreview = (conv) => {
  if (conv.lastMsgType === 1) return '[图片]'
  if (conv.lastMsgType === 2) {
    return isVideo(conv.lastContent) ? '[视频]' : '[文件]'
  }
  return conv.lastContent || ''
}

// 会话时间展示：今天显示时分，今年显示月日，更早显示完整日期
const formatConvTime = (t) => {
  const date = parseTime(t)
  if (!date) return ''
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  if (date.toDateString() === now.toDateString()) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${pad(date.getMonth() + 1)}月${pad(date.getDate())}日`
  }
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`
}

// 删除（清空）会话：仅从消息列表移除，好友关系保留，好友列表可重新“聊一聊”
const onDeleteConversation = async (conv) => {
  try {
    await ElMessageBox.confirm('确定删除该条会话吗？删除后仅从消息列表移除，不影响好友关系。', '删除会话', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await deleteConversation(conv.friendUserId)
    ElMessage.success('已删除会话')
    loadConversations(true)
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// 定时轮询好友与申请列表，对方新发起的申请无需刷新页面即可看到
let listTimer = null

onMounted(() => {
  loadConversations()
  loadFriends()
  loadRequests()
  listTimer = setInterval(() => {
    loadConversations(true)
    loadFriends(true)
    loadRequests(true)
  }, 8000)
})

// 搜索用户
const onSearch = async () => {
  const kw = keyword.value.trim()
  if (!kw) {
    ElMessage.warning('请输入用户名或昵称')
    return
  }
  searching.value = true
  try {
    results.value = await searchUsers(kw)
    searched.value = true
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    searching.value = false
  }
}

// 发起好友申请
const onApply = async (user) => {
  applyingId.value = user.id
  try {
    await sendFriendRequest(user.id)
    user.applied = true
    ElMessage.success(`已向 ${displayName(user)} 发送好友申请`)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    applyingId.value = null
  }
}

// 同意 / 拒绝申请
const onAccept = async (req) => {
  try {
    await acceptFriendRequest(req.id)
    ElMessage.success(`已和 ${req.fromNickname || req.fromUsername} 成为好友`)
    req.status = 1
    loadFriends()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

const onReject = async (req) => {
  try {
    await rejectFriendRequest(req.id)
    ElMessage.success('已拒绝该申请')
    req.status = 2
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// 删除好友
const onRemove = async (friend) => {
  try {
    await ElMessageBox.confirm(`确定删除好友「${displayName(friend)}」吗？删除后将无法继续聊天。`, '删除好友', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await removeFriend(friend.userId)
    ElMessage.success('已删除好友')
    loadFriends()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// 最近一次消息指纹（末条ID:条数）：轮询无新消息时跳过重渲染与滚动，避免页面抖动
let lastMsgKey = ''

// 是否贴底：用户翻看历史（未贴底）时，新消息到达不强制拉回底部
let stickBottom = true

// 点击会话项：把会话数据适配为 openChat 需要的好友结构后打开聊天
const openConversation = (conv) => {
  openChat({
    userId: conv.friendUserId,
    username: conv.username,
    nickname: conv.nickname,
    avatar: conv.avatar,
  })
}

// 聊天：打开弹窗并开始轮询新消息；重置指纹确保首屏完整加载；进入即标记已读、清零角标
const openChat = async (friend) => {
  chatFriend.value = friend
  chatDialog.value = true
  lastMsgKey = ''
  stickBottom = true
  await refreshMessages(true)
  markConversationRead(friend.userId)
  chatTimer = setInterval(() => refreshMessages(false), 3000)
}

const closeChat = () => {
  if (chatTimer) {
    clearInterval(chatTimer)
    chatTimer = null
  }
  // 关闭聊天时将本次会话期间新收到的消息一并标为已读
  if (chatFriend.value) markConversationRead(chatFriend.value.userId)
  chatFriend.value = null
  messages.value = []
  draft.value = ''
  lastMsgKey = ''
  dragDepth.value = 0
}

// 标记已读：失败静默，避免打扰聊天；成功后刷新消息列表角标
const markConversationRead = async (friendUserId) => {
  try {
    await markChatRead(friendUserId)
    loadConversations(true)
  } catch {
    /* 忽略已读标记失败 */
  }
}

// 滚动时更新贴底状态，距底部 60px 内视为贴底
const onScroll = () => {
  const box = messageBox.value
  if (!box) return
  stickBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60
}

// 拉取聊天记录：指纹未变化时跳过重渲染；仅贴底时自动滚动，静默失败避免轮询频繁报错
const refreshMessages = async (notify = true) => {
  if (!chatFriend.value) return
  try {
    const list = await getMessages(chatFriend.value.userId)
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

const onSend = async () => {
  const content = draft.value.trim()
  const files = pendingFiles.value.filter((f) => !f.uploading && f.url)
  // 既无文本也无待发送文件，直接返回
  if (!content && !files.length) return
  sending.value = true
  try {
    // 先发送文本消息（在上）
    if (content) {
      await sendMessage({ receiverId: chatFriend.value.userId, content })
      draft.value = ''
      await refreshMessages(true)
    }
    // 再逐个发送文件消息（在下）
    pendingFiles.value = []
    for (const file of files) {
      await sendMessage({
        receiverId: chatFriend.value.userId,
        content: file.url,
        msgType: file.msgType,
        fileName: file.fileName,
      })
      await refreshMessages(true)
    }
  } catch (err) {
    ElMessage.error(err.message)
  } finally {
    sending.value = false
  }
}

// 发送文件：选择/拖入后先上传 OSS 到待发送区，用户点发送才真正发出（仿微信）
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

// 从待发送区移除某个文件
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

// 图片/视频预览弹窗：点击后弹窗预览，可保存到本地
const mediaPreviewDialog = ref(false)
const mediaPreview = ref(null) // { url, type: 'image' | 'video' }

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

onUnmounted(() => {
  if (chatTimer) clearInterval(chatTimer)
  if (listTimer) clearInterval(listTimer)
})
</script>

<template>
  <div class="page">
    <div class="page-container">
      <!-- 添加好友 -->
      <el-card shadow="never" class="section">
        <template #header>
          <span class="card-title">添加好友</span>
        </template>
        <div class="search-bar">
          <el-input
            v-model.trim="keyword"
            class="search-input"
            size="large"
            placeholder="输入用户名或昵称搜索"
            clearable
            @keyup.enter="onSearch"
          />
          <el-button type="primary" size="large" :loading="searching" @click="onSearch">
            搜索
          </el-button>
        </div>

        <div v-if="searched" class="search-results">
          <p v-if="!results.length" class="empty-tip">没有找到匹配的用户</p>
          <div v-for="user in results" :key="user.id" class="user-item">
            <el-avatar :size="44" :src="user.avatar || DEFAULT_AVATAR">
              {{ (user.nickname || user.username || 'U')[0].toUpperCase() }}
            </el-avatar>
            <div class="user-info">
              <div class="user-name name-link" @click="gotoProfile(user.id)">{{ displayName(user) }}</div>
              <div class="user-account">账号: {{ user.username }}</div>
            </div>
            <div v-if="isFriendAlready(user)" class="item-actions">
              <el-button type="primary" size="small" round @click="openChat(asFriend(user))">聊一聊</el-button>
              <el-button size="small" round class="danger-btn" @click="onRemove(asFriend(user))">删除</el-button>
            </div>
            <el-button
              v-else-if="user.applied"
              disabled
              size="small"
              round
            >
              已申请
            </el-button>
            <el-button
              v-else
              type="primary"
              size="small"
              round
              :loading="applyingId === user.id"
              @click="onApply(user)"
            >
              加好友
            </el-button>
          </div>
        </div>
      </el-card>

      <!-- 好友列表 / 好友申请 -->
      <el-card shadow="never" class="section">
        <el-tabs v-model="activeTab">
          <el-tab-pane name="messages">
            <template #label>
              <el-badge :value="totalUnread" :hidden="!totalUnread" :max="99">
                消息
              </el-badge>
            </template>
            <div v-loading="loadingConversations" class="list-body">
              <p v-if="!conversations.length" class="empty-tip">
                还没有消息记录，去“我的好友”里找好友聊一聊吧
              </p>
              <div
                v-for="conv in conversations"
                :key="conv.friendUserId"
                class="user-item conv-item"
                @click="openConversation(conv)"
              >
                <el-badge
                  :value="Number(conv.unreadCount) || 0"
                  :hidden="!(Number(conv.unreadCount) > 0)"
                  :max="99"
                  class="conv-avatar-badge"
                >
                  <el-avatar :size="44" :src="conv.avatar || DEFAULT_AVATAR">
                    {{ (conv.nickname || conv.username || 'U')[0].toUpperCase() }}
                  </el-avatar>
                </el-badge>
                <div class="user-info">
                  <div class="user-name">{{ displayName(conv) }}</div>
                  <div class="conv-preview">{{ conversationPreview(conv) }}</div>
                </div>
                <div class="conv-meta">
                  <span class="conv-time">{{ formatConvTime(conv.lastTime) }}</span>
                  <el-button
                    text
                    size="small"
                    class="danger-btn conv-del"
                    @click.stop="onDeleteConversation(conv)"
                  >
                    删除
                  </el-button>
                </div>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane label="我的好友" name="friends">
            <div v-loading="loadingFriends" class="list-body">
              <p v-if="!friends.length" class="empty-tip">
                还没有好友，去上面搜索添加吧
              </p>
              <div v-for="friend in friends" :key="friend.userId" class="user-item">
                <el-avatar :size="44" :src="friend.avatar || DEFAULT_AVATAR">
                  {{ (friend.nickname || friend.username || 'U')[0].toUpperCase() }}
                </el-avatar>
                <div class="user-info">
                  <div class="user-name name-link" @click="gotoProfile(friend.userId)">{{ displayName(friend) }}</div>
                  <div class="user-account">账号: {{ friend.username }}</div>
                </div>
                <div class="item-actions">
                  <el-button type="primary" size="small" round @click="openChat(friend)">聊一聊</el-button>
                  <el-button size="small" round class="danger-btn" @click="onRemove(friend)">删除</el-button>
                </div>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane name="requests">
            <template #label>
              <el-badge :value="pendingCount" :hidden="!pendingCount" :max="99">
                好友申请
              </el-badge>
            </template>
            <div v-loading="loadingRequests" class="list-body">
              <p v-if="!requests.length" class="empty-tip">暂无好友申请</p>
              <div v-for="req in requests" :key="req.id" class="user-item">
                <el-avatar :size="44" :src="req.fromAvatar || DEFAULT_AVATAR">
                  {{ (req.fromNickname || req.fromUsername || 'U')[0].toUpperCase() }}
                </el-avatar>
                <div class="user-info">
                  <div class="user-name name-link" @click="gotoProfile(req.fromUserId)">{{ req.fromNickname || req.fromUsername }}</div>
                  <div class="user-account">账号: {{ req.fromUsername }} · {{ formatTime(req.createTime) }}</div>
                </div>
                <div v-if="req.status === 0" class="item-actions">
                  <el-button type="primary" size="small" round @click="onAccept(req)">同意</el-button>
                  <el-button size="small" round @click="onReject(req)">拒绝</el-button>
                </div>
                <el-tag v-else-if="req.status === 1" type="success" effect="plain" round>已同意</el-tag>
                <el-tag v-else type="info" effect="plain" round>已拒绝</el-tag>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </div>

    <!-- 聊天弹窗 -->
    <el-dialog v-model="chatDialog" width="480px" @close="closeChat">
      <template #header>
        <div class="chat-header">
          <el-avatar
            shape="square"
            :size="40"
            :src="friendAvatar"
            class="chat-header-avatar"
            @click="gotoProfile(chatFriend?.userId)"
          >
            {{ (chatFriend?.nickname || chatFriend?.username || 'U')[0].toUpperCase() }}
          </el-avatar>
          <div class="chat-header-info">
            <div class="chat-header-name">{{ displayName(chatFriend) }}</div>
            <div class="chat-header-account">账号: {{ chatFriend?.username }}</div>
          </div>
        </div>
      </template>
      <div
        class="chat-box"
        @dragenter="onDragEnter"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
      >
        <div v-if="dragging" class="chat-drop-mask">
          <el-icon :size="36"><UploadFilled /></el-icon>
          <p>松开即可发送文件</p>
        </div>
        <div ref="messageBox" class="chat-messages" @scroll="onScroll">
          <p v-if="!messages.length" class="empty-tip">还没有聊天记录，说点什么吧</p>
          <template v-for="item in chatList" :key="item.key">
            <div v-if="item.type === 'divider'" class="msg-divider">{{ item.text }}</div>
            <div v-else class="msg" :class="{ mine: isMine(item.msg) }">
              <el-avatar v-if="!isMine(item.msg)" class="msg-avatar" shape="square" :size="36" :src="friendAvatar">
                {{ (chatFriend?.nickname || chatFriend?.username || 'U')[0].toUpperCase() }}
              </el-avatar>
              <div
                class="bubble"
                :class="{ 'bubble-media': isMediaBubble(item.msg) }"
                :title="formatTime(item.msg.createTime)"
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
                  <div
                    v-else
                    class="bubble-file"
                    @click="openFileInfo(item.msg)"
                  >
                    <el-icon :size="26" class="bubble-file-icon"><Document /></el-icon>
                    <span class="bubble-file-name">{{ item.msg.fileName || '文件' }}</span>
                  </div>
                </template>
                <div v-else class="bubble-text">{{ item.msg.content }}</div>
              </div>
              <el-avatar v-if="isMine(item.msg)" class="msg-avatar" shape="square" :size="36" :src="myAvatar">
                {{ myName[0].toUpperCase() }}
              </el-avatar>
            </div>
          </template>
        </div>
        <div class="chat-toolbar">
          <el-tooltip content="发送图片或文件（也可直接拖入）" placement="top">
            <el-button text class="chat-attach-btn" :disabled="sending || uploading" @click="triggerFilePick">
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
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            @keydown.enter.exact.prevent="onSend"
          />
          <el-button type="primary" :loading="sending" :disabled="!draft.trim() && !pendingFiles.length" @click="onSend">
            {{ pendingFiles.length ? `发送 (${pendingFiles.length})` : '发送' }}
          </el-button>
        </div>
        <input ref="fileInput" type="file" multiple class="file-input-hidden" @change="onFilePicked" />
      </div>
    </el-dialog>

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
.page {
  min-height: 100vh;
}
.section {
  margin-bottom: 24px;
}
.card-title {
  font-weight: 700;
  font-size: 15px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.card-title::before {
  content: '';
  width: 4px;
  height: 16px;
  border-radius: 2px;
  background: var(--pv-ink);
}

/* 搜索区 */
.search-bar {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}
.search-input {
  width: 420px;
  max-width: 100%;
}
.search-results {
  margin-top: 20px;
}

/* 用户条目（搜索结果 / 好友 / 申请共用） */
.user-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid var(--pv-border);
  border-radius: 12px;
  background: #fff;
  margin-bottom: 12px;
  transition: box-shadow 0.2s ease;
}
.user-item:hover {
  box-shadow: var(--pv-shadow-sm);
}
.user-info {
  flex: 1;
  min-width: 0;
}
.user-name {
  font-weight: 600;
  color: var(--pv-text);
}
.name-link {
  cursor: pointer;
  transition: color 0.15s ease;
}
.name-link:hover {
  color: var(--pv-ink);
  text-decoration: underline;
}
.user-account {
  font-size: 12px;
  color: var(--pv-text-secondary);
  margin-top: 2px;
}
.item-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.danger-btn {
  color: #b04a4a;
  border-color: #e4caca;
}
.danger-btn:hover,
.danger-btn:focus {
  color: #963535;
  border-color: #963535;
  background: #faf1f1;
}

.list-body {
  min-height: 100px;
  padding-top: 8px;
}

/* 消息（会话）列表项 */
.conv-item {
  cursor: pointer;
}
.conv-avatar-badge :deep(.el-badge__content) {
  border: none;
}
.conv-preview {
  font-size: 13px;
  color: var(--pv-text-secondary);
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conv-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  flex-shrink: 0;
}
.conv-time {
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.conv-del {
  opacity: 0;
  transition: opacity 0.15s ease;
}
.conv-item:hover .conv-del {
  opacity: 1;
}
.empty-tip {
  color: var(--pv-text-secondary);
  text-align: center;
  padding: 18px 0;
}

/* 聊天弹窗 */
.chat-box {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.chat-messages {
  height: 420px;
  overflow-y: auto;
  background: var(--pv-tint);
  border: 1px solid var(--pv-border);
  border-radius: 12px;
  padding: 16px;
}
/* 聊天头部：对方头像（可点击进主页）+ 昵称账号 */
.chat-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.chat-header-avatar {
  cursor: pointer;
  --el-avatar-border-radius: 6px;
}
.chat-header-name {
  font-weight: 600;
  font-size: 15px;
  color: var(--pv-text);
}
.chat-header-account {
  font-size: 12px;
  color: var(--pv-text-secondary);
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
/* 文件消息卡片：图标 + 文件名，点击新标签页打开下载/预览 */
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
/* 发送文件工具栏 */
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
/* 聊天容器：拖拽蒙层需相对定位 */
.chat-box {
  position: relative;
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
/* 视频消息：气泡内直接播放 */
.bubble-video {
  display: block;
  max-width: 240px;
  max-height: 180px;
  border-radius: 8px;
  background: #000;
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
@media (max-width: 768px) {
  .search-input {
    width: 100%;
  }
  .chat-input {
    flex-wrap: wrap;
  }
}
</style>
