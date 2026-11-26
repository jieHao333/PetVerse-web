<div align="center">

# PetVerse-web

**Vue 3 + Vite 的宠物社区前端**

宠物动态 · 好友私聊 · 周边商城 · 优惠券 · AI 养宠顾问 · 数据看板

[![Vue](https://img.shields.io/badge/Vue-3.5-4FC08D?style=flat-square&logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
[![Element Plus](https://img.shields.io/badge/Element_Plus-2.14-409EFF?style=flat-square)](https://element-plus.org/)
[![Vue Router](https://img.shields.io/badge/Vue_Router-4-4FC08D?style=flat-square&logo=vuedotjs&logoColor=white)](https://router.vuejs.org/)
[![Axios](https://img.shields.io/badge/Axios-1.19-5A29E4?style=flat-square&logo=axios&logoColor=white)](https://axios-http.com/)
[![Node](https://img.shields.io/badge/Node-18%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](https://github.com/374426703/PetVerse-web/pulls)

**后端仓库**：[374426703/PetVerse](https://github.com/374426703/PetVerse)

</div>

---

## 项目简介

PetVerse（宠域）前端，单页应用，覆盖首页、宠域空间、商城与订单、好友私聊、虚拟宠物、优惠券、AI 养宠顾问，以及商家端与管理端（商家审核、优惠券、数据看板、AI 扩展、知识库）。

页面通过 `/api/**` 访问网关；开发环境由 Vite 代理到 `http://localhost:8080`，生产环境由 nginx 托管静态资源并反代同一路径。游客可浏览首页、圈子与商城，写操作与个人页面需登录，管理端页面按角色放行。

## 快速开始

要求 Node.js `^18` 或 `>=20`，后端网关已在 `8080` 启动。

```bash
npm install
npm run dev
```

访问 `http://localhost:5173`。开发服务器把 `/api` 代理到 `http://localhost:8080`（见 `vite.config.js`）。

构建与预览：

```bash
npm run build      # 产物在 dist/
npm run preview    # 本地预览构建结果
```

## 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 框架 | Vue 3.5（Composition API） | 页面与响应式状态 |
| 构建 | Vite 5 | 开发服务器、HMR 与打包 |
| UI | Element Plus 2.14（按需自动导入） | 组件库，经 `unplugin-vue-components` 注入 |
| 路由 | Vue Router 4（history 模式） | 路由表与全局守卫 |
| 请求 | Axios 1.19 | `src/api/request.js` 统一附加令牌、解包响应、处理 401 |
| 内容渲染 | marked 18 + DOMPurify 3.4 | Markdown 渲染与 XSS 消毒 |
| 运行时 | Node.js `^18` 或 `>=20` | 开发与构建 |

## 目录结构

```text
PetVerse-web/
├── Dockerfile             # node:20 构建 → nginx:1.27 托管
├── nginx.conf
├── vite.config.js
└── src/
    ├── api/               # 按业务域拆分的请求封装
    ├── components/        # 顶栏、宠物引导弹窗等公共组件
    ├── layouts/           # MainLayout
    ├── router/            # 路由与守卫
    ├── utils/             # 登录态、埋点、头像、响应式、缓存
    └── views/             # 页面
```

## Docker 部署

```bash
docker build -t petverse-web:latest .

# 单独运行必须与后端同网络，且后端服务名 / 别名是 app
docker run -d --name petverse-web -p 80:80 petverse-web:latest
```

`nginx.conf` 中上游写死为 `app:8080`，容器不在同一 Docker 网络或找不到该名称时，`/api` 返回 502。常规部署使用后端仓库的 `docker-compose.micro.yml`：该文件把网关的网络别名设为 `app`，并从 `../PetVerse-web` 构建前端镜像。

## nginx 行为

| 项 | 配置 |
|---|---|
| SPA 路由 | `try_files $uri $uri/ /index.html` |
| API 反代 | `/api/` → `http://app:8080`，保留原始路径 |
| SSE | `proxy_buffering off`，读写超时 300s，`Connection ""` |
| 上传 | `client_max_body_size 60m` |
| 缓存 | `index.html` 不缓存；图片 30 天；js / css 12 小时 |
| 敏感文件 | `README.md`、`.env.*`、`*.sql`、`pom.xml`、`Dockerfile` 等返回 404 |
| 敏感目录 | `.git`、`.idea`、`node_modules` 等返回 404 |
| 日志 | access / error 输出到 stdout / stderr |

`resolver 127.0.0.11` 是 Docker 内置 DNS，配合变量形式的 upstream，后端容器重建换 IP 后无需重启 nginx。

## 页面

| 路由 | 页面 | 权限 |
|---|---|---|
| `/` | 首页 | 游客可读 |
| `/space`、`/space/:id`、`/space/topic/:category` | 圈子、动态详情、话题 | 游客可读，写操作需登录 |
| `/shop`、`/shop/product/:id`、`/shop/store/:id` | 商城、商品详情、店铺 | 游客可读 |
| `/shop/product/:id/review` | 商品评价 | 登录 |
| `/shop/cart`、`/shop/orders`、`/shop/my-reviews` | 购物车、我的订单、我的评价 | 登录 |
| `/coupons`、`/claim` | 领券中心、兑换码兑换 | 登录 |
| `/friends`、`/chat/:userId` | 好友、私聊 | 登录 |
| `/pet-chat` | AI 养宠顾问 | 登录 |
| `/pet/profile/:id`、`/pet/identity/:id?` | 宠物档案编辑、宠物身份卡 | 登录 |
| `/my-spaces` | 我的动态 | 登录 |
| `/profile`、`/user/:id`、`/notifications` | 个人主页、他人主页、通知 | 登录 |
| `/merchant-apply`、`/merchant-center` | 商家入驻、商家中心 | 登录 / `MERCHANT` 或 `ADMIN` |
| `/admin/merchant-audit`、`/admin/merchant-manage` | 商家审核、商家管理 | `ADMIN` |
| `/admin/coupons` | 优惠券管理 | `ADMIN` |
| `/admin/bi` | 数据看板 | `ADMIN` |
| `/admin/ai-extensions` | AI 扩展管理（MCP / Skill） | `ADMIN` |
| `/kb` | 知识库管理 | `ADMIN` |

## 鉴权与埋点

- 登录态存 `localStorage`（`token` / `user`），`src/utils/auth.js` 为唯一数据源，JWT 过期在路由守卫中提前判废并清场。
- Axios 拦截器统一附加 `Authorization: Bearer <token>`；HTTP 401 与 `body.code=401` 都走 `clearAuth`，非静默请求再引导登录（`silentAuth` 用于推荐、未读数轮询等后台请求）。
- 游客可读页面通过路由 `meta.public` 放行，写操作由页面内 `requireLogin` 拦截，后端仍会校验。
- `src/utils/track.js` 将曝光 / 点击 / 搜索 / 页面浏览等埋点上报到 `/api/data/track`，供数据中台聚合。
- Markdown 与用户内容渲染前经 DOMPurify 消毒。
