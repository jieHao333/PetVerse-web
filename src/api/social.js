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

/** 发送聊天消息 */
export const sendMessage = (data) => request.post('/social/chat/message', data)

/** 查询与某好友的最近聊天记录 */
export const getMessages = (friendUserId) => request.get('/social/chat/messages', { params: { friendUserId } })
