/**
 * 用户级本地缓存命名空间
 *
 * 这里存放的都是「属于某个登录用户」的数据快照（个性化推荐、AI 会话缓存等）。
 * 登录态一旦失效（令牌过期、被吊销、主动退出、切换账号），这些快照必须整体清除，
 * 否则下次打开页面仍会命中上一个身份的内容，出现「已是游客却还看得见个性化数据」的残留。
 *
 * 约定：所有按用户隔离的键都以 pv:user:<userId>: 开头，清除时按前缀扫描，
 * 新增缓存只需用 userScopedKey 生成键，不必再改动清理逻辑。
 */

/** 用户级缓存统一前缀 */
export const USER_CACHE_PREFIX = 'pv:user:'

/**
 * 历史遗留前缀：旧版本推荐快照没有纳入统一命名空间，
 * 保留在这里是为了升级后第一次清理时能把存量键一起带走
 */
const LEGACY_PREFIXES = ['pv:recommend:']

/**
 * 生成用户级缓存键：pv:user:<userId>:<module>[:<scene>...]
 * userId 缺失（游客）时返回空串，调用方据此跳过读写
 */
export const userScopedKey = (userId, module, ...rest) => {
  if (userId == null || userId === '') return ''
  return [USER_CACHE_PREFIX + userId, module, ...rest].join(':')
}

/**
 * 清除全部用户级缓存，返回被清除的键数量
 *
 * 先收集再删除：直接在遍历 localStorage 的过程中删除会导致索引错位、漏删。
 * 隐私模式 / 存储被禁用时静默跳过，不影响主流程。
 */
export const purgeUserScopedCache = () => {
  const doomed = []
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key) continue
      if (key.startsWith(USER_CACHE_PREFIX) || LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        doomed.push(key)
      }
    }
    doomed.forEach((key) => localStorage.removeItem(key))
  } catch {
    return 0
  }
  return doomed.length
}
