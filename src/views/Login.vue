<script setup>
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Lock, User } from '@element-plus/icons-vue'
import { login } from '@/api/user'
import { safeRedirect, setAuth } from '@/utils/auth'
import logo from '@/assets/logo.jpg'

const route = useRoute()
const router = useRouter()

const formRef = ref()
const form = reactive({ username: '', password: '' })
const loading = ref(false)

const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

const onSubmit = async () => {
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  loading.value = true
  try {
    const data = await login(form)
    // 统一写入登录态 store：顶栏头像、首页推荐等订阅方会立即刷新
    setAuth(data.token, data.user)
    ElMessage.success('登录成功')
    // 被游客拦截带到登录页时带 redirect，登录成功后回跳操作前那一页
    router.replace(safeRedirect(route.query.redirect) || { name: 'home' })
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

/* ==========================================================================
   指针驱动的动态视觉（视差 / 卡片倾斜 / 高光 / 微尘粒子）
   --------------------------------------------------------------------------
   实现原则：
   1. 单一 rAF 循环，所有效果共用一份指针状态，lerp 惯性平滑，动画不生硬；
   2. JS 只写 CSS 自定义属性与 transform，全部走合成层，不触发布局重排；
   3. 性能闸：粒子数按页面面积定量、DPR 封顶 1.5、标签页隐藏即暂停、
      触屏（coarse pointer）不挂指针监听、prefers-reduced-motion 时整套关闭。
   ========================================================================== */
const rootRef = ref(null)
const tiltRef = ref(null)
const canvasRef = ref(null)
const fxEnabled = ref(false)

const finePointer = window.matchMedia('(pointer: fine)')
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const motionOK = () => !reducedMotion.matches

let rafId = 0
let ctx = null
let W = 0
let H = 0
let particles = []

// 指针在文档中的坐标（pageX/pageY 天然含滚动偏移）
const pointer = { x: -9999, y: -9999, active: false }
// 归一化视口坐标（-1..1），视差层的驱动源
const target = { nx: 0, ny: 0 }
const cur = { nx: 0, ny: 0 }
// 卡片倾斜与高光：target 由指针事件写入，cur 每帧逼近，形成惯性
const tiltTarget = { rx: 0, ry: 0, gx: 50, gy: 50, go: 0 }
const tilt = { rx: 0, ry: 0, gx: 50, gy: 50, go: 0 }

const lerp = (a, b, t) => a + (b - a) * t

const onPointerMove = (e) => {
  pointer.x = e.pageX
  pointer.y = e.pageY
  pointer.active = true
  target.nx = (e.clientX / window.innerWidth) * 2 - 1
  target.ny = (e.clientY / window.innerHeight) * 2 - 1
  // 卡片随指针轻微倾斜，幅度压得很小：有生命感，但绝不会晃到影响阅读
  tiltTarget.ry = target.nx * 2.6
  tiltTarget.rx = -target.ny * 2
  // 高光跟随：映射到卡片局部坐标，靠近卡片时才淡入
  const el = tiltRef.value
  if (el) {
    const r = el.getBoundingClientRect()
    const gx = ((e.clientX - r.left) / r.width) * 100
    const gy = ((e.clientY - r.top) / r.height) * 100
    tiltTarget.gx = gx
    tiltTarget.gy = gy
    tiltTarget.go = gx > -30 && gx < 130 && gy > -30 && gy < 130 ? 1 : 0
  }
}

// 指针离开窗口：一切缓慢归位，不残留倾斜
const onPointerOut = (e) => {
  if (e.relatedTarget) return
  pointer.active = false
  target.nx = 0
  target.ny = 0
  tiltTarget.rx = 0
  tiltTarget.ry = 0
  tiltTarget.go = 0
}

/* ---------- 微尘粒子：缓慢上浮的尘埃，靠近光标时被轻轻带动 ---------- */
// 纯中性颗粒：墨尘为主，掺少量冷灰与暖灰，像空气里的浮尘，不带任何彩色
const PALETTE = [
  ['20,22,28', 0.62],
  ['96,112,142', 0.24],
  ['150,140,120', 0.14],
]
const pickColor = () => {
  let roll = Math.random()
  for (const [c, w] of PALETTE) {
    roll -= w
    if (roll <= 0) return c
  }
  return PALETTE[0][0]
}

const buildParticles = () => {
  // 按面积定量：大屏不稀、小屏不挤，上限 60 保证开销恒定
  const count = Math.round(Math.min(60, Math.max(18, (W * H) / 34000)))
  particles = Array.from({ length: count }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: 1 + Math.random() * 2.1,
    depth: 0.35 + Math.random() * 0.65, // 深度：同时决定视差幅度与受力大小
    vx: 0,
    vy: 0,
    a: 0.1 + Math.random() * 0.2,
    tw: 0.4 + Math.random() * 0.9, // 闪烁频率
    ph: Math.random() * Math.PI * 2, // 闪烁相位
    c: pickColor(),
  }))
}

const drawParticles = (t) => {
  if (!ctx) return
  ctx.clearRect(0, 0, W, H)
  const R = 150 // 指针引力半径
  for (const p of particles) {
    // 指针引力：越靠近越被轻轻带向光标，像气流卷动的微尘
    if (pointer.active) {
      const dx = pointer.x - p.x
      const dy = pointer.y - p.y
      const d2 = dx * dx + dy * dy
      if (d2 < R * R && d2 > 0.01) {
        const d = Math.sqrt(d2)
        const f = (1 - d / R) * 0.02 * p.depth
        p.vx += (dx / d) * f
        p.vy += (dy / d) * f
      }
    }
    // 环境漂浮：浮力上升 + 缓慢摆动，阻尼让速度收敛
    p.vx += Math.sin(t * 0.0004 * p.tw + p.ph) * 0.0012
    p.vy -= 0.0018 * p.depth
    p.vx *= 0.96
    p.vy *= 0.96
    // 限速，避免被引力甩出去
    const sp2 = p.vx * p.vx + p.vy * p.vy
    if (sp2 > 0.36) {
      const s = 0.6 / Math.sqrt(sp2)
      p.vx *= s
      p.vy *= s
    }
    p.x += p.vx
    p.y += p.vy
    // 出界回绕（留出视差偏移的余量）
    if (p.y < -40) { p.y = H + 40; p.x = Math.random() * W }
    else if (p.y > H + 40) { p.y = -40 }
    if (p.x < -40) p.x = W + 40
    else if (p.x > W + 40) p.x = -40

    // 视差：深度越大，随指针移动越明显
    const px = cur.nx * 26 * p.depth
    const py = cur.ny * 18 * p.depth
    const alpha = p.a * (0.55 + 0.45 * Math.sin(t * 0.001 * p.tw + p.ph))
    ctx.globalAlpha = Math.max(0, alpha)
    ctx.fillStyle = `rgb(${p.c})`
    ctx.beginPath()
    ctx.arc(p.x + px, p.y + py, p.r, 0, 6.2832)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

/* ---------- 主循环 ---------- */
const tick = (t) => {
  // 视差量收敛后跳过 DOM 写入，避免空转
  const dx = target.nx - cur.nx
  const dy = target.ny - cur.ny
  if (Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4) {
    cur.nx = lerp(cur.nx, target.nx, 0.06)
    cur.ny = lerp(cur.ny, target.ny, 0.06)
    const root = rootRef.value
    if (root) {
      root.style.setProperty('--px', cur.nx.toFixed(4))
      root.style.setProperty('--py', cur.ny.toFixed(4))
    }
  }
  tilt.rx = lerp(tilt.rx, tiltTarget.rx, 0.08)
  tilt.ry = lerp(tilt.ry, tiltTarget.ry, 0.08)
  tilt.gx = lerp(tilt.gx, tiltTarget.gx, 0.12)
  tilt.gy = lerp(tilt.gy, tiltTarget.gy, 0.12)
  tilt.go = lerp(tilt.go, tiltTarget.go, 0.1)
  const el = tiltRef.value
  if (el) {
    el.style.transform = `perspective(1100px) rotateX(${tilt.rx.toFixed(3)}deg) rotateY(${tilt.ry.toFixed(3)}deg)`
    el.style.setProperty('--gx', `${tilt.gx.toFixed(2)}%`)
    el.style.setProperty('--gy', `${tilt.gy.toFixed(2)}%`)
    el.style.setProperty('--go', tilt.go.toFixed(3))
  }
  drawParticles(t)
  rafId = requestAnimationFrame(tick)
}

const resizeFx = () => {
  const root = rootRef.value
  const canvas = canvasRef.value
  if (!root || !canvas || !ctx) return
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  W = root.clientWidth
  H = root.clientHeight
  canvas.width = Math.round(W * dpr)
  canvas.height = Math.round(H * dpr)
  canvas.style.width = `${W}px`
  canvas.style.height = `${H}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  buildParticles()
}

// 标签页隐藏时暂停循环，回来再续：不做无谓的绘制
const onVisibility = () => {
  if (document.hidden) {
    cancelAnimationFrame(rafId)
    rafId = 0
  } else if (!rafId) {
    rafId = requestAnimationFrame(tick)
  }
}

onMounted(async () => {
  if (!motionOK()) return
  fxEnabled.value = true
  await nextTick()
  const canvas = canvasRef.value
  if (!canvas) return
  ctx = canvas.getContext('2d', { alpha: true })
  resizeFx()
  window.addEventListener('resize', resizeFx, { passive: true })
  document.addEventListener('visibilitychange', onVisibility)
  if (finePointer.matches) {
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    document.addEventListener('pointerout', onPointerOut)
  }
  rafId = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  window.removeEventListener('resize', resizeFx)
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('pointermove', onPointerMove)
  document.removeEventListener('pointerout', onPointerOut)
})
</script>

<template>
  <div ref="rootRef" class="auth-page">
    <!-- 动态效果层（全部 aria-hidden，纯装饰） -->
    <canvas v-if="fxEnabled" ref="canvasRef" class="fx-canvas" aria-hidden="true"></canvas>
    <div class="bg-glow" aria-hidden="true"></div>
    <div class="grain" aria-hidden="true"></div>

    <!-- 左：品牌区 -->
    <aside class="brand-side">
      <span class="plx paw-wrap" aria-hidden="true">
        <svg class="paw-mark" viewBox="0 0 100 100">
          <g fill="currentColor">
            <ellipse cx="50" cy="67" rx="19" ry="15.5" />
            <ellipse cx="27" cy="44" rx="8" ry="11" transform="rotate(-16 27 44)" />
            <ellipse cx="43.5" cy="30.5" rx="8.5" ry="11.5" />
            <ellipse cx="59.5" cy="30.5" rx="8.5" ry="11.5" />
            <ellipse cx="75" cy="44" rx="8" ry="11" transform="rotate(16 75 44)" />
          </g>
        </svg>
      </span>

      <span class="plx logo-plx">
        <span class="brand-logo glass-tile rise" style="--d: 0.05s">
          <img :src="logo" alt="PetVerse" />
        </span>
      </span>
      <p class="brand-eyebrow rise" style="--d: 0.14s">Pet Social Space</p>
      <h1 class="brand-name rise" style="--d: 0.2s">PetVerse</h1>
      <p class="brand-tag rise" style="--d: 0.28s">宠物社交空间 · 记录与分享每一刻陪伴</p>

      <ul class="brand-points rise" style="--d: 0.36s">
        <li class="glass-chip">宠物档案</li>
        <li class="glass-chip">萌友社区</li>
        <li class="glass-chip">优选商城</li>
      </ul>

      <span class="plx orb-wrap orb-wrap-a" aria-hidden="true"><span class="orb orb-a"></span></span>
      <span class="plx orb-wrap orb-wrap-b" aria-hidden="true"><span class="orb orb-b"></span></span>
    </aside>

    <!-- 两栏之间的细分隔线：划出层次，但不切断留白 -->
    <span class="auth-divider" aria-hidden="true"></span>

    <!-- 右：登录卡 -->
    <main class="form-side">
      <div ref="tiltRef" class="card-tilt">
        <section class="glass-card">
          <span class="card-glare" aria-hidden="true"></span>
          <h2 class="card-title">欢迎回来</h2>
          <p class="card-sub">登录你的宠物社交空间</p>

          <el-form
            ref="formRef"
            :model="form"
            :rules="rules"
            label-position="top"
            size="large"
            class="glass-form"
            @submit.prevent="onSubmit"
          >
            <el-form-item prop="username">
              <el-input v-model.trim="form.username" placeholder="用户名" :prefix-icon="User" />
            </el-form-item>
            <el-form-item prop="password">
              <el-input
                v-model="form.password"
                type="password"
                placeholder="密码"
                :prefix-icon="Lock"
                show-password
              />
            </el-form-item>
            <el-button
              type="primary"
              size="large"
              class="submit-btn"
              :loading="loading"
              native-type="submit"
            >
              登 录
            </el-button>
          </el-form>

          <div class="footer">
            还没有账号？<router-link :to="{ path: '/register', query: route.query }">立即注册</router-link>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.auth-page {
  position: relative;
  /* 建立独立层叠上下文：装饰层都收在这个上下文里，不会漏到内容之上 */
  isolation: isolate;
  min-height: 100vh;
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  overflow: hidden;
  /* 与全站一致的中性纯色底，不做渐变：质感交给玻璃、颗粒与光影 */
  background: var(--pv-bg);
  /* 视差驱动变量：JS 每帧写入，各装饰层以不同系数消费，形成纵深 */
  --px: 0;
  --py: 0;
}

/* ---------- 动态效果层 ---------- */
.fx-canvas {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}

/* 缓慢呼吸的柔光层 */
.bg-glow {
  position: absolute;
  inset: -10%;
  background:
    radial-gradient(40% 50% at 30% 30%, rgba(255, 255, 255, 0.7), transparent 70%),
    radial-gradient(35% 45% at 72% 62%, rgba(255, 255, 255, 0.55), transparent 70%);
  filter: blur(30px);
  animation: breathe 14s ease-in-out infinite;
  pointer-events: none;
}
@keyframes breathe {
  0%, 100% { transform: scale(1) translateY(0); opacity: 0.85; }
  50% { transform: scale(1.08) translateY(-2%); opacity: 1; }
}

.grain {
  position: absolute;
  inset: 0;
  opacity: 0.035;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

/* 视差工具类：外层负责位移，内层仍可拥有自己的动画/变换 */
.plx {
  display: block;
  will-change: transform;
  transform: translate3d(calc(var(--px) * var(--plx, 0px)), calc(var(--py) * var(--ply, 0px)), 0);
}

/* 入场编排：品牌区元素错峰浮起，--d 控制先后 */
.rise {
  opacity: 0;
  animation: rise 0.9s cubic-bezier(0.22, 1, 0.36, 1) var(--d, 0s) forwards;
}
@keyframes rise {
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ===== 左：品牌区 ===== */
.brand-side {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 64px 8vw 64px 10vw;
}

/* 品牌水印：极淡的爪印，是 PetVerse 的品牌记号而非装饰堆砌 */
.paw-wrap {
  position: absolute;
  right: 6%;
  bottom: 4%;
  --plx: 14px;
  --ply: 10px;
  pointer-events: none;
}
.paw-mark {
  width: min(300px, 24vw);
  color: var(--pv-ink);
  opacity: 0.05;
  transform: rotate(-14deg);
}

.logo-plx {
  --plx: 10px;
  --ply: 6px;
  margin-bottom: 28px;
}
.brand-logo {
  width: 92px;
  height: 92px;
}
.glass-tile {
  display: block;
  padding: 5px;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 16px 40px rgba(60, 66, 90, 0.14), inset 0 1px 1px rgba(255, 255, 255, 0.9);
}
.glass-tile img {
  width: 100%;
  height: 100%;
  border-radius: 22px;
  object-fit: cover;
  display: block;
}
.brand-eyebrow {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 3.5px;
  text-transform: uppercase;
  color: rgba(86, 93, 107, 0.72);
  margin: 0 0 10px;
}
.brand-name {
  font-size: 52px;
  font-weight: 800;
  letter-spacing: 1px;
  color: var(--pv-ink);
  margin: 0 0 14px;
  line-height: 1.1;
}
.brand-tag {
  font-size: 16px;
  color: var(--pv-text-secondary);
  margin: 0 0 36px;
  max-width: 30ch;
  line-height: 1.7;
}
.brand-points {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 0;
  padding: 0;
}
.glass-chip {
  padding: 9px 18px;
  border-radius: 999px;
  font-size: 13px;
  color: var(--pv-ink-soft);
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 6px 18px rgba(60, 66, 90, 0.08), inset 0 1px 1px rgba(255, 255, 255, 0.8);
  transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.35s ease;
}
.glass-chip:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 24px rgba(60, 66, 90, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.8);
}

/* 品牌区装饰玻璃球：外层吃视差（两球方向相反），内层保留原有浮动 */
.orb-wrap {
  position: absolute;
  pointer-events: none;
}
.orb-wrap-a {
  width: 120px;
  height: 120px;
  right: 12%;
  top: 16%;
  --plx: 22px;
  --ply: 14px;
}
.orb-wrap-b {
  width: 64px;
  height: 64px;
  right: 26%;
  bottom: 18%;
  --plx: -16px;
  --ply: -10px;
}
.orb {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.75), rgba(255, 255, 255, 0.15));
  border: 1px solid rgba(255, 255, 255, 0.8);
  box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.9), 0 18px 40px rgba(60, 66, 90, 0.12);
}
.orb-a { animation: drift 12s ease-in-out infinite; }
.orb-b { animation: drift 9s ease-in-out infinite reverse; }
@keyframes drift {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-18px); }
}

/* 两栏分隔细线：纵向渐隐，只在大屏出现 */
.auth-divider {
  position: absolute;
  left: 52.4%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 1px;
  height: min(52vh, 440px);
  background: linear-gradient(
    180deg,
    transparent,
    rgba(96, 112, 142, 0.32) 28%,
    rgba(96, 112, 142, 0.32) 72%,
    transparent
  );
  pointer-events: none;
}

/* ===== 右：登录卡 ===== */
.form-side {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 8vw 48px 2vw;
}
/* 倾斜由 JS 写在这一层，卡片自身的入场动画不受影响 */
.card-tilt {
  width: 420px;
  max-width: 100%;
  will-change: transform;
}
.glass-card {
  position: relative;
  width: 100%;
  padding: 44px 40px 36px;
  border-radius: var(--pv-radius-lg);
  background-color: var(--pv-glass-2);
  background-image: var(--pv-glass-sheen);
  backdrop-filter: var(--pv-glass-blur-lg);
  -webkit-backdrop-filter: var(--pv-glass-blur-lg);
  border: 1px solid var(--pv-glass-line);
  box-shadow: var(--pv-glass-shadow-lg), var(--pv-glass-ring);
  overflow: hidden;
  animation: card-in 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes card-in {
  from { opacity: 0; transform: translateY(24px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
/* 光标高光：soft-light 混合让白玻璃更通透、墨按钮更亮，而不会糊成牛奶色 */
.card-glare {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  opacity: var(--go, 0);
  background: radial-gradient(
    340px circle at var(--gx, 50%) var(--gy, 50%),
    rgba(255, 255, 255, 0.55),
    rgba(255, 255, 255, 0) 65%
  );
  mix-blend-mode: soft-light;
}
.card-title {
  font-size: 26px;
  font-weight: 800;
  color: var(--pv-ink);
  margin: 0 0 8px;
}
.card-sub {
  font-size: 13.5px;
  color: var(--pv-text-secondary);
  margin: 0 0 28px;
}

/* 玻璃输入框 */
.glass-form :deep(.el-input__wrapper) {
  background: rgba(255, 255, 255, 0.6);
  box-shadow: inset 0 0 0 1px rgba(23, 24, 28, 0.08);
  border-radius: 14px;
  backdrop-filter: blur(8px);
  transition: all 0.25s ease;
}
.glass-form :deep(.el-input__wrapper:hover) {
  background: rgba(255, 255, 255, 0.8);
  box-shadow: inset 0 0 0 1px rgba(23, 24, 28, 0.16);
}
.glass-form :deep(.el-input__wrapper.is-focus) {
  background: #fff;
  box-shadow:
    inset 0 0 0 1px var(--pv-ink),
    0 0 0 4px rgba(23, 24, 28, 0.06);
}
.glass-form :deep(.el-input__inner) {
  color: var(--pv-ink);
}
.glass-form :deep(.el-input__inner::placeholder) {
  color: rgba(23, 24, 28, 0.4);
}
.glass-form :deep(.el-input__prefix),
.glass-form :deep(.el-input__suffix) {
  color: rgba(23, 24, 28, 0.5);
}

.submit-btn.el-button--primary:not(.is-plain):not(.is-text):not(.is-link) {
  width: 100%;
  height: 50px;
  margin-top: 12px;
  letter-spacing: 8px;
  font-weight: 700;
  font-size: 16px;
  border: none;
  border-radius: 14px;
  color: #fff;
  background: linear-gradient(145deg, #2b2d33, #17181c);
  box-shadow: 0 12px 28px rgba(23, 24, 28, 0.28), inset 0 1px 1px rgba(255, 255, 255, 0.25);
  transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease;
}
.submit-btn.el-button--primary:not(.is-plain):not(.is-text):not(.is-link):hover,
.submit-btn.el-button--primary:not(.is-plain):not(.is-text):not(.is-link):focus {
  transform: translateY(-2px);
  filter: brightness(1.1);
  color: #fff;
  background: linear-gradient(145deg, #2b2d33, #17181c);
  box-shadow: 0 18px 38px rgba(23, 24, 28, 0.34), inset 0 1px 1px rgba(255, 255, 255, 0.25);
}
.submit-btn.el-button--primary:not(.is-plain):not(.is-text):not(.is-link):active {
  transform: translateY(0);
}

.footer {
  position: relative;
  text-align: center;
  margin-top: 24px;
  color: var(--pv-text-secondary);
  font-size: 13px;
}
.footer a {
  color: var(--pv-ink);
  font-weight: 600;
  border-bottom: 1px solid rgba(23, 24, 28, 0.3);
  padding-bottom: 1px;
}
.footer a:hover {
  opacity: 1;
  border-bottom-color: var(--pv-ink);
}

/* ===== 响应式 ===== */
@media (max-width: 1024px) {
  /* 窄栏宽下分隔线会贴上卡片边缘，干脆撤掉 */
  .auth-divider {
    display: none;
  }
}

@media (max-width: 900px) {
  .auth-page {
    grid-template-columns: minmax(0, 1fr);
  }
  /* 固定 420px 的卡片在小屏改为撑满列宽，避免把 grid 列撑出视口 */
  .card-tilt {
    width: 100%;
  }
  .brand-side {
    padding: 48px 24px 8px;
    align-items: center;
    text-align: center;
  }
  .brand-name { font-size: 34px; }
  .brand-tag { margin-bottom: 20px; }
  .brand-points { justify-content: center; }
  .orb-wrap { display: none; }
  .paw-wrap { right: -6%; bottom: auto; top: 2%; opacity: 0.7; }
  .form-side { padding: 20px 16px 48px; }
}

/* 手机端进一步收紧品牌区与卡片内边距，让登录表单尽快进入首屏 */
@media (max-width: 768px) {
  .brand-side {
    padding: 40px 20px 0;
  }
  .brand-logo {
    width: 72px;
    height: 72px;
  }
  .brand-name {
    font-size: 30px;
  }
  .brand-points {
    display: none;
  }
  .glass-card {
    padding: 30px 22px 26px;
    border-radius: 22px;
  }
  .card-title {
    font-size: 22px;
  }
  .card-sub {
    margin-bottom: 20px;
  }
  .submit-btn.el-button--primary:not(.is-plain):not(.is-text):not(.is-link) {
    letter-spacing: 5px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .bg-glow, .orb, .glass-card, .rise { animation: none; }
  .rise { opacity: 1; }
}
</style>
