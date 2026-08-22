import request from './request'

/** 用户注册，返回登录结果（token + 用户信息） */
export const register = (data) => request.post('/user/register', data)

/** 用户登录 */
export const login = (data) => request.post('/user/login', data)

/** 获取当前登录用户信息 */
export const getMe = () => request.get('/user/me')

/** 修改用户资料 */
export const updateUser = (data) => request.put('/user', data)

/** 按用户名或昵称搜索用户（加好友场景） */
export const searchUsers = (keyword) => request.get('/user/search', { params: { keyword } })
