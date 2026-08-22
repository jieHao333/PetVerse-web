import request from './request'

/** 查询当前用户的宠物，无宠物返回 null */
export const getMyPet = () => request.get('/pet/me', { params: { userId: getUserId() } })

/** 获取宠物图鉴列表 */
export const getCatalog = () => request.get('/pet/catalog')

/** 随机抽取预览 */
export const randomCatalog = () => request.get('/pet/catalog/random')

/** 领取宠物 */
export const claimPet = (data) => request.post('/pet/claim', data)

/** 修改宠物名称，返回更新后的宠物信息 */
export const renamePet = (name) => request.put('/pet/rename', { userId: getUserId(), name })

/** 宠物每日签到 */
export const signIn = () => request.post('/pet/sign-in', { userId: getUserId() })

function getUserId() {
  const user = JSON.parse(localStorage.getItem('user') || 'null')
  return user?.id
}
