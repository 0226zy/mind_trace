# mind_trace · 止念

「止念」是一个随身思虑登记与结构化处理工具：先快速记录，再通过七步评估把循环思虑转成行动或收尾。项目采用 **微信原生小程序 + Go API + 腾讯云 MySQL + Vue 3 管理端**，不使用 CloudBase。

> 产品是记录与效率工具，不提供医疗诊断、心理治疗或紧急救援服务。

## 项目结构

```text
mind_trace/
├─ miniprogram/              # 微信原生小程序：此刻、处理、思虑库、应急叫停
│  ├─ pages/
│  ├─ components/
│  ├─ services/              # API 请求、鉴权、本地草稿与离线同步
│  └─ config.js              # 公开 API 地址与本地存储键
├─ server/                   # Go API（Gin + GORM）
│  ├─ cmd/server/            # 服务入口
│  ├─ internal/              # 鉴权、领域逻辑、HTTP 处理与数据模型
│  └─ migrations/            # MySQL 初始化迁移
├─ web/                      # Vue 3 + Vite 管理端
├─ docs/
│  ├─ product-design.md      # 产品、信息架构、交互与状态
│  ├─ architecture.md        # 分层、登录、模型、安全、同步与部署
│  ├─ api-contract.md        # V1 API 唯一契约
│  └─ release-checklist.md   # 可执行发布工作清单
└─ README.md
```

## 技术栈

- 小程序：微信原生 WXML / WXSS / JavaScript。
- 后端：Go 1.22、Gin、GORM，提供 `/api/v1` REST API。
- 数据库：腾讯云 MySQL；小程序不直连数据库。
- 管理端：Vue 3 + Vite + JavaScript，仅展示运行概览和有限用户指标，不展示思虑正文。
- 登录：小程序 `wx.login()` 获取 code，Go 服务端调用微信 `jscode2session` 换取用户标识并签发 JWT。

## 快速启动

### 1. 准备依赖

- Go 1.22 或兼容版本。
- Node.js 20.19+ 或 22.12+，以及 npm。
- 腾讯云 MySQL 实例或仅用于本地开发的 MySQL。
- 微信公众平台**小程序**账号及真实 AppID；本地界面调试可暂用 `touristappid`。
- 微信开发者工具 Stable：<https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html>

### 使用 Docker Compose 启动服务端（可选）

根目录提供 `compose.yaml`，会启动 MySQL 8.4、Go API 和 Vue 管理端：

```bash
cp .env.example .env
# 替换 .env 中全部占位凭据；若密码含 @、:、/ 等字符，需按 Go MySQL DSN 规则编码。
docker compose --env-file .env up --build -d
```

API 默认在 `http://127.0.0.1:8080`，管理端在 `http://127.0.0.1:8081`。该映射仅用于部署验证；正式环境应在反向代理或负载均衡上配置 HTTPS，并限制端口暴露。MySQL 不映射宿主端口，只允许 Compose 私网访问。`MYSQL_PASSWORD` 必须与应用 DSN 中的编码形式保持一致。

### 手动配置并启动 Go API

```bash
cd server
cp .env.example .env
```

编辑 `.env` 或等价环境变量，先创建空数据库；服务启动时会执行 GORM AutoMigrate，`server/migrations` 保存对应初始化 SQL。启动：

```bash
go run ./cmd/server
```

默认监听 `8080`，健康检查为 `GET /health` 和 `GET /api/v1/health`，本地 API Base URL 为 `http://127.0.0.1:8080/api/v1`。正式环境必须使用已备案并配置证书的 HTTPS 合法域名。

### 3. 启动 Vue 3 管理端

另开终端：

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

将 `.env.local` 中 `VITE_API_PROXY_TARGET` 改为 `http://localhost:8080`；`VITE_API_BASE_URL` 保持 `/api/v1`。开发服务器默认端口为 `5173`。生产构建：

```bash
npm run build
```

### 4. 导入微信小程序

1. 打开微信开发者工具 Stable，选择“导入项目”。
2. 项目目录选择本仓库的 **`miniprogram`**，不要导入仓库根目录。
3. 本地无真实凭据时，可使用项目内的 `touristappid` 做有限本地调试；其能力受工具限制。
4. **真机预览、体验版、登录联调和发布必须改用真实 AppID**。
5. 公众平台的账号类型必须是**小程序**，不能是小游戏。
6. 在 `miniprogram/config.js` 配置公开 `API_BASE`。开发者工具的“不校验合法域名”只用于本地调试，不能替代真机 HTTPS 合法域名验证。

小程序端不保存 `AppSecret`、MySQL DSN、JWT 密钥或管理员密码。

## 环境变量

### Go API（`server`）

| 变量 | 必填 | 说明 |
|---|---|---|
| `APP_ENV` | 是 | `development` 或 `production`；只有开发环境允许开发登录 |
| `PORT` | 否 | Go HTTP 监听端口，默认 `8080` |
| `MYSQL_DSN` | 是 | MySQL 连接串；凭据仅放服务端，禁止提交和写日志 |
| `JWT_SECRET` | 是 | JWT HS256 密钥，至少 32 字节，生产使用独立高熵随机值 |
| `JWT_TTL_HOURS` | 否 | JWT 有效期，默认 168 小时，允许 1–720 |
| `WECHAT_APP_ID` | 正式登录必填 | 小程序真实 AppID |
| `WECHAT_APP_SECRET` | 正式登录必填 | 小程序 AppSecret，仅用于服务端调用微信接口 |
| `WECHAT_API_URL` | 否 | `jscode2session` 地址，默认微信官方接口 |
| `AUTH_DEV_MODE` | 是 | 仅本地开发可设 `true` 以接受 `dev_` 前缀 code；测试/预发/生产必须为 `false` |
| `ADMIN_USERNAME` | 管理端需要 | 管理员账号，仅由环境变量配置，与密码同时配置 |
| `ADMIN_PASSWORD` | 管理端需要 | 独立高强度管理员密码，不与微信用户共用 |
| `ALLOWED_ORIGINS` | 否 | 管理端跨域来源白名单，多个来源用逗号分隔；生产避免 `*` |

### Vue 管理端（`web`）

| 变量 | 必填 | 说明 |
|---|---|---|
| `VITE_API_BASE_URL` | 否 | API 基础地址，默认同源 `/api/v1`；不要写入任何秘密 |
| `VITE_API_PROXY_TARGET` | 否 | 仅开发服务器使用，本地 Go 启动后设为 `http://localhost:8080` |

小程序是原生项目，不假设存在 Node 环境变量机制；开发/生产 API 地址通过 `miniprogram/config.js` 注入，且包内只能出现公开 API 地址。

## 测试与检查

### Go API

```bash
cd server
go test ./...
go vet ./...
```

现有自动化测试覆盖鉴权、微信错误脱敏、相似度、登记幂等与并发竞争、版本状态规则、继承字段和收尾校验。真实 MySQL 上的跨用户访问、迁移、事务与并发集成测试仍须在部署环境执行，不能用单元测试代替。

### Vue 3 管理端

```bash
cd web
npm run build
```

当前管理端未配置单元测试脚本，构建检查不能替代功能测试；须在浏览器验收登录、概览、用户分页、401、加载、空态和错误态。

### 微信小程序

- 在微信开发者工具 Stable 中完成编译和基础库兼容性检查。
- 按 `docs/product-design.md` 的 V1 验收路径测试登录、速记、七步评估、复发、搜索、统计和应急叫停。
- 覆盖断网、弱网、超时、切后台、进程重启、401、空列表和无搜索结果。
- 真机使用真实 AppID，关闭“不校验合法域名”后复测 HTTPS、登录和同步。

### 发布前

完整执行 [`docs/release-checklist.md`](./docs/release-checklist.md)，包括体验版、隐私、类目、审核、备份恢复和监控。**不承诺备案或微信审核时长。**

## API 与核心约束

- Base URL：`/api/v1`；成功响应 `{ "data": ... }`，失败响应 `{ "error": { "code": "...", "message": "..." } }`，时间为 RFC3339。
- 除登录和健康检查外，请求携带 `Authorization: Bearer <token>`。
- 微信登录：`POST /auth/wechat/login`；管理登录：`POST /admin/login`。
- 快速登记：`POST /records`；传入 `thoughtId` 才表示复发关联，相似匹配不得自动关联。
- 版本状态：`registered / evaluating / paused / closed`；思虑点状态：`active / resolved / recurring`。
- 所有业务查询由服务端按当前令牌用户隔离，禁止信任客户端传入的用户 ID。

接口细节不在 README 复制扩展，新增能力先更新契约再改实现。

## 文档入口

- [产品与交互设计](./docs/product-design.md)：低刺激交互、信息架构、完整流程、七步评估、复发、应急叫停、空态与异常。
- [技术架构](./docs/architecture.md)：小程序 / Go / MySQL / Vue 分层、微信登录时序、数据模型、权限、离线同步、安全备份和部署。
- [API 契约](./docs/api-contract.md)：路径、请求响应、字段约束和状态枚举。
- [发布工作清单](./docs/release-checklist.md)：腾讯云 MySQL、域名、ICP备案、HTTPS、微信配置、隐私、类目、体验版、提审、发布、监控和备份。

## 安全与隐私底线

- 情绪与心理相关记录按敏感个人信息保护，最小化收集并提供注销删除。
- `.env`、AppSecret、数据库凭据、令牌和备份不得提交到 Git。
- MySQL 仅允许后端私网访问；正式环境全链路 HTTPS。
- 日志不得记录思虑正文、AppSecret、`session_key`、访问令牌或数据库密码。
- 管理端仅可访问 `docs/api-contract.md` 允许的聚合信息，不可查看用户思虑正文。
