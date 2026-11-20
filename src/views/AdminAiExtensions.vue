<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Plus, Refresh } from '@element-plus/icons-vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import {
  createMcpServer,
  createSkill,
  deleteMcpServer,
  deleteSkill,
  listMcpServers,
  listSkills,
  testMcpServer,
  updateMcpServer,
  updateSkill,
} from '@/api/ai'

// AI 扩展管理页（管理员限定）：维护对话 Agent 的两类可插拔能力——
// MCP 服务（远程工具来源）与 Skill（注入系统提示词的技能指令）。
// 入口由路由 meta.roles 与网关 / 后端 X-User-Role 双重把关，页面本身不处理凭证。
const activeTab = ref('mcp')

const formatTime = (ts) => {
  if (!ts) return '-'
  const d = new Date(ts * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
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
      `确定删除 MCP 服务「${row.name}」？删除后模型将不再能调用该服务提供的工具。`,
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
      `确定删除 Skill「${row.name}」？将删除整个技能包目录，其指令不再出现在技能目录中。`,
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

const reload = () => {
  loadMcpServers()
  loadSkills()
}

onMounted(reload)
</script>

<template>
  <div class="ext-page">
    <header class="ext-head">
      <div>
        <h2 class="ext-title">AI 扩展管理</h2>
        <p class="ext-sub">
          为 AI 养宠顾问接入 MCP 远程工具与 Skill 技能指令，启用后对所有用户的对话生效
        </p>
      </div>
      <el-button :icon="Refresh" @click="reload">刷新</el-button>
    </header>

    <el-tabs v-model="activeTab" class="ext-tabs">
      <!-- ==================== MCP 服务 ==================== -->
      <el-tab-pane label="MCP 服务" name="mcp">
        <div class="tab-toolbar">
          <p class="tab-hint">
            MCP（Model Context Protocol）服务为模型提供额外工具。支持 Streamable HTTP / SSE 远程服务与 Stdio 本地命令；
            建议只接入可信服务，敏感操作请谨慎评估。
          </p>
          <el-button :icon="Plus" type="primary" @click="openMcpCreate">新增服务</el-button>
        </div>

        <el-table v-loading="mcpLoading" :data="mcpServers" class="ext-table" empty-text="暂无 MCP 服务，点击「新增服务」接入">
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
              <el-button class="ext-op-btn" size="small" text type="primary" @click="runTest(row)">测试</el-button>
              <el-button class="ext-op-btn" size="small" text type="primary" @click="openMcpEdit(row)">编辑</el-button>
              <el-button class="ext-op-btn" size="small" text type="danger" @click="removeMcp(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- ==================== Skill 技能 ==================== -->
      <el-tab-pane label="Skill 技能" name="skill">
        <div class="tab-toolbar">
          <p class="tab-hint">
            Skill 是标准技能包（skills/&lt;name&gt;/SKILL.md：frontmatter 的 name/description + Markdown 正文）。
            提示词只常驻 name+description 目录，模型判断相关时经 load_skill 工具按需加载正文（渐进式披露）。
          </p>
          <el-button :icon="Plus" type="primary" @click="openSkillCreate">新增技能</el-button>
        </div>

        <el-table v-loading="skillLoading" :data="skills" row-key="name" class="ext-table" empty-text="暂无 Skill，点击「新增技能」创建">
          <el-table-column label="技能" min-width="220">
            <template #default="{ row }">
              <div class="cell-name">{{ row.name }}</div>
              <div v-if="row.description" class="cell-source">{{ row.description }}</div>
            </template>
          </el-table-column>
          <el-table-column label="正文" min-width="240">
            <template #default="{ row }">
              <span class="cell-endpoint">{{ (row.content || '').replace(/\s+/g, ' ').slice(0, 50) }}</span>
              <span class="cell-muted">（{{ row.bodyLines || 0 }} 行<template v-if="row.resources?.length"> · {{ row.resources.join('/') }}</template>）</span>
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
              <el-button class="ext-op-btn" size="small" text type="primary" @click="openSkillPreview(row)">查看</el-button>
              <el-button class="ext-op-btn" size="small" text type="primary" @click="openSkillEdit(row)">编辑</el-button>
              <el-button class="ext-op-btn" size="small" text type="danger" @click="removeSkill(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

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
          <el-input v-model="mcpForm.description" maxlength="255" placeholder="仅管理页展示，如 提供地图与路线查询工具" />
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
  </div>
</template>

<style scoped>
.ext-page {
  width: 100%;
  min-width: 0;
  max-width: 1160px;
  margin: 0 auto;
  padding: 20px 16px 40px;
}
.ext-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.ext-title {
  margin: 0;
  font-size: 20px;
  color: var(--pv-ink);
}
.ext-sub {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--pv-text-secondary);
}
.ext-tabs {
  margin-top: 12px;
}
.tab-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.tab-hint {
  flex: 1;
  min-width: 240px;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--pv-text-secondary);
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
.cell-muted {
  font-size: 13px;
  color: var(--pv-text-secondary);
}
.ext-op-btn {
  padding: 0;
  font-size: 13px;
}
.ext-op-btn + .ext-op-btn {
  margin-left: 12px;
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
</style>