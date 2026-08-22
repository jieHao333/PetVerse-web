import request from './request'

function getUserId() {
  const user = JSON.parse(localStorage.getItem('user') || 'null')
  return user?.id
}

/** 分页查询笔记 */
export const getNotePage = (params) => request.get('/note/page', { params })

/** 新增笔记 */
export const saveNote = (data) => request.post('/note', { ...data, userId: getUserId() })

/** 修改笔记 */
export const updateNote = (data) => request.put('/note', data)

/** 删除笔记 */
export const deleteNote = (id) => request.delete(`/note/${id}`)
