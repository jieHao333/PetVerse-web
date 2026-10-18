<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { searchUsers } from '@/api/user'
import {
  acceptFriendRequest,
  deleteConversation,
  getConversations,
  getFriends,
  getReceivedRequests,
  rejectFriendRequest,
  removeFriend,
  sendFriendRequest,
} from '@/api/social'
import { DEFAULT_AVATAR } from '@/utils/avatar'

const activeTab = ref('messages')

const router = useRouter()

// 点击用户名跳转用户主页（账号信息 + 宠物 + 动态）
const gotoProfile = (userId) => {
  if (userId) router.push(`/user/${userId}`)
}

// 新标签页打开一对一聊天页：聊天界面独立成页，好友与非好友（打招呼）都走同一入口
const openChatPage = (userId) => {
  if (!userId) return
  window.open(router.resolve({ name: 'chat', params: { userId } }).href, '_blank')
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

const displayName = (u) => u?.nickname || u?.username || '用户'

// 时间格式化：2026-08-22T13:58 -> 2026-08-22 13:58
const formatTime = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '')

// 消息时间解析：后端返回 2026-08-22T13:58 或带空格格式，统一转 Date 供会话排序展示
const parseTime = (t) => (t ? new Date(String(t).replace(' ', 'T')) : null)

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

// 点击会话项：新标签页打开与该用户的聊天页（非好友的招呼会话同样从这里进入）
const openConversation = (conv) => openChatPage(conv.friendUserId)

// 视频按扩展名识别（后端文件消息统一为 msgType 2，前端细分渲染为可播放视频）
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'm4v']
const isVideo = (url) => VIDEO_EXTENSIONS.some((ext) => String(url || '').toLowerCase().endsWith('.' + ext))

onUnmounted(() => {
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
              <el-button type="primary" size="small" round @click="openChatPage(user.id)">聊一聊</el-button>
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
                  <div class="conv-name">
                    <span class="user-name">{{ displayName(conv) }}</span>
                    <!-- 非好友会话来自打招呼：对方回复前只能发一条，标出来免得被当成故障 -->
                    <el-tag v-if="conv.friend === false" size="small" type="warning" effect="plain" round>
                      非好友
                    </el-tag>
                  </div>
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
                  <el-button type="primary" size="small" round @click="openChatPage(friend.userId)">聊一聊</el-button>
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
  overflow-wrap: anywhere;
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
  overflow-wrap: anywhere;
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

/* 会话名行：昵称与「非好友」标识同行 */
.conv-name {
  display: flex;
  align-items: center;
  gap: 8px;
}
@media (max-width: 768px) {
  .search-input {
    width: 100%;
  }
  /* 触屏无 hover：会话删除按钮常显 */
  .conv-del {
    opacity: 1;
  }
  /* 操作按钮另起一行右对齐，给昵称/账号留出完整宽度 */
  .user-item {
    flex-wrap: wrap;
    row-gap: 8px;
  }
  .item-actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
