import request from './request'

/** 分页查询宠域空间动态 */
export const getSpacePage = (params) => request.get('/space/page', { params })

/** 发布动态（作者身份由后端从登录令牌解析，无需传入用户ID） */
export const saveSpace = (data) => request.post('/space', data)

/** 修改动态 */
export const updateSpace = (data) => request.put('/space', data)

/** 删除动态 */
export const deleteSpace = (id) => request.delete(`/space/${id}`)

/** 上传动态媒体（图片≤5MB / 视频≤50MB），返回 { mediaType, url }；大文件上传单独放宽超时 */
export const uploadSpaceMedia = (file) => {
  const formData = new FormData()
  formData.append('file', file)
  return request.post('/space/media', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  })
}
