import request from './request'

/** 点赞对象类型：0-宠域空间动态（后续评论等在此扩展） */
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
