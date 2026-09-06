<script setup>
import AppHeader from '@/components/AppHeader.vue'
</script>

<template>
  <div class="main-layout">
    <!-- 顶栏仅挂载一次：logo 文案固定 PetVerse、导航列表固定不变；
         切换导航时只有下方 router-view 的内容重新加载 -->
    <AppHeader show-nav />
    <router-view v-slot="{ Component }">
      <transition name="fade-slide" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>
  </div>
</template>

<style scoped>
.main-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
/* 顶栏已移入布局，子页面 .page 不再自带全屏高度，避免多出 60px 滚动 */
.main-layout > :deep(.page) {
  min-height: 0;
  flex: 1;
}
</style>
