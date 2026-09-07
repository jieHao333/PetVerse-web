import request from './request'

/** 通知类型：1-评论 2-回复 3-点赞 */
export const NOTIF_TYPE = {
  COMMENT: 1,
  REPLY: 2,
  LIKE: 3,
}

/** 通知来源：1-圈子动态 2-商品评价 */
export const NOTIF_SOURCE = {
  SPACE: 1,
  SHOP_REVIEW: 2,
}

/** 分页查询我的通知，params: { pageNum, pageSize, onlyUnread? } */
export const pageNotifications = (params) => request.get('/remark/notification/page', { params })

/** 我的未读通知数（顶栏铃铛轮询），注意后端 Long 序列化为字符串，使用需 Number() 还原 */
export const getUnreadCount = () => request.get('/remark/notification/unread-count')

/** 标记单条通知为已读 */
export const markRead = (id) => request.put(`/remark/notification/${id}/read`)

/** 标记我的全部通知为已读 */
export const markAllRead = () => request.put('/remark/notification/read-all')
