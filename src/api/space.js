import request from './request'

function getUserId() {
  const user = JSON.parse(localStorage.getItem('user') || 'null')
  return user?.id
}

/** 分页查询宠域空间动态 */
export const getSpacePage = (params) => request.get('/space/page', { params })

/** 发布动态 */
export const saveSpace = (data) => request.post('/space', { ...data, userId: getUserId() })

/** 修改动态 */
export const updateSpace = (data) => request.put('/space', data)

/** 删除动态 */
export const deleteSpace = (id) => request.delete(`/space/${id}`)

/** 上传动态媒体（图片≤5MB / 视频≤50MB），返回 { mediaType, url } */
export const uploadSpaceMedia = (file) => {
  const formData = new FormData()
  formData.append('file', file)
  return request.post('/space/media', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}
