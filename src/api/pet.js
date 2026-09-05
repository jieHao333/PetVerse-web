import request from './request'

/** 查询当前用户的代表宠物（优先虚拟宠物），无宠物返回 null（用户身份由后端从登录令牌解析） */
export const getMyPet = () => request.get('/pet/me')

/** 查询当前用户的全部宠物，按领养先后排序 */
export const listMyPets = () => request.get('/pet/my-list')

/** 按ID查询单只宠物（完善信息页载入用） */
export const getPetById = (id) => request.get(`/pet/${id}`)

/** 按用户ID查询代表宠物（用户主页展示他人宠物），无宠物返回 null */
export const getPetByUserId = (userId) => request.get('/pet/me', { params: { userId } })

/** 获取宠物图鉴列表 */
export const getCatalog = () => request.get('/pet/catalog')

/** 随机抽取预览 */
export const randomCatalog = () => request.get('/pet/catalog/random')

/** 领取虚拟宠物 */
export const claimPet = (data) => request.post('/pet/claim', data)

/** 登记真实宠物（名称 + 收养时间），返回新建的宠物信息 */
export const registerPet = (data) => request.post('/pet/register', data)

/** 完善真实宠物档案（种类/性别/生日/绝育），返回更新后的宠物信息 */
export const updatePetProfile = (data) => request.put('/pet/profile', data)

/** 修改宠物名称（按宠物ID），返回更新后的宠物信息 */
export const renamePet = (petId, name) => request.put('/pet/rename', { petId, name })

/** 删除宠物（仅本人宠物，逻辑删除），id 以字符串传递避免精度丢失 */
export const deletePet = (id) => request.delete(`/pet/${id}`)

/** 每日签到，为用户所有虚拟宠物增加经验 */
export const signIn = () => request.post('/pet/sign-in', {})
