# mind_trace 技术架构

> 产品名：止念  
> 目标架构：**微信原生小程序 + Go API + 腾讯云 MySQL + Vue 3 管理端**。  
> 本文完全替换原 CloudBase / 云函数 / 云数据库方案，不依赖微信云开发。接口路径、字段和状态以 [API 契约](./api-contract.md) 为唯一基准。

## 1. 架构边界

- 小程序负责低刺激交互、本地草稿、离线登记队列和应急叫停；不直连 MySQL，不持有 AppSecret 或管理员凭据。
- Go API 负责微信登录、鉴权、用户隔离、业务校验、复发版本、统计、注销删除和管理端只读接口。
- MySQL 部署在腾讯云，保存正式业务数据；只接受来自后端私有网络或安全组白名单的连接。
- Vue 3 管理端仅提供运行概览与有限用户指标，不展示思虑正文，不提供跨用户业务查询。
- V1 不引入 CloudBase、MongoDB、独立 Node 云函数或语义向量服务；相似匹配由 Go 服务按关键词实现，结果仅供提示。

## 2. 分层与模块

```text
微信小程序（WXML / WXSS / JavaScript）
  ├─ pages：此刻、处理、思虑库、七步评估、详情、统计、我的
  ├─ components：速记面板、分步表单、版本时间线、应急工具
  ├─ services：/api/v1 请求、令牌处理、统一错误映射
  └─ local：敏感缓存、草稿、离线 outbox、同步状态
                         │ HTTPS
                         ▼
Nginx / 腾讯云负载均衡（TLS 终止、限流、请求大小限制）
                         ▼
Go API（Gin + GORM，/api/v1）
  ├─ transport：HTTP 路由、JSON、鉴权中间件、错误契约
  ├─ auth：jscode2session、JWT、管理员登录
  ├─ domain：思虑点、登记版本、七步状态机、复发、统计
  ├─ repository：事务、参数化 SQL、按 user_id 隔离
  └─ infrastructure：MySQL、日志、指标、微信 API 客户端
                         │ 私网 + TLS（按云数据库能力启用）
                         ▼
腾讯云 MySQL（users / thoughts / records）

Vue 3 + Vite 管理端（web/，静态构建，同源或独立管理域名）
                         │ HTTPS /api/v1/admin/*
                         ▼
Go API 管理接口（独立管理员鉴权，不返回思虑正文）
```

### 2.1 Go 内部约束

- HTTP 层不直接拼 SQL；领域逻辑与 Gin 路由、GORM 持久化分别组织，事务由服务层统一管理。
- 成功统一 `{ "data": ... }`，失败统一 `{ "error": { "code", "message" } }`；时间统一 RFC3339。
- 除健康检查、`/auth/wechat/login` 和 `/admin/login` 外，业务请求使用 `Authorization: Bearer <token>`。
- 用户身份只从服务端 JWT 解析，禁止从请求体、查询参数或客户端传入的 `userId` 取得归属。
- 创建思虑点与首个版本、已有思虑点新增版本、收尾状态变更均在数据库事务中完成。
- 日志记录请求 ID、路由、状态码、耗时和用户内部 ID（必要时哈希）；不得记录思虑正文、令牌、AppSecret、数据库密码或完整微信会话响应。

## 3. 微信登录时序

```text
用户          小程序             Go API              微信接口            MySQL
 │ 点击登录      │                   │                    │                  │
 │─────────────▶│ wx.login()        │                    │                  │
 │              │── code ──────────▶│                    │                  │
 │              │  + 可选昵称/头像   │── AppID+AppSecret ─▶│                  │
 │              │                   │   + code            │                  │
 │              │                   │◀─ openid/session ───│                  │
 │              │                   │── 查找或创建用户 ──────────────────────▶│
 │              │◀─ {token,user} ───│◀──────────────────────────────────────│
 │              │── 保存 JWT，后续 Bearer 调用                                │
```

1. 服务端校验 `code` 非空，并通过服务端 HTTPS 调用微信 `jscode2session`；`WECHAT_APP_ID`、`WECHAT_APP_SECRET` 只存在于 Go 服务环境。
2. 以微信返回的 `openid` 查找或创建用户，保证其唯一；`session_key` 不下发、不写入日志，`unionid` 不作为 V1 的登录主键。
3. 服务端使用至少 32 字节的 `JWT_SECRET`，以 HS256 签发包含用户 ID、`role=user` 和过期时间的 JWT；有效期由 `JWT_TTL_HOURS` 控制。JWT 不存 MySQL，客户端保存令牌。
4. `/me` 从 JWT 取得当前用户并检查用户仍存在；`DELETE /me` 删除当前用户全部业务数据。注销后旧 JWT 因用户不存在而不能继续访问，客户端同时清除令牌。
5. `AUTH_DEV_MODE=true` 仅 `APP_ENV=development` 时开放，接受 `dev_` 前缀 code；测试、预发和生产必须显式为 `false`，服务端拒绝危险配置。
6. 微信接口失败、code 过期或重放均返回统一错误，不创建伪用户，不自动改用开发登录。

管理员登录是独立流程：`POST /admin/login` 使用 `ADMIN_USERNAME`、`ADMIN_PASSWORD`，签发 `role=admin` 的 JWT。用户令牌不能访问 `/admin/*`，管理员令牌默认也不能读取用户业务正文。

## 4. MySQL 数据模型

使用 InnoDB、`utf8mb4` 和 GORM 模型。主键为自增 `uint64`（MySQL `bigint unsigned`），API JSON 中表现为 ID 数值；业务写入统一校验归属和字段长度，时间字段由服务持久化并在 API 输出 RFC3339。

### 4.1 `users`

| 字段 | 类型/约束 | 说明 |
|---|---|---|
| `id` | bigint unsigned PK | 内部用户 ID，同时作为用户 JWT 的 subject |
| `open_id` | varchar(64) NOT NULL UNIQUE | 当前小程序微信用户标识；开发用户使用受限的 `dev:` 标识 |
| `nickname` | varchar(100) | 可选资料，不影响登录 |
| `avatar_url` | varchar(1024) | 可选头像地址 |
| `created_at` / `updated_at` | datetime | 创建与更新时间 |

V1 不保存 `unionid`、`session_key` 或软删除标记；注销采用物理删除。

### 4.2 `thoughts`

| 字段 | 类型/约束 | 说明 |
|---|---|---|
| `id` | bigint unsigned PK | 思虑点 ID |
| `user_id` | bigint unsigned NOT NULL，索引 | 数据归属，所有查询必备条件 |
| `trigger_event` | varchar(100) NOT NULL | 首次登记的触发事件，用作主题摘要 |
| `emotions` | json | 首次登记情绪，供筛选 |
| `status` | varchar(16) NOT NULL DEFAULT `active` | `active / resolved / recurring` |
| `created_at` / `updated_at` | datetime | 创建与更新时间 |

索引：`(user_id, status)`、`(user_id, created_at)`。版本计数、最近记录和当前进度通过关联 records 聚合，不另存冗余计数；相似匹配只查询当前用户的触发事件与记录正文，匹配结果不自动关联。

### 4.3 `records`

| 字段 | 类型/约束 | 说明 |
|---|---|---|
| `id` | bigint unsigned PK | 登记版本 ID |
| `thought_id` | bigint unsigned NOT NULL | 所属思虑点 |
| `user_id` | bigint unsigned NOT NULL，索引 | 冗余归属，便于强制隔离 |
| `version_no` | int NOT NULL | 思虑点内递增 |
| `status` | varchar(16) NOT NULL DEFAULT `registered` | `registered / evaluating / paused / closed` |
| `step` | int NOT NULL DEFAULT 0 | 0–7 |
| `trigger_event` | varchar(100) NOT NULL | 1–100 字 |
| `emotions` | json | 情绪字符串数组 |
| `intensity` | int NOT NULL | 1–10 |
| `loop_thought` | varchar(1000) NOT NULL | 1–1000 字，服务端按字符校验 |
| `rumination_type` | varchar(100) | 第 1 步 |
| `risk_content` | text | 第 2 步 |
| `probability` | int NULL | 0–100；空值与 0 区分 |
| `controllable_actions` | json | `[{text,done}]` |
| `uncontrollable_items` | json | `[{text,crossedOut}]` |
| `scenario_worst` / `scenario_likely` / `scenario_best` | text | 第 6 步 |
| `close_confirmations` | json | 3 个布尔值 |
| `created_at` / `updated_at` | datetime | 创建与最近保存时间 |
| `closed_at` | datetime NULL | 未收尾为空 |

约束与索引：

- `UNIQUE(thought_id, version_no)`；新增版本时使用事务和思虑点行锁或等效机制，避免并发版本号冲突。
- `(user_id, status)`、`(user_id, created_at)`；版本时间线按 `version_no DESC` 读取。
- 写入时同时验证思虑点与记录均属于当前 `user_id`，思虑点删除级联删除其版本。
- 数组字段保持契约中的 camelCase JSON key；数据库 snake_case 只在持久层映射。
- 复发继承在创建新版本时从上一版复制评估字段，不另存 `inherited_from`；旧版本保持不变。
- 不在 V1 另建对客户端暴露的 actions 资源；行动完成状态存于 `controllable_actions`。

### 4.4 鉴权存储

V1 使用无状态 JWT，不建立 `sessions` 或 `admin_sessions` 表。`JWT_SECRET` 只存在服务端；用户与管理员的 `role` 在鉴权中间件中分别校验。注销通过删除用户使其旧 JWT 失效；如未来需要单设备踢出或主动吊销，再扩展会话/黑名单模型和对应契约。

## 5. 业务不变量与权限隔离

- 所有业务 SQL 都带当前 `user_id`；“先按 ID 查出再判断”也必须最终阻止跨用户读写，并统一返回不泄露资源存在性的错误。
- `POST /records`：无 `thoughtId` 时，事务创建思虑点和 v1；有 `thoughtId` 时，验证归属、递增版本、复制上一版允许继承的评估字段，状态重新进入登记流程。
- `PATCH /records/:id`：只允许当前用户的未收尾版本；保存七步字段、步骤和状态，不放宽 `close` 校验。
- `POST /records/:id/close`：事务内检查状态、必填项、平衡视角三栏及三项确认，成功后写 `closed` 和 `closed_at`。
- `pause` 只进入 `paused`；应急叫停不修改版本状态。
- 思虑点聚合状态由领域逻辑统一更新，不能由客户端直接传入。
- 管理端 `/admin/overview` 与 `/admin/users` 只返回契约规定的聚合指标和元数据，SQL 不选择 `trigger_event`、`loop_thought`、风险内容等正文列。
- 注销按当前用户在事务中删除 records、thoughts、users，避免残留。备份中的副本依备份周期到期清除，隐私说明应披露该延迟。

## 6. 离线与同步

### 6.1 本地数据

- 小程序本地保存：当前会话令牌、非敏感界面设置、评估草稿、待同步登记 outbox、同步游标。
- 应急叫停完全本地运行；离线时可用。
- 本地列表缓存不是权威数据源；退出登录、令牌失效后的重新授权和注销成功时清理敏感缓存。

### 6.2 登记 outbox

1. 用户提交时先写入本地 outbox，状态为 `pending`，立即显示“已存本机，待同步”，不能冒充云端成功。
2. 联网后按本地创建顺序调用 `POST /records`；成功后保存服务端 `thought / record` 并标记 `synced`。
3. 复发关联保存用户已确认的 `thoughtId`；同步前若目标不可访问，保留原文并让用户重新选择，不改关联到其他主题。
4. 对明确失败的请求按错误处理；对超时等“结果未知”的请求，不盲目重复自动提交，先标记 `unknown` 并提示核对，避免重复版本。
5. V1 契约未定义客户端幂等键。若需无人值守安全重试，应先扩展 API 契约和服务端去重存储，再上线自动重放，不能只在客户端假设幂等。

### 6.3 草稿与冲突

- 每个版本本地维护 `step`、草稿正文、`localUpdatedAt` 和已知服务端 `updatedAt`。
- 单设备草稿按本地最新编辑恢复；服务端以 `PATCH` 成功响应为准。
- 多设备同时编辑时，V1 采用最后成功写入优先，但不得覆盖 `closed` 版本；发现服务端已收尾则停止自动保存并保留本地副本供用户查看。
- 列表和详情联网后重新拉取；不在本地自行计算服务端总计数作为最终值。

## 7. 备份、安全与隐私

### 7.1 备份与恢复

- 开启腾讯云 MySQL 自动备份和 binlog/时间点恢复能力；生产建议至少每日备份，保留周期按隐私承诺与恢复目标配置。
- 备份、快照和只读实例使用同等访问控制；导出文件加密并限制下载，不放入代码仓库或公开对象存储。
- 每月至少一次在隔离环境做恢复演练，记录恢复点、恢复耗时、数据完整性和责任人；仅“备份成功”不等于可恢复。
- 明确 RPO/RTO 后再选择跨地域备份；删除与注销数据在备份中的保留期限需写入隐私与运维规范。

### 7.2 安全基线

- 全链路 HTTPS；证书自动续期并监控到期；小程序只配置 HTTPS 合法域名，不使用 IP、端口或明文 HTTP。
- MySQL 不开放公网；安全组只允许 API 子网/实例访问 3306，应用账号最小权限，root 不用于服务连接。
- AppSecret、MySQL DSN、管理员账号密码和令牌密钥通过环境变量/密钥管理注入；`.env` 不入库，日志与前端构建均不得包含。
- SQL 参数化、JSON 请求大小限制、登录与接口限流、管理员登录失败锁定/ backoff、安全超时和统一错误响应。
- 敏感个人信息最小化收集；隐私协议说明处理目的、方式、范围、保存期限、注销渠道。需要单独同意的场景在微信小程序隐私设置与界面中同步落实。
- 生产依赖与镜像定期漏洞扫描；数据库和系统补丁在维护窗口实施。

## 8. 部署拓扑

```text
微信客户端                         管理人员
   │ HTTPS api.example.com             │ HTTPS admin.example.com（或同源 /admin）
   ▼                                   ▼
DNS + 腾讯云 CDN/负载均衡（可选） + Nginx（443）
                                      ├─ 静态 Vue 3 构建产物
                                      └─ 反向代理 /api/v1 → Go API
                                                             │
                                                腾讯云私有网络 VPC
                                                             │
                                      ┌──────────────────────┴──────────┐
                                      ▼                                 ▼
                           腾讯云 MySQL 主实例                  日志/指标/告警
                           自动备份 + binlog                    错误率、延迟、容量、证书
                                      │
                                      ▼
                           隔离恢复演练环境 / 备份存储
```

- 首期可单台 CVM 运行 Nginx 与 Go API，MySQL 使用独立腾讯云数据库；不得把 MySQL 与小程序直接连通。
- Go 以受管服务运行，配置健康检查、优雅退出、连接池和文件描述符/内存限制；静态管理端与 API 可同源减少 CORS。
- 生产、测试环境使用不同数据库、AppID 配置和密钥；`AUTH_DEV_MODE=false` 是生产启动硬性条件。
- 发布采用迁移先行且向后兼容、再滚动 API、最后发布小程序的顺序；数据库回滚与代码回滚分别预案化。
- 监控至少覆盖：5xx、P95 延迟、微信登录失败、DB 连接/慢查询/磁盘、备份结果、证书到期、磁盘与服务存活；告警正文不含用户内容。

## 9. 与 V1 API 的对应

| 能力 | 接口 | 服务端要点 |
|---|---|---|
| 微信登录/当前用户/注销 | `/auth/wechat/login`、`/me` | code 换会话、用户隔离、全量删除 |
| 首页聚合 | `/dashboard` | 仅当前用户计数 |
| 相似提示 | `/thoughts/match` | 仅候选与分数，不自动关联 |
| 快速登记/复发 | `/records` | 新建或版本递增、继承、事务 |
| 队列/详情/草稿 | `/records`、`/records/:id` | 状态分页、归属校验、草稿保存 |
| 收尾/搁置 | `/records/:id/close`、`/pause` | 服务端强校验与状态机 |
| 思虑库/时间线 | `/thoughts`、`/thoughts/:id` | 查询筛选、倒序版本 |
| 统计 | `/stats/summary` | 当前用户聚合 |
| 管理端 | `/admin/login`、`/overview`、`/users` | 独立鉴权、无思虑正文 |

任何新端点、状态、筛选条件或幂等机制，必须先更新 `docs/api-contract.md`，再改实现和客户端，避免文档与接口分叉。
