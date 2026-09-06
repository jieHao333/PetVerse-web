import request from './request'

/** 点赞对象类型：0-圈子动态（后续评论等在此扩展） */
export const LIKE_TARGET_SPACE = 0

/** 点赞（幂等，重复点赞返回成功） */
export const likeTarget = (targetType, targetId) =>
  request.post(`/remark/like/${targetType}/${targetId}`)

/** 取消点赞（幂等） */
export const unlikeTarget = (targetType, targetId) =>
  request.delete(`/remark/like/${targetType}/${targetId}`)

/** 批量查询点赞数与当前用户点赞状态，返回 { counts: {id: 数量}, likedIds: [id...] } */
export const getLikeBatch = (targetType, targetIds) =>
  request.get('/remark/like/batch', {
    params: { targetType, targetIds: targetIds.join(',') }
  })

/** 评论对象类型：0-圈子动态（与点赞 target 同构，后续在此扩展） */
export const COMMENT_TARGET_SPACE = 0

/** 发表评论（data: { targetType, targetId, content, replyUserId? }），返回评论详情 */
export const saveComment = (data) => request.post('/remark/comment', data)

/** 分页查询指定对象的评论（params: { targetType, targetId, pageNum, pageSize }，时间正序） */
export const getCommentPage = (params) => request.get('/remark/comment/page', { params })

/** 删除评论（仅本人可删，逻辑删除） */
export const deleteComment = (id) => request.delete(`/remark/comment/${id}`)

/** 批量查询评论数，返回 { [targetId]: 数量 }，供列表页展示每条动态评论数 */
export const getCommentCounts = (targetType, targetIds) =>
  request.get('/remark/comment/counts', {
    params: { targetType, targetIds: targetIds.join(',') }
  })
