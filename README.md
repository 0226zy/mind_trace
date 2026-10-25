# mind_trace · 止念

「止念」是一个随身思虑登记与结构化处理工具：先快速记录，再通过七步评估把循环思虑转成行动或收尾。项目默认使用 **微信原生小程序 + 微信云开发**，同时保留 **Go API + 腾讯云 MySQL + Vue 3 管理端** HTTP 模式。

> 产品是记录与效率工具，不提供医疗诊断、心理治疗或紧急救援服务。

## 两种数据模式

| 模式 | 后端与数据 | 管理端 | 适用说明 |
|---|---|---|---|
| `cloud`（默认） | 云函数 `mindTrace` + 云数据库 | V1 无管理端数据互通 | 无需自建 API 域名、ICP备案或 `request` 合法域名 |
| `http`（保留） | Go API + 腾讯云 MySQL | Vue 3 管理端可用 | 需部署 API、HTTPS 域名并配置微信合法域名 |

页面始终通过 `miniprogram/services/api.js` 调用，由请求层根据 `DATA_MODE` 选择 `wx.cloud.callFunction` 或 `wx.request`。**两种模式的数据不自动同步，切换配置不等于迁移数据。**

## 项目结构

```text
mind_trace/
├─ miniprogram/              # 微信原生小程序：此刻、处理、思虑库、应急叫停
│  ├─ pages/
│  ├─ components/
│  ├─ services/              # 双模式请求层、本地草稿与离线同步
│  ├─ cloudfunctions/
│  │  └─ mindTrace/          # 默认云函数，wx-server-sdk 4.0.2
│  └─ config.js              # DATA_MODE、云环境、云函数名、HTTP API 地址
├─ server/                   # 可选 Go API（Gin + GORM）
│  ├─ cmd/server/            # 服务入口
│  ├─ internal/              # 鉴权、领域逻辑、HTTP 处理与数据模型
│  └─ migrations/            # MySQL 初始化迁移
├─ web/                      # 可选 Vue 3 + Vite 管理端，仅 HTTP 模式
├─ compose.yaml              # 可选 MySQL + Go API + Vue 一键编排
├─ docs/
│  ├─ README.md              # 文档地图与分角色阅读顺序
│  ├─ product-design.md      # 产品、信息架构、交互与状态
│  ├─ architecture.md        # 双模式架构、安全、同步、部署与扩容
│  ├─ code-design.md         # 全系统模块、时序、配置、测试与扩展规范
│  ├─ cloud-api.md           # 默认云开发调用契约
│  ├─ cloud-deployment.md    # 云环境、函数、集合、规则、索引与验收
│  ├─ api-contract.md        # HTTP V1 API 契约
│  └─ release-checklist.md   # 通用 / cloud / HTTP 发布清单
└─ README.md
```

## 快速启动：默认 cloud 模式

### 1. 准备小程序与云环境

1. 准备微信公众平台**小程序**账号，账号类型不能是小游戏。
2. 下载并安装[微信开发者工具 Stable](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)，导入本仓库的 **`miniprogram`** 目录。
3. 配置真实 AppID。`touristappid` 仅用于有限的本地界面调试；云函数、云数据库、真机、体验版和发布使用真实 AppID。
4. 在开发者工具中开通云开发并创建环境，记录环境 ID。测试与生产建议使用不同环境。
5. 在云开发控制台核对当前套餐、配额和费用；**套餐与免费额度以控制台当期为准，不承诺固定免费。**

### 2. 配置数据模式

在 `miniprogram/config.js` 配置：

```js
module.exports = {
  DATA_MODE: 'cloud',
  CLOUD_ENV: '你的环境ID',
  CLOUD_FUNCTION_NAME: 'mindTrace',
  API_BASE: 'https://your-api.example.com/api/v1', // 仅 http 使用
  // 其余现有配置保持不变
}
```

`CLOUD_ENV` 为空时使用默认云环境；正式发布建议显式填环境 ID。`API_BASE` 在 cloud 模式不会用于业务请求。

### 3. 部署云函数和数据库

```bash
cd miniprogram/cloudfunctions/mindTrace
npm install --omit=dev
npm run check
npm test
npm audit
```

1. 在微信开发者工具中右键 `mindTrace`，选择“上传并部署：云端安装依赖”。
2. 在云数据库创建 `users`、`thoughts`、`records` 集合，普通业务归属字段统一为 `ownerOpenid`。
3. 三个集合均设置安全规则 `read:false`、`write:false`，禁止小程序端直接读写；只有云函数可访问。
4. 按[云开发部署指南](./docs/cloud-deployment.md)创建 `ownerOpenid` 用户/列表索引和版本唯一索引。
5. 验证 `login → createRecord → patchRecord → closeRecord`，以及同一 `clientRequestId` 重试不重复创建。

云函数通过 `cloud.getWXContext().OPENID` 确定身份；公开用户 ID 为 `${_id}:${generation}`，非 login 调用必须携带 `actorUserId` 并校验代次。云模式不需要 Go、MySQL、Nginx、API 域名、ICP备案或 `request` 合法域名；小程序主体注册、隐私、类目、体验版、提审和发布仍然需要。

**已知依赖风险**：当前 `wx-server-sdk` 4.0.2 的 `npm audit` 仍报告官方 SDK 间接依赖 `axios/lodash.set/lodash.unset` 漏洞，普通 `npm audit fix` 无法非破坏消除，不得使用 `--force` 降级。上线前必须复查官方更新并在真实云环境验证，不宣称 0 漏洞。

完整操作见 **[cloud-deployment.md](./docs/cloud-deployment.md)**。

## 可选启动：HTTP 模式（Go + MySQL + Vue）

将 `miniprogram/config.js` 改为 `DATA_MODE: 'http'`，并配置 `API_BASE`。该路径沿用原有 Go、MySQL、HTTPS、域名和管理端部署方式。

### 1. 准备依赖

- Go 1.22 或兼容版本。
- Node.js 20.19+ 或 22.12+，以及 npm。
- 腾讯云 MySQL 实例或仅用于本地开发的 MySQL。
- 真实小程序 AppID；本地非云端界面调试可暂用 `touristappid`。

### 2. 使用 Docker Compose 启动服务端

根目录 `compose.yaml` 会启动 MySQL 8.4、Go API 和 Vue 管理端：

```bash
cp .env.example .env
# 替换 .env 中全部占位凭据；若密码含 @、:、/ 等字符，需按 Go MySQL DSN 规则编码。
docker compose --env-file .env up --build -d
```

API 默认在 `http://127.0.0.1:8080`，管理端在 `http://127.0.0.1:8081`。该映射仅用于部署验证；正式环境应在反向代理或负载均衡上配置 HTTPS，并限制端口暴露。MySQL 不映射宿主端口，只允许 Compose 私网访问。`MYSQL_PASSWORD` 必须与应用 DSN 中的编码形式保持一致。

### 3. 或手动配置并启动 Go API

```bash
cd server
cp .env.example .env
```

编辑 `.env` 或等价环境变量，先创建空数据库；服务启动时执行 GORM AutoMigrate，`server/migrations` 保存对应初始化 SQL。启动：

```bash
go run ./cmd/server
```

默认监听 `8080`，健康检查为 `GET /health` 和 `GET /api/v1/health`，本地 API Base URL 为 `http://127.0.0.1:8080/api/v1`。正式环境必须使用已备案并配置证书的 HTTPS 合法域名。

### 4. 启动 Vue 3 管理端

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

将 `.env.local` 中 `VITE_API_PROXY_TARGET` 改为 `http://localhost:8080`，`VITE_API_BASE_URL` 保持 `/api/v1`。开发服务器默认端口为 `5173`。生产构建：

```bash
npm run build
```

Vue 管理端只连接 Go + MySQL HTTP 模式，不读取微信云数据库；cloud 模式 V1 无管理端数据互通。

### 5. 配置小程序 HTTP 地址

1. 在 `miniprogram/config.js` 设置 `DATA_MODE:'http'` 和公开 `API_BASE`。
2. 真机预览、体验版、登录联调和发布必须使用真实 AppID。
3. 开发者工具的“不校验合法域名”只用于本地调试；真机需关闭该选项后复测 HTTPS 和 `request` 合法域名。
4. 小程序端不保存 AppSecret、MySQL DSN、JWT 密钥或管理员密码。

## 配置参考

### 小程序（`miniprogram/config.js`）

| 配置 | 默认值/模式 | 说明 |
|---|---|---|
| `DATA_MODE` | `cloud` | `cloud` 为默认；`http` 切回 Go API |
| `CLOUD_ENV` | 空字符串 | cloud 使用；空为默认云环境，可填环境 ID |
| `CLOUD_FUNCTION_NAME` | `mindTrace` | cloud 云函数名 |
| `API_BASE` | 示例 HTTPS 地址 | 仅 HTTP 模式使用 |

### Go API（仅 HTTP，`server`）

| 变量 | 必填 | 说明 |
|---|---|---|
| `APP_ENV` | 否 | 默认 `development`，可设 `production`；只有开发环境允许开发登录 |
| `PORT` | 否 | Go HTTP 监听端口，默认 `8080` |
| `MYSQL_DSN` | 是 | MySQL 连接串；凭据仅放服务端，禁止提交和写日志 |
| `JWT_SECRET` | 是 | JWT HS256 密钥，至少 32 字节，生产使用独立高熵随机值 |
| `JWT_TTL_HOURS` | 否 | JWT 有效期，默认 168 小时，允许 1–720 |
| `WECHAT_APP_ID` | 正式登录必填 | 小程序真实 AppID |
| `WECHAT_APP_SECRET` | 正式登录必填 | 小程序 AppSecret，仅用于服务端调用微信接口 |
| `WECHAT_API_URL` | 否 | `jscode2session` 地址，默认微信官方接口 |
| `AUTH_DEV_MODE` | 否 | 默认 `false`；仅本地开发可设 `true`，测试/预发/生产必须为 `false` |
| `ADMIN_USERNAME` | 管理端需要 | 管理员账号，与密码同时配置 |
| `ADMIN_PASSWORD` | 管理端需要 | 独立高强度管理员密码 |
| `ALLOWED_ORIGINS` | 否 | 管理端跨域来源白名单；生产避免 `*` |

### Vue 管理端（仅 HTTP，`web`）

| 变量 | 必填 | 说明 |
|---|---|---|
| `VITE_API_BASE_URL` | 否 | API 基础地址，默认同源 `/api/v1`；不要写入秘密 |
| `VITE_API_PROXY_TARGET` | 否 | 仅开发服务器使用，本地 Go 启动后设为 `http://localhost:8080` |

## 测试与检查

### 默认 cloud 模式

- 按 [cloud-deployment.md](./docs/cloud-deployment.md) 验收云函数、集合、安全规则、`ownerOpenid` 索引、事务、幂等和双账号隔离。
- 验证非 login 调用缺少、伪造或使用旧代次 `actorUserId` 均被拒绝；返回不暴露 `ownerOpenid` 和原始代次字段。
- 同一 `clientRequestId` 经核对后的重试只产生首次记录；并发复发不重复版本号。
- 验证 `createRecord` 与注销并发时的用户写冲突，以及 `deleting → 清理 → 删除` 的同代次恢复。
- 验证检索和统计读取当前用户全部数据，不停留在前 20/100 条。
- 真机体验版使用正确 AppID、`CLOUD_ENV` 和已部署云函数；上线前完成 SDK 漏洞复查和真实云环境验证。

### Go API（仅 HTTP）

```bash
cd server
go test ./...
go vet ./...
```

现有自动化测试覆盖鉴权、微信错误脱敏、相似度、登记幂等与并发竞争、版本状态规则、继承字段和收尾校验。真实 MySQL 上的跨用户访问、迁移、事务与并发集成测试仍须在部署环境执行。

### Vue 3 管理端（仅 HTTP）

```bash
cd web
npm run build
```

当前管理端未配置单元测试脚本，构建检查不能替代功能测试；须在浏览器验收登录、概览、用户分页、401、加载、空态和错误态。

### 微信小程序（两种模式）

- 在微信开发者工具 Stable 中完成编译和基础库兼容性检查。
- 按 `docs/product-design.md` 验收登录、速记、七步评估、复发、搜索、统计和应急叫停。
- 覆盖断网、弱网、超时、切后台、进程重启、401、空列表和无搜索结果。
- 验证每条队列绑定 `ownerUserId + backendMode + backendEnv`；账号/代次、模式或环境变化时阻断同步，网络结果未知时不盲目自动重发。

### 发布前

完整执行 [`docs/release-checklist.md`](./docs/release-checklist.md)：先完成通用项，再按实际模式执行 cloud 默认路径或 HTTP 可选路径。**不承诺微信审核或 HTTP 备案时长。**

## API 与核心约束

- 两种模式成功响应均为 `{data:...}`，业务失败均为 `{error:{code,message}}`。
- cloud 的 login 使用 `{action,payload}`，非 login 使用 `{action,payload,actorUserId}`；HTTP Base URL 为 `/api/v1`。
- cloud 通过 `OPENID + actorUserId` 校验身份和用户代次，公开用户 ID 为 `${_id}:${generation}`；HTTP 除登录和健康检查外携带 Bearer JWT。
- 云集合使用普通字段 `ownerOpenid` 做归属，不返回客户端；客户端仍禁止直接读写。
- 快速登记使用 `clientRequestId` 保证同一用户重试幂等；cloud 的 `createRecord` 事务写用户以与注销标记形成写冲突。
- cloud 注销按 `deleting → 清理 → 删除用户` 执行，同代次可恢复，旧代次不得操作新账号。
- 离线队列绑定 `ownerUserId + backendMode + backendEnv`；缺字段或归属变化时阻断，未知网络结果不自动重发。
- 新版本继承评估字段但重置 `closeConfirmations`。
- 版本状态：`registered / evaluating / paused / closed`；思虑点状态：`active / resolved / recurring`。
- 两套数据不自动同步；Vue 管理端仅支持 Go + MySQL HTTP 模式。

## 文档入口

先看 **[文档导航](./docs/README.md)**，按产品、cloud 开发、HTTP 开发／部署或发布任务选择阅读顺序。

### 产品与系统设计

- [产品与交互设计](./docs/product-design.md)：角色、场景、实际页面、七步评估、复发、离线、应急、V1 边界与验收。
- [技术架构](./docs/architecture.md)：双模式分层、身份、模型、权限、离线同步、安全、部署和扩容限制。
- [代码设计](./docs/code-design.md)：仓库结构、模块职责、核心代码时序、配置、测试文件与扩展规范。

### API 契约

- [云开发 API 契约](./docs/cloud-api.md)：`mindTrace` 的 14 个 action、集合、OPENID、事务与幂等。
- [HTTP API 契约](./docs/api-contract.md)：Go 路径、请求响应、字段约束和状态枚举。

### 部署与发布

- [云开发部署指南](./docs/cloud-deployment.md)：真实 AppID、环境、云函数、集合、规则、索引和体验版验收。
- [发布工作清单](./docs/release-checklist.md)：通用、cloud 默认、HTTP 可选的分模式发布步骤。

## 安全与隐私底线

- 情绪与心理相关记录按敏感个人信息保护，最小化收集并提供注销删除。
- `.env`、AppSecret、数据库凭据、令牌和备份不得提交到 Git。
- cloud 集合安全规则必须禁止客户端读写，云函数仍须逐请求校验 `ownerOpenid` 归属和 `actorUserId` 用户代次。
- HTTP MySQL 仅允许后端私网访问，正式环境全链路 HTTPS。
- 日志不得记录思虑正文、AppSecret、`session_key`、访问令牌或数据库密码。
- 管理端仅可访问 HTTP API 契约允许的聚合信息，不可查看用户思虑正文，也不直接读取云数据库。
