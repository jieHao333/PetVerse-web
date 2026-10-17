<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { Download, Refresh, Upload } from '@element-plus/icons-vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import {
  deleteKbDocument,
  fetchKbFileUrl,
  getKbPreview,
  listKbDocuments,
  reindexKb,
  uploadKbDocument,
} from '@/api/ai'

// 知识库管理页（管理员限定）：维护 AI 顾问检索用的养宠知识语料（md / pdf / docx / doc）
// 入口由路由 meta.roles 与后端 X-User-Role 双重把关，页面本身不处理凭证
const loading = ref(false)
const reindexing = ref(false)
const uploading = ref(false)
const docs = ref([])
const summary = ref({ totalDocuments: 0, totalChunks: 0, totalChars: 0 })
const supported = ref([])
const fileInput = ref(null)

// 列表分页与过滤：语料会持续增长，按服务端分页取当前页，不做前端假分页
const query = reactive({ page: 1, size: 10, keyword: '' })
const total = ref(0)

// 上传表单（弹窗内编辑，确认后连同文件一起提交）
const uploadDialog = ref(false)
const pickedFile = ref(null)
const form = ref({ title: '', category: '', species: [] })

// 在线预览弹窗
const previewVisible = ref(false)
const previewLoading = ref(false)
const preview = ref(null)
const previewTab = ref('doc')
// PDF 原文的 object URL：iframe 自己带不了 Authorization 头，只能先把二进制取回来；
// 关闭弹窗与组件卸载都要 revoke，否则每预览一次就漏掉一份文件大小的内存
const pdfUrl = ref('')
const releaseFileUrl = () => {
  if (pdfUrl.value) {
    URL.revokeObjectURL(pdfUrl.value)
    pdfUrl.value = ''
  }
}
onUnmounted(releaseFileUrl)

const SPECIES_OPTIONS = ['猫', '狗', '通用']

const kindType = (kind) => ({ pdf: 'danger', doc: 'warning', docx: 'warning' }[kind] || 'success')
const kindLabel = (kind) => (kind || 'md').toUpperCase()

const formatTime = (ts) => {
  if (!ts) return '-'
  const d = new Date(ts * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const loadDocuments = async () => {
  loading.value = true
  try {
    const data = await listKbDocuments({ page: query.page, size: query.size, keyword: query.keyword })
    docs.value = data.items || []
    total.value = data.total || 0
    summary.value = {
      totalDocuments: data.totalDocuments || 0,
      totalChunks: data.totalChunks || 0,
      totalChars: data.totalChars || 0,
    }
    supported.value = data.supportedKinds || []
  } catch (e) {
    ElMessage.error(e.message || '知识库列表加载失败')
  } finally {
    loading.value = false
  }
}

const searchDocuments = () => {
  query.page = 1
  loadDocuments()
}

// ---------- 在线预览 ----------
const isPdfPreview = computed(() => preview.value?.kind === 'pdf' && !!pdfUrl.value)

// Markdown 正文必须先过 DOMPurify：文档内容来自上传的文件，
// 直接 v-html 等于把「上传文档」变成「向页面注入脚本」的通道
const previewHtml = computed(() => {
  const doc = preview.value
  if (!doc?.content || doc.format !== 'markdown') return ''
  return DOMPurify.sanitize(marked.parse(doc.content))
})

const openPreview = async (row) => {
  previewVisible.value = true
  previewLoading.value = true
  previewTab.value = 'doc'
  preview.value = null
  releaseFileUrl()
  try {
    preview.value = await getKbPreview(row.docId)
    // PDF 交给浏览器内置查看器原样渲染；其余格式展示后端回传的正文
    if (preview.value.kind === 'pdf' && preview.value.hasFile) {
      pdfUrl.value = (await fetchKbFileUrl(row.docId)).url
    }
  } catch (e) {
    ElMessage.error(e.message || '预览加载失败')
    previewVisible.value = false
  } finally {
    previewLoading.value = false
  }
}

const downloadOriginal = async () => {
  if (!preview.value?.hasFile) {
    ElMessage.warning('该文档没有留存的原文文件')
    return
  }
  try {
    const { url } = await fetchKbFileUrl(preview.value.docId)
    const a = document.createElement('a')
    a.href = url
    a.download = preview.value.source || preview.value.docId
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    ElMessage.error(e.message || '原文下载失败')
  }
}

// ---------- 上传 ----------
const pickFile = () => fileInput.value?.click()

const onFileChange = (event) => {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const suffix = `.${(file.name.split('.').pop() || '').toLowerCase()}`
  if (supported.value.length && !supported.value.includes(suffix)) {
    ElMessage.warning(`暂不支持 ${suffix} 格式，可用格式：${supported.value.join(' / ')}`)
    return
  }
  pickedFile.value = file
  form.value.title = file.name.replace(/\.[^.]+$/, '')
  uploadDialog.value = true
}

const submitUpload = async () => {
  if (!pickedFile.value) return
  uploading.value = true
  try {
    const result = await uploadKbDocument(pickedFile.value, {
      title: form.value.title?.trim(),
      category: form.value.category?.trim(),
      species: (form.value.species || []).join(','),
    })
    ElMessage.success(`已入库：${result.source}（${result.chunks} 条片段）`)
    uploadDialog.value = false
    pickedFile.value = null
    form.value = { title: '', category: '', species: [] }
    // 列表按更新时间倒序，新文档在第一页
    query.page = 1
    await loadDocuments()
  } catch (e) {
    ElMessage.error(e.message || '文档入库失败')
  } finally {
    uploading.value = false
  }
}

// ---------- 删除 / 重建 ----------
const removeDoc = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确定删除《${row.name}》及其 ${row.chunkCount} 条知识片段？AI 顾问将不再检索到该文档内容。`,
      '删除文档',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await deleteKbDocument(row.docId)
    ElMessage.success('已删除')
    // 删掉的是当前页最后一条时回退一页，否则停在一张空表上
    if (docs.value.length === 1 && query.page > 1) query.page -= 1
    await loadDocuments()
  } catch (e) {
    ElMessage.error(e.message || '删除失败')
  }
}

const handleReindex = async () => {
  try {
    await ElMessageBox.confirm(
      '全量重建会清空当前知识库，并重新导入仓库语料目录下的全部文档（耗时与文档数量相关，期间检索可能为空）。继续？',
      '全量重建知识库',
      { type: 'warning', confirmButtonText: '开始重建', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  reindexing.value = true
  try {
    const result = await reindexKb()
    const failed = result?.failures?.length
    ElMessage.success(
      `重建完成：导入 ${result?.ingested ?? 0} 篇 / ${result?.chunks ?? 0} 条片段` +
      (failed ? `，${failed} 个文件失败` : ''),
    )
    query.page = 1
    await loadDocuments()
  } catch (e) {
    ElMessage.error(e.message || '重建失败')
  } finally {
    reindexing.value = false
  }
}

onMounted(loadDocuments)
</script>

<template>
  <div class="kb-page">
    <header class="kb-head">
      <div>
        <h2 class="kb-title">知识库</h2>
        <p class="kb-sub">
          AI 顾问回答时检索的养宠语料，支持 {{ supported.join(' / ') || 'md / pdf / docx / doc' }}
        </p>
      </div>
      <div class="kb-actions">
        <el-input
          v-model="query.keyword"
          class="kb-search"
          placeholder="按文档名 / 文件名 / 分类过滤"
          clearable
          @keyup.enter="searchDocuments"
          @clear="searchDocuments"
        >
          <template #append>
            <el-button @click="searchDocuments">搜索</el-button>
          </template>
        </el-input>
        <el-button :icon="Upload" type="primary" @click="pickFile">上传文档</el-button>
        <el-button :icon="Refresh" :loading="reindexing" @click="handleReindex">全量重建</el-button>
      </div>
    </header>

    <div class="kb-stats">
      <div class="stat">
        <span class="stat-num">{{ summary.totalDocuments }}</span>
        <span class="stat-label">篇文档</span>
      </div>
      <div class="stat">
        <span class="stat-num">{{ summary.totalChunks }}</span>
        <span class="stat-label">条知识片段</span>
      </div>
      <div class="stat">
        <span class="stat-num">{{ summary.totalChars.toLocaleString() }}</span>
        <span class="stat-label">字正文</span>
      </div>
    </div>

    <el-table
      v-loading="loading"
      :data="docs"
      class="kb-table"
      empty-text="知识库为空，可上传文档或执行全量重建"
    >
      <!-- 列宽总和压在容器以内（约 918px），不触发横向滚动；
           操作列不用 fixed，避免窄屏时固定列盖住相邻列 -->
      <el-table-column label="文档" min-width="260">
        <template #default="{ row }">
          <div class="cell-name">
            {{ row.name }}
            <el-tag size="small" effect="plain" type="info" class="cell-origin">
              {{ row.origin === 'upload' ? '上传' : '仓库' }}
            </el-tag>
          </div>
          <div class="cell-source">{{ row.source }}</div>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="76">
        <template #default="{ row }">
          <el-tag size="small" effect="plain" :type="kindType(row.kind)">
            {{ kindLabel(row.kind) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="分类" width="100">
        <template #default="{ row }">
          <span class="cell-muted">{{ row.category || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="物种" width="96">
        <template #default="{ row }">
          <el-tag v-for="s in row.species" :key="s" size="small" class="cell-species">{{ s }}</el-tag>
          <span v-if="!row.species?.length" class="cell-muted">-</span>
        </template>
      </el-table-column>
      <el-table-column label="片段" prop="chunkCount" width="66" align="center" />
      <el-table-column label="字数" width="84" align="center">
        <template #default="{ row }">{{ row.charCount.toLocaleString() }}</template>
      </el-table-column>
      <el-table-column label="更新时间" width="140">
        <template #default="{ row }">
          <span class="cell-muted">{{ formatTime(row.updatedAt) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="132" align="center">
        <template #default="{ row }">
          <el-button class="kb-op-btn" size="small" text type="primary" @click="openPreview(row)">
            预览
          </el-button>
          <el-button class="kb-op-btn" size="small" text type="danger" @click="removeDoc(row)">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-model:current-page="query.page"
      v-model:page-size="query.size"
      class="kb-pager"
      background
      layout="total, sizes, prev, pager, next, jumper"
      :page-sizes="[10, 20, 50, 100]"
      :total="total"
      @size-change="searchDocuments"
      @current-change="loadDocuments"
    />

    <input
      ref="fileInput"
      type="file"
      class="hidden-input"
      :accept="supported.join(',') || '.md,.pdf,.docx,.doc'"
      @change="onFileChange"
    />

    <el-dialog v-model="uploadDialog" title="上传知识文档" width="420px">
      <div class="dialog-file">{{ pickedFile?.name }}（{{ ((pickedFile?.size || 0) / 1024).toFixed(1) }} KB）</div>
      <el-form label-position="top">
        <el-form-item label="标题">
          <el-input v-model="form.title" placeholder="AI 引用来源里显示的名称" />
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="form.category" placeholder="如 喂养 / 疫苗 / 急症（可留空）" />
        </el-form-item>
        <el-form-item label="适用物种">
          <el-checkbox-group v-model="form.species">
            <el-checkbox v-for="s in SPECIES_OPTIONS" :key="s" :value="s">{{ s }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <p class="dialog-hint">
        Markdown 文件可在开头用 --- 元数据块声明 title / category / species / tags；
        标签会参与关键词检索，写别名（如「黑下巴、猫痤疮」）能显著提升长尾问题的召回。
      </p>
      <template #footer>
        <el-button @click="uploadDialog = false">取消</el-button>
        <el-button type="primary" :loading="uploading" @click="submitUpload">上传并入库</el-button>
      </template>
    </el-dialog>

    <!-- 文档在线预览：原文（md 渲染 / pdf 内置查看器 / 其余纯文本）+ AI 实际入库的片段 -->
    <el-dialog
      v-model="previewVisible"
      :title="preview ? `${preview.name}（${kindLabel(preview.kind)}｜${preview.chunkCount} 个片段）` : '预览'"
      width="880px"
      top="6vh"
      destroy-on-close
      @closed="releaseFileUrl"
    >
      <div v-loading="previewLoading" class="pv-body">
        <el-tabs v-model="previewTab">
          <el-tab-pane label="原文预览" name="doc">
            <iframe
              v-if="isPdfPreview"
              :src="pdfUrl"
              class="pv-iframe"
              title="文档原文"
            ></iframe>
            <div v-else-if="preview" class="pv-scroll">
              <!-- eslint-disable-next-line vue/no-v-html -- 内容已过 DOMPurify -->
              <div v-if="previewHtml" class="pv-md" v-html="previewHtml" />
              <pre v-else class="pv-text">{{ preview.content }}</pre>
              <p v-if="preview.contentFrom === 'chunks'" class="pv-note">
                该文档没有可回读的原文文件，以上内容按入库片段拼接，相邻片段间的一句重叠属预期。
              </p>
            </div>
          </el-tab-pane>

          <el-tab-pane label="AI 入库片段" name="chunks">
            <div v-if="preview" class="pv-scroll">
              <p class="pv-note">
                下面是这篇文档被切分后真正进向量库的内容：每块前面的「文档标题｜小节」是检索用的上下文行。
              </p>
              <div v-for="c in preview.chunks" :key="c.chunkIndex" class="pv-chunk">
                <div class="pv-chunk-head">
                  <span class="pv-chunk-no">#{{ c.chunkIndex }}</span>
                  <span class="pv-chunk-sec">{{ c.section || '（无小节）' }}</span>
                  <span class="pv-chunk-meta">{{ c.chars }} 字 · {{ c.tokenCount }} 个检索词</span>
                </div>
                <pre class="pv-chunk-body">{{ c.content }}</pre>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>
      <template #footer>
        <el-button :icon="Download" :disabled="!preview?.hasFile" @click="downloadOriginal">
          下载原文
        </el-button>
        <el-button type="primary" @click="previewVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.kb-page {
  /* 表格 8 列约 918px，容器留出边距后仍不触发横向滚动；
     窄屏下由表格内部横向滚动，不做固定列（固定列会盖住相邻内容）。
     min-width: 0 必须写：.main-layout 是 flex 容器，子项默认 min-width:auto，
     表格的 min-content 宽度会把整页顶宽，表现为整页横滚而不是表格内滚动 */
  width: 100%;
  min-width: 0;
  max-width: 1160px;
  margin: 0 auto;
  padding: 20px 16px 40px;
}
.kb-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.kb-title {
  margin: 0;
  font-size: 20px;
  color: var(--pv-ink);
}
.kb-sub {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--pv-text-secondary);
}
.kb-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.kb-stats {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin: 18px 0;
}
.stat {
  flex: 1;
  min-width: 140px;
  padding: 14px 16px;
  border: 1px solid var(--pv-border);
  border-radius: var(--pv-radius, 16px);
  background: var(--pv-tint);
}
.stat-num {
  display: block;
  font-size: 22px;
  font-weight: 600;
  color: var(--pv-ink);
}
.stat-label {
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.kb-table {
  border-radius: 12px;
}
.cell-name {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-weight: 600;
  color: var(--pv-ink);
}
.cell-origin {
  font-weight: 400;
}
.cell-source {
  margin-top: 2px;
  font-size: 12px;
  color: var(--pv-text-secondary);
}
.cell-muted {
  font-size: 13px;
  color: var(--pv-text-secondary);
}
.cell-species {
  margin-right: 4px;
  margin-bottom: 2px;
}
/* 操作列两个文字按钮：左右内边距压到 0，132px 列宽内单行放下不换行 */
.kb-op-btn {
  padding: 0;
  font-size: 13px;
}
.kb-op-btn + .kb-op-btn {
  margin-left: 14px;
}
.hidden-input {
  display: none;
}
.dialog-file {
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--pv-ink);
}
.dialog-hint {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--pv-text-secondary);
}

/* ---------- 分页与搜索 ---------- */
.kb-search {
  flex: 1 1 200px;
  max-width: 300px;
  width: auto;
}
.kb-pager {
  margin-top: 14px;
  flex-wrap: wrap;
  row-gap: 8px;
  justify-content: flex-end;
}
@media (max-width: 768px) {
  .kb-search {
    flex-basis: 100%;
    max-width: none;
  }
  .kb-pager {
    justify-content: center;
  }
}

/* ---------- 预览弹窗 ---------- */
.pv-body {
  min-height: 320px;
}
.pv-iframe {
  width: 100%;
  height: 68vh;
  border: 1px solid var(--pv-border);
  border-radius: 10px;
  background: #fff;
}
/* 长文档在弹窗内部滚动，避免把整页撑高 */
.pv-scroll {
  max-height: 68vh;
  overflow-y: auto;
  padding-right: 8px;
}
.pv-text {
  margin: 0;
  padding: 12px 14px;
  border: 1px solid var(--pv-border);
  border-radius: 10px;
  background: var(--pv-tint);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.75;
  color: var(--pv-ink);
  white-space: pre-wrap;
  word-break: break-word;
}
.pv-note {
  margin: 0 0 12px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--pv-tint);
  font-size: 12px;
  line-height: 1.6;
  color: var(--pv-text-secondary);
}
.pv-chunk {
  margin-bottom: 12px;
  border: 1px solid var(--pv-border);
  border-radius: 10px;
  overflow: hidden;
}
.pv-chunk-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--pv-tint);
  font-size: 12px;
}
.pv-chunk-no {
  font-weight: 600;
  color: var(--pv-ink);
  font-variant-numeric: tabular-nums;
}
.pv-chunk-sec {
  flex: 1;
  min-width: 0;
  color: var(--pv-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pv-chunk-meta {
  color: var(--pv-text-secondary);
  white-space: nowrap;
}
.pv-chunk-body {
  margin: 0;
  padding: 10px 12px;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.7;
  color: var(--pv-ink);
  white-space: pre-wrap;
  word-break: break-word;
}

/* v-html 注入的 Markdown 内容不带 scoped 属性，必须用 :deep 命中 */
.pv-md :deep(h1),
.pv-md :deep(h2),
.pv-md :deep(h3) {
  margin: 18px 0 8px;
  font-size: 15px;
  color: var(--pv-ink);
}
.pv-md :deep(h1) {
  margin-top: 0;
  font-size: 18px;
}
.pv-md :deep(p),
.pv-md :deep(li) {
  font-size: 13px;
  line-height: 1.8;
  color: var(--pv-ink-soft, var(--pv-ink));
}
.pv-md :deep(ul),
.pv-md :deep(ol) {
  padding-left: 20px;
  margin: 6px 0;
}
.pv-md :deep(table) {
  width: 100%;
  margin: 10px 0;
  border-collapse: collapse;
  font-size: 12.5px;
}
.pv-md :deep(th),
.pv-md :deep(td) {
  padding: 6px 8px;
  border: 1px solid var(--pv-border);
  text-align: left;
  vertical-align: top;
}
.pv-md :deep(th) {
  background: var(--pv-tint);
}
.pv-md :deep(code) {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--pv-tint);
  font-size: 12px;
}
.pv-md :deep(hr) {
  margin: 16px 0;
  border: none;
  border-top: 1px solid var(--pv-border);
}
</style>
