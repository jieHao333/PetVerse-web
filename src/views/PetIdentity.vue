<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import { listMyPets } from '@/api/pet'
import logo from '@/assets/logo.jpg'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const pets = ref([])

// 当前查看的宠物：优先路由指定 ID，其次第一只已签发身份卡的宠物，兜底第一只
const current = computed(
  () =>
    pets.value.find((p) => String(p.id) === String(route.params.id)) ||
    pets.value.find((p) => p.cardIssueDate) ||
    pets.value[0] ||
    null,
)

// 切换宠物：replace 避免切换过程堆积历史记录
const select = (pet) => {
  if (!current.value || pet.id !== current.value.id) {
    router.replace(`/pet/identity/${pet.id}`)
  }
}

// 真实宠物按生日计算年龄，不足 1 岁展示月龄；虚拟宠物直接使用年龄字段
const ageText = (pet) => {
  if (!pet) return '未填写'
  if (pet.type !== 'REAL') return `${pet.age ?? 0}岁`
  if (!pet.birthday) return '未填写'
  const birth = new Date(pet.birthday)
  const now = new Date()
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth())
  if (now.getDate() < birth.getDate()) months -= 1
  if (months < 0) months = 0
  return months >= 12 ? `${Math.floor(months / 12)}岁` : `${months}个月`
}

// 签发编号：签发日期去掉分隔符，如 20260905
const dateNo = (pet) => (pet?.cardIssueDate ? pet.cardIssueDate.replace(/-/g, '') : '')

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
    <AppHeader title="宠物身份证" show-back />

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
            :class="{ active: p.id === current.id }"
            @click="select(p)"
          >
            <el-avatar :size="26" :src="p.imageUrl || ''">{{ (p.name || '宠')[0] }}</el-avatar>
            <span class="chip-name">{{ p.name }}</span>
            <span v-if="!p.cardIssueDate" class="chip-lock">未签发</span>
          </button>
        </div>

        <!-- 已签发：宠物身份证 -->
        <div v-if="current.cardIssueDate" class="id-card">
          <div class="id-card-title">宠物身份证</div>
          <div class="id-card-body">
            <el-avatar :size="150" :src="current.imageUrl || ''" class="id-avatar">
              {{ (current.name || '宠')[0] }}
            </el-avatar>
            <div class="id-fields">
              <div class="id-field id-field-full">
                <div class="id-label">名字/NAME</div>
                <div class="id-value id-name">{{ current.name }}</div>
              </div>
              <div class="id-field">
                <div class="id-label">品种/BREED ›</div>
                <div class="id-value">{{ current.breed || current.species || '未填写' }}</div>
              </div>
              <div class="id-field">
                <div class="id-label">年龄/AGE</div>
                <div class="id-value">{{ ageText(current) }}</div>
              </div>
              <div class="id-field">
                <div class="id-label">性别/GENDER</div>
                <div class="id-value">{{ current.genderName || '未填写' }}</div>
              </div>
              <div class="id-field">
                <div class="id-label">绝育/NEUTER</div>
                <div class="id-value">{{ current.sterilized ? '已绝育' : '未绝育' }}</div>
              </div>
            </div>
          </div>
          <div class="id-card-footer">
            <div class="id-brand">
              <img :src="logo" alt="PetVerse" class="id-logo" />
              <span class="id-brand-name">PetVerse</span>
            </div>
            <div class="id-date">
              <span class="id-label">签发日期/DATE No.</span>
              <span class="id-date-no">{{ dateNo(current) }}</span>
            </div>
          </div>
        </div>

        <!-- 未签发：真实宠物待完善档案后自动签发 -->
        <div v-else class="id-card unissued">
          <div class="id-card-title">宠物身份证</div>
          <div class="id-unissued-body">
            <div class="stamp">未签发</div>
            <p class="unissued-tip">
              {{
                current.type === 'REAL'
                  ? '完善宠物档案（种类 / 性别 / 生日）后自动签发身份卡'
                  : '身份卡尚未签发'
              }}
            </p>
            <el-button
              v-if="current.type === 'REAL'"
              type="primary"
              round
              @click="router.push(`/pet/profile/${current.id}`)"
            >
              去完善信息
            </el-button>
          </div>
        </div>
      </template>
    </div>
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
.id-card-title {
  font-size: 20px;
  font-weight: 800;
  color: var(--pv-ink);
}
.id-card-body {
  display: flex;
  align-items: center;
  gap: 30px;
  margin-top: 20px;
}
.id-avatar {
  flex-shrink: 0;
  border: 6px solid #fff;
  background: #f7ddc9;
  font-size: 46px;
  color: #8a5a3b;
  box-shadow: 0 8px 18px rgba(23, 24, 28, 0.12);
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
  align-items: baseline;
  gap: 10px;
}
.id-date-no {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 2px;
  color: var(--pv-ink);
}

/* 未签发状态：灰底 + 红色未签发印章 */
.unissued {
  background-color: #f2f1ee;
  background-image: none;
}
.id-unissued-body {
  padding: 34px 0 26px;
  text-align: center;
}
.stamp {
  display: inline-block;
  padding: 6px 18px;
  border: 3px solid rgba(196, 86, 86, 0.65);
  border-radius: 8px;
  color: rgba(196, 86, 86, 0.8);
  font-size: 22px;
  font-weight: 800;
  letter-spacing: 6px;
  transform: rotate(-8deg);
}
.unissued-tip {
  margin: 18px 0 14px;
  font-size: 13px;
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
}
</style>
