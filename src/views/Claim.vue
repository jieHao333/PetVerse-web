<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import { claimPet, getCatalog, randomCatalog } from '@/api/pet'

const router = useRouter()

const catalog = ref([])
const loading = ref(true)
const selectedId = ref(null)

const previewDialog = ref(false)
const preview = ref(null)
const claiming = ref(false)
// 用户为宠物取的名字，随机与自选流程共用，重新抽卡时保留已取的名字
const petName = ref('')

// 校验名字：领养前必须取名且不超过 50 字符（后端也会校验）
const checkName = () => {
  const name = petName.value.trim()
  if (!name) {
    ElMessage.warning('请先给宠物取个名字')
    return null
  }
  if (name.length > 50) {
    ElMessage.warning('宠物名称不能超过50个字符')
    return null
  }
  return name
}

const rarityType = (code) => ({ 1: 'info', 2: 'primary', 3: 'warning' })[code] || 'info'

onMounted(async () => {
  try {
    catalog.value = await getCatalog()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
})

// 随机抽取：先预览，再确认领取
const onRandomPreview = async () => {
  try {
    preview.value = await randomCatalog()
    previewDialog.value = true
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// 确认领取（RANDOM）
const onClaimRandom = async () => {
  const name = checkName()
  if (!name) return
  claiming.value = true
  try {
    await claimPet({ method: 'RANDOM', name })
    ElMessage.success(`恭喜，${name} 成为你的伙伴！`)
    previewDialog.value = false
    router.push({ name: 'home' })
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    claiming.value = false
  }
}

// 自选领取（CHOOSE）
const onClaimChoose = async () => {
  if (!selectedId.value) {
    ElMessage.warning('请先选择一只宠物')
    return
  }
  const name = checkName()
  if (!name) return
  claiming.value = true
  try {
    await claimPet({ method: 'CHOOSE', catalogId: selectedId.value, name })
    ElMessage.success(`领养成功，${name} 正在等你！`)
    router.push({ name: 'home' })
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    claiming.value = false
  }
}
</script>

<template>
  <div class="page">
    <AppHeader title="领养宠物" show-back />

    <div class="page-container">
      <!-- 随机抽取 -->
      <el-card shadow="never" class="section random-section">
        <div class="random-hero">
          <div class="random-copy">
            <div class="random-title">🎲 随机抽取</div>
            <div class="random-tip">不想选择的话，就让命运为你安排一位伙伴吧</div>
          </div>
          <el-button size="large" round class="random-btn" @click="onRandomPreview">
            随机抽取一只
          </el-button>
        </div>
      </el-card>

      <!-- 图鉴自选 -->
      <el-card shadow="never" class="section">
        <template #header>
          <span class="card-title">图鉴自选</span>
        </template>
        <p class="tip">从下面的宠物中选择你心仪的一位，并给它取个名字</p>

        <div v-loading="loading" class="catalog-grid">
          <div
            v-for="item in catalog"
            :key="item.id"
            class="catalog-item"
            :class="{ active: selectedId === item.id }"
            @click="selectedId = item.id"
          >
            <el-avatar :size="72" :src="item.imageUrl || ''" class="pet-thumb" shape="square">
              {{ (item.name || '宠')[0] }}
            </el-avatar>
            <div class="item-name">{{ item.name }}</div>
            <el-tag :type="rarityType(item.rarity)" size="small" effect="plain">{{ item.rarityName }}</el-tag>
            <div class="item-breed">{{ item.species }} · {{ item.breed }}</div>
          </div>
        </div>

        <div class="choose-actions">
          <el-input
            v-model="petName"
            class="name-input"
            size="large"
            maxlength="50"
            placeholder="给它取个名字吧"
            clearable
          />
          <el-button type="primary" size="large" :loading="claiming" @click="onClaimChoose">
            领养所选宠物
          </el-button>
        </div>
      </el-card>
    </div>

    <!-- 随机抽取结果预览 -->
    <el-dialog v-model="previewDialog" title="抽取结果" width="380px">
      <div v-if="preview" class="preview-body">
        <el-avatar :size="96" :src="preview.imageUrl || ''" class="preview-avatar">
          {{ (preview.name || '宠')[0] }}
        </el-avatar>
        <div class="preview-name">{{ preview.name }}</div>
        <el-tag :type="rarityType(preview.rarity)" effect="plain">{{ preview.rarityName }}</el-tag>
        <div class="preview-breed">{{ preview.species }} · {{ preview.breed }}</div>
        <div class="preview-desc">{{ preview.description }}</div>
        <el-input
          v-model="petName"
          class="name-input"
          size="large"
          maxlength="50"
          placeholder="给它取个名字吧"
          clearable
        />
      </div>
      <template #footer>
        <el-button @click="onRandomPreview">再抽一次</el-button>
        <el-button type="primary" :loading="claiming" @click="onClaimRandom">确认领取</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
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
.section {
  margin-bottom: 24px;
}
.tip {
  color: var(--pv-text-secondary);
  margin: 0 0 18px;
}

/* 随机抽取区 */
.random-section {
  overflow: hidden;
}
.random-section :deep(.el-card__body) {
  padding: 0;
}
.random-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  padding: 30px 34px;
  background: var(--pv-ink);
  position: relative;
  overflow: hidden;
}
.random-hero::before {
  content: '';
  position: absolute;
  width: 240px;
  height: 240px;
  right: -70px;
  top: -100px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.random-hero::after {
  content: '';
  position: absolute;
  width: 120px;
  height: 120px;
  left: 44%;
  bottom: -70px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.random-copy {
  position: relative;
  z-index: 1;
}
.random-title {
  color: #fff;
  font-size: 20px;
  font-weight: 700;
}
.random-tip {
  color: rgba(255, 255, 255, 0.6);
  margin: 8px 0 0;
  font-size: 13px;
}
.random-btn {
  position: relative;
  z-index: 1;
  background: #fff;
  color: var(--pv-ink);
  border: none;
  font-weight: 600;
  padding: 12px 28px;
}
.random-btn:hover,
.random-btn:focus {
  background: var(--pv-tint);
  color: var(--pv-ink);
  transform: translateY(-2px);
}

/* 图鉴网格 */
.catalog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 16px;
  min-height: 80px;
}
.catalog-item {
  position: relative;
  border: 1px solid var(--pv-border);
  background: #fff;
  border-radius: 14px;
  padding: 18px 16px;
  text-align: center;
  cursor: pointer;
  transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease;
}
.catalog-item:hover {
  transform: translateY(-4px);
  border-color: #c9c8c4;
  box-shadow: var(--pv-shadow-lg);
}
.catalog-item.active {
  border-color: transparent;
  box-shadow: 0 0 0 2px var(--pv-ink), var(--pv-shadow);
}
.catalog-item.active::after {
  content: '✓';
  position: absolute;
  top: 10px;
  right: 10px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--pv-ink);
  color: #fff;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pet-thumb {
  margin-bottom: 12px;
  font-size: 24px;
  box-shadow: 0 6px 14px rgba(23, 24, 28, 0.1);
}
.item-name {
  font-weight: 600;
  color: var(--pv-text);
  margin-bottom: 6px;
}
.item-breed {
  font-size: 12px;
  color: var(--pv-text-secondary);
  margin-top: 6px;
}
.choose-actions {
  margin-top: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  flex-wrap: wrap;
}
.name-input {
  width: 300px;
  max-width: 100%;
}

/* 抽取预览弹窗 */
.preview-body {
  text-align: center;
  padding: 8px 0;
}
.preview-avatar {
  border: 4px solid #fff;
  box-shadow: 0 0 0 2px var(--pv-ink), 0 12px 28px rgba(23, 24, 28, 0.18);
  font-size: 32px;
  margin-bottom: 14px;
}
.preview-name {
  font-size: 21px;
  font-weight: 700;
  color: var(--pv-text);
  margin-bottom: 8px;
}
.preview-breed {
  color: var(--pv-text-secondary);
  margin-top: 8px;
}
.preview-desc {
  color: var(--pv-text-secondary);
  margin-top: 10px;
  line-height: 1.7;
}
.preview-body .name-input {
  margin-top: 18px;
  width: 100%;
}
</style>
