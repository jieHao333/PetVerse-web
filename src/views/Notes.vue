<script setup>
import { onMounted, ref } from 'vue'
import { Plus, Search } from '@element-plus/icons-vue'
import AppHeader from '@/components/AppHeader.vue'
import { deleteNote, getNotePage, saveNote, updateNote } from '@/api/note'

const notes = ref([])
const total = ref(0)
const pageNum = ref(1)
const pageSize = ref(10)
const keyword = ref('')
const category = ref('')
const loading = ref(false)

const dialogVisible = ref(false)
const saving = ref(false)
const isEdit = ref(false)
const form = ref({ id: null, title: '', content: '', category: '' })

const loadNotes = async () => {
  loading.value = true
  try {
    const data = await getNotePage({
      pageNum: pageNum.value,
      pageSize: pageSize.value,
      title: keyword.value || undefined,
      category: category.value || undefined,
    })
    notes.value = data.records
    total.value = data.total
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

onMounted(loadNotes)

const onSearch = () => {
  pageNum.value = 1
  loadNotes()
}

const openCreate = () => {
  isEdit.value = false
  form.value = { id: null, title: '', content: '', category: '' }
  dialogVisible.value = true
}

const openEdit = (note) => {
  isEdit.value = true
  form.value = { id: note.id, title: note.title, content: note.content, category: note.category }
  dialogVisible.value = true
}

const onSave = async () => {
  if (!form.value.title.trim()) {
    ElMessage.warning('请输入笔记标题')
    return
  }
  if (!form.value.content.trim()) {
    ElMessage.warning('请输入笔记内容')
    return
  }
  saving.value = true
  try {
    let res
    if (isEdit.value) {
      res = await updateNote({
        id: form.value.id,
        title: form.value.title,
        content: form.value.content,
        category: form.value.category,
      })
    } else {
      res = await saveNote({
        title: form.value.title,
        content: form.value.content,
        category: form.value.category,
      })
    }
    ElMessage.success('保存成功')
    // 新建笔记会奖励宠物经验，升级时额外提示（仅新建时有奖励）
    const petExp = res?.petExp
    if (!isEdit.value && petExp) {
      if (petExp.leveledUp) {
        ElMessage.success(`宠物获得 +${petExp.gainedExp} 经验，升级到 Lv.${petExp.level}`)
      } else {
        ElMessage.success(`宠物获得 +${petExp.gainedExp} 经验`)
      }
    }
    dialogVisible.value = false
    loadNotes()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}

const onDelete = async (note) => {
  try {
    await ElMessageBox.confirm(`确定删除笔记「${note.title}」吗？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await deleteNote(note.id)
    ElMessage.success('删除成功')
    loadNotes()
  } catch {
    // 用户取消则不处理
  }
}

const formatTime = (t) => (t ? t.replace('T', ' ').slice(0, 16) : '')
</script>

<template>
  <div class="page">
    <AppHeader title="我的笔记" show-nav />

    <div class="page-container">
      <div class="page-head">
        <div>
          <h2 class="page-title">我的笔记</h2>
          <p class="page-desc">记录与宠物在一起的每个瞬间 · 发布新笔记可为宠物 +10 经验</p>
        </div>
        <el-button type="primary" size="large" :icon="Plus" @click="openCreate">新建笔记</el-button>
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
        <el-button @click="onSearch">搜索</el-button>
      </div>

      <div class="table-wrap pv-panel">
        <el-table
          v-loading="loading"
          :data="notes"
          empty-text="暂无笔记，点击「新建笔记」开始记录"
          row-key="id"
        >
          <el-table-column label="标题" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="note-title">{{ row.title }}</span>
            </template>
          </el-table-column>
          <el-table-column label="分类" width="120">
            <template #default="{ row }">
              <el-tag v-if="row.category" type="info" effect="plain" round>{{ row.category }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="内容" min-width="240" show-overflow-tooltip prop="content" />
          <el-table-column label="创建时间" width="150">
            <template #default="{ row }">{{ formatTime(row.createTime) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="140" align="center">
            <template #default="{ row }">
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button link type="danger" @click="onDelete(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="pager">
          <span class="total-text">共 {{ total }} 条</span>
          <el-pagination
            v-model:current-page="pageNum"
            :page-size="pageSize"
            :total="total"
            layout="prev, pager, next"
            background
            @current-change="loadNotes"
          />
        </div>
      </div>
    </div>

    <!-- 新增/编辑弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑笔记' : '新建笔记'"
      width="520px"
      :close-on-click-modal="false"
    >
      <el-form :model="form" label-width="70px">
        <el-form-item label="标题" required>
          <el-input v-model.trim="form.title" placeholder="请输入标题" maxlength="100" show-word-limit />
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model.trim="form.category" placeholder="如：日常、养宠经验（选填）" maxlength="50" />
        </el-form-item>
        <el-form-item label="内容" required>
          <el-input
            v-model.trim="form.content"
            type="textarea"
            :rows="6"
            placeholder="写点什么吧..."
            show-word-limit
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
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
.table-wrap {
  overflow: hidden;
}
.table-wrap :deep(.el-table) {
  --el-table-border-color: #eef1f6;
  --el-table-header-bg-color: #fafafa;
  --el-table-header-text-color: #64748b;
  --el-table-row-hover-bg-color: var(--pv-tint);
}
.table-wrap :deep(.el-table th.el-table__cell) {
  font-weight: 600;
}
.note-title {
  font-weight: 500;
  color: var(--pv-text);
}
.pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  padding: 14px 20px;
  border-top: 1px solid #f1f3f9;
}
.total-text {
  font-size: 13px;
  color: var(--pv-text-secondary);
}
</style>
