<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Plus, MagicStick } from '@element-plus/icons-vue'
import AppHeader from '@/components/AppHeader.vue'
import { listMyPets, uploadPetAvatar, updatePetHealth } from '@/api/pet'
import { assessPetHealth } from '@/api/ai'
import { healthRecordTimeText, petAgeInfo, petHealthText, realPetMonths } from '@/utils/pet'
import { useIsMobile } from '@/utils/responsive'
import logo from '@/assets/logo.jpg'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const pets = ref([])
// 身份卡头像在手机上缩小，给右侧字段留出空间，避免卡片被拉成一张竖版表单
const isMobile = useIsMobile()
const idAvatarSize = computed(() => (isMobile.value ? 96 : 150))

// 当前查看的宠物：优先路由指定 ID，其次第一只已签发身份卡的宠物，兜底第一只
// 宠物 ID 为雪花 ID（后端序列化为字符串），比较统一走 String，禁止 Number 转换以防精度丢失
const current = computed(
  () =>
    pets.value.find((p) => String(p.id) === String(route.params.id)) ||
    pets.value.find((p) => p.cardIssueDate) ||
    pets.value[0] ||
    null,
)

// 是否已完成身份认证（签发身份卡）：cardIssueDate 非空即已认证
const issued = computed(() => !!current.value?.cardIssueDate)

// 切换宠物：replace 避免切换过程堆积历史记录
const select = (pet) => {
  if (!current.value || String(pet.id) !== String(current.value.id)) {
    router.replace(`/pet/identity/${pet.id}`)
  }
}

// 真实宠物按生日计算年龄，不足 1 岁展示月龄；虚拟宠物直接使用年龄字段；未知返回空
const ageText = (pet) => {
  if (!pet) return ''
  if (pet.type !== 'REAL') return pet.age ? `${pet.age}岁` : ''
  const months = realPetMonths(pet.birthday)
  if (months == null) return ''
  return months >= 12 ? `${Math.floor(months / 12)}岁` : `${months}个月`
}

// 性别双语文案：1-弟弟/Boy 2-妹妹/Girl
const genderText = (pet) => {
  if (!pet) return ''
  if (pet.gender === 1 || pet.gender === '1') return '弟弟 / Boy'
  if (pet.gender === 2 || pet.gender === '2') return '妹妹 / Girl'
  return pet.genderName || ''
}

// 证件字段：仅收集已填写的内容，未认证宠物自然只展示已填字段
const fields = computed(() => {
  const p = current.value
  if (!p) return []
  const list = [{ label: '姓名 / NAME', value: p.name || '', full: true }]
  const breed = p.breed || p.species
  if (breed) list.push({ label: '品种 / BREED', value: breed })
  const age = ageText(p)
  if (age) list.push({ label: '年龄 / AGE', value: age })
  const gender = genderText(p)
  if (gender) list.push({ label: '性别 / GENDER', value: gender })
  // 绝育状态默认值为「未绝育」，仅在已认证（明确填写过档案）时展示，避免展示未确认的默认值
  if (issued.value) {
    list.push({ label: '绝育 / NEUTERED', value: p.sterilized ? '已绝育 / Yes' : '未绝育 / No' })
  }
  return list
})

// 签发日期：签发日期去掉分隔符，如 20260905；未签发展示占位文案
const issueText = computed(() =>
  current.value?.cardIssueDate
    ? current.value.cardIssueDate.replace(/-/g, '')
    : '未签发 / NOT ISSUED',
)

// ===== 头像放大 + 切换 =====
const avatarDialog = ref(false)
const switching = ref(false)

const openAvatar = () => {
  if (current.value) avatarDialog.value = true
}

// 切换头像：选中图片后上传 OSS 并就地更新当前宠物展示
const onSwitchAvatar = async ({ file }) => {
  if (switching.value || !current.value) return
  switching.value = true
  try {
    const data = await uploadPetAvatar(current.value.id, file)
    const idx = pets.value.findIndex((p) => String(p.id) === String(data.id))
    if (idx > -1) pets.value[idx] = data
    ElMessage.success('头像已更新')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    switching.value = false
  }
}

const goProfile = () => {
  if (current.value) router.push(`/pet/profile/${current.value.id}`)
}

// ===== 健康信息（仅猫/狗展示，随 AI 咨询上下文发送） =====
// 每类健康项使用适合的录入控件；unit / recordTime 独立保存，原字段仍保留纯内容
const HEALTH_ITEMS = [
  {
    key: 'weight', label: '体重', icon: '⚖️', color: '#4a90d9',
    hint: '定时记录体重可以更好的管理爱宠健康～', full: true,
    inputType: 'number', fieldLabel: '体重数值', placeholder: '请输入体重',
    units: ['kg', 'g'], defaultUnit: 'kg', min: 0.01, max: 999, precision: 2, step: 0.1,
  },
  {
    key: 'bcs', label: 'BCS', icon: '📊', color: '#2ec7a0', hint: '体况评分',
    inputType: 'select', fieldLabel: '体况评分（1–9 分制）', defaultUnit: '分',
    options: [
      { value: '1', label: '1 · 极度消瘦' }, { value: '2', label: '2 · 消瘦' },
      { value: '3', label: '3 · 偏瘦' }, { value: '4', label: '4 · 略瘦' },
      { value: '5', label: '5 · 理想体态' }, { value: '6', label: '6 · 略超重' },
      { value: '7', label: '7 · 超重' }, { value: '8', label: '8 · 肥胖' },
      { value: '9', label: '9 · 极度肥胖' },
    ],
  },
  {
    key: 'deworming', label: '驱虫', icon: '🐛', color: '#8b6fe8', hint: '建议3个月1次',
    inputType: 'select', fieldLabel: '驱虫情况', allowCreate: true,
    options: ['体内驱虫', '体外驱虫', '体内外同驱'], placeholder: '选择或输入驱虫情况',
  },
  {
    key: 'specialPeriod', label: '特殊时期', icon: '📅', color: '#f5a623', hint: '如发情期 / 孕期 / 哺乳期',
    inputType: 'select', fieldLabel: '当前特殊时期', allowCreate: true,
    options: ['发情期', '孕期', '哺乳期', '绝育恢复期', '术后恢复期', '无'],
    placeholder: '选择或输入特殊时期',
  },
  {
    key: 'vaccine', label: '疫苗', icon: '💉', color: '#e858a8', hint: '建议接种疫苗',
    inputType: 'select', fieldLabel: '疫苗接种情况', allowCreate: true,
    options: ['狂犬疫苗', '猫三联', '犬四联', '犬六联', '犬八联', '年度加强免疫'],
    placeholder: '选择或输入疫苗名称',
  },
  {
    key: 'rearingMethod', label: '养育方式', icon: '🏠', color: '#e8604c', hint: '如室内散养 / 笼养等',
    inputType: 'select', fieldLabel: '养育方式', allowCreate: true,
    options: ['室内散养', '室内笼养', '室内外结合', '室外饲养', '半散养'],
    placeholder: '选择或输入养育方式',
  },
  {
    key: 'medicalHistory', label: '病史', icon: '🏥', color: '#29b6d8', hint: '记录既往疾病与用药',
    inputType: 'textarea', fieldLabel: '既往疾病与用药', placeholder: '请输入既往疾病、治疗或用药情况',
    maxlength: 500,
    quickOptions: ['无既往病史', '皮肤过敏', '肠胃疾病', '呼吸道疾病', '泌尿系统疾病', '术后恢复', '长期用药'],
  },
]

// 仅猫 / 狗展示健康信息模块
const showHealth = computed(() => ['猫', '狗'].includes(current.value?.species))

// 使用本地时间而不是 UTC，格式与后端 LocalDateTime 的 ISO 入参一致
const currentRecordTime = () => {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

const healthOptionValue = (option) => option?.value ?? option
const healthOptionLabel = (option) => option?.label ?? option

// 健康项编辑弹窗：回填内容、单位和记录时间，兼容没有元数据的旧数据
const healthDialog = ref(false)
const healthTarget = ref(null)
const healthValue = ref('')
const healthUnit = ref('')
const healthRecordTime = ref('')
const savingHealth = ref(false)

const openHealthEdit = (item) => {
  if (!current.value) return
  const rawValue = current.value[item.key] || ''
  const meta = current.value.healthMeta?.[item.key] || {}
  healthTarget.value = item
  healthUnit.value = meta.unit || item.defaultUnit || ''
  healthRecordTime.value = meta.recordTime || currentRecordTime()

  if (item.inputType === 'number') {
    const matched = String(rawValue).match(/-?\d+(?:\.\d+)?/)
    healthValue.value = matched ? Number(matched[0]) : null
    // 旧版体重可能已包含 g / kg，回填时优先沿用原单位
    if (!meta.unit) {
      const legacyValue = String(rawValue).toLowerCase()
      if (/(?:kg|公斤|千克)/.test(legacyValue)) healthUnit.value = 'kg'
      else if (/(?:g|克)/.test(legacyValue)) healthUnit.value = 'g'
    }
  } else if (item.key === 'bcs') {
    const matched = String(rawValue).match(/[1-9]/)
    healthValue.value = matched?.[0] || ''
  } else {
    healthValue.value = rawValue
  }
  healthDialog.value = true
}

// 病史快捷项采用追加方式，保留用户已经填写的自由文本
const addHealthQuickOption = (option) => {
  if (option === '无既往病史') {
    healthValue.value = option
    return
  }
  const rawValue = String(healthValue.value || '').trim()
  const existing = rawValue === '无既往病史' ? '' : rawValue
  if (existing.includes(option)) return
  const nextValue = existing ? `${existing}；${option}` : option
  const maxlength = healthTarget.value?.maxlength || 500
  if (nextValue.length > maxlength) {
    ElMessage.warning(`病史内容不能超过${maxlength}个字符`)
    return
  }
  healthValue.value = nextValue
}

const onSaveHealth = async () => {
  if (!current.value || !healthTarget.value || savingHealth.value) return
  const item = healthTarget.value
  const value = healthValue.value == null ? '' : String(healthValue.value).trim()
  if (value && item.inputType === 'number' && (!Number.isFinite(Number(value)) || Number(value) <= 0)) {
    ElMessage.warning('请输入大于 0 的体重数值')
    return
  }
  if (value && !healthRecordTime.value) {
    ElMessage.warning('请选择记录时间')
    return
  }
  savingHealth.value = true
  try {
    const data = await updatePetHealth(current.value.id, item.key, value, {
      unit: value ? healthUnit.value || null : null,
      recordTime: value ? healthRecordTime.value : null,
    })
    const idx = pets.value.findIndex((p) => String(p.id) === String(data.id))
    if (idx > -1) pets.value[idx] = data
    healthDialog.value = false
    ElMessage.success('健康信息已更新')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    savingHealth.value = false
  }
}

// 返回：身份卡页主要经新标签打开，无历史可退，关闭当前标签即回到上一操作页面；
// 同标签内跳转进入（历史可退，如去领养后的回退）则正常回退；
// 浏览器拒绝脚本关闭非脚本打开的标签时，兜底回首页避免无反应
const onBack = () => {
  if (window.history.length > 1 && window.history.state?.back) {
    router.back()
    return
  }
  window.close()
  if (!window.closed) router.replace('/')
}

// ===== AI 健康评估 =====
const healthReport = ref(null)   // 最近一次评估报告
const assessing = ref(false)     // 评估请求中

// 组装健康评估入参：仅收集非空字段，健康信息以 health 子对象下发（与对话上下文一致）；
// 年龄按生日换算（age 整岁 + ageText 含月龄文本，与身份卡展示 / 对话入口同一口径）
const buildHealthPayload = (pet) => {
  const payload = { id: pet.id, name: pet.name || '', species: pet.species || '', breed: pet.breed || '' }
  const { age, ageText: agePrecise } = petAgeInfo(pet)
  if (age != null) payload.age = age
  if (agePrecise) payload.ageText = agePrecise
  const health = {}
  for (const item of HEALTH_ITEMS) {
    const value = petHealthText(pet, item.key, true)
    if (value) health[item.key] = value
  }
  if (Object.keys(health).length) payload.health = health
  return payload
}

const runAssessment = async () => {
  if (!current.value || assessing.value) return
  assessing.value = true
  try {
    healthReport.value = await assessPetHealth(buildHealthPayload(current.value))
    ElMessage.success('AI 健康评估完成')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    assessing.value = false
  }
}

// 切换宠物时清空上一只宠物的评估结果，避免张冠李戴
watch(() => current.value?.id, () => { healthReport.value = null })

// 评级 -> 展示文案 / 颜色（评分环与标签配色）
const LEVEL_META = {
  excellent: { text: '优秀', color: '#2ec7a0' },
  good: { text: '良好', color: '#4a90d9' },
  fair: { text: '一般', color: '#f5a623' },
  warning: { text: '需关注', color: '#e8604c' },
}
const levelMeta = computed(() => LEVEL_META[healthReport.value?.level] || { text: '—', color: '#909399' })

onMounted(async () => {
  try {
    pets.value = (await listMyPets()) || []
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="page">
    <AppHeader title="宠物身份证" show-back @back="onBack" />

    <div v-loading="loading" class="page-container">
      <!-- 无宠物 -->
      <el-card v-if="!loading && !pets.length" shadow="never" class="empty-card">
        <el-result icon="info" title="你还没有宠物" sub-title="登记真实宠物或领养虚拟伙伴后即可签发身份卡">
          <template #extra>
            <el-button type="primary" round @click="router.push('/claim')">去领养宠物</el-button>
          </template>
        </el-result>
      </el-card>

      <template v-else-if="current">
        <!-- 多宠物切换：可查看名下每只宠物的身份信息 -->
        <div class="pet-switcher">
          <button
            v-for="p in pets"
            :key="p.id"
            class="switcher-chip"
            :class="{ active: String(p.id) === String(current.id) }"
            @click="select(p)"
          >
            <el-avatar :size="26" :src="p.imageUrl || ''">{{ (p.name || '宠')[0] }}</el-avatar>
            <span class="chip-name">{{ p.name }}</span>
            <span v-if="!p.cardIssueDate" class="chip-lock">未认证</span>
          </button>
        </div>

        <!-- 宠物身份证 -->
        <div class="id-card" :class="{ unissued: !issued }">
          <div class="id-card-head">
            <div class="id-card-title">
              <span class="title-cn">宠物身份证</span>
              <span class="title-en">PET IDENTITY CARD</span>
            </div>
            <span v-if="!issued" class="unverified-tag">未认证 / UNVERIFIED</span>
          </div>

          <div class="id-card-body">
            <!-- 点击头像放大并可切换 -->
            <div class="id-avatar-wrap" title="点击放大 / 更换头像" @click="openAvatar">
              <el-avatar :size="idAvatarSize" :src="current.imageUrl || ''" class="id-avatar">
                {{ (current.name || '宠')[0] }}
              </el-avatar>
              <div class="avatar-zoom">放大 / 更换</div>
            </div>

            <div class="id-fields">
              <div
                v-for="f in fields"
                :key="f.label"
                class="id-field"
                :class="{ 'id-field-full': f.full }"
              >
                <div class="id-label">{{ f.label }}</div>
                <div class="id-value" :class="{ 'id-name': f.full }">{{ f.value }}</div>
              </div>
            </div>
          </div>

          <div class="id-card-footer">
            <div class="id-brand">
              <img :src="logo" alt="PetVerse" class="id-logo" />
              <span class="id-brand-name">PetVerse</span>
            </div>
            <div class="id-date">
              <span class="id-label">签发日期 / DATE OF ISSUE</span>
              <span class="id-date-no" :class="{ 'date-empty': !issued }">{{ issueText }}</span>
            </div>
          </div>

          <!-- 未认证宠物：底部完善档案入口 -->
          <div v-if="!issued" class="id-card-action">
            <el-button type="primary" round @click="goProfile">完善档案 / Complete Profile</el-button>
          </div>
        </div>

        <!-- 健康信息：仅猫/狗展示，可逐项记录并随 AI 咨询上下文发送 -->
        <div v-if="showHealth" class="health-section">
          <div class="health-title">健康信息</div>
          <div class="health-grid">
            <div
              v-for="item in HEALTH_ITEMS"
              :key="item.key"
              class="health-tile"
              :class="{ 'health-tile-full': item.full }"
              :title="`点击记录${item.label}`"
              @click="openHealthEdit(item)"
            >
              <div class="health-tile-head">
                <span class="health-icon" :style="{ background: item.color }">{{ item.icon }}</span>
                <span class="health-label">{{ item.label }}</span>
                <el-icon class="health-add"><Plus /></el-icon>
              </div>
              <div class="health-value" :class="{ 'health-hint': !current[item.key] }">
                {{ petHealthText(current, item.key) || item.hint }}
              </div>
              <div
                v-if="current[item.key] && current.healthMeta?.[item.key]?.recordTime"
                class="health-record-time"
              >
                记录于 {{ healthRecordTimeText(current.healthMeta[item.key].recordTime) }}
              </div>
            </div>
          </div>
        </div>

        <!-- AI 健康智能评估：基于档案与健康信息由 LangGraph 多步生成 -->
        <div v-if="showHealth" class="ai-health-section">
          <div class="ai-health-head">
            <div class="ai-health-title">
              <el-icon class="ai-health-icon"><MagicStick /></el-icon>
              AI 健康评估
            </div>
            <el-button type="primary" round size="small" :loading="assessing" @click="runAssessment">
              {{ healthReport ? '重新评估' : '开始评估' }}
            </el-button>
          </div>

          <div v-if="healthReport" class="ai-health-report">
            <div class="ai-health-score">
              <div class="score-ring" :style="{ borderColor: levelMeta.color }">
                <span class="score-num" :style="{ color: levelMeta.color }">{{ healthReport.score }}</span>
                <span class="score-unit">分</span>
              </div>
              <div class="score-info">
                <span class="score-level" :style="{ background: levelMeta.color }">{{ levelMeta.text }}</span>
                <p class="score-summary">{{ healthReport.summary }}</p>
              </div>
            </div>

            <div v-if="healthReport.risks?.length" class="report-block">
              <div class="report-label risk">风险提示</div>
              <ul class="report-list">
                <li v-for="(r, i) in healthReport.risks" :key="i">{{ r }}</li>
              </ul>
            </div>

            <div v-if="healthReport.suggestions?.length" class="report-block">
              <div class="report-label">养护建议</div>
              <ul class="report-list">
                <li v-for="(s, i) in healthReport.suggestions" :key="i">{{ s }}</li>
              </ul>
            </div>

            <div v-if="healthReport.care_plan?.length" class="report-block">
              <div class="report-label">养护计划</div>
              <ul class="report-list">
                <li v-for="(c, i) in healthReport.care_plan" :key="i">{{ c }}</li>
              </ul>
            </div>

            <div v-if="healthReport.reminders?.length" class="report-block">
              <div class="report-label">提醒事项</div>
              <div class="reminder-tags">
                <el-tag
                  v-for="(rm, i) in healthReport.reminders"
                  :key="i"
                  class="reminder-tag"
                  :type="rm.urgency === 'high' ? 'danger' : rm.urgency === 'medium' ? 'warning' : 'info'"
                  effect="light"
                  size="small"
                >
                  {{ rm.type }}：{{ rm.advice }}
                </el-tag>
              </div>
            </div>

            <p class="report-disclaimer">{{ healthReport.disclaimer }}</p>
          </div>

          <div v-else class="ai-health-empty">
            由 AI 结合宠物档案与健康信息综合评估，生成健康评分、风险提示与养护计划（不能替代兽医面诊）。
          </div>
        </div>
      </template>
    </div>

    <!-- 头像放大 + 切换弹窗 -->
    <el-dialog v-model="avatarDialog" width="420px" align-center class="avatar-dialog">
      <div class="avatar-view">
        <el-image
          v-if="current?.imageUrl"
          :src="current.imageUrl"
          fit="contain"
          class="avatar-big"
          :preview-src-list="[current.imageUrl]"
          :initial-index="0"
          preview-teleported
        />
        <div v-else class="avatar-placeholder">{{ (current?.name || '宠')[0] }}</div>
      </div>
      <div class="avatar-actions">
        <el-upload
          :show-file-list="false"
          accept="image/png,image/jpeg,image/jpg,image/webp"
          :http-request="onSwitchAvatar"
        >
          <el-button type="primary" round :loading="switching">切换头像 / Change Avatar</el-button>
        </el-upload>
      </div>
    </el-dialog>

    <!-- 健康信息编辑弹窗：按类别提供数字、预设选项或快捷病史，并统一记录时间 -->
    <el-dialog
      v-model="healthDialog"
      :title="`记录${healthTarget?.label || ''}`"
      width="min(500px, calc(100vw - 32px))"
      align-center
    >
      <el-form v-if="healthTarget" label-position="top" class="health-form" @submit.prevent>
        <el-form-item v-if="healthTarget.inputType === 'number'" :label="healthTarget.fieldLabel">
          <div class="health-input-row">
            <el-input-number
              v-model="healthValue"
              class="health-main-input health-number-input"
              :min="healthTarget.min"
              :max="healthUnit === 'g' ? 999000 : healthTarget.max"
              :precision="healthTarget.precision"
              :step="healthUnit === 'g' ? 1 : healthTarget.step"
              :placeholder="healthTarget.placeholder"
              controls-position="right"
            />
            <el-select v-model="healthUnit" class="health-unit-select" aria-label="体重单位">
              <el-option
                v-for="unit in healthTarget.units"
                :key="unit"
                :label="unit"
                :value="unit"
              />
            </el-select>
          </div>
        </el-form-item>

        <el-form-item v-else-if="healthTarget.inputType === 'select'" :label="healthTarget.fieldLabel">
          <div class="health-input-row">
            <el-select
              v-model="healthValue"
              class="health-main-input"
              filterable
              clearable
              :allow-create="healthTarget.allowCreate"
              :default-first-option="healthTarget.allowCreate"
              :placeholder="healthTarget.placeholder || '请选择'"
            >
              <el-option
                v-for="option in healthTarget.options"
                :key="healthOptionValue(option)"
                :label="healthOptionLabel(option)"
                :value="healthOptionValue(option)"
              />
            </el-select>
            <span v-if="healthTarget.defaultUnit" class="health-fixed-unit">{{ healthTarget.defaultUnit }}</span>
          </div>
          <div v-if="healthTarget.allowCreate" class="health-field-tip">
            可选择常用项，也可以输入自定义内容后按回车创建
          </div>
        </el-form-item>

        <el-form-item v-else :label="healthTarget.fieldLabel">
          <el-input
            v-model="healthValue"
            type="textarea"
            :rows="4"
            :maxlength="healthTarget.maxlength"
            show-word-limit
            :placeholder="healthTarget.placeholder"
          />
          <div v-if="healthTarget.quickOptions?.length" class="health-quick-options">
            <button
              v-for="option in healthTarget.quickOptions"
              :key="option"
              type="button"
              class="health-quick-option"
              @click="addHealthQuickOption(option)"
            >
              + {{ option }}
            </button>
          </div>
        </el-form-item>

        <el-form-item label="记录时间" required>
          <el-date-picker
            v-model="healthRecordTime"
            type="datetime"
            class="health-record-picker"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DD[T]HH:mm:ss"
            placeholder="选择记录时间"
            :clearable="false"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="healthDialog = false">取消</el-button>
        <el-button type="primary" :loading="savingHealth" @click="onSaveHealth">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
}
.empty-card {
  max-width: 640px;
  margin: 0 auto;
}
.empty-card :deep(.el-card__body) {
  padding: 40px 24px;
}

/* 多宠物切换条 */
.pet-switcher {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  max-width: 640px;
  margin: 0 auto 16px;
}
.switcher-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px 5px 6px;
  border: 1px solid var(--pv-border);
  border-radius: 999px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  color: var(--pv-text);
}
.switcher-chip.active {
  border-color: var(--pv-ink);
  background: var(--pv-tint);
  font-weight: 600;
}
.chip-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip-lock {
  padding: 0 6px;
  border: 1px solid var(--pv-border);
  border-radius: 999px;
  font-size: 11px;
  color: var(--pv-text-secondary);
}

/* 身份卡：浅蓝证件底 + 指纹环水印（SVG 实色描边，非渐变） */
.id-card {
  max-width: 640px;
  margin: 0 auto;
  border-radius: 18px;
  padding: 26px 30px 22px;
  background-color: #eaf2fb;
  background-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='640'%20height='420'%20viewBox='0%200%20640%20420'%3E%3Cg%20fill='none'%20stroke='%23d8e7f6'%20stroke-width='1.4'%3E%3Ccircle%20cx='70'%20cy='60'%20r='18'/%3E%3Ccircle%20cx='70'%20cy='60'%20r='34'/%3E%3Ccircle%20cx='70'%20cy='60'%20r='50'/%3E%3Ccircle%20cx='70'%20cy='60'%20r='66'/%3E%3Ccircle%20cx='70'%20cy='60'%20r='82'/%3E%3Ccircle%20cx='560'%20cy='350'%20r='20'/%3E%3Ccircle%20cx='560'%20cy='350'%20r='38'/%3E%3Ccircle%20cx='560'%20cy='350'%20r='56'/%3E%3Ccircle%20cx='560'%20cy='350'%20r='74'/%3E%3Ccircle%20cx='590'%20cy='90'%20r='16'/%3E%3Ccircle%20cx='590'%20cy='90'%20r='30'/%3E%3Ccircle%20cx='590'%20cy='90'%20r='44'/%3E%3Ccircle%20cx='300'%20cy='400'%20r='24'/%3E%3Ccircle%20cx='300'%20cy='400'%20r='44'/%3E%3Ccircle%20cx='300'%20cy='400'%20r='64'/%3E%3C/g%3E%3C/svg%3E");
  background-size: 640px 420px;
  box-shadow: var(--pv-shadow);
}
.id-card.unissued {
  background-color: #f2f1ee;
  background-image: none;
}
.id-card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
}
.id-card-title {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.title-cn {
  font-size: 20px;
  font-weight: 800;
  color: var(--pv-ink);
  letter-spacing: 2px;
}
.title-en {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.5px;
  color: #3d8bd4;
}
.unverified-tag {
  flex-shrink: 0;
  padding: 3px 12px;
  border: 1px solid rgba(196, 86, 86, 0.5);
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  color: rgba(196, 86, 86, 0.85);
}
.id-card-body {
  display: flex;
  align-items: center;
  gap: 30px;
  margin-top: 20px;
}
.id-avatar-wrap {
  position: relative;
  flex-shrink: 0;
  cursor: pointer;
  border-radius: 50%;
}
.id-avatar {
  border: 6px solid #fff;
  background: #f7ddc9;
  font-size: 46px;
  color: #8a5a3b;
  box-shadow: 0 8px 18px rgba(23, 24, 28, 0.12);
}
.avatar-zoom {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: rgba(23, 24, 28, 0.45);
  opacity: 0;
  transition: opacity 0.15s ease;
}
.id-avatar-wrap:hover .avatar-zoom {
  opacity: 1;
}
.id-fields {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px 24px;
}
.id-field-full {
  grid-column: 1 / -1;
}
.id-label {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: #3d8bd4;
}
.id-value {
  margin-top: 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--pv-ink);
  overflow-wrap: anywhere;
  word-break: break-word;
}
.id-name {
  font-size: 24px;
  font-weight: 800;
}
.id-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 28px;
}
.id-brand {
  display: flex;
  align-items: center;
  gap: 8px;
}
.id-logo {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  object-fit: cover;
  display: block;
}
.id-brand-name {
  font-size: 18px;
  font-weight: 800;
  color: #e23b3b;
}
.id-date {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
}
.id-date-no {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 2px;
  color: var(--pv-ink);
  white-space: nowrap;
}
.id-date-no.date-empty {
  font-size: 15px;
  letter-spacing: 1px;
  color: var(--pv-text-secondary);
}
.id-card-action {
  margin-top: 22px;
  text-align: center;
}

/* 头像放大弹窗 */
.avatar-view {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 240px;
}
.avatar-big {
  width: 240px;
  height: 240px;
  border-radius: 12px;
  background: #f2f1ee;
}
.avatar-placeholder {
  width: 240px;
  height: 240px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f7ddc9;
  color: #8a5a3b;
  font-size: 72px;
  font-weight: 700;
}
.avatar-actions {
  margin-top: 18px;
  display: flex;
  justify-content: center;
}

/* 健康信息模块：彩色图标磁贴，体重占整行，其余两列 */
.health-section {
  max-width: 640px;
  margin: 20px auto 0;
}
.health-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--pv-text);
  margin-bottom: 12px;
}
.health-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.health-tile {
  border: 1px solid var(--pv-border);
  border-radius: 12px;
  background: #fff;
  padding: 14px 16px;
  cursor: pointer;
  transition: box-shadow 0.15s ease, transform 0.15s ease;
}
.health-tile:hover {
  box-shadow: var(--pv-shadow);
  transform: translateY(-1px);
}
.health-tile-full {
  grid-column: 1 / -1;
}
.health-tile-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.health-icon {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
}
.health-label {
  font-size: 14px;
  font-weight: 700;
  color: var(--pv-text);
  flex: 1;
}
.health-add {
  color: var(--pv-text-secondary);
  font-size: 16px;
}
.health-value {
  margin-top: 10px;
  font-size: 13px;
  color: var(--pv-text);
  word-break: break-all;
}
.health-value.health-hint {
  color: var(--pv-text-secondary);
}
.health-record-time {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--pv-text-secondary);
}
.health-form :deep(.el-form-item) {
  margin-bottom: 16px;
}
.health-form :deep(.el-form-item__label) {
  padding-bottom: 6px;
  font-weight: 600;
  color: var(--pv-text);
}
.health-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}
.health-main-input {
  flex: 1;
  width: auto;
  min-width: 0;
}
.health-number-input :deep(.el-input__inner) {
  text-align: left;
}
.health-unit-select {
  width: 90px;
  flex-shrink: 0;
}
.health-fixed-unit {
  flex-shrink: 0;
  min-width: 28px;
  font-size: 14px;
  color: var(--pv-text-secondary);
}
.health-field-tip {
  width: 100%;
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--pv-text-secondary);
}
.health-record-picker {
  width: 100%;
}
.health-quick-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
  margin-top: 10px;
}
.health-quick-option {
  padding: 4px 10px;
  border: 1px solid var(--pv-border);
  border-radius: 999px;
  background: #fff;
  color: var(--pv-text-secondary);
  font-size: 12px;
  line-height: 1.5;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.health-quick-option:hover,
.health-quick-option:focus-visible {
  border-color: var(--pv-ink);
  background: var(--pv-tint);
  color: var(--pv-text);
  outline: none;
}

/* AI 健康评估卡片 */
.ai-health-section {
  max-width: 640px;
  margin: 20px auto 0;
  border: 1px solid var(--pv-border);
  border-radius: 14px;
  background: #fff;
  padding: 18px 20px;
  box-shadow: var(--pv-shadow);
}
.ai-health-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.ai-health-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 16px;
  font-weight: 700;
  color: var(--pv-text);
}
.ai-health-icon {
  color: #8b6fe8;
  font-size: 18px;
}
.ai-health-empty {
  margin-top: 14px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--pv-text-secondary);
}
.ai-health-report {
  margin-top: 14px;
}
.ai-health-score {
  display: flex;
  align-items: center;
  gap: 18px;
}
.score-ring {
  width: 84px;
  height: 84px;
  border: 5px solid #4a90d9;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.score-num {
  font-size: 26px;
  font-weight: 800;
  line-height: 1;
}
.score-unit {
  font-size: 11px;
  color: var(--pv-text-secondary);
  margin-top: 2px;
}
.score-info {
  flex: 1;
  min-width: 0;
}
.score-level {
  display: inline-block;
  padding: 2px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
}
.score-summary {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--pv-text);
  overflow-wrap: anywhere;
}
.report-block {
  margin-top: 14px;
}
.report-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--pv-text);
  margin-bottom: 6px;
}
.report-label.risk {
  color: #e8604c;
}
.report-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--pv-text);
}
.report-list li {
  overflow-wrap: anywhere;
}
.reminder-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
/* 提醒文案由 AI 生成、长度不可控：覆盖 el-tag 默认 nowrap 与固定高度，超长时在标签内换行 */
.reminder-tags :deep(.el-tag.reminder-tag) {
  max-width: 100%;
  height: auto;
  padding: 4px 10px;
  line-height: 1.5;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.report-disclaimer {
  margin: 14px 0 0;
  padding-top: 10px;
  border-top: 1px dashed var(--pv-border);
  font-size: 12px;
  color: var(--pv-text-secondary);
}

@media (max-width: 768px) {
  /* 多宠物切换改为横向滑动，避免筛选条占掉多行高度 */
  .pet-switcher {
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 4px;
    scrollbar-width: none;
  }
  .pet-switcher::-webkit-scrollbar {
    display: none;
  }
  .switcher-chip {
    flex-shrink: 0;
  }
  .id-card {
    padding: 20px 16px 18px;
  }
  .id-card-body {
    flex-direction: column;
    align-items: center;
    gap: 18px;
  }
  .id-avatar {
    border-width: 4px;
    font-size: 34px;
  }
  .id-fields {
    width: 100%;
    gap: 10px 14px;
  }
  .id-label {
    font-size: 11px;
    letter-spacing: 0.3px;
  }
  .id-value {
    margin-top: 4px;
    font-size: 13px;
  }
  .id-name {
    font-size: 21px;
  }
  .id-card-footer {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
  .id-date {
    align-items: flex-start;
  }
  .id-date-no {
    font-size: 22px;
  }
  .health-grid {
    grid-template-columns: 1fr;
  }
  .health-tile-full {
    grid-column: auto;
  }
  .ai-health-head {
    flex-wrap: wrap;
  }
}

@media (max-width: 360px) {
  .id-card {
    padding: 18px 14px 16px;
  }
  .unverified-tag {
    font-size: 10px;
    letter-spacing: 0.5px;
  }
}

/* 常见手机宽度：头像居左、字段居右的证件式布局，缩短卡片纵向长度 */
@media (min-width: 361px) and (max-width: 768px) {
  .id-card-body {
    flex-direction: row;
    align-items: flex-start;
    gap: 14px;
  }
  .id-avatar-wrap {
    align-self: flex-start;
  }
  .id-fields {
    width: auto;
    flex: 1;
    min-width: 0;
    grid-template-columns: 1fr 1fr;
    gap: 10px 14px;
  }
  .id-name {
    font-size: 21px;
  }
  .id-card-footer {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 10px 16px;
  }
  .id-date {
    align-items: flex-start;
  }
  .id-date-no {
    font-size: 19px;
    letter-spacing: 1px;
  }
}
</style>
