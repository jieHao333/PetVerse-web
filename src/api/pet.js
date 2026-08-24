import request from './request'

/** 查询当前用户的出场宠物，无宠物返回 null */
export const getMyPet = () => request.get('/pet/me', { params: { userId: getUserId() } })

/** 查询当前用户的全部宠物，按领养先后排序 */
export const listMyPets = () => request.get('/pet/my-list', { params: { userId: getUserId() } })

/** 按用户ID查询出场宠物（用户主页展示他人宠物），无宠物返回 null */
export const getPetByUserId = (userId) => request.get('/pet/me', { params: { userId } })

/** 获取宠物图鉴列表 */
export const getCatalog = () => request.get('/pet/catalog')

/** 随机抽取预览 */
export const randomCatalog = () => request.get('/pet/catalog/random')

/** 领取宠物 */
export const claimPet = (data) => request.post('/pet/claim', data)

/** 修改宠物名称（按宠物ID），返回更新后的宠物信息 */
export const renamePet = (petId, name) => request.put('/pet/rename', { userId: getUserId(), petId, name })

/** 设置出场宠物，返回更新后的宠物信息 */
export const setActivePet = (petId) => request.put('/pet/active', { userId: getUserId(), petId })

/** 每日签到，为用户所有宠物增加经验 */
export const signIn = () => request.post('/pet/sign-in', { userId: getUserId() })

function getUserId() {
  const user = JSON.parse(localStorage.getItem('user') || 'null')
  return user?.id
}
