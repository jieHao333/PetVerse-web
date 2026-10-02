import { onUnmounted, ref } from 'vue'

// 共享的移动端断点检测，断点与全局样式（main.css）保持一致：≤768px 视为手机端
// 主要用于模板中按端切换组件行为（如 el-table 的 fixed 列在窄屏禁用，避免悬浮遮挡横向滚动）
export function useIsMobile() {
  const query = window.matchMedia('(max-width: 768px)')
  const isMobile = ref(query.matches)
  const onChange = (e) => {
    isMobile.value = e.matches
  }
  query.addEventListener('change', onChange)
  onUnmounted(() => query.removeEventListener('change', onChange))
  return isMobile
}
