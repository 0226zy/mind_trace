# mind_trace 技术架构

> 产品名：止念  
> 默认架构：**微信原生小程序 + 微信云开发（云函数 `mindTrace` + 云数据库）**。
> 保留架构：**微信原生小程序 + Go API + 腾讯云 MySQL + Vue 3 管理端**。
> 云模式契约见 [cloud-api.md](./cloud-api.md)，HTTP 契约见 [api-contract.md](./api-contract.md)，云部署见 [cloud-deployment.md](./cloud-deployment.md)。

## 1. 双模式边界

小程序页面始终调用 `miniprogram/services/api.js`，由请求层根据 `DATA_MODE` 选择云函数或 HTTP；页面不直接访问云数据库，也不直接连接 MySQL。

| 配置/能力 | `cloud`（默认） | `http`（保留） |
|---|---|---|
| 业务调用 | `wx.cloud.callFunction` | `wx.request` |
| 服务端 | 云函数 `mindTrace` | Go 1.22 + Gin + GORM |
| 数据存储 | 云数据库 `users / thoughts / records` | 腾讯云 MySQL `users / thoughts / records` |
| 身份 | `cloud.getWXContext().OPENID` | `jscode2session` + JWT |
| 小程序配置 | `CLOUD_ENV`、`CLOUD_FUNCTION_NAME` | `API_BASE` |
| 自建 API 域名、ICP备案、`request` 合法域名 | 不需要 | 需要 |
| Vue 管理端 | **V1 不支持数据互通** | 支持，仅显示契约允许的指标 |
| 数据关系 | 与 HTTP 数据**不自动同步** | 与 cloud 数据**不自动同步** |

`miniprogram/config.js`：

```js
module.exports = {
  DATA_MODE: 'cloud',                 // 默认；改 'http' 使用 Go API
  CLOUD_ENV: '',                     // 空为默认云环境，可填环境 ID
  CLOUD_FUNCTION_NAME: 'mindTrace',
  API_BASE: 'https://your-api.example.com/api/v1', // 仅 http 使用
  // 其余现有配置保持不变
}
```

切换配置只改变后续请求去向，不是数据迁移。本地 outbox 必须绑定 `ownerUserId + backendMode + backendEnv`；账号/代次、模式或环境变化时阻断自动同步，防止把待办写入另一账号或后端。小程序主体注册、真实 AppID、隐私、类目和审核是两种模式的共同要求。

## 2. 默认 cloud 架构

### 2.1 分层

```text
微信小程序（WXML / WXSS / JavaScript）
  ├─ pages：此刻、处理、思虑库、七步评估、详情、统计、我的
  ├─ components：速记面板、分步表单、版本时间线、应急工具
  ├─ services/api.js：统一 action 请求、错误与返回结构归一化
  └─ local：敏感缓存、草稿、绑定用户/代次与后端环境的离线 outbox
                         │ wx.cloud.callFunction
                         ▼
miniprogram/cloudfunctions/mindTrace（wx-server-sdk 4.0.2）
  ├─ 入口：{ action, payload, actorUserId? } 路由与参数校验
  ├─ auth：WXContext.OPENID + actorUserId 用户代次校验
  ├─ domain：登记、复发、七步状态机、检索、统计、注销
  └─ data：事务、幂等、分批读取、强制 ownerOpenid 隔离
                         │ 仅服务端 SDK
                         ▼
微信云数据库
  ├─ users（generation / deleting / lastWriteAt）
  ├─ thoughts（versionCount / openCount）
  └─ records
```

数据库安全规则对 `users`、`thoughts`、`records` 均设置 `read:false`、`write:false`，禁止小程序端直接读写。只有云函数可以访问；云函数仍必须在每个业务查询和写入中校验普通业务字段 `ownerOpenid`，不能把安全规则当作用户隔离的替代品。

### 2.2 云登录、公开用户 ID 与代次

```text
用户          小程序                 云函数 mindTrace             云数据库
 │ 点击登录      │ wx.cloud.callFunction       │                       │
 │─────────────▶│ {action:'login',payload} ──▶│                       │
 │              │                             │ 读取 WXContext.OPENID │
 │              │                             │── 按 ownerOpenid 查用户 ▶│
 │              │                             │── 不存在则创建并生成代次 ▶│
 │              │◀──────── {data:{user}} ─────│                       │
 │              │ user.id = ${_id}:${generation}                       │
 │              │ 非 login 事件另带 actorUserId=user.id                  │
```

1. cloud 登录不传 `code`，不经过 Go，不签发 JWT，也不需要云函数持有 AppSecret。
2. 云函数只从 `cloud.getWXContext().OPENID` 取得微信身份；事件中的 `openid`、`userId` 或 `actorUserId` 都不能替代该身份来源。
3. 公开用户 ID 为 **`${_id}:${generation}`**。`generation` 是创建用户时生成的随机代次，因此公开 ID 不是只由 OPENID 哈希得到的值。
4. `login` 不携带 `actorUserId`；其他所有 action 都必须携带，服务端校验其与当前用户的公开 ID 完全一致。用户不存在、普通业务遇到注销中用户或代次不符时返回 401。
5. 返回用户不暴露 `ownerOpenid`、原始 `generation`、`deleting`、`deletingAt` 等内部字段；记录和思虑文档的 `_id` 映射为 `id`，归属字段不返回。

### 2.3 注销与创建竞争控制

- `deleteMe` 先在事务中把同代次用户标记为 `deleting:true`，再分批清理 records/thoughts，最后在事务中复核代次并删除 users 文档。
- 同一 `actorUserId` 可重复调用 `deleteMe` 恢复中断清理；旧代次不能操作新代次用户，延迟清理也不能删除新代次。
- `login` 遇到注销中用户时先完成同代次清理，再创建新代次。
- `createRecord` 在事务中校验活跃用户和代次，并在写 records/thoughts 前更新用户 `lastWriteAt/updatedAt`。该用户写与注销标记形成写冲突，避免注销过程中新增记录。
- 客户端重新登录和同步前均核对包含代次的用户 ID；旧代次离线记录阻断同步而非写入新账号。

### 2.4 action 与 HTTP 对应

| cloud action | HTTP 对应 | 说明 |
|---|---|---|
| `login` / `me` / `deleteMe` | `/auth/wechat/login`、`/me` | 登录、当前用户、同代次可重入注销 |
| `dashboard` | `GET /dashboard` | 当前用户首页计数 |
| `matchThoughts` | `POST /thoughts/match` | 仅提示，不自动关联 |
| `createRecord` | `POST /records` | 含 `clientRequestId`，用户写冲突、事务与幂等创建 |
| `listRecords` / `getRecord` / `patchRecord` | `/records`、`/records/:id` | 队列、详情、七步草稿 |
| `closeRecord` / `pauseRecord` | `/records/:id/close`、`/pause` | 收尾、搁置 |
| `listThoughts` / `getThought` | `/thoughts`、`/thoughts/:id` | 检索与版本时间线 |
| `stats` | `GET /stats/summary` | 当前用户统计 |

除 `login` 外，表中 action 的事件都包含 `actorUserId`。两种模式成功均为 `{data:...}`，业务失败均为 `{error:{code,message}}`。云函数异常需转换为该结构，不能把堆栈或数据库错误直接返回小程序。

### 2.5 云数据库模型与索引

所有文档使用 `_id`，普通业务归属字段为 `ownerOpenid`；时间统一保存 ISO 字符串。

- **users**：`_id`、`ownerOpenid`、`generation`、`deleting`、`deletingAt`、`lastWriteAt`、昵称、头像、创建/更新时间。`ownerOpenid` 建唯一索引。
- **thoughts**：`_id`、`ownerOpenid`、主题字段、`status`、`versionCount`、`openCount`、创建/更新时间。聚合字段用于事务内分配版本号与状态计算。
- **records**：`_id`、`ownerOpenid`、`thoughtId`、`versionNo`、`clientRequestId`、登记字段、七步评估字段、`status`、`step`、创建/更新/收尾时间。

索引：`users(ownerOpenid)` 唯一；`thoughts(ownerOpenid,status,updatedAt)`、`thoughts(ownerOpenid,updatedAt)`；`records(ownerOpenid,status,createdAt)`、`records(ownerOpenid,createdAt)`；`records(thoughtId,versionNo)` 唯一。实际创建方式以云控制台当期能力为准，并通过并发验收证明约束有效。

### 2.6 云事务、幂等与检索

- `createRecord` 使用 `db.runTransaction`，先校验用户和代次，再执行上述用户文档写入和业务文档写入。
- 客户端每次快速登记生成 `clientRequestId`；云函数对 `OPENID + clientRequestId` 经 SHA-256 生成确定性的记录 `_id`。该值是记录幂等 ID，不是公开用户 ID。同一用户重试返回首次记录，不重复创建，也不增加版本计数。
- 新思虑的首个版本与思虑文档在同一事务创建；复发时锁定思虑文档、递增 `versionCount` 并生成唯一 `versionNo`。
- 新版本继承上一版评估字段，但重置 `closeConfirmations`，并独立进入登记流程。
- `closeRecord` 在事务中校验记录与思虑文档，更新 `closed`、`openCount` 和思虑状态。
- 版本数大于等于 3 为 `recurring`；不足 3 版且 `openCount=0` 为 `resolved`，否则为 `active`。
- 检索与统计按当前 `ownerOpenid` 分批读取后计算，必须遍历全部数据，不能假设只有前 20/100 条。

### 2.7 云模式部署与运维边界

- 需要真实 AppID、开通云开发、创建环境、配置 `CLOUD_ENV`、上传部署 `mindTrace`、创建集合/规则/索引，详细步骤见 [cloud-deployment.md](./cloud-deployment.md)。
- 不需要自建 API 域名、该域名的 ICP备案/HTTPS 证书或小程序 `request` 合法域名。
- 云函数错误率、耗时、数据库容量、套餐和用量需要监控；套餐与免费额度以控制台当期为准，不承诺固定免费。
- 按云控制台当期能力配置备份/导出并做恢复演练；日志、导出与告警不得包含思虑正文。
- `wx-server-sdk` 4.0.2 的间接依赖漏洞是已知风险：`npm audit` 仍报告 `axios/lodash.set/lodash.unset`，普通 `npm audit fix` 无法非破坏消除，不得 `--force` 降级。上线前复查官方更新并在真实云环境验证，不宣称 0 漏洞。
- Vue 管理端不读取云数据库；V1 不提供云模式管理端数据互通。

## 3. 保留的 HTTP 架构（Go + MySQL）

### 3.1 分层

```text
微信小程序（DATA_MODE=http）
                         │ HTTPS wx.request
                         ▼
Nginx / 腾讯云负载均衡（TLS 终止、限流、请求大小限制）
                         ▼
Go API（Gin + GORM，/api/v1）
  ├─ transport：HTTP 路由、JSON、JWT 鉴权、错误契约
  ├─ auth：jscode2session、用户/管理员角色
  ├─ domain：思虑点、登记版本、七步状态机、复发、统计
  └─ repository：事务、幂等、参数化查询、user_id 隔离
                         │ 私网 + TLS（按云数据库能力启用）
                         ▼
腾讯云 MySQL（users / thoughts / records）

Vue 3 + Vite 管理端（web/）
                         │ HTTPS /api/v1/admin/*
                         ▼
Go API 管理接口（独立管理员鉴权，不返回思虑正文）
```

HTTP 层不直接拼 SQL；领域逻辑与 Gin 路由、GORM 持久化分别组织，事务由服务层统一管理。除健康检查、用户登录和管理员登录外，请求携带 `Authorization: Bearer <token>`。用户身份只从 JWT 解析，禁止信任客户端传入的 `userId`。

### 3.2 HTTP 微信登录时序

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

1. Go 服务端通过 HTTPS 调用 `jscode2session`；`WECHAT_APP_ID`、`WECHAT_APP_SECRET` 只存在服务端。
2. 以 `openid` 查找或创建用户；`session_key` 不下发、不写日志。
3. 使用至少 32 字节的 `JWT_SECRET`，以 HS256 签发包含用户 ID、`role` 和过期时间的 JWT；有效期由 `JWT_TTL_HOURS` 控制。
4. `/me` 检查用户存在；`DELETE /me` 删除业务数据后，旧 JWT 因用户不存在而失效。
5. `AUTH_DEV_MODE=true` 仅允许 `APP_ENV=development`；生产必须为 `false`。
6. 管理员通过 `POST /admin/login` 和环境变量账号密码取得 `role=admin` JWT；用户令牌不能访问 `/admin/*`。

### 3.3 MySQL 数据模型

使用 InnoDB、`utf8mb4` 和 GORM 模型；主键为自增 `uint64`（MySQL `bigint unsigned`）。

**users**

| 字段 | 类型/约束 | 说明 |
|---|---|---|
| `id` | bigint unsigned PK | 内部用户 ID、JWT subject |
| `open_id` | varchar(64) NOT NULL UNIQUE | 微信用户标识 |
| `nickname` / `avatar_url` | varchar(100) / varchar(1024) | 可选资料 |
| `created_at` / `updated_at` | datetime | 创建与更新时间 |

**thoughts**

| 字段 | 类型/约束 | 说明 |
|---|---|---|
| `id` | bigint unsigned PK | 思虑点 ID |
| `user_id` | bigint unsigned NOT NULL，索引 | 数据归属 |
| `trigger_event` | varchar(100) NOT NULL | 首次触发事件、主题摘要 |
| `emotions` | json | 首次登记情绪 |
| `status` | varchar(16) NOT NULL | `active / resolved / recurring` |
| `created_at` / `updated_at` | datetime | 创建与更新时间 |

索引：`(user_id,status)`、`(user_id,created_at)`。版本计数、最近记录和当前进度通过 records 聚合。

**records**

| 字段 | 类型/约束 | 说明 |
|---|---|---|
| `id` | bigint unsigned PK | 登记版本 ID |
| `thought_id` / `user_id` | bigint unsigned NOT NULL | 思虑归属与用户隔离 |
| `client_request_id` | varchar(64) NULL | 客户端幂等键；`(user_id,client_request_id)` 唯一 |
| `version_no` | int NOT NULL | 思虑点内递增；`(thought_id,version_no)` 唯一 |
| `status` / `step` | varchar(16) / int | 四种版本状态；0–7 |
| `trigger_event` / `loop_thought` | varchar(100) / varchar(1000) | 快速登记正文 |
| `emotions` / `intensity` | json / int | 情绪标签与 1–10 强度 |
| `rumination_type` / `risk_content` / `probability` | 字符串 / text / int NULL | 第 1–3 步 |
| `controllable_actions` / `uncontrollable_items` | json | `[{text,done}]`、`[{text,crossedOut}]` |
| `scenario_worst` / `scenario_likely` / `scenario_best` | text | 第 6 步 |
| `close_confirmations` | json | 3 个布尔值 |
| `created_at` / `updated_at` / `closed_at` | datetime | 创建、保存、收尾时间 |

索引还包括 `(user_id,status)`、`(user_id,created_at)`。新增版本使用事务和思虑点行锁或等效机制；同一用户的 `clientRequestId` 重试返回首次结果，不同用户互不影响。思虑点删除级联删除记录。V1 使用无状态 JWT，不建立 sessions 表。

## 4. 两种模式共同的业务不变量

- cloud 以 `WXContext.OPENID + ownerOpenid` 做数据归属，以 `actorUserId` 做用户代次校验；HTTP 以 `JWT/user_id` 隔离。管理接口不返回思虑正文。
- 相似匹配仅提示；只有用户确认后才携带 `thoughtId` 创建新版本。
- 新版本继承评估字段、重置三项收尾确认，旧版本不变。
- 草稿保存不放宽收尾校验；`close` 校验必填项、平衡视角三栏及三项确认。
- 版本状态仅 `registered / evaluating / paused / closed`；思虑点状态仅 `active / resolved / recurring`。
- 应急叫停是本地独立工具，不新增版本状态。
- cloud 注销按 `deleting → 清理 → 删除用户` 执行，HTTP 注销删除当前用户业务数据；客户端清除身份、敏感缓存与离线队列。
- 两种模式返回结构、字段约束和产品状态一致；cloud 的 `ownerOpenid` 和原始代次字段不返回客户端。

## 5. 离线与同步

1. 用户提交时先写入本地 outbox，显示“已存本机，待同步”，不能冒充云端成功。
2. 每条 outbox 绑定 `ownerUserId + backendMode + backendEnv`，同时保存 `clientRequestId`、创建时间和同步状态；同一登记重试沿用同一个幂等键。
3. `ownerUserId` 是入队时公开用户 ID；cloud 包含 `${_id}:${generation}`，用于识别注销前后的不同代次。
4. `backendMode` 为 `cloud/http`；`backendEnv` 在 cloud 为 `CLOUD_ENV || 'default'`，HTTP 为 `API_BASE`。缺字段、用户/代次变化或后端变化均标记 `blocked`，保留本机数据并停止自动同步。
5. cloud 通过确定性记录 `_id` 幂等，HTTP 通过 `(user_id,client_request_id)` 唯一约束幂等；人工核对后使用同一 `clientRequestId` 重试可返回首次结果。
6. 网络结果未知或中断的条目标记 `uncertain`，不盲目自动重发；不得把 cloud 队列直接写入 MySQL，也不得反向写入。
7. 复发关联保存用户确认的 `thoughtId`；目标不可访问时保留原文并让用户重新选择，不改关联到其他主题。
8. 草稿以服务端成功响应为准；发现已收尾版本则停止自动保存，保留本地副本供查看。
9. 应急叫停完全本地运行；列表缓存不是权威数据源。
10. 两套云端数据不自动同步，模式切换不承担迁移、合并、去重或账号映射。

## 6. 备份、安全与隐私

### 6.1 cloud

- 数据库安全规则持续禁止客户端读写；云函数内再做 `ownerOpenid` 归属和 `actorUserId` 代次校验。
- 监控函数错误、耗时、用量和数据库容量；按控制台能力配置备份/导出并演练恢复。
- 云函数日志不得记录思虑正文、完整身份标识或敏感 payload。
- 云套餐、计费和免费额度以控制台当期为准；配置用量和费用提醒。
- Vue 管理端不得通过额外开放数据库规则来“支持”云模式。

### 6.2 HTTP

- 全链路 HTTPS；证书自动续期并监控到期；小程序配置 HTTPS `request` 合法域名，不使用 IP、端口或明文 HTTP。
- MySQL 不开放公网；安全组只允许 API 实例/子网访问 3306，应用账号最小权限，root 不用于服务连接。
- AppSecret、MySQL DSN、管理员密码和 `JWT_SECRET` 通过环境变量/密钥管理注入；`.env` 不入库。
- SQL 参数化、请求大小限制、登录限流、管理员登录 backoff、安全超时和统一错误响应。
- 开启 MySQL 自动备份与 binlog/时间点恢复；备份加密限权，每月至少一次隔离恢复演练并记录 RPO/RTO。

### 6.3 共同要求

情绪与心理相关记录按敏感个人信息最小化收集，隐私政策说明目的、方式、范围、保存期限和注销渠道。备份副本按公布策略到期清除。两种模式都不因技术架构不同而免除小程序主体、隐私、类目或审核义务。

## 7. 部署拓扑

### 7.1 cloud（默认）

```text
微信原生小程序（真实 AppID，DATA_MODE=cloud）
          │ wx.cloud.callFunction
          ▼
指定 CLOUD_ENV → 云函数 mindTrace → users / thoughts / records
          │                         └─ 禁止客户端直接读写
          ├─ 云日志 / 用量与错误告警
          └─ 控制台备份或导出 / 隔离恢复演练
```

无需 Nginx、CVM、Go、MySQL、API 域名或 Vue 管理端即可运行云模式核心小程序。云模式 V1 无管理端数据互通。

### 7.2 HTTP（可选，原部署方式完整保留）

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

- 可用根目录 `compose.yaml` 启动 MySQL 8.4、Go API 和 Vue 管理端，也可分环境手动部署。
- 首期可单台 CVM 运行 Nginx 与 Go API，MySQL 使用独立腾讯云数据库；不得让小程序直连 MySQL。
- Go 配置健康检查、优雅退出、连接池和资源限制；静态管理端与 API 可同源减少 CORS。
- 生产、测试使用不同数据库、AppID 配置和密钥；`AUTH_DEV_MODE=false` 是生产硬性条件。
- 发布采用兼容迁移先行、再滚动 API、最后发布小程序的顺序；数据库回滚与代码回滚分别预案化。
- 监控 5xx、P95、微信登录失败、DB 连接/慢查询/磁盘、备份、证书与服务存活。

任何新 action、端点、状态、筛选或幂等变化，必须先更新对应契约，再修改实现和客户端，避免两种模式分叉。
