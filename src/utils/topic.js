// 话题在后端以英文逗号拼接存于 space.category，前端统一在此拆分与限制数量
export const MAX_TOPICS = 6

export const splitTopics = (category) =>
  (category || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
