<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CircleClose, Plus, Search } from '@element-plus/icons-vue'
import AppHeader from '@/components/AppHeader.vue'
import { deleteSpace, getSpacePage, saveSpace, updateSpace, uploadSpaceMedia } from '@/api/space'

const router = useRouter()

const spaces = ref([])
const total = ref(0)
const pageNum = ref(1)
const pageSize = ref(10)
const keyword = ref('')
const category = ref('')
// 发布时间范围：[开始日期, 结束日期]，格式 YYYY-MM-DD，起止均含当天
const dateRange = ref(null)
const loading = ref(false)

// 当前登录用户ID，仅本人动态展示编辑/删除入口
const myId = String(JSON.parse(localStorage.getItem('user') || 'null')?.id || '')
const isMySpace = (item) => String(item.userId) === myId

// 可见性文案：0-公开 1-仅好友 2-仅自己，后端已按当前身份过滤
const visibilityLabel = { 0: '公开', 1: '仅好友', 2: '仅自己' }

// 媒体规格（与后端保持一致）：图片≤5MB，视频(mp4)≤50MB，单条最多9个
const MAX_MEDIA_COUNT = 9
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const MAX_VIDEO_SIZE = 50 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

const dialogVisible = ref(false)
const saving = ref(false)
const isEdit = ref(false)
const form = ref({ id: null, title: '', content: '', category: '', visibility: 0, mediaList: [] })
const uploading = ref(false)

const loadSpaces = async () => {
  loading.value = true
  try {
    const data = await getSpacePage({
      pageNum: pageNum.value,
      pageSize: pageSize.value,
      title: keyword.value || undefined,
      category: category.value || undefined,
      // 选中的日期换算为当天零点与当天末尾，确保起止日期当天的动态都能命中
      startTime: dateRange.value?.[0] ? `${dateRange.value[0]} 00:00:00` : undefined,
      endTime: dateRange.value?.[1] ? `${dateRange.value[1]} 23:59:59` : undefined,
    })
    spaces.value = data.records
    // 后端 Long 统一序列化为字符串（防雪花ID精度丢失），total 需还原为数字供分页组件使用
    total.value = Number(data.total || 0)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

onMounted(loadSpaces)

const onSearch = () => {
  pageNum.value = 1
  loadSpaces()
}

// 切换每页条数后回到第一页重新加载
const onSizeChange = () => {
  pageNum.value = 1
  loadSpaces()
}

const openCreate = () => {
  isEdit.value = false
  form.value = { id: null, title: '', content: '', category: '', visibility: 0, mediaList: [] }
  dialogVisible.value = true
}

const openEdit = (item) => {
  isEdit.value = true
  form.value = {
    id: item.id,
    title: item.title || '',
    content: item.content,
    category: item.category || '',
    visibility: Number(item.visibility || 0),
    mediaList: (item.mediaList || []).map((m) => ({ ...m })),
  }
  dialogVisible.value = true
}

// 上传前校验：与后端同规格，不合法直接拦截不发请求
const beforeUpload = (file) => {
  if (form.value.mediaList.length >= MAX_MEDIA_COUNT) {
    ElMessage.warning(`单条动态最多上传 ${MAX_MEDIA_COUNT} 个媒体`)
    return false
  }
  const isImage = IMAGE_TYPES.includes(file.type)
  const isVideo = file.type === 'video/mp4'
  if (!isImage && !isVideo) {
    ElMessage.error('仅支持 jpg/jpeg/png/webp/gif 图片或 mp4 视频')
    return false
  }
  if (isImage && file.size > MAX_IMAGE_SIZE) {
    ElMessage.error('图片大小不能超过 5MB')
    return false
  }
  if (isVideo && file.size > MAX_VIDEO_SIZE) {
    ElMessage.error('视频大小不能超过 50MB')
    return false
  }
  return true
}

// 自定义上传：逐文件调用媒体上传接口，成功后加入媒体列表
const handleUpload = async ({ file }) => {
  uploading.value = true
  try {
    const res = await uploadSpaceMedia(file)
    form.value.mediaList.push({ mediaType: res.mediaType, url: res.url })
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    uploading.value = false
  }
}

const removeMedia = (index) => {
  form.value.mediaList.splice(index, 1)
}

const onSave = async () => {
  if (!form.value.content.trim()) {
    ElMessage.warning('请输入动态内容')
    return
  }
  if (uploading.value) {
    ElMessage.warning('媒体上传中，请稍候')
    return
  }
  saving.value = true
  try {
    const payload = {
      title: form.value.title || undefined,
      content: form.value.content,
      category: form.value.category || undefined,
      visibility: form.value.visibility,
      mediaList: form.value.mediaList,
    }
    let res
    if (isEdit.value) {
      res = await updateSpace({ id: form.value.id, ...payload })
    } else {
      res = await saveSpace(payload)
    }
    ElMessage.success('发布成功')
    // 发布新动态会奖励宠物经验，升级时额外提示（仅新建时有奖励）
    const petExp = res?.petExp
    if (!isEdit.value && petExp) {
      if (petExp.leveledUp) {
        ElMessage.success(`宠物获得 +${petExp.gainedExp} 经验，升级到 Lv.${petExp.level}`)
      } else {
        ElMessage.success(`宠物获得 +${petExp.gainedExp} 经验`)
      }
    }
    dialogVisible.value = false
    loadSpaces()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}

const onDelete = async (item) => {
  try {
    await ElMessageBox.confirm('确定删除这条动态吗？删除后不可恢复', '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await deleteSpace(item.id)
    ElMessage.success('删除成功')
    loadSpaces()
  } catch {
    // 用户取消则不处理
  }
}

const formatTime = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '')

// 点击作者名跳转用户主页（与其他页面用户名交互保持一致）
const gotoProfile = (userId) => {
  if (userId) router.push(`/user/${userId}`)
}

// 媒体九宫格：单张占满一行，两张两列，其余三列
const mediaGridClass = (item) => {
  const count = item.mediaList?.length || 0
  if (count === 1) return 'media-grid single'
  if (count === 2 || count === 4) return 'media-grid two-col'
  return 'media-grid'
}

// 图片预览列表（仅取图片项），供 el-image 放大预览
const previewImages = (item) => (item.mediaList || []).filter((m) => m.mediaType === 0).map((m) => m.url)

const previewIndex = (item, media) => previewImages(item).indexOf(media.url)
</script>

<template>
  <div class="page">
    <AppHeader title="宠域空间" show-nav />

    <div class="page-container">
      <div class="page-head">
        <div>
          <h2 class="page-title">宠域空间</h2>
          <p class="page-desc">看看大家与宠物在一起的每个瞬间 · 发布新动态可为宠物 +10 经验</p>
        </div>
        <el-button type="primary" size="large" :icon="Plus" @click="openCreate">发布动态</el-button>
      </div>

      <div class="toolbar pv-panel">
        <el-input
          v-model.trim="keyword"
          placeholder="按标题搜索"
          clearable
          :prefix-icon="Search"
          class="toolbar-input"
          @keyup.enter="onSearch"
          @clear="onSearch"
        />
        <el-input
          v-model.trim="category"
          placeholder="按分类筛选"
          clearable
          class="toolbar-input narrow"
          @keyup.enter="onSearch"
          @clear="onSearch"
        />
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="YYYY-MM-DD"
          clearable
          @change="onSearch"
        />
        <el-button @click="onSearch">搜索</el-button>
      </div>

      <!-- 动态流 -->
      <div v-loading="loading" class="feed-list">
        <div v-for="item in spaces" :key="item.id" class="feed-card pv-panel">
          <div class="feed-head">
            <el-avatar :size="40" :src="item.authorAvatar || ''" class="feed-avatar">
              {{ (item.authorNickname || item.authorUsername || 'U')[0]?.toUpperCase() }}
            </el-avatar>
            <div class="feed-meta">
              <span class="feed-author" @click="gotoProfile(item.userId)">
                {{ item.authorNickname || item.authorUsername }}
              </span>
              <div class="feed-sub">
                <span class="feed-time">{{ formatTime(item.createTime) }}</span>
                <el-tag size="small" effect="plain" round>{{ visibilityLabel[item.visibility] || '公开' }}</el-tag>
                <el-tag v-if="item.category" size="small" type="info" effect="plain" round>
                  {{ item.category }}
                </el-tag>
              </div>
            </div>
            <div v-if="isMySpace(item)" class="feed-actions">
              <el-button link type="primary" @click="openEdit(item)">编辑</el-button>
              <el-button link type="danger" @click="onDelete(item)">删除</el-button>
            </div>
          </div>

          <div v-if="item.title" class="feed-title">{{ item.title }}</div>
          <div class="feed-content">{{ item.content }}</div>

          <div v-if="item.mediaList && item.mediaList.length" :class="mediaGridClass(item)">
            <template v-for="(media, idx) in item.mediaList" :key="idx">
              <el-image
                v-if="media.mediaType === 0"
                :src="media.url"
                fit="cover"
                class="media-item"
                :preview-src-list="previewImages(item)"
                :initial-index="previewIndex(item, media)"
                preview-teleported
              />
              <video
                v-else
                :src="media.url"
                controls
                preload="metadata"
                class="media-item media-video"
              />
            </template>
          </div>
        </div>

        <div v-if="!loading && !spaces.length" class="feed-empty pv-panel">
          {{
            keyword || category || dateRange
              ? '没有搜索到相关动态'
              : '还没有可见的动态，点击「发布动态」分享第一个瞬间吧'
          }}
        </div>

        <div v-if="total > 0" class="pager pv-panel">
          <span class="total-text">共 {{ total }} 条</span>
          <el-pagination
            v-model:current-page="pageNum"
            v-model:page-size="pageSize"
            :page-sizes="[10, 15, 20, 50]"
            :total="Number(total)"
            layout="sizes, prev, pager, next"
            background
            @current-change="loadSpaces"
            @size-change="onSizeChange"
          />
        </div>
      </div>
    </div>

    <!-- 发布/编辑动态弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑动态' : '发布动态'"
      width="560px"
      :close-on-click-modal="false"
    >
      <el-form :model="form" label-width="70px">
        <el-form-item label="内容" required>
          <el-input
            v-model.trim="form.content"
            type="textarea"
            :rows="5"
            placeholder="分享你和宠物的瞬间..."
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="标题">
          <el-input v-model.trim="form.title" placeholder="选填，给动态起个标题" maxlength="100" show-word-limit />
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model.trim="form.category" placeholder="如：日常、养宠经验（选填）" maxlength="50" />
        </el-form-item>
        <el-form-item label="图片视频">
          <div class="media-picker">
            <div v-for="(media, idx) in form.mediaList" :key="idx" class="media-thumb">
              <img v-if="media.mediaType === 0" :src="media.url" alt="" />
              <video v-else :src="media.url" preload="metadata" />
              <span v-if="media.mediaType === 1" class="media-type-badge">视频</span>
              <el-icon class="media-remove" @click="removeMedia(idx)"><CircleClose /></el-icon>
            </div>
            <el-upload
              v-if="form.mediaList.length < 9"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4"
              :show-file-list="false"
              :before-upload="beforeUpload"
              :http-request="handleUpload"
              class="media-uploader"
            >
              <div class="upload-trigger">
                <el-icon v-if="!uploading"><Plus /></el-icon>
                <span>{{ uploading ? '上传中' : `添加 ${form.mediaList.length}/9` }}</span>
              </div>
            </el-upload>
          </div>
          <div class="upload-tip">支持 jpg/png/webp/gif 图片（≤5MB）或 mp4 视频（≤50MB），最多 9 个</div>
        </el-form-item>
        <el-form-item label="可见性">
          <el-radio-group v-model="form.visibility">
            <el-radio :value="0">公开</el-radio>
            <el-radio :value="1">仅好友</el-radio>
            <el-radio :value="2">仅自己</el-radio>
          </el-radio-group>
          <div class="visibility-tip">
            公开：所有人可见；仅好友：只有好友可见；仅自己：只有自己可见（自己始终能看到自己的动态）
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">发布</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
}
.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.page-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--pv-text);
}
.page-desc {
  margin-top: 4px;
  color: var(--pv-text-secondary);
  font-size: 13px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 14px 16px;
  flex-wrap: wrap;
}
.toolbar-input {
  width: 220px;
}
.toolbar-input.narrow {
  width: 160px;
}
/* 日期范围选择器默认 350px 偏宽，收窄与搜索框协调 */
.toolbar :deep(.el-date-editor) {
  width: 250px;
  flex-shrink: 0;
}
.toolbar :deep(.el-range-separator) {
  padding: 0 2px;
}
.toolbar :deep(.el-range-input) {
  font-size: 13px;
}

/* 动态流 */
.feed-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.feed-card {
  padding: 18px 20px;
}
.feed-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.feed-avatar {
  flex-shrink: 0;
  background: var(--pv-ink);
  color: #fff;
}
.feed-meta {
  flex: 1;
  min-width: 0;
}
.feed-author {
  font-weight: 600;
  font-size: 15px;
  color: var(--pv-text);
  cursor: pointer;
}
.feed-author:hover {
  text-decoration: underline;
}
.feed-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.feed-time {
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.feed-actions {
  flex-shrink: 0;
}
.feed-title {
  margin-top: 12px;
  font-size: 16px;
  font-weight: 600;
  color: var(--pv-text);
}
.feed-content {
  margin-top: 8px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--pv-text);
  white-space: pre-wrap;
  word-break: break-word;
}

/* 媒体九宫格 */
.media-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 12px;
  max-width: 640px;
}
.media-grid.two-col {
  grid-template-columns: repeat(2, 1fr);
  max-width: 480px;
}
.media-grid.single {
  grid-template-columns: 1fr;
  max-width: 360px;
}
.media-item {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 10px;
  background: var(--pv-tint);
  object-fit: cover;
  display: block;
}
.media-video {
  border: 1px solid var(--pv-border);
}
.feed-empty {
  padding: 48px 0;
  text-align: center;
  color: var(--pv-text-secondary);
}

/* 发布弹窗内的媒体选择 */
.media-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.media-thumb {
  position: relative;
  width: 76px;
  height: 76px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--pv-border);
}
.media-thumb img,
.media-thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.media-type-badge {
  position: absolute;
  left: 4px;
  bottom: 4px;
  font-size: 11px;
  color: #fff;
  background: rgba(23, 24, 28, 0.72);
  border-radius: 4px;
  padding: 1px 5px;
}
.media-remove {
  position: absolute;
  top: 3px;
  right: 3px;
  font-size: 18px;
  color: #fff;
  background: rgba(23, 24, 28, 0.6);
  border-radius: 50%;
  cursor: pointer;
}
.media-remove:hover {
  background: rgba(23, 24, 28, 0.85);
}
.upload-trigger {
  width: 76px;
  height: 76px;
  border: 1px dashed var(--pv-border);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--pv-text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s;
}
.upload-trigger:hover {
  border-color: var(--pv-ink);
  color: var(--pv-ink);
}
.upload-tip,
.visibility-tip {
  margin-top: 6px;
  font-size: 12px;
  color: var(--pv-text-secondary);
  line-height: 1.6;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  padding: 14px 20px;
}
.total-text {
  font-size: 13px;
  color: var(--pv-text-secondary);
}
</style>
