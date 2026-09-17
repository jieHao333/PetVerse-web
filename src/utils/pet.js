/**
 * 宠物年龄工具
 *
 * 真实宠物档案的权威年龄来源是生日（pet.age 列登记后不再维护，恒为 0），
 * 展示与发送给 AI 的年龄统一在此按生日换算，避免各页面 / 各上下文各算一套产生不一致。
 */

/**
 * 按生日计算真实宠物的总月龄；生日缺失 / 非法返回 null，未来日期按 0 个月处理
 */
export const realPetMonths = (birthday) => {
  if (!birthday) return null
  const birth = new Date(birthday)
  if (Number.isNaN(birth.getTime())) return null
  const now = new Date()
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth())
  if (now.getDate() < birth.getDate()) months -= 1
  return Math.max(0, months)
}

/**
 * AI 咨询 / 健康评估上下文的年龄信息：
 * - age：数值年龄（真实宠物按生日换算整岁；虚拟宠物取 age 字段），不可得为 null
 * - ageText：精确年龄文本（真实宠物含月龄，如「1 岁 3 个月」「8 个月」；虚拟宠物「X 岁」），不可得为 ''
 * 后端以 ageText 优先渲染档案年龄，保证 AI 看到的年龄与档案 / 身份卡展示一致
 */
export const petAgeInfo = (pet) => {
  if (!pet) return { age: null, ageText: '' }
  if (pet.type === 'REAL') {
    const months = realPetMonths(pet.birthday)
    if (months == null) return { age: null, ageText: '' }
    const years = Math.floor(months / 12)
    const rest = months % 12
    const ageText =
      months < 12 ? `${months} 个月` : rest > 0 ? `${years} 岁 ${rest} 个月` : `${years} 岁`
    return { age: years, ageText }
  }
  return { age: pet.age ?? null, ageText: pet.age != null ? `${pet.age} 岁` : '' }
}
