<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import { searchUsers } from '@/api/user'
import {
  acceptFriendRequest,
  getFriends,
  getMessages,
  getReceivedRequests,
  rejectFriendRequest,
  removeFriend,
  sendMessage,
  sendFriendRequest,
} from '@/api/social'

const activeTab = ref('friends')

const router = useRouter()

// 点击用户名跳转用户主页（账号信息 + 宠物 + 笔记）
const gotoProfile = (userId) => {
  if (userId) router.push(`/user/${userId}`)
}

// 好友与申请数据
const friends = ref([])
const requests = ref([])
const loadingFriends = ref(false)
const loadingRequests = ref(false)

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
const myAvatar = computed(() => myUser.value?.avatar || '')
const myName = computed(() => myUser.value?.nickname || myUser.value?.username || 'U')
// 对方头像（好友列表 8 秒轮询，头像变更会自动同步）
const friendAvatar = computed(() => chatFriend.value?.avatar || '')

// 后端 Long 序列化为字符串，与本地缓存的 id 统一转字符串比较，避免类型不一致导致误判
const isMine = (msg) => String(msg.senderId) === String(myId.value)

const displayName = (u) => u?.nickname || u?.username || '用户'

// 时间格式化：2026-08-22T13:58 -> 2026-08-22 13:58
const formatTime = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '')

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

// 定时轮询好友与申请列表，对方新发起的申请无需刷新页面即可看到
let listTimer = null

onMounted(() => {
  loadFriends()
  loadRequests()
  listTimer = setInterval(() => {
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

// 聊天：打开弹窗并开始轮询新消息
const openChat = async (friend) => {
  chatFriend.value = friend
  chatDialog.value = true
  await refreshMessages(true)
  chatTimer = setInterval(() => refreshMessages(false), 3000)
}

const closeChat = () => {
  if (chatTimer) {
    clearInterval(chatTimer)
    chatTimer = null
  }
  chatFriend.value = null
  messages.value = []
  draft.value = ''
}

// 拉取聊天记录，静默失败避免轮询时频繁报错
const refreshMessages = async (notify = true) => {
  if (!chatFriend.value) return
  try {
    messages.value = await getMessages(chatFriend.value.userId)
    await nextTick()
    if (messageBox.value) {
      messageBox.value.scrollTop = messageBox.value.scrollHeight
    }
  } catch (e) {
    if (notify) ElMessage.error(e.message)
  }
}

const onSend = async () => {
  const content = draft.value.trim()
  if (!content) return
  sending.value = true
  try {
    await sendMessage({ receiverId: chatFriend.value.userId, content })
    draft.value = ''
    await refreshMessages(true)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    sending.value = false
  }
}

onUnmounted(() => {
  if (chatTimer) clearInterval(chatTimer)
  if (listTimer) clearInterval(listTimer)
})
</script>

<template>
  <div class="page">
    <AppHeader title="好友" show-nav />

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
            <el-avatar :size="44" :src="user.avatar || ''">
              {{ (user.nickname || user.username || 'U')[0].toUpperCase() }}
            </el-avatar>
            <div class="user-info">
              <div class="user-name name-link" @click="gotoProfile(user.id)">{{ displayName(user) }}</div>
              <div class="user-account">@{{ user.username }}</div>
            </div>
            <el-button
              v-if="user.applied"
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
          <el-tab-pane label="我的好友" name="friends">
            <div v-loading="loadingFriends" class="list-body">
              <p v-if="!friends.length" class="empty-tip">
                还没有好友，去上面搜索添加吧
              </p>
              <div v-for="friend in friends" :key="friend.userId" class="user-item">
                <el-avatar :size="44" :src="friend.avatar || ''">
                  {{ (friend.nickname || friend.username || 'U')[0].toUpperCase() }}
                </el-avatar>
                <div class="user-info">
                  <div class="user-name name-link" @click="gotoProfile(friend.userId)">{{ displayName(friend) }}</div>
                  <div class="user-account">账号: {{ friend.username }}</div>
                </div>
                <div class="item-actions">
                  <el-button type="primary" size="small" round @click="openChat(friend)">聊天</el-button>
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
                <el-avatar :size="44" :src="req.fromAvatar || ''">
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
    <el-dialog
      v-model="chatDialog"
      :title="`与 ${displayName(chatFriend)} 聊天`"
      width="480px"
      @close="closeChat"
    >
      <div class="chat-box">
        <div ref="messageBox" class="chat-messages">
          <p v-if="!messages.length" class="empty-tip">还没有聊天记录，说点什么吧</p>
          <div
            v-for="msg in messages"
            :key="msg.id"
            class="msg"
            :class="{ mine: isMine(msg) }"
          >
            <el-avatar v-if="!isMine(msg)" class="msg-avatar" shape="square" :size="36" :src="friendAvatar">
              {{ (chatFriend?.nickname || chatFriend?.username || 'U')[0].toUpperCase() }}
            </el-avatar>
            <div class="bubble">
              <div class="bubble-text">{{ msg.content }}</div>
              <div class="bubble-time">{{ formatTime(msg.createTime) }}</div>
            </div>
            <el-avatar v-if="isMine(msg)" class="msg-avatar" shape="square" :size="36" :src="myAvatar">
              {{ myName[0].toUpperCase() }}
            </el-avatar>
          </div>
        </div>
        <div class="chat-input">
          <el-input
            v-model="draft"
            type="textarea"
            :rows="2"
            maxlength="500"
            placeholder="输入消息，Enter 发送"
            @keydown.enter.exact.prevent="onSend"
          />
          <el-button type="primary" :loading="sending" @click="onSend">发送</el-button>
        </div>
      </div>
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
  height: 360px;
  overflow-y: auto;
  background: var(--pv-tint);
  border: 1px solid var(--pv-border);
  border-radius: 12px;
  padding: 16px;
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
  border-radius: 8px;
  padding: 8px 12px;
  box-shadow: var(--pv-shadow-sm);
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
.bubble-time {
  font-size: 11px;
  color: var(--pv-text-secondary);
  margin-top: 4px;
  text-align: right;
}
.msg.mine .bubble-time {
  color: rgba(255, 255, 255, 0.55);
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
