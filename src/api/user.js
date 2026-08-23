import request from './request'

/** 用户注册，返回登录结果（token + 用户信息） */
export const register = (data) => request.post('/user/register', data)

/** 用户登录 */
export const login = (data) => request.post('/user/login', data)

/** 获取当前登录用户信息 */
export const getMe = () => request.get('/user/me')

/** 根据ID查询用户信息（用户主页） */
export const getUserById = (id) => request.get(`/user/${id}`)

/** 修改用户资料 */
export const updateUser = (data) => request.put('/user', data)

/** 按用户名或昵称搜索用户（加好友场景） */
export const searchUsers = (keyword) => request.get('/user/search', { params: { keyword } })

/** 上传头像（存储到阿里云OSS），返回最新用户信息 */
export const uploadAvatar = (file) => {
  const formData = new FormData()
  formData.append('file', file)
  return request.post('/user/avatar', formData)
}
