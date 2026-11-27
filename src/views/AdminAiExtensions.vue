<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Plus, Refresh } from '@element-plus/icons-vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import {
  activateModel,
  createMcpServer,
  createModelProvider,
  createSkill,
  deleteMcpServer,
  deleteModelProvider,
  deleteSkill,
  listMcpServers,
  listModelProviders,
  listSkills,
  testMcpServer,
  testModel,
  updateMcpServer,
  updateModelProvider,
  updateSkill,
} from '@/api/ai'

// AI 扩展管理页（管理员限定）：维护对话 Agent 的三类可插拔能力——
// MCP 服务（远程工具来源）、Skill（注入系统提示词的技能指令）与模型（LLM 供应商与切换）。
// 入口由路由 meta.roles 与网关 / 后端 X-User-Role 双重把关，页面本身不处理凭证。
const activeTab = ref('mcp')

const formatTime = (ts) => {
  if (!ts) return '-'
  const d = new Date(ts * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 正文预览：折叠空白后截断。Markdown 原文带换行与缩进，直接塞进单元格会撑成多行
const contentPreview = (content) => {
  const text = (content || '').replace(/\s+/g, ' ').trim()
  if (!text) return '-'
  return text.length > 64 ? `${text.slice(0, 64)}…` : text
}

// ==================== MCP 服务 ====================
const mcpLoading = ref(false)
const mcpServers = ref([])

const TRANSPORTS = [
  { value: 'streamable_http', label: 'Streamable HTTP', tag: 'success' },
  { value: 'sse', label: 'SSE', tag: 'warning' },
  { value: 'stdio', label: 'Stdio（本地命令）', tag: 'info' },
]
const transportMeta = (t) => TRANSPORTS.find((x) => x.value === t) || TRANSPORTS[0]
const isHttpTransport = (t) => t === 'streamable_http' || t === 'sse'

const loadMcpServers = async () => {
  mcpLoading.value = true
  try {
    const data = await listMcpServers()
    mcpServers.value = data.items || []
  } catch (e) {
    ElMessage.error(e.message || 'MCP 服务列表加载失败')
  } finally {
    mcpLoading.value = false
  }
}

// 地址 / 命令列的展示文本：HTTP 类显示 url，stdio 显示 command + args
const mcpEndpoint = (row) =>
  isHttpTransport(row.transport) ? row.url : [row.command, ...(row.args || [])].join(' ')

// ---------- 新增 / 编辑弹窗 ----------
const mcpDialog = ref(false)
const mcpSaving = ref(false)
const mcpEditingId = ref(null)
const mcpForm = reactive({
  name: '',
  transport: 'streamable_http',
  url: '',
  command: '',
  argsText: '',
  description: '',
  enabled: true,
})
// 键值对（请求头 / 环境变量）用动态行编辑，比让管理员手写 JSON 更不易出错
const headerRows = ref([])
const envRows = ref([])

const rowsToObj = (rows) => {
  const obj = {}
  for (const { key, value } of rows) {
    const k = (key || '').trim()
    if (k) obj[k] = value ?? ''
  }
  return obj
}
const objToRows = (obj) => Object.entries(obj || {}).map(([key, value]) => ({ key, value: String(value) }))
const addRow = (rows) => rows.push({ key: '', value: '' })
const removeRow = (rows, index) => rows.splice(index, 1)

const openMcpCreate = () => {
  mcpEditingId.value = null
  Object.assign(mcpForm, {
    name: '', transport: 'streamable_http', url: '', command: '',
    argsText: '', description: '', enabled: true,
  })
  headerRows.value = []
  envRows.value = []
  mcpDialog.value = true
}

const openMcpEdit = (row) => {
  mcpEditingId.value = row.id
  Object.assign(mcpForm, {
    name: row.name,
    transport: row.transport,
    url: row.url || '',
    command: row.command || '',
    argsText: (row.args || []).join('\n'),
    description: row.description || '',
    enabled: row.enabled,
  })
  headerRows.value = objToRows(row.headers)
  envRows.value = objToRows(row.env)
  mcpDialog.value = true
}

const buildMcpPayload = () => ({
  name: mcpForm.name.trim(),
  transport: mcpForm.transport,
  url: mcpForm.url.trim(),
  command: mcpForm.command.trim(),
  args: mcpForm.argsText.split('\n').map((s) => s.trim()).filter(Boolean),
  env: rowsToObj(envRows.value),
  headers: rowsToObj(headerRows.value),
  description: mcpForm.description.trim(),
  enabled: mcpForm.enabled,
})

const validateMcpForm = () => {
  if (!mcpForm.name.trim()) return '请填写服务名称'
  if (isHttpTransport(mcpForm.transport)) {
    const url = mcpForm.url.trim()
    if (!url) return 'HTTP / SSE 传输必须填写服务地址'
    if (!/^https?:\/\//.test(url)) return '服务地址必须以 http:// 或 https:// 开头'
  } else if (!mcpForm.command.trim()) {
    return 'Stdio 传输必须填写启动命令'
  }
  return ''
}

const submitMcp = async () => {
  const err = validateMcpForm()
  if (err) {
    ElMessage.warning(err)
    return
  }
  mcpSaving.value = true
  try {
    const payload = buildMcpPayload()
    if (mcpEditingId.value == null) {
      await createMcpServer(payload)
      ElMessage.success('MCP 服务已新增')
    } else {
      await updateMcpServer(mcpEditingId.value, payload)
      ElMessage.success('MCP 服务已更新')
    }
    mcpDialog.value = false
    await loadMcpServers()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    mcpSaving.value = false
  }
}

// 启停开关：受控写法（:model-value + @change），成功后才落值，失败时开关保持原状
const toggleMcp = async (row, enabled) => {
  try {
    await updateMcpServer(row.id, {
      name: row.name,
      transport: row.transport,
      url: row.url || '',
      command: row.command || '',
      args: row.args || [],
      env: row.env || {},
      headers: row.headers || {},
      description: row.description || '',
      enabled,
    })
    row.enabled = enabled
    ElMessage.success(enabled ? '已启用，下一轮对话生效' : '已停用')
  } catch (e) {
    ElMessage.error(e.message || '状态更新失败')
  }
}

const removeMcp = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确定删除 MCP 服务[${row.name}]？删除后模型将不再能调用该服务提供的工具。`,
      '删除 MCP 服务',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await deleteMcpServer(row.id)
    ElMessage.success('已删除')
    await loadMcpServers()
  } catch (e) {
    ElMessage.error(e.message || '删除失败')
  }
}

// ---------- 连接测试 ----------
const testDialog = ref(false)
const testLoading = ref(false)
const testServerName = ref('')
const testResult = ref(null)
const testError = ref('')

const runTest = async (row) => {
  testServerName.value = row.name
  testDialog.value = true
  testLoading.value = true
  testResult.value = null
  testError.value = ''
  try {
    testResult.value = await testMcpServer(row.id)
  } catch (e) {
    testError.value = e.message || '连接失败'
  } finally {
    testLoading.value = false
  }
}

// ==================== Skill 技能 ====================
const skillLoading = ref(false)
const skills = ref([])

const loadSkills = async () => {
  skillLoading.value = true
  try {
    const data = await listSkills()
    skills.value = data.items || []
  } catch (e) {
    ElMessage.error(e.message || 'Skill 列表加载失败')
  } finally {
    skillLoading.value = false
  }
}

const skillDialog = ref(false)
const skillSaving = ref(false)
// 技能以 name（hyphen-case）为唯一标识与目录名，编辑时记录原名用于 PUT 路径
const skillEditingName = ref(null)
const skillForm = reactive({ name: '', description: '', content: '', enabled: true })

const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const openSkillCreate = () => {
  skillEditingName.value = null
  Object.assign(skillForm, { name: '', description: '', content: '', enabled: true })
  skillDialog.value = true
}

const openSkillEdit = (row) => {
  skillEditingName.value = row.name
  Object.assign(skillForm, {
    name: row.name,
    description: row.description || '',
    content: row.content || '',
    enabled: row.enabled,
  })
  skillDialog.value = true
}

const validateSkillForm = () => {
  const name = skillForm.name.trim()
  if (!name) return '请填写技能名称'
  if (!SKILL_NAME_RE.test(name)) return '技能名须为 hyphen-case（小写字母/数字/连字符，如 petcare-calc）'
  const desc = skillForm.description.trim()
  if (!desc) return '请填写 description（说明做什么 + 何时触发，是技能被选用的依据）'
  if (/[\r\n]/.test(desc)) return 'description 必须为单行'
  if (desc.length > 1024) return 'description 不能超过 1024 字符'
  if (!skillForm.content.trim()) return '请填写技能正文'
  if (skillForm.content.split('\n').length > 500) return '技能正文不能超过 500 行'
  return ''
}

const submitSkill = async () => {
  const err = validateSkillForm()
  if (err) {
    ElMessage.warning(err)
    return
  }
  skillSaving.value = true
  try {
    const payload = {
      name: skillForm.name.trim(),
      description: skillForm.description.trim(),
      content: skillForm.content.trim(),
      enabled: skillForm.enabled,
    }
    if (skillEditingName.value == null) {
      await createSkill(payload)
      ElMessage.success('Skill 已新增')
    } else {
      await updateSkill(skillEditingName.value, payload)
      ElMessage.success('Skill 已更新')
    }
    skillDialog.value = false
    await loadSkills()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    skillSaving.value = false
  }
}

const toggleSkill = async (row, enabled) => {
  try {
    await updateSkill(row.name, {
      name: row.name,
      description: row.description || '',
      content: row.content || '',
      enabled,
    })
    row.enabled = enabled
    ElMessage.success(enabled ? '已启用，下一轮对话生效' : '已停用')
  } catch (e) {
    ElMessage.error(e.message || '状态更新失败')
  }
}

const removeSkill = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确定删除 Skill[${row.name}]？将删除整个技能包目录，其指令不再出现在技能目录中。`,
      '删除 Skill',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await deleteSkill(row.name)
    ElMessage.success('已删除')
    await loadSkills()
  } catch (e) {
    ElMessage.error(e.message || '删除失败')
  }
}

// ---------- 技能预览（Markdown 渲染，先经 DOMPurify 消毒） ----------
const skillPreviewVisible = ref(false)
const skillPreview = ref(null)
const skillPreviewHtml = computed(() => {
  const content = skillPreview.value?.content
  if (!content) return ''
  return DOMPurify.sanitize(marked.parse(content))
})
const openSkillPreview = (row) => {
  skillPreview.value = row
  skillPreviewVisible.value = true
}

// ==================== 模型（供应商 + 当前生效模型） ====================
// 结构对齐 ZCode / Zed 一类 Agent 客户端：供应商描述「协议 + Base URL + Key」，
// 其下挂多个模型 ID；全局只有一个「当前生效模型」，切换后下一轮对话立即生效。
const modelLoading = ref(false)
const providers = ref([])
const activeSelection = ref({ providerId: 0, model: '' })
// 服务端真正在用的配置：可能因供应商停用 / 模型被删 / 无配置而回落到 .env，页面要如实展示
const runtime = ref({})
// MOCK_CHAT 硬开关状态：开启时无论怎么配都返回模拟回复，必须显式提示
const mockMode = ref(false)
// 生效模型下拉的受控值（providerId:modelId），把两段信息压成一个可选项值
const selectedModelKey = ref('')

const PROTOCOLS = [
  {
    value: 'openai',
    label: 'OpenAI 兼容',
    tag: 'success',
    placeholder: 'https://api.deepseek.com/v1',
    hint: '',
  },
  {
    value: 'anthropic',
    label: 'Anthropic',
    tag: 'warning',
    placeholder: 'https://api.anthropic.com',
    hint: '',
  },
]
const protocolMeta = (p) => PROTOCOLS.find((x) => x.value === p) || PROTOCOLS[0]

// 模型的展示名：未填 label 时用模型 ID
const modelName = (m) => (m?.label || '').trim() || m?.id || '-'
// 选项值与生效指针都用「供应商ID:模型ID」编码，切模型只需一个下拉
const modelKey = (providerId, modelId) => `${providerId}:${modelId}`
const splitModelKey = (key) => {
  const idx = String(key || '').indexOf(':')
  if (idx < 0) return { providerId: 0, model: '' }
  return { providerId: Number(key.slice(0, idx)), model: key.slice(idx + 1) }
}

// 可被选为当前模型的供应商：启用且至少有一个模型
const selectableProviders = computed(() =>
  providers.value.filter((p) => p.enabled && (p.models || []).length))

// 当前生效模型的展示文案（来源标签 / 视觉能力已从卡片上移除，只在回落提示里说明）
const runtimeText = computed(() => {
  const r = runtime.value
  if (!r || !r.model) return '未配置（对话将返回模拟回复）'
  const name = r.label && r.label !== r.model ? `${r.label}（${r.model}）` : r.model
  return `${r.providerName || '环境变量（.env）'} · ${name}`
})

const syncSelectedKey = () => {
  const { providerId, model } = activeSelection.value
  selectedModelKey.value = providerId && model ? modelKey(providerId, model) : ''
}

const loadModels = async () => {
  modelLoading.value = true
  try {
    const data = await listModelProviders()
    providers.value = data.items || []
    activeSelection.value = data.active || { providerId: 0, model: '' }
    runtime.value = data.runtime || {}
    mockMode.value = !!data.mock
    syncSelectedKey()
  } catch (e) {
    ElMessage.error(e.message || '模型配置加载失败')
  } finally {
    modelLoading.value = false
  }
}

// 切换当前生效模型：成功后刷新列表拿到服务端实际生效配置；失败把下拉回滚到原值
const onActivateModel = async (key) => {
  const { providerId, model } = splitModelKey(key)
  if (!providerId || !model) {
    syncSelectedKey()
    return
  }
  modelLoading.value = true
  try {
    await activateModel(providerId, model)
    ElMessage.success('已切换，下一轮对话生效')
    await loadModels()
  } catch (e) {
    ElMessage.error(e.message || '切换失败')
    syncSelectedKey()
  } finally {
    modelLoading.value = false
  }
}

// ---------- 供应商新增 / 编辑弹窗 ----------
const providerDialog = ref(false)
const providerSaving = ref(false)
const providerEditingId = ref(null)
// 编辑时回显 Key 尾号；输入框留空表示「沿用原 Key」，避免把脱敏掩码当成新 Key 提交
const providerKeyMask = ref('')
const providerForm = reactive({
  name: '',
  protocol: 'openai',
  baseUrl: '',
  apiKey: '',
  description: '',
  enabled: true,
})
// 模型清单用动态行编辑：一个供应商下可以挂多档模型（便宜的快模型 + 旗舰模型）
// maxTokensText 是「最大输出」的原始输入，支持 128K / 1M / 纯数字三种写法，保存时换算成 token
const modelRows = ref([])

// 1K = 1024 tokens；上限与后端 ModelItem.maxTokens 的 le 保持一致（1M）
const TOKEN_UNITS = { K: 1024, M: 1024 * 1024 }
const MAX_OUTPUT_TOKENS = 1024 * 1024

/**
 * 把「128K / 1M / 131072」解析成 token 数。
 * @param {string|number} raw 用户输入
 * @returns {number} token 数；空输入返回 0（沿用全局）；格式非法返回 NaN
 */
const parseTokens = (raw) => {
  const text = String(raw ?? '').trim().toUpperCase().replace(/[\s,_]/g, '')
  if (!text) return 0
  const matched = text.match(/^(\d+(?:\.\d+)?)([KM]?)$/)
  if (!matched) return Number.NaN
  const value = Number(matched[1]) * (TOKEN_UNITS[matched[2]] || 1)
  return Number.isFinite(value) ? Math.round(value) : Number.NaN
}

/**
 * token 数 → 便于阅读的写法（能整除时用 K / M）。
 * @param {number} tokens token 数
 * @returns {string} 如 131072 → "128K"、1048576 → "1M"、512 → "512"；0 → 空串
 */
const formatTokens = (tokens) => {
  const value = Number(tokens) || 0
  if (value <= 0) return ''
  if (value % TOKEN_UNITS.M === 0) return `${value / TOKEN_UNITS.M}M`
  if (value % TOKEN_UNITS.K === 0) return `${value / TOKEN_UNITS.K}K`
  return String(value)
}

const blankModelRow = () => ({ id: '', label: '', maxTokensText: '', vision: false })

const openProviderCreate = () => {
  providerEditingId.value = null
  providerKeyMask.value = ''
  Object.assign(providerForm, {
    name: '', protocol: 'openai', baseUrl: '', apiKey: '', description: '', enabled: true,
  })
  modelRows.value = [blankModelRow()]
  providerDialog.value = true
}

const openProviderEdit = (row) => {
  providerEditingId.value = row.id
  providerKeyMask.value = row.apiKeyMask || ''
  Object.assign(providerForm, {
    name: row.name,
    protocol: row.protocol || 'openai',
    baseUrl: row.baseUrl || '',
    // 故意留空：留空即沿用原 Key
    apiKey: '',
    description: row.description || '',
    enabled: row.enabled,
  })
  modelRows.value = (row.models || []).length
    ? row.models.map((m) => ({
      id: m.id || '',
      label: m.label || '',
      // 库里存 token，编辑框回显成 K / M 写法（131072 → 128K）
      maxTokensText: formatTokens(m.maxTokens),
      vision: !!m.vision,
    }))
    : [blankModelRow()]
  providerDialog.value = true
}

const addModelRow = () => modelRows.value.push(blankModelRow())
const removeModelRow = (index) => modelRows.value.splice(index, 1)

const buildProviderPayload = () => ({
  name: providerForm.name.trim(),
  protocol: providerForm.protocol,
  baseUrl: providerForm.baseUrl.trim(),
  apiKey: providerForm.apiKey.trim(),
  models: modelRows.value
    .filter((r) => (r.id || '').trim())
    .map((r) => ({
      id: r.id.trim(),
      label: (r.label || '').trim(),
      // 界面写 128K / 1M，落库统一成 token；空 = 0 = 沿用全局 LLM_MAX_TOKENS
      maxTokens: parseTokens(r.maxTokensText) || 0,
      vision: !!r.vision,
    })),
  description: providerForm.description.trim(),
  enabled: providerForm.enabled,
})

const validateProviderForm = () => {
  if (!providerForm.name.trim()) return '请填写供应商名称'
  const url = providerForm.baseUrl.trim()
  if (!url) return '请填写 Base URL'
  if (!/^https?:\/\//.test(url)) return 'Base URL 必须以 http:// 或 https:// 开头'
  if (providerEditingId.value == null && !providerForm.apiKey.trim()) return '请填写 API Key'
  const ids = modelRows.value.map((r) => (r.id || '').trim()).filter(Boolean)
  if (!ids.length) return '请至少添加一个模型'
  if (new Set(ids).size !== ids.length) return '模型 ID 不能重复'
  if (ids.length > 20) return '单个供应商最多添加 20 个模型'
  // 最大输出允许 128K / 1M 写法，但必须能换算成合法 token 数
  for (const row of modelRows.value) {
    const id = (row.id || '').trim()
    if (!id) continue
    const text = (row.maxTokensText || '').trim()
    if (!text) continue
    const tokens = parseTokens(text)
    if (Number.isNaN(tokens)) {
      return `「${id}」的最大输出格式不对：可填 128K / 1M，或直接填 token 数`
    }
    if (tokens > MAX_OUTPUT_TOKENS) {
      return `「${id}」的最大输出不能超过 1M（${MAX_OUTPUT_TOKENS} tokens）`
    }
  }
  return ''
}

const submitProvider = async () => {
  const err = validateProviderForm()
  if (err) {
    ElMessage.warning(err)
    return
  }
  providerSaving.value = true
  try {
    const payload = buildProviderPayload()
    if (providerEditingId.value == null) {
      await createModelProvider(payload)
      ElMessage.success('供应商已新增')
    } else {
      await updateModelProvider(providerEditingId.value, payload)
      ElMessage.success('供应商已更新')
    }
    providerDialog.value = false
    await loadModels()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    providerSaving.value = false
  }
}

// 启停：受控写法，成功后才落值，失败时开关保持原状
const toggleProvider = async (row, enabled) => {
  try {
    await updateModelProvider(row.id, {
      name: row.name,
      protocol: row.protocol,
      baseUrl: row.baseUrl || '',
      // 留空表示沿用原 Key（后端会读原值），这里不需要把掩码传回去
      apiKey: '',
      models: (row.models || []).map((m) => ({
        id: m.id, label: m.label || '', maxTokens: m.maxTokens || 0, vision: !!m.vision,
      })),
      description: row.description || '',
      enabled,
    })
    row.enabled = enabled
    ElMessage.success(enabled ? '已启用' : '已停用，若它是当前模型会自动回落到 .env')
    await loadModels()
  } catch (e) {
    ElMessage.error(e.message || '状态更新失败')
  }
}

const removeProvider = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确定删除供应商「${row.name}」？其下 ${(row.models || []).length} 个模型将一并移除。`,
      '删除模型供应商',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await deleteModelProvider(row.id)
    ElMessage.success('已删除')
    await loadModels()
  } catch (e) {
    ElMessage.error(e.message || '删除失败')
  }
}

// ---------- 连通性测试 ----------
// 真正发一次最小推理请求：能验证「地址可达 + Key 有效 + 模型 ID 存在」，
// 比单纯探活端口更有意义（多数 401 / 404 都在这一步才暴露）。
const providerTestDialog = ref(false)
const providerTestLoading = ref(false)
const providerTestProvider = ref(null)
const providerTestModelId = ref('')
const providerTestResult = ref(null)
const providerTestError = ref('')

const runProviderTest = async () => {
  if (!providerTestProvider.value || !providerTestModelId.value) return
  providerTestLoading.value = true
  providerTestResult.value = null
  providerTestError.value = ''
  try {
    providerTestResult.value = await testModel(providerTestProvider.value.id, providerTestModelId.value)
  } catch (e) {
    providerTestError.value = e.message || '连接失败'
  } finally {
    providerTestLoading.value = false
  }
}

const openProviderTest = (row) => {
  providerTestProvider.value = row
  providerTestModelId.value = row.models?.[0]?.id || ''
  providerTestDialog.value = true
  providerTestResult.value = null
  providerTestError.value = ''
  // 只有一个模型时直接开测，省掉一次点击
  if (providerTestModelId.value && (row.models || []).length === 1) runProviderTest()
}

// 切换待测模型时清掉上一次结果，避免把 A 的结论看成 B 的
const onTestModelChange = () => {
  providerTestResult.value = null
  providerTestError.value = ''
}

const reload = () => {
  loadMcpServers()
  loadSkills()
  loadModels()
}

onMounted(reload)
</script>

<template>
  <div class="page">
    <div class="page-container">
      <el-card shadow="never" class="section">
        <template #header>
          <div class="card-header">
            <span class="card-title">AI 扩展管理</span>
            <div class="filters">
              <el-button :icon="Refresh" @click="reload">刷新</el-button>
            </div>
          </div>
        </template>

        <el-tabs v-model="activeTab" class="ext-tabs">
          <!-- ==================== MCP 服务 ==================== -->
          <el-tab-pane name="mcp">
            <template #label>
              <span class="tab-label">
                MCP 服务
                <span v-if="mcpServers.length" class="tab-count">{{ mcpServers.length }}</span>
              </span>
            </template>

            <div class="tab-toolbar">
              <el-button :icon="Plus" type="primary" @click="openMcpCreate">新增服务</el-button>
            </div>

            <el-table
              v-loading="mcpLoading"
              :data="mcpServers"
              stripe
              class="ext-table"
              empty-text="暂无 MCP 服务，点击「新增服务」接入"
            >
              <el-table-column label="服务" min-width="200">
                <template #default="{ row }">
                  <div class="cell-name">{{ row.name }}</div>
                  <div v-if="row.description" class="cell-source">{{ row.description }}</div>
                </template>
              </el-table-column>
              <el-table-column label="传输" width="150">
                <template #default="{ row }">
                  <el-tag size="small" effect="plain" :type="transportMeta(row.transport).tag">
                    {{ transportMeta(row.transport).label }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="地址 / 命令" min-width="240">
                <template #default="{ row }">
                  <span class="cell-endpoint">{{ mcpEndpoint(row) || '-' }}</span>
                </template>
              </el-table-column>
              <el-table-column label="启用" width="80" align="center">
                <template #default="{ row }">
                  <el-switch :model-value="row.enabled" @change="(v) => toggleMcp(row, v)" />
                </template>
              </el-table-column>
              <el-table-column label="更新时间" width="140">
                <template #default="{ row }">
                  <span class="cell-muted">{{ formatTime(row.updateTime) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="150" align="center">
                <template #default="{ row }">
                  <el-button link type="primary" @click="runTest(row)">测试</el-button>
                  <el-button link type="primary" @click="openMcpEdit(row)">编辑</el-button>
                  <el-button link type="danger" @click="removeMcp(row)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <!-- ==================== Skill 技能 ==================== -->
          <el-tab-pane name="skill">
            <template #label>
              <span class="tab-label">
                Skill 技能
                <span v-if="skills.length" class="tab-count">{{ skills.length }}</span>
              </span>
            </template>

            <div class="tab-toolbar">
              <el-button :icon="Plus" type="primary" @click="openSkillCreate">新增技能</el-button>
            </div>

            <el-table
              v-loading="skillLoading"
              :data="skills"
              row-key="name"
              stripe
              class="ext-table"
              empty-text="暂无 Skill，点击「新增技能」创建"
            >
              <el-table-column label="技能" min-width="220">
                <template #default="{ row }">
                  <div class="cell-name">{{ row.name }}</div>
                  <div v-if="row.description" class="cell-source">{{ row.description }}</div>
                </template>
              </el-table-column>
              <el-table-column label="正文" min-width="260">
                <template #default="{ row }">
                  <div class="cell-endpoint">{{ contentPreview(row.content) }}</div>
                  <div class="cell-meta">
                    {{ row.bodyLines || 0 }} 行
                    <template v-if="row.resources?.length"> · {{ row.resources.join(' / ') }}</template>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="启用" width="80" align="center">
                <template #default="{ row }">
                  <el-switch :model-value="row.enabled" @change="(v) => toggleSkill(row, v)" />
                </template>
              </el-table-column>
              <el-table-column label="更新时间" width="140">
                <template #default="{ row }">
                  <span class="cell-muted">{{ formatTime(row.updateTime) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="150" align="center">
                <template #default="{ row }">
                  <el-button link type="primary" @click="openSkillPreview(row)">查看</el-button>
                  <el-button link type="primary" @click="openSkillEdit(row)">编辑</el-button>
                  <el-button link type="danger" @click="removeSkill(row)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <!-- ==================== 模型（供应商 + 切换） ==================== -->
          <el-tab-pane name="model">
            <template #label>
              <span class="tab-label">
                模型
                <span v-if="providers.length" class="tab-count">{{ providers.length }}</span>
              </span>
            </template>

            <!-- 当前生效模型：一眼看清「现在到底用哪个」，右侧下拉即切换 -->
            <div v-loading="modelLoading" class="active-model">
              <div class="active-main">
                <div class="active-value">{{ runtimeText }}</div>
                <div v-if="runtime.baseUrl" class="active-meta">
                  {{ protocolMeta(runtime.protocol).label }} · {{ runtime.baseUrl }}
                </div>
              </div>
              <div class="active-actions">
                <el-select
                  v-model="selectedModelKey"
                  class="active-select"
                  placeholder="选择要启用的模型"
                  filterable
                  :disabled="!selectableProviders.length"
                  @change="onActivateModel"
                >
                  <el-option-group
                    v-for="p in selectableProviders"
                    :key="p.id"
                    :label="`${p.name}（${protocolMeta(p.protocol).label}）`"
                  >
                    <el-option
                      v-for="m in p.models"
                      :key="modelKey(p.id, m.id)"
                      :label="modelName(m)"
                      :value="modelKey(p.id, m.id)"
                    >
                      <span class="option-model">{{ modelName(m) }}</span>
                      <span class="option-id">{{ m.id }}</span>
                    </el-option>
                  </el-option-group>
                </el-select>
              </div>
            </div>
            <!-- 回落提示：供应商停用 / 模型被删 / 未配置时如实说明，避免「以为在用 A 其实在跑 B」 -->
            <el-alert
              v-if="mockMode"
              title="服务端已开启 MOCK_CHAT：对话一律返回内置模拟回复，模型配置不会生效，需在 .env 中关闭该开关。"
              type="info"
              :closable="false"
              show-icon
              class="runtime-note"
            />
            <el-alert
              v-if="runtime.note"
              :title="runtime.note"
              type="warning"
              :closable="false"
              show-icon
              class="runtime-note"
            />
            <div v-if="!providers.length && !modelLoading" class="model-empty-tip">
              还没有配置任何模型：新增供应商后即可在这里一键切换，无需改代码重启。
            </div>

            <div class="tab-toolbar">
              <el-button :icon="Plus" type="primary" @click="openProviderCreate">新增供应商</el-button>
            </div>

            <el-table
              v-loading="modelLoading"
              :data="providers"
              row-key="id"
              stripe
              class="ext-table"
              empty-text="暂无模型供应商，点击「新增供应商」接入 OpenAI 兼容或 Anthropic 服务"
            >
              <el-table-column label="供应商" min-width="180">
                <template #default="{ row }">
                  <div class="cell-name">{{ row.name }}</div>
                  <div v-if="row.description" class="cell-source">{{ row.description }}</div>
                </template>
              </el-table-column>
              <el-table-column label="协议" width="140">
                <template #default="{ row }">
                  <el-tag size="small" effect="plain" :type="protocolMeta(row.protocol).tag">
                    {{ protocolMeta(row.protocol).label }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="Base URL" min-width="220">
                <template #default="{ row }">
                  <span class="cell-endpoint">{{ row.baseUrl || '-' }}</span>
                </template>
              </el-table-column>
              <el-table-column label="模型" min-width="220">
                <template #default="{ row }">
                  <div class="model-tags">
                    <el-tag
                      v-for="m in (row.models || []).slice(0, 3)"
                      :key="m.id"
                      size="small"
                      effect="plain"
                      :type="m.vision ? 'success' : 'info'"
                    >
                      {{ modelName(m) }}
                    </el-tag>
                    <el-tag
                      v-if="(row.models || []).length > 3"
                      size="small"
                      effect="plain"
                      type="info"
                    >+{{ row.models.length - 3 }}</el-tag>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="启用" width="80" align="center">
                <template #default="{ row }">
                  <el-switch :model-value="row.enabled" @change="(v) => toggleProvider(row, v)" />
                </template>
              </el-table-column>
              <el-table-column label="更新时间" width="140">
                <template #default="{ row }">
                  <span class="cell-muted">{{ formatTime(row.updateTime) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="150" align="center">
                <template #default="{ row }">
                  <el-button link type="primary" @click="openProviderTest(row)">测试</el-button>
                  <el-button link type="primary" @click="openProviderEdit(row)">编辑</el-button>
                  <el-button link type="danger" @click="removeProvider(row)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </div>

    <!-- ==================== MCP 新增 / 编辑弹窗 ==================== -->
    <el-dialog
      v-model="mcpDialog"
      :title="mcpEditingId == null ? '新增 MCP 服务' : '编辑 MCP 服务'"
      width="560px"
      top="6vh"
      destroy-on-close
    >
      <el-form label-position="top">
        <el-form-item label="服务名称" required>
          <el-input v-model="mcpForm.name" maxlength="64" placeholder="唯一名称，如 高德地图" />
        </el-form-item>
        <el-form-item label="传输协议">
          <el-select v-model="mcpForm.transport" class="full-width">
            <el-option v-for="t in TRANSPORTS" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>

        <template v-if="isHttpTransport(mcpForm.transport)">
          <el-form-item label="服务地址" required>
            <el-input v-model="mcpForm.url" placeholder="https://example.com/mcp" />
          </el-form-item>
          <el-form-item label="请求头（可选，如鉴权 Authorization）">
            <div class="kv-editor">
              <div v-for="(row, i) in headerRows" :key="i" class="kv-row">
                <el-input v-model="row.key" placeholder="Header 名" class="kv-key" />
                <el-input v-model="row.value" placeholder="值" class="kv-value" />
                <el-button text type="danger" @click="removeRow(headerRows, i)">删除</el-button>
              </div>
              <el-button text type="primary" @click="addRow(headerRows)">+ 添加请求头</el-button>
            </div>
          </el-form-item>
        </template>

        <template v-else>
          <el-form-item label="启动命令" required>
            <el-input v-model="mcpForm.command" placeholder="如 npx / uvx / python" />
          </el-form-item>
          <el-form-item label="命令参数（每行一个）">
            <el-input v-model="mcpForm.argsText" type="textarea" :rows="3" placeholder="-y&#10;@modelcontextprotocol/server-xxx" />
          </el-form-item>
          <el-form-item label="环境变量（可选）">
            <div class="kv-editor">
              <div v-for="(row, i) in envRows" :key="i" class="kv-row">
                <el-input v-model="row.key" placeholder="变量名" class="kv-key" />
                <el-input v-model="row.value" placeholder="值" class="kv-value" />
                <el-button text type="danger" @click="removeRow(envRows, i)">删除</el-button>
              </div>
              <el-button text type="primary" @click="addRow(envRows)">+ 添加环境变量</el-button>
            </div>
          </el-form-item>
        </template>

        <el-form-item label="用途说明（可选）">
          <el-input v-model="mcpForm.description" maxlength="255" placeholder="如 提供地图与路线查询工具" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="mcpForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="mcpDialog = false">取消</el-button>
        <el-button type="primary" :loading="mcpSaving" @click="submitMcp">保存</el-button>
      </template>
    </el-dialog>

    <!-- ==================== MCP 连接测试结果 ==================== -->
    <el-dialog v-model="testDialog" :title="`连接测试：${testServerName}`" width="520px" destroy-on-close>
      <div v-loading="testLoading" class="test-body">
        <template v-if="!testLoading">
          <el-alert v-if="testError" :title="testError" type="error" :closable="false" show-icon />
          <template v-else-if="testResult">
            <el-alert
              :title="`连接成功，该服务提供 ${testResult.toolCount} 个工具`"
              type="success"
              :closable="false"
              show-icon
            />
            <div v-if="testResult.tools?.length" class="test-tools">
              <div v-for="tool in testResult.tools" :key="tool.name" class="test-tool">
                <div class="test-tool-name">{{ tool.name }}</div>
                <div v-if="tool.description" class="test-tool-desc">{{ tool.description }}</div>
              </div>
            </div>
            <el-empty v-else description="连接成功，但该服务未暴露任何工具" :image-size="60" />
          </template>
        </template>
      </div>
      <template #footer>
        <el-button type="primary" @click="testDialog = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- ==================== Skill 新增 / 编辑弹窗 ==================== -->
    <el-dialog
      v-model="skillDialog"
      :title="skillEditingName == null ? '新增 Skill' : '编辑 Skill'"
      width="640px"
      top="6vh"
      destroy-on-close
    >
      <el-form label-position="top">
        <el-form-item label="技能名称（name，hyphen-case）" required>
          <el-input v-model="skillForm.name" maxlength="64" placeholder="如 petcare-calc（小写字母/数字/连字符，同时是目录名）" />
        </el-form-item>
        <el-form-item label="触发说明（description，单行）" required>
          <el-input
            v-model="skillForm.description"
            maxlength="1024"
            show-word-limit
            placeholder="说明做什么 + 何时触发，是模型选用该技能的唯一依据。如：养护计算与误食毒物初筛流程，用户问喂多少/喝多少/年龄换算/吃了X有没有毒时使用"
          />
        </el-form-item>
        <el-form-item label="技能正文（SKILL.md body，Markdown 指令）" required>
          <el-input
            v-model="skillForm.content"
            type="textarea"
            :rows="12"
            maxlength="20000"
            show-word-limit
            placeholder="用祈使句写适用场景、回答流程与口径（不超过 500 行），例如：&#10;当用户咨询疫苗相关问题时，先确认宠物年龄与疫苗史，再按以下流程给出建议……"
          />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="skillForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="skillDialog = false">取消</el-button>
        <el-button type="primary" :loading="skillSaving" @click="submitSkill">保存</el-button>
      </template>
    </el-dialog>

    <!-- ==================== Skill 预览 ==================== -->
    <el-dialog
      v-model="skillPreviewVisible"
      :title="skillPreview ? skillPreview.name : '技能预览'"
      width="680px"
      top="6vh"
      destroy-on-close
    >
      <div v-if="skillPreview" class="skill-preview">
        <p v-if="skillPreview.description" class="skill-preview-desc">{{ skillPreview.description }}</p>
        <!-- eslint-disable-next-line vue/no-v-html -- 内容已过 DOMPurify -->
        <div class="skill-md" v-html="skillPreviewHtml" />
      </div>
      <template #footer>
        <el-button type="primary" @click="skillPreviewVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- ==================== 模型供应商 新增 / 编辑 ==================== -->
    <el-dialog
      v-model="providerDialog"
      :title="providerEditingId == null ? '新增模型供应商' : '编辑模型供应商'"
      width="780px"
      top="6vh"
      destroy-on-close
    >
      <el-form label-position="top">
        <div class="form-grid">
          <el-form-item label="供应商名称" required>
            <el-input v-model="providerForm.name" maxlength="64" placeholder="唯一名称，如 DeepSeek / Claude 官方" />
          </el-form-item>
          <el-form-item label="协议">
            <el-select v-model="providerForm.protocol" class="full-width">
              <el-option v-for="p in PROTOCOLS" :key="p.value" :label="p.label" :value="p.value" />
            </el-select>
          </el-form-item>
        </div>

        <el-form-item label="Base URL" required>
          <el-input
            v-model="providerForm.baseUrl"
            :placeholder="protocolMeta(providerForm.protocol).placeholder"
          />
          <div class="form-hint full-width">{{ protocolMeta(providerForm.protocol).hint }}</div>
        </el-form-item>

        <el-form-item label="API Key" :required="providerEditingId == null">
          <el-input
            v-model="providerForm.apiKey"
            type="password"
            show-password
            :placeholder="providerEditingId == null
              ? 'sk-...'
              : `留空表示沿用原 Key（当前 ${providerKeyMask || '已配置'}）`"
          />
        </el-form-item>

        <el-form-item label="模型清单" required>
          <div class="model-editor">
            <div v-for="(row, i) in modelRows" :key="i" class="model-row">
              <el-input v-model="row.id" placeholder="模型 ID，如 deepseek-chat" class="model-id" />
              <el-input v-model="row.label" placeholder="展示名（可选）" class="model-label" />
              <el-tooltip content="支持 128K / 1M，也可直接填 token 数；留空沿用全局默认（128K）" placement="top">
                <el-input
                  v-model="row.maxTokensText"
                  placeholder="如 128K / 1M"
                  class="model-tokens"
                />
              </el-tooltip>
              <el-tooltip content="勾选后图片会直接送给该模型识别" placement="top">
                <el-checkbox v-model="row.vision" class="model-vision">图片</el-checkbox>
              </el-tooltip>
              <el-button text type="danger" :disabled="modelRows.length === 1" @click="removeModelRow(i)">
                删除
              </el-button>
            </div>
            <div class="model-editor-foot">
              <el-button text type="primary" @click="addModelRow">+ 添加模型</el-button>
            </div>
          </div>
        </el-form-item>

        <el-form-item label="用途说明（可选）">
          <el-input v-model="providerForm.description" maxlength="255" placeholder="如 日常对话主模型" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="providerForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="providerDialog = false">取消</el-button>
        <el-button type="primary" :loading="providerSaving" @click="submitProvider">保存</el-button>
      </template>
    </el-dialog>

    <!-- ==================== 模型连通性测试 ==================== -->
    <el-dialog
      v-model="providerTestDialog"
      :title="`连通性测试：${providerTestProvider?.name || ''}`"
      width="560px"
      destroy-on-close
    >
      <div class="test-body">
        <el-form label-position="top">
          <el-form-item label="选择要测试的模型">
            <el-select v-model="providerTestModelId" class="full-width" @change="onTestModelChange">
              <el-option
                v-for="m in providerTestProvider?.models || []"
                :key="m.id"
                :label="modelName(m)"
                :value="m.id"
              />
            </el-select>
          </el-form-item>
        </el-form>
        <div v-loading="providerTestLoading" class="test-result">
          <template v-if="!providerTestLoading">
            <el-alert v-if="providerTestError" :title="providerTestError" type="error" :closable="false" show-icon />
            <template v-else-if="providerTestResult">
              <el-alert
                :title="`连接成功，耗时 ${providerTestResult.latencyMs} ms`"
                type="success"
                :closable="false"
                show-icon
              />
              <div class="test-reply">模型回复：{{ providerTestResult.reply || '（空回复，但请求已成功）' }}</div>
            </template>
            <div v-else class="test-tip">
              向该模型发送一条最小请求，验证地址可达、Key 有效、模型 ID 存在。
            </div>
          </template>
        </div>
      </div>
      <template #footer>
        <el-button @click="providerTestDialog = false">关闭</el-button>
        <el-button type="primary" :loading="providerTestLoading" @click="runProviderTest">开始测试</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
}
.section {
  margin-bottom: 24px;
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}
.card-title {
  font-weight: 700;
  font-size: 15px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.card-title::before {
  content: '';
  width: 4px;
  height: 16px;
  border-radius: 2px;
  background: var(--pv-ink);
}
.filters {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.ext-tabs :deep(.el-tabs__header) {
  margin-bottom: 16px;
}
.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
/* 页签上的计数胶囊：不额外占一行，把「有几个」放在最靠前的位置 */
.tab-count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  color: var(--pv-text-secondary);
  background: var(--pv-tint);
}
.tab-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-bottom: 12px;
}
.ext-table {
  border-radius: 12px;
}
.cell-name {
  font-weight: 600;
  color: var(--pv-ink);
}
.cell-source {
  margin-top: 2px;
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.cell-endpoint {
  font-size: 12.5px;
  color: var(--pv-text-secondary);
  word-break: break-all;
}
.cell-meta {
  margin-top: 2px;
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.cell-muted {
  font-size: 13px;
  color: var(--pv-text-secondary);
}
.full-width {
  width: 100%;
}

/* 键值对编辑器 */
.kv-editor {
  width: 100%;
}
.kv-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.kv-key {
  flex: 0 0 38%;
}
.kv-value {
  flex: 1;
}

/* 连接测试 */
.test-body {
  min-height: 120px;
}
.test-tools {
  margin-top: 12px;
  max-height: 48vh;
  overflow-y: auto;
}
.test-tool {
  padding: 8px 10px;
  border: 1px solid var(--pv-border);
  border-radius: 8px;
  margin-bottom: 8px;
}
.test-tool-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--pv-ink);
  font-family: monospace;
}
.test-tool-desc {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--pv-text-secondary);
}

/* 技能预览 */
.skill-preview {
  max-height: 64vh;
  overflow-y: auto;
}
.skill-preview-desc {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--pv-text-secondary);
}
.skill-md :deep(h1),
.skill-md :deep(h2),
.skill-md :deep(h3) {
  margin: 16px 0 8px;
  font-size: 15px;
  color: var(--pv-ink);
}
.skill-md :deep(p),
.skill-md :deep(li) {
  font-size: 13px;
  line-height: 1.8;
  color: var(--pv-ink-soft, var(--pv-ink));
}
.skill-md :deep(ul),
.skill-md :deep(ol) {
  padding-left: 20px;
  margin: 6px 0;
}
.skill-md :deep(code) {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--pv-tint);
  font-size: 12px;
}
.skill-md :deep(pre) {
  margin: 10px 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--pv-tint);
  overflow-x: auto;
}

/* ==================== 模型页签 ==================== */

/* 当前生效模型：左侧是谁在跑，右侧一键切换 */
.active-model {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 14px 16px;
  margin-bottom: 12px;
  border: 1px solid var(--pv-border);
  border-radius: 12px;
  background: var(--pv-tint);
}
.active-value {
  font-size: 15px;
  font-weight: 700;
  color: var(--pv-ink);
  word-break: break-all;
}
.active-meta {
  margin-top: 2px;
  font-size: 12px;
  color: var(--pv-text-secondary);
  word-break: break-all;
}
.active-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.active-select {
  width: 320px;
}
/* 下拉项：模型名在前、真实 ID 在后，避免同名模型分不清 */
.option-model {
  margin-right: 10px;
}
.option-id {
  font-size: 12px;
  font-family: monospace;
  color: var(--pv-text-secondary);
}
.runtime-note {
  margin-bottom: 12px;
}
.model-empty-tip {
  margin-bottom: 12px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--pv-text-secondary);
}
.model-tags {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* 供应商弹窗：名称与协议并排，其余整行 */
.form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220px;
  gap: 12px;
}
.form-hint {
  font-size: 12px;
  line-height: 1.7;
  color: var(--pv-text-secondary);
}
.model-editor {
  width: 100%;
}
.model-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.model-id {
  flex: 1 1 220px;
}
.model-label {
  flex: 1 1 140px;
}
.model-tokens {
  width: 140px;
}
.model-vision {
  margin-right: 0;
}
.model-editor-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

/* 连通性测试 */
.test-result {
  min-height: 72px;
}
.test-reply {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--pv-tint);
  font-size: 13px;
  line-height: 1.7;
  color: var(--pv-ink);
  word-break: break-word;
}
.test-tip {
  font-size: 13px;
  line-height: 1.8;
  color: var(--pv-text-secondary);
}
</style>
