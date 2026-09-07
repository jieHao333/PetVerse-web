import request from './request'

/** 发起好友申请 */
export const sendFriendRequest = (toUserId) => request.post('/social/friend/request', { toUserId })

/** 查询我收到的好友申请 */
export const getReceivedRequests = () => request.get('/social/friend/request/received')

/** 同意好友申请 */
export const acceptFriendRequest = (id) => request.put(`/social/friend/request/${id}/accept`)

/** 拒绝好友申请 */
export const rejectFriendRequest = (id) => request.put(`/social/friend/request/${id}/reject`)

/** 查询我的好友列表 */
export const getFriends = () => request.get('/social/friend/list')

/** 删除好友 */
export const removeFriend = (friendUserId) => request.delete(`/social/friend/${friendUserId}`)

/** 发送聊天消息（文本/图片/文件，文件消息传 msgType 与 fileName） */
export const sendMessage = (data) => request.post('/social/chat/message', data)

/** 上传聊天文件（图片/文档/压缩包等≤20MB），返回 { url, msgType, fileName }；大文件上传单独放宽超时 */
export const uploadChatFile = (file) => {
  const formData = new FormData()
  formData.append('file', file)
  return request.post('/social/chat/file', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  })
}

/** 查询与某好友的最近聊天记录 */
export const getMessages = (friendUserId) => request.get('/social/chat/messages', { params: { friendUserId } })

/** 查询我的消息（会话）列表 */
export const getConversations = () => request.get('/social/chat/conversations')

/** 标记与某好友的会话为已读（进入聊天时清零未读角标） */
export const markChatRead = (friendUserId) => request.post('/social/chat/read', null, { params: { friendUserId } })

/** 删除（清空）与某好友的会话 */
export const deleteConversation = (friendUserId) => request.delete('/social/chat/conversation', { params: { friendUserId } })
