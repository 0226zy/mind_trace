# 止念 · 运营管理

基于 Vue 3、Vite 和 JavaScript 的轻量管理后台。包含管理员登录、运营概览、用户分页列表，以及完整的加载、空态和错误状态。

## 功能

- 管理员登录：`POST /admin/login`，token 存储于 `localStorage`。
- 请求自动携带 `Authorization: Bearer <token>`；收到 401 后清除 token 并回到登录页。
- 运营概览：`GET /admin/overview`，展示用户、思虑、登记、收尾指标及趋势/收尾占比。
- 用户列表：`GET /admin/users?page=&pageSize=`，支持分页与每页条数切换，不展示思虑正文。
- 响应式桌面/移动端布局，无重型 UI 组件库。

## 本地开发

要求 Node.js 20.19+ 或 22.12+。

```bash
cp .env.example .env.local
npm install
npm run dev
```

开发服务器默认监听 `5173`，并允许通过 CLI 覆盖，例如 `npm run dev -- --host 0.0.0.0 --port 7100`。

环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api/v1` | 前端 API 根路径，构建时注入 |
| `VITE_API_PROXY_TARGET` | `http://localhost:3000` | 仅开发服务器使用，`/api` 转发目标 |

也可以把 `VITE_API_BASE_URL` 设置为完整后端地址（例如 `http://localhost:3000/api/v1`），此时不使用开发代理，后端需正确配置 CORS。

## 构建与预览

```bash
npm run build
npm run preview
```

生产文件输出至 `dist/`。Vite 环境变量会在构建时固化，修改后需重新构建。

## Docker 部署

镜像采用 Node 多阶段构建和 Nginx 静态托管。Nginx 已配置 SPA fallback，并将 `/api/` 反向代理到 `API_PROXY_TARGET`。

```bash
docker build -t mind-trace-admin \
  --build-arg VITE_API_BASE_URL=/api/v1 .

docker run --rm -p 8080:80 \
  -e API_PROXY_TARGET=http://host.docker.internal:3000 \
  mind-trace-admin
```

访问 `http://localhost:8080`。在 Docker Compose 或容器网络中，可将 `API_PROXY_TARGET` 设置为 `http://backend:3000`（替换为实际服务名与端口）。目标地址不应以 `/` 结尾；原始 `/api/...` 路径会完整转发。

`nginx.conf.template` 由官方 Nginx 镜像启动脚本进行环境变量替换。若使用其他 Nginx 镜像，请先生成最终配置。

## API 约定

默认 Base URL 为 `/api/v1`。成功响应为 `{ "data": ... }`，错误响应为 `{ "error": { "code", "message" } }`。概览接口未在契约中规定详细字段，前端兼容 `userCount` / `thoughtCount` / `recordCount` / `closedRecordCount` 及对应嵌套 `count`、`total` 字段；趋势兼容 `recordTrend`、`recordsTrend`、`trend`、`dailyRecords` 数组。未提供趋势时显示空态，不使用模拟数据。

## 目录

```text
src/
├── api/          # fetch 请求封装与管理端 API
├── assets/       # 全局样式
├── components/   # 指标卡、趋势图、状态组件
├── layouts/      # 管理端导航布局
├── router/       # 路由与登录守卫
├── stores/       # token 状态与持久化
├── utils/        # 数据格式化与概览数据解析
└── views/        # 登录、概览、用户页面
```
