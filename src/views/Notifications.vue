<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NOTIF_SOURCE, NOTIF_TYPE, markAllRead, markRead, pageNotifications } from '@/api/notification'
import { DEFAULT_AVATAR } from '@/utils/avatar'

const router = useRouter()

const list = ref([])
const total = ref(0)
const pageNum = ref(1)
const pageSize = ref(10)
const onlyUnread = ref(false)
const loading = ref(false)

const formatTime = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '')

// 来源标签颜色：圈子动态-主色，商品评价-警告色
const sourceTagType = (source) => (source === NOTIF_SOURCE.SHOP_REVIEW ? 'warning' : 'primary')

// 依据类型 + 来源生成一句可读的动作文案
const actionText = (item) => {
  const { type, source } = item
  if (type === NOTIF_TYPE.LIKE) return source === NOTIF_SOURCE.SPACE ? '赞了你的动态' : '赞了你'
  if (type === NOTIF_TYPE.COMMENT) return source === NOTIF_SOURCE.SHOP_REVIEW ? '评论了你的评价' : '评论了你的动态'
  if (type === NOTIF_TYPE.REPLY) return source === NOTIF_SOURCE.SHOP_REVIEW ? '回复了你的评价' : '回复了你的评论'
  return '给你发来一条消息'
}

const loadList = async () => {
  loading.value = true
  try {
    const data = await pageNotifications({
      pageNum: pageNum.value,
      pageSize: pageSize.value,
      onlyUnread: onlyUnread.value ? 1 : undefined,
    })
    list.value = data.records || []
    // 后端 Long 统一序列化为字符串，total 需还原为数字供分页组件使用
    total.value = Number(data.total || 0)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

onMounted(loadList)

const onFilterChange = () => {
  pageNum.value = 1
  loadList()
}

const onSizeChange = () => {
  pageNum.value = 1
  loadList()
}

const isUnread = (item) => Number(item.isRead) === 0

// 点击通知：先标记已读，再按来源跳转到对应内容
const onOpen = async (item) => {
  if (isUnread(item)) {
    try {
      await markRead(item.id)
      item.isRead = 1
    } catch {
      // 标记失败不阻断跳转
    }
  }
  if (item.source === NOTIF_SOURCE.SHOP_REVIEW && item.targetId) {
    router.push(`/shop/product/${item.targetId}`)
  } else {
    // 圈子动态：回到圈子信息流查看
    router.push('/space')
  }
}

const onMarkAllRead = async () => {
  try {
    await markAllRead()
    ElMessage.success('已全部标记为已读')
    loadList()
  } catch (e) {
    ElMessage.error(e.message)
  }
}
</script>

<template>
  <div class="page">
    <div class="page-container">
      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <span class="card-title">消息中心</span>
            <div class="header-actions">
              <el-switch
                v-model="onlyUnread"
                inline-prompt
                active-text="仅看未读"
                inactive-text="全部"
                @change="onFilterChange"
              />
              <el-button
                type="primary"
                plain
                size="small"
                :disabled="total === 0"
                @click="onMarkAllRead"
              >
                全部已读
              </el-button>
            </div>
          </div>
        </template>

        <div v-loading="loading" class="notif-list">
          <el-empty v-if="!loading && list.length === 0" :description="onlyUnread ? '没有未读消息' : '还没有收到任何消息通知'" />

          <div
            v-for="item in list"
            :key="item.id"
            :class="['notif-item', { unread: isUnread(item) }]"
            @click="onOpen(item)"
          >
            <el-avatar :size="40" :src="item.actorAvatar || DEFAULT_AVATAR" class="notif-avatar">
              {{ (item.actorNickname || '宠').slice(0, 1) }}
            </el-avatar>
            <div class="notif-body">
              <div class="notif-head">
                <span class="notif-actor">{{ item.actorNickname || `用户${item.actorUserId}` }}</span>
                <span class="notif-action">{{ actionText(item) }}</span>
                <el-tag :type="sourceTagType(item.source)" size="small" effect="plain" round>
                  {{ item.sourceText }}
                </el-tag>
                <span class="notif-time">{{ formatTime(item.createTime) }}</span>
              </div>
              <div v-if="item.content" class="notif-content">{{ item.content }}</div>
            </div>
            <span v-if="isUnread(item)" class="notif-dot"></span>
          </div>
        </div>

        <div v-if="total > 0" class="pager">
          <span class="total-text">共 {{ total }} 条</span>
          <el-pagination
            v-model:current-page="pageNum"
            v-model:page-size="pageSize"
            :page-sizes="[10, 15, 20, 50]"
            :total="Number(total)"
            layout="sizes, prev, pager, next"
            background
            @current-change="loadList"
            @size-change="onSizeChange"
          />
        </div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
.header-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.notif-list {
  display: flex;
  flex-direction: column;
  min-height: 120px;
}
.notif-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.2s;
}
.notif-item + .notif-item {
  border-top: 1px solid var(--pv-border);
}
.notif-item:hover {
  background: var(--pv-tint);
}
.notif-item.unread {
  background: rgba(64, 158, 255, 0.06);
}
.notif-avatar {
  flex-shrink: 0;
  background: var(--pv-ink);
  color: #fff;
}
.notif-body {
  flex: 1;
  min-width: 0;
}
.notif-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.notif-actor {
  font-weight: 600;
  font-size: 14px;
  color: var(--pv-text);
}
.notif-action {
  font-size: 14px;
  color: var(--pv-text-secondary);
}
.notif-time {
  font-size: 12px;
  color: var(--pv-text-secondary);
  margin-left: auto;
}
.notif-content {
  margin-top: 6px;
  font-size: 13px;
  color: var(--pv-text);
  line-height: 1.6;
  word-break: break-word;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.notif-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-color-danger);
  margin-top: 6px;
}

.pager {
  margin-top: 20px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
}
.total-text {
  font-size: 13px;
  color: var(--pv-text-secondary);
}
</style>
