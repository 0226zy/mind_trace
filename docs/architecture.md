# mind_trace 技术架构

> 「止念」当前包含一个微信原生小程序和两套互不自动同步的后端：默认微信云开发，以及保留的 Go API + MySQL + Vue 3 管理端。
>
> 本文说明系统边界、运行时分层、数据与安全、离线和扩容约束；代码文件级设计见 [code-design](./code-design.md)，字段级契约见 [cloud-api](./cloud-api.md) 与 [api-contract](./api-contract.md)。

## 1. 架构目标与边界

### 1.1 目标

- 同一套小程序页面和领域流程可切换 `cloud`／`http` 传输。
- 身份归属、用户隔离、幂等和收尾规则由服务端保证，不只依赖客户端。
- 网络失败不丢失本机内容，也不把未知结果误报为成功或盲目重复写入。
- 管理端只接触 HTTP 模式的聚合信息，不读取思虑正文。
- 默认 cloud 路径避免自建 API 域名，同时保留独立 HTTP 部署能力。

### 1.2 不包含的系统能力

当前没有消息队列、缓存层、独立全文检索服务、后台任务系统、多地域同步或两套后端之间的数据迁移。不得把扩容设计建立在这些未实现组件上。

### 1.3 双模式选择

| 维度 | `cloud`（默认） | `http`（保留） |
|---|---|---|
| 小程序传输 | `wx.cloud.callFunction` | `wx.request` |
| 服务端 | Node.js 云函数 `mindTrace` | Go 1.22、Gin、GORM |
| 存储 | 云数据库 `users/thoughts/records` | MySQL 8 `users/thoughts/records` |
| 用户身份 | `WXContext.OPENID` + 用户代次 | `jscode2session` + JWT |
| 管理端 | V1 无数据互通 | Vue 3 + Vite，仅聚合接口 |
| 部署依赖 | 微信云环境和数据库规则/索引 | HTTPS API、MySQL、静态管理端及合法域名 |

`DATA_MODE` 只改变后续请求去向，不迁移历史数据。cloud 环境由 `CLOUD_ENV` 标识，HTTP 环境由完整 `API_BASE` 标识；本机离线队列把二者纳入归属校验。

## 2. 总体结构与调用边界

```text
微信原生小程序 miniprogram/
  pages + components + utils
          │ 仅调用 services/api.js
          ▼
  services/request.js ───────────────┐
    ├─ cloud-transport.js            └─ 401 重登录与归属复核
    │      │ wx.cloud.callFunction
    │      ▼
    │  云函数 mindTrace → 云数据库
    │
    └─ wx.request → Go /api/v1 → MySQL
                           ↑
                 Vue 管理端 /admin/*
```

边界规则：

1. 页面不直接调用 `wx.cloud.database`，不连接 MySQL，也不自行拼装云事件。
2. `services/api.js` 提供统一的类 HTTP 门面；cloud 传输层将路径和方法映射成 action，因此页面无需分支。
3. 服务端是业务数据的权威来源；本机 storage 只承担登录缓存、草稿、离线 outbox 和应急计时。
4. Vue 管理端只调用 Go 的 `/api/v1/admin/*`，不读取云数据库，也没有用户正文接口。
5. 两种模式对外使用相同业务字段和状态；内部身份、ID 与事务机制可以不同。

## 3. 默认 cloud 运行时架构

### 3.1 组件

```text
miniprogram/cloudfunctions/mindTrace/
  index.js   云 SDK、action 分发、数据访问、事务与响应封装
  domain.js  纯领域校验、相似度、分页、状态、统计与公开模型
       │
       ▼
users / thoughts / records（全部带 ownerOpenid）
```

函数配置为 Node.js 18.15、256 MB、20 秒超时，`wx-server-sdk` 固定为 4.0.2，并通过 `DYNAMIC_CURRENT_ENV` 使用部署环境。三个集合的客户端安全规则均为 `read:false`、`write:false`，只有服务端 SDK 访问。

### 3.2 身份与公开 ID

- 微信身份只来自 `cloud.getWXContext().OPENID`，事件中的用户字段不能替代它。
- `users._id` 是 OPENID 的 SHA-256 派生值；用户另有随机 `generation`。
- 公开用户 ID 为 `${_id}:${generation}`。`login` 只携带 `{action,payload}`，其他 13 个 action 另带 `actorUserId`，并须完整匹配当前公开 ID。
- 普通业务要求用户存在且非 `deleting`；注销恢复只允许同代次。
- 公开返回移除 `ownerOpenid`、`_openid`、原始 `generation`、`deleting` 等内部字段，文档 `_id` 映射为 `id`。

代次机制用于阻止注销前的延迟请求或离线内容写入注销后的新账号，不是代替 OPENID 的认证机制。

### 3.3 数据与一致性

- `thoughts` 保存 `versionCount`、`openCount`、`latestRecordId` 等聚合元数据；`records` 保存每次版本全文。
- `createRecord` 在事务内复核用户和代次，并按文档 ID 读取思虑及最新版本。带 `clientRequestId` 时，以 `OPENID + clientRequestId` 的 SHA-256 派生记录 ID；已存在则返回首次结果。
- 新思虑及其首个版本、复发版本及思虑聚合更新在同一事务完成。新版本继承评估字段但重置三项确认。
- 真正创建前，事务先更新用户的 `lastWriteAt/updatedAt`，与注销的用户标记形成写—写冲突。
- `closeRecord` 按“先思虑、后记录”的顺序读取并更新，重新计算 `openCount` 和思虑状态；草稿保存不能直接关闭记录。
- 所有业务读取和写入都校验 `ownerOpenid`；客户端传入的 ID 不能扩大数据范围。

### 3.4 注销协议

```text
同事务：校验 actorUserId → deleting=true
   ↓（事务外，可重入）
分批读取并删除 records / thoughts
   ↓
同事务：复核 deleting 与 generation → 删除用户
```

`deleteMe` 可在部分失败后以同一 `actorUserId` 重试。登录遇到 `deleting` 用户也先恢复清理，再创建新代次；最终删除复核代次，防止迟到的清理误删新账号。多集合清理不是单个跨集合大事务，因此“可重入恢复”是必要组成部分。

### 3.5 查询方式

当前列表、首页、匹配、思虑库和统计通过每批 100 条、每批都带 `ownerOpenid` 的查询遍历当前用户数据，再在函数内筛选、聚合和分页。删除也采用分批读取和每轮最多 20 个并行删除。

这保证结果不停留在首批 100 条，但并不意味着数据库端分页或全文检索。`thoughtId/versionNo` 唯一索引用于版本约束；当前读取主要依赖 `ownerOpenid` 索引，新增组合查询时才需要按真实查询增加复合索引。

## 4. HTTP 运行时架构

### 4.1 Go 分层

```text
cmd/server       配置、MySQL 连接池、AutoMigrate、HTTP 超时与优雅退出
internal/api     Gin 路由、JSON、分页、鉴权、安全头、CORS、统一错误
internal/apperr  可预期业务错误
internal/service 用户/管理员鉴权、登记、思虑、匹配、统计、管理与校验
internal/models  GORM 模型、JSON 字段、外键和 CHECK 声明
migrations       MySQL 8 初始化 SQL
```

- HTTP 请求体限制为 1 MiB，拒绝未知字段和多个 JSON 对象；ID 必须为正 `uint64`。
- 用户和管理员使用不同 `role` 的 HS256 JWT。用户中间件还检查用户仍存在，因此注销后的旧 token 失效。
- 微信登录由服务端调用 `jscode2session`；AppSecret 只在服务端，错误不得泄漏带 Secret 的请求 URL。
- 除健康检查、微信登录和管理员登录外均使用 Bearer token；客户端不能指定数据归属用户。
- 服务本身无服务端会话状态，可在共享 MySQL 和相同密钥配置下部署多个实例。

### 4.2 MySQL 一致性

- 三张表使用 InnoDB、`utf8mb4`、自增 `uint64` 主键；外键级联删除，状态和数值范围有 CHECK。
- `(user_id,client_request_id)` 唯一保证用户范围内幂等；空键存 `NULL`，不限制无幂等键的普通登记。
- 创建复发版本时在事务内对思虑行 `FOR UPDATE`，再分配 `version_no`；`(thought_id,version_no)` 是第二道约束。
- 唯一键竞争失败者回滚后读取已提交赢家，返回首次结果，而不是把正常重试变成冲突。
- 新增和收尾共用思虑行锁及一致的重算规则，避免并发版本号或思虑状态互相覆盖。
- `DELETE /me` 在一个数据库事务中删除版本、思虑和用户。
- 服务启动执行 GORM AutoMigrate；生产可先审阅并执行 `migrations/001_init.sql`，再收窄应用账号 DDL 权限。

### 4.3 Vue 管理端

Vue SPA 通过 Vue Router 管理登录、概览和用户列表；管理员 token 保存在浏览器 `localStorage`。请求封装统一携带 Bearer token、解包 `{data}`，401 时清 token 并回登录页。

概览服务端当前返回总用户数、近 30 天活跃用户数、思虑数、记录数和已收尾数，不返回登记趋势；前端趋势区域因此显示空态，不生成模拟数据。用户列表只返回 ID、昵称、注册时间和计数。

## 5. 统一契约与错误边界

- 成功：`{data:...}`；业务失败：`{error:{code,message}}`。云函数还在错误对象中提供 `statusCode`，客户端传输层恢复为本地错误属性。
- 可预期错误使用 `INVALID_INPUT`、`UNAUTHORIZED`、`NOT_FOUND`、`CONFLICT` 等；未知异常统一为 `INTERNAL_ERROR`，不向客户端返回堆栈或数据库原文。
- HTTP 创建成功为 201，其余通常为 200；云调用以业务错误结构而非 HTTP 状态表达结果。
- 两套后端均限制分页 `pageSize<=100`、记录状态、思虑状态、文本长度和七步字段结构。
- 新增能力应先更新对应 API 契约，再同步修改两种服务端、统一门面、页面和测试，避免产品语义分叉。

## 6. 本机草稿与离线一致性

### 6.1 存储分类

| 内容 | 权威位置 | 本机职责 |
|---|---|---|
| 登录信息 | cloud 用户或 HTTP JWT | 缓存用户与 token；401 后重新登录 |
| 速记草稿 | 未提交前只在本机 | 输入即时保存，成功入队或创建后清除 |
| 快速登记 outbox | 创建成功后以服务端为准 | 网络失败时保存，记录同步状态和归属 |
| 七步草稿 | 服务端记录 + 本机副本 | 编辑即存本机，防抖保存；服务端成功才移除副本 |
| 应急计时 | 本机 | 保存结束时间或剩余时间，不写业务后端 |

### 6.2 outbox 归属与状态

每项绑定 `ownerUserId + backendMode + backendEnv + clientRequestId`。cloud 环境值为 `CLOUD_ENV || 'default'`，HTTP 为 `API_BASE`。

- 入队或登录后归属缺失、账号／代次变化、后端变化时标记 `blocked`，保留原文并禁止自动同步。
- 只有 `queued` 且归属一致的项目自动串行发送；成功后移除本机项。
- 网络错误可能发生在服务端提交之后，故标记 `uncertain`；进程在 `sending` 中中断也恢复成 `uncertain`。
- 非网络业务失败为 `failed`；`failed/uncertain/blocked` 只能由用户查看并处理。
- 人工核对后重试沿用相同 `clientRequestId`，依靠服务端幂等返回首次结果。队列不会跨 cloud 环境、API 地址或用户重放。

评估草稿和 outbox 是不同机制：评估草稿不自动创建记录，也不支持离线调用服务端收尾。

## 7. 性能与扩容

### 7.1 cloud

云函数可按平台能力随调用扩展，但单次调用的数据量、20 秒超时、256 MB 内存、数据库读取次数和费用是现实边界。

- `dashboard/matchThoughts/listThoughts/getThought/stats` 会读取当前用户较多或全部数据；列表分页发生在内存中，不能靠增大 `pageSize` 解决全量读取成本。
- 用户数据增长会同时增加执行时长、内存和数据库读取费用。应先基于真实用量监控和索引评估，再调整查询边界；不能把现有实现描述为无限水平扩展。
- 创建与关闭使用短事务和文档 ID 访问，避免事务中全表扫描；聚合元数据必须与业务写入保持同一事务。
- 注销的批量读写刻意放在事务外，以可重入清理换取可恢复性；大数据量注销需要关注耗时和失败重试。

### 7.2 HTTP

Go API 不保存用户会话，可在负载均衡后横向增加实例，但需共享 MySQL、相同 JWT 配置和一致的迁移版本。

- 每实例数据库连接池当前最大打开 25、最大空闲 10、连接最长存活 30 分钟；实例数增加会放大 MySQL 总连接需求，必须按数据库上限整体预算。
- `Match` 当前读取用户全部思虑和版本后内存计算；数据增长时应基于实际慢查询优化，而非宣称已有专用搜索引擎。
- 思虑库文本查询使用 `LIKE` 和相关子查询，情绪使用 MySQL JSON；统计使用 `JSON_TABLE` 和分组。现有索引覆盖用户、状态和创建时间，不自动解决所有关键词或聚合成本。
- MySQL 是唯一强一致存储。实例扩展不能替代数据库 CPU、IOPS、连接、锁竞争、慢查询和容量治理；思虑行锁会串行化同一主题的并发创建与收尾。
- 当前无应用缓存和队列；新增这些组件会改变一致性与运维语义，需另行设计，不属于 V1 已交付能力。

## 8. 安全、隐私与可靠性

### 8.1 共同底线

- 思虑及心理相关内容按敏感个人信息最小化收集；隐私政策、保存期限、注销与备份删除策略需在发布时落实。
- 日志不得记录正文、完整身份标识、AppSecret、`session_key`、token 或数据库密码；备份和导出同等限权。
- 测试、预发、生产使用不同数据环境和凭据；真实 AppID、类目、隐私和审核是两种模式共同要求。

### 8.2 cloud

- 持续禁止客户端直接读写集合，服务端继续做归属与代次校验。
- 监控函数错误、耗时、内存、数据库容量、读取量和费用；按控制台能力备份/导出并做隔离恢复演练。
- `wx-server-sdk` 4.0.2 的 `npm audit` 仍报告间接依赖 `axios/lodash.set/lodash.unset` 风险。不得宣称 0 漏洞，也不得用 `--force` 做破坏性降级；上线前复查官方更新并在真实云环境验证。

### 8.3 HTTP

- 正式环境全链路 HTTPS，小程序配置合法域名；MySQL 只在私网开放给 API，应用账号最小权限。
- 密钥通过环境变量或密钥管理注入；`JWT_SECRET` 至少 32 字节，生产禁止 `AUTH_DEV_MODE=true`。
- Gin 设置安全响应头、CORS 白名单、请求与读写超时；部署边界还应配置登录限流和管理员 backoff，这些不是当前 Go 代码内置能力。
- 开启 MySQL 自动备份及 binlog/时间点恢复，定期隔离恢复演练并记录 RPO/RTO。
- 静态管理端与 API 可同源部署以减少 CORS；token 位于 `localStorage`，任何前端依赖和 XSS 修复都直接影响管理员会话安全。

## 9. 部署拓扑与发布约束

### 9.1 cloud

```text
真实 AppID 小程序 → 指定 CLOUD_ENV → mindTrace → users/thoughts/records
                                        ├─ 日志、错误与用量监控
                                        └─ 控制台备份或导出
```

无需 Go、MySQL、Nginx、API 域名或 Vue 即可运行核心小程序。仍需部署函数、建立集合/规则/索引并完成真机与体验版验收，详见 [cloud-deployment](./cloud-deployment.md)。

### 9.2 HTTP

```text
小程序 ── HTTPS ─┐
                 ├─ 负载均衡 / Nginx ─ Go API（可多实例）─ 私网 MySQL
管理员 ─ HTTPS ──┘        └─ Vue 静态站点
```

根目录 `compose.yaml` 提供 MySQL 8.4、Go API 和 Vue 的本地/单机构建编排；它不是多实例或高可用部署。生产应限制端口暴露、分离环境、配置证书与监控。

发布数据库变更时先执行向后兼容迁移，再滚动 API，最后发布小程序；数据库回滚和代码回滚分别准备。通用与分模式验收见 [release-checklist](./release-checklist.md)。
