<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Plus } from '@element-plus/icons-vue'
import AppHeader from '@/components/AppHeader.vue'
import { listMyPets, uploadPetAvatar, updatePetHealth } from '@/api/pet'
import logo from '@/assets/logo.jpg'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const pets = ref([])

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
  if (!pet.birthday) return ''
  const birth = new Date(pet.birthday)
  const now = new Date()
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth())
  if (now.getDate() < birth.getDate()) months -= 1
  if (months < 0) months = 0
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
// 类别元数据：key 与后端字段 / AI 上下文键一致；icon 用 emoji、color 为图标底色
const HEALTH_ITEMS = [
  { key: 'weight', label: '体重', icon: '⚖️', color: '#4a90d9', hint: '定时记录体重可以更好的管理爱宠健康～', full: true },
  { key: 'bcs', label: 'BCS', icon: '📊', color: '#2ec7a0', hint: '体况评分' },
  { key: 'deworming', label: '驱虫', icon: '🐛', color: '#8b6fe8', hint: '建议3个月1次' },
  { key: 'specialPeriod', label: '特殊时期', icon: '📅', color: '#f5a623', hint: '如发情期 / 孕期 / 哺乳期' },
  { key: 'vaccine', label: '疫苗', icon: '💉', color: '#e858a8', hint: '建议接种疫苗' },
  { key: 'rearingMethod', label: '养育方式', icon: '🏠', color: '#e8604c', hint: '如室内散养 / 笼养等' },
  { key: 'medicalHistory', label: '病史', icon: '🏥', color: '#29b6d8', hint: '记录既往疾病与用药' },
]

// 仅猫 / 狗展示健康信息模块
const showHealth = computed(() => ['猫', '狗'].includes(current.value?.species))

// 健康项编辑弹窗：点击磁贴或 + 号打开，回填当前值
const healthDialog = ref(false)
const healthTarget = ref(null)
const healthValue = ref('')
const savingHealth = ref(false)

const openHealthEdit = (item) => {
  if (!current.value) return
  healthTarget.value = item
  healthValue.value = current.value[item.key] || ''
  healthDialog.value = true
}

const onSaveHealth = async () => {
  if (!current.value || !healthTarget.value || savingHealth.value) return
  savingHealth.value = true
  try {
    const data = await updatePetHealth(current.value.id, healthTarget.value.key, healthValue.value)
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
              <el-avatar :size="150" :src="current.imageUrl || ''" class="id-avatar">
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
                {{ current[item.key] || item.hint }}
              </div>
            </div>
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

    <!-- 健康信息编辑弹窗 -->
    <el-dialog v-model="healthDialog" :title="`记录${healthTarget?.label || ''}`" width="420px">
      <el-input
        v-model="healthValue"
        type="textarea"
        :rows="3"
        maxlength="500"
        show-word-limit
        :placeholder="healthTarget?.hint || '请输入内容'"
      />
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
  align-items: center;
  justify-content: space-between;
  gap: 12px;
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
}
.id-date-no {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 2px;
  color: var(--pv-ink);
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

@media (max-width: 768px) {
  .id-card-body {
    flex-direction: column;
    align-items: flex-start;
    gap: 18px;
  }
  .id-card-footer {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
  .id-date {
    align-items: flex-start;
  }
  .health-grid {
    grid-template-columns: 1fr;
  }
  .health-tile-full {
    grid-column: auto;
  }
}
</style>
