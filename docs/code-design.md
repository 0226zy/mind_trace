# mind_trace 代码设计

> 本文对应当前仓库实现，面向需要修改代码的开发者。产品语义见 [product-design](./product-design.md)，系统约束见 [architecture](./architecture.md)，完整字段和 HTTP 状态见 [cloud-api](./cloud-api.md) 与 [api-contract](./api-contract.md)。
>
> 项目使用原生 JavaScript 小程序、Node.js 云函数、Go 1.22 和 Vue 3 JavaScript；没有 TypeScript、跨端小程序框架、前端状态库或独立 repository 层。

## 1. 仓库结构与依赖方向

```text
mind_trace/
├─ miniprogram/
│  ├─ app.js / app.json / app.wxss / config.js
│  ├─ pages/
│  │  ├─ now/                 # 此刻
│  │  ├─ process/             # 服务端处理队列 + 本机 outbox
│  │  ├─ library/             # 思虑库
│  │  ├─ evaluate/            # 七步评估
│  │  ├─ thought-detail/      # 版本时间线
│  │  ├─ local-record/        # 单条本机登记
│  │  ├─ emergency/           # 本地应急工具
│  │  ├─ stats/               # 用户统计
│  │  └─ profile/             # 账号、隐私与注销
│  ├─ components/quick-note/  # 速记、匹配、创建、离线保存
│  ├─ components/state-view/  # 加载／错误／空态
│  ├─ services/               # API、认证、双传输、请求与同步
│  ├─ utils/                  # 校验、格式化、归属与离线纯函数
│  ├─ cloudfunctions/mindTrace/
│  │  ├─ index.js             # 云入口、数据访问与事务
│  │  ├─ domain.js            # 无云 SDK 的领域纯函数
│  │  └─ test/domain.test.js
│  ├─ tests/run.js
│  └─ scripts/check-syntax.js
├─ server/
│  ├─ cmd/server/main.go
│  ├─ internal/api/           # Gin transport
│  ├─ internal/apperr/        # 业务错误类型
│  ├─ internal/config/        # 环境变量与启动校验
│  ├─ internal/models/        # GORM 模型与 JSON Scanner/Valuer
│  ├─ internal/service/       # 鉴权、事务与领域服务
│  └─ migrations/            # 001 初始化；002 允许 intensity 为空
├─ web/src/
│  ├─ api/                    # fetch 与管理端接口
│  ├─ components/             # 指标卡、趋势图、状态块
│  ├─ layouts/                # 管理端框架
│  ├─ router/                 # 路由与登录守卫
│  ├─ stores/                 # 管理员 token
│  ├─ utils/                  # 展示归一化
│  └─ views/                  # 登录、概览、用户列表
├─ compose.yaml               # MySQL + Go + Vue 编排
├─ Makefile                   # 测试、构建、小程序编译入口
└─ .github/workflows/ci.yml
```

依赖方向应保持：

```text
小程序 pages/components → services/api → request → cloud/http transport
小程序 services/utils 不反向依赖 pages
云函数 index → domain；domain 不引入 wx-server-sdk
Go cmd → api → service → models/apperr；service 不依赖 Gin
Vue views → api/stores/utils/components；api 不依赖 views
```

云函数 `index.js` 和 Go `service` 都直接包含数据访问逻辑，当前没有独立 ORM repository 接口，也没有让两种后端共享运行时代码。

## 2. 小程序启动、配置与页面

### 2.1 `app.js` 与全局状态

`globalData` 包含：

```js
{ user: null, networkConnected: true, deletionEpoch: 0, initializationError: '' }
```

启动顺序：

1. cloud 模式调用 `initializeCloud(wx, CLOUD_ENV)`；不支持云开发时记录初始化错误并提示。
2. `sync.recoverInterruptedQueue()` 把上次遗留的 `sending` 改为 `uncertain`。
3. `loginInBackground()` 调用 `auth.ensureLogin()`，随后核对队列归属并检查可同步项目。
4. 读取网络类型，监听网络变化；恢复连接时触发 `flushQueue()`。

`deletionEpoch` 只在当前进程递增。注销后，“此刻”的 `onShow` 比较组件代次，调用速记组件的 `resetSensitiveData()`，避免异步返回重新展示旧敏感内容。

### 2.2 `app.json` 与导航

注册 9 个页面；TabBar 固定为：

- `pages/now/index`：此刻；
- `pages/process/index`：处理；
- `pages/library/index`：思虑库。

其他页面使用 `navigateTo` 进入。Tab 页面使用 `switchTab`，本机登记同步成功后用 `redirectTo` 进入评估。`lazyCodeLoading` 为 `requiredComponents`。

### 2.3 `config.js`

```js
{
  DATA_MODE: 'cloud',
  CLOUD_ENV: '',
  CLOUD_FUNCTION_NAME: 'mindTrace',
  API_BASE: 'https://your-api.example.com/api/v1',
  REQUEST_TIMEOUT: 12000,
  QUICK_DRAFT_KEY: 'mind_trace_quick_draft_v1',
  OFFLINE_QUEUE_KEY: 'mind_trace_offline_records_v1',
  EVALUATION_DRAFT_PREFIX: 'mind_trace_evaluation_draft_v1_'
}
```

`REQUEST_TIMEOUT` 只用于 HTTP；云函数自身超时在云端 `config.json`。本地 key 修改会影响已有草稿或队列的可见性，发布时不能随意改名。

### 2.4 页面职责

| 文件 | 关键状态／方法 | 实现要点 |
|---|---|---|
| `pages/now/index.js` | `loadDashboard/openQuick/evaluateNow` | 每次 `onShow` 刷新 dashboard 并检查速记删除代次；主页只展示今日与待办计数 |
| `pages/process/index.js` | `load/filterRecords/refreshOffline/syncNow` | 请求 `page=1,pageSize=100`；待处理按强度排序，已收尾按时间排序；顶部单独呈现 outbox |
| `pages/library/index.js` | `load/applyLocalFilters` | 服务端处理 `query/status/emotion/page`；时间和 `versionCount>=3` 只过滤已加载项目 |
| `pages/evaluate/index.js` | `loadRecord/scheduleSave/saveRemote/next/pauseRecord/closeRecord` | 表单与 record 双向映射；本地即时保存、1.4 秒防抖；串行化远程保存；关闭前检查全部步骤 |
| `pages/thought-detail/index.js` | `load/toggleVersion/openEvaluation` | `getThought` 返回思虑和倒序版本；归一化后默认展开最新版本 |
| `pages/local-record/index.js` | `loadItem/retrySync/removeLocal` | 每次显示时重新校验账号和后端；`uncertain` 需确认；成功后可进入评估 |
| `pages/emergency/index.js` | 感官步骤、`start/pause/resetTimer` | 无 API 依赖；计时 storage key 为 `mind_trace_emergency_timer_v1`，按 `endsAt` 恢复 |
| `pages/stats/index.js` | `load` | 将对象或数组形式的情绪计数归一化，计算条形宽度；趋势只渲染接口已返回日期 |
| `pages/profile/index.js` | `load/deleteAll` | 输入“删除全部数据”后调用 `deleteMe`；成功才清 session、`wx.clearStorageSync()` 并递增代次 |

页面共同通过 `state-view` 表达 `loading/error/empty`。页面不能引入 `wx-server-sdk`、直接查询云集合或拼接 SQL。

## 3. 小程序组件与工具函数

### 3.1 `components/quick-note`

组件属性只有 `visible`，声明 `styleIsolation: shared` 以受控共享全局按钮和排版样式；内部阶段为：

```text
edit → matching → match（有候选或可跳过匹配）→ saving → details → complete
                  └──────── 网络失败 → 本机 outbox → details
```

`edit` 只包含一个正文 `textarea`；`details` 在正文创建或入队后补充情绪与强度；`complete` 才显示评估、返回和应急操作。主要方法：

- `persistDraft()`：仅编辑阶段且代次有效时写速记草稿。
- `submit()`：先校验单正文，再确保登录并仅以该正文调用 `matchThoughts`。
- `chooseSimilar(event)`：从 `item.thought.id/_id` 取 `thoughtId`。
- `chooseNew()`：不传 `thoughtId`。
- `createRecord(thoughtId)`：通过 `buildQuickPayload` 生成短标题、完整正文、空情绪、空强度和持久 `clientRequestId` 并创建。
- `saveOffline(existingPayload)`：网络失败入队；若创建阶段已经生成 ID，必须沿用。
- `showSuccess()`：清除速记草稿、保留本次结果并进入 `details`，同时发出 `saved` 刷新 dashboard。
- `saveDetails()`：在线调用 `saveRecordDetails`；离线通过 `updateQueuedDetails` 只修改仍为 `queued` 的 payload，不改变幂等 ID或归属。
- `resetAfterSaved()`：用户离开补充或完成阶段后清空本次表单与结果。
- `resetSensitiveData(epoch)`：注销代次变化时清空表单、结果、候选、错误和草稿。

父组件事件为 `close`、`saved`、`evaluate`、`emergency`。`saved.detail` 包含 `{result,offlineSaved}`；`evaluate.detail.id` 是服务端记录 ID。

### 3.2 `components/state-view`

接收 `loading/loadingText/error/empty/emptyTitle/emptyText`，错误重试通过 `retry` 事件交给页面。组件不自行请求数据。

### 3.3 `utils` 模块

| 文件 | 导出／职责 |
|---|---|
| `validate.js` | `validateQuick` 只校验单正文；`evaluationStepError(step,form)`、`buildEvaluationPayload(form,step)` 处理七步字段 |
| `format.js` | 情绪枚举、状态中文、`normalizeRecord/Thought/ThoughtDetail`、趋势和百分比；兼容 `id/_id` 等响应形态 |
| `offline.js` | 创建 `clientRequestId`，队列增改删，`canAutoSync`；`withQueuedDetails` 仅允许修改 queued 项且不直接访问 storage |
| `ownership.js` | `getUserId`、`ownershipBlock`、`reconcileQueueOwnership`；阻止缺归属、跨账号和跨后端 |
| `backend.js` | `getBackendContext(config)`、`sameBackend`；cloud 默认环境规范化为 `default` |
| `data-mode.js` | 只接受 `cloud/http`，选择对应传输，配置错误快速失败 |
| `quick-state.js` | 空表单、`buildQuickPayload` 单正文载荷构造和删除代次重置对象，统一在线与离线创建语义 |

`format.js` 的归一化只用于展示，不替代服务端字段约束，也不应成为持久化新数据模型的手段。

## 4. 统一 API、认证与传输

### 4.1 `services/api.js` 门面

页面可见的方法及映射如下：

| 方法 | HTTP | cloud action |
|---|---|---|
| `me()` | `GET /me` | `me` |
| `deleteMe()` | `DELETE /me` | `deleteMe` |
| `dashboard()` | `GET /dashboard` | `dashboard` |
| `matchThoughts(text)` | `POST /thoughts/match` | `matchThoughts` |
| `createRecord(payload,options)` | `POST /records` | `createRecord` |
| `records(params)` | `GET /records` | `listRecords` |
| `record(id)` | `GET /records/:id` | `getRecord` |
| `saveEvaluation(id,payload)` | `PATCH /records/:id` | `patchRecord` |
| `saveRecordDetails(id,payload)` | `PATCH /records/:id` | `patchRecord` |
| `closeRecord(id)` | `POST /records/:id/close` | `closeRecord` |
| `pauseRecord(id)` | `POST /records/:id/pause` | `pauseRecord` |
| `thoughts(params)` | `GET /thoughts` | `listThoughts` |
| `thought(id)` | `GET /thoughts/:id` | `getThought` |
| `stats()` | `GET /stats/summary` | `stats` |

加上 `auth.ensureLogin()` 内部使用的 `login`，cloud 总计 14 个 action：`login、me、deleteMe、dashboard、matchThoughts、createRecord、listRecords、getRecord、patchRecord、closeRecord、pauseRecord、listThoughts、getThought、stats`。

### 4.2 `services/request.js`

- `rawHttpRequest`：拼接 `API_BASE + path`，设置 JSON、12 秒超时和可选 Bearer token；2xx 解包 `data`，非 2xx 保留 `statusCode/code`，传输失败标记 `network=true`。
- `rawRequest`：通过 `selectTransport` 选择 cloud 或 HTTP。
- `request`：发起前核对预期用户和后端；401 且非匿名请求时强制登录一次，复核归属未变后只重试一次。
- `createRecord` 可传 `expectedOwnerUserId/expectedBackend`，防止异步期间账号或环境变化后仍发送。

`request.raw` 用于认证流程，避免登录自身触发递归重登录。

### 4.3 `services/auth.js`

模块级 `loginPromise` 合并并发登录：

```text
cloud：有缓存用户时先匿名 raw /me；401 再 login，否则直接 login
http：有 token 且不强制时直接使用缓存；否则 wx.login → /auth/wechat/login
```

`completeLogin` 校验用户 ID，HTTP 必须取得 token；随后写 `mind_trace_user`，cloud 删除旧 token，并立即 `reconcileAccount`。`clearSession` 只清身份 key；完整注销由页面额外清理其他本地数据。

### 4.4 `services/cloud-transport.js`

`mapCloudAction(path,method,data)` 解析路径、query 和 path 参数，query 的 `page/pageSize` 转数字。`attachActorUserId` 只从缓存用户取公开 ID：

```js
login:     { action, payload }
其他action: { action, payload, actorUserId? } // 服务端要求必须存在且匹配
```

`unwrapCloudResult` 支持 `response.result` 或直接 result；成功解包 `data`，业务错误转换为带 `statusCode/code` 的异常。调用失败或 SDK 不可用统一标记 `network=true`，保留 `originalError` 供调试，不向页面暴露堆栈。

## 5. 本机 outbox 设计

### 5.1 条目结构

```js
{
  clientRequestId,
  ownerUserId,
  backendMode,               // cloud | http
  backendEnv,                // CLOUD_ENV || 'default'，或 API_BASE
  payload,                   // createRecord 入参，含相同 clientRequestId
  syncState,                 // queued | sending | uncertain | failed | blocked
  blockReason,               // ownerMissing/accountUnknown/accountChanged/...
  createdAt,
  errorMessage
}
```

`ownerUserId` 是入队时公开用户 ID；cloud 中包含代次。storage 不是加密数据库，敏感正文只在产品所需草稿和 outbox 中保存，注销成功后统一清除。

### 5.2 `services/sync.js`

- `enqueue`：补齐 ID、归属、payload 和状态，按 `clientRequestId` 去重写入。
- `syncItem`：每次重新读取最新条目并复核归属；先标 `sending`，成功后移除。
- 网络错误标 `uncertain`，非网络错误标 `failed`，归属错误标 `blocked`。
- `flushQueue`：模块级 `flushing` 合并并发调用；按队列顺序串行，只发送 `canAutoSync` 的条目，首个失败后停止本轮。
- `reconcileAccount`：登录或 flush 前重新计算阻断状态，不删除旧记录。
- `recoverInterruptedQueue`：仅把 `sending` 改为 `uncertain`，不直接重发。

状态机：

```text
queued ─发送→ sending ─成功→ 移除
  │               ├─网络/中断→ uncertain ─人工确认→ sending
  │               └─业务失败→ failed ─人工重试→ sending
  └─归属异常→ blocked（保留，不自动转移）
```

## 6. 云函数代码设计

### 6.1 运行配置与职责划分

`config.json`：Nodejs18.15、256 MB、20 秒、无 OpenAPI 权限。`database.rules.json` 禁止客户端读写。`package.json` 固定 `wx-server-sdk` 4.0.2，测试只用 Node 内置测试器。

`domain.js` 不依赖云 SDK，负责：

- `AppError` 与 `badRequest/conflict/notFound`；
- 用户代次、公开用户模型和字段白名单；
- 登记、列表、匹配、草稿和收尾校验；
- 思虑状态、版本继承、相似度、内存分页；
- 思虑列表、匹配和统计的纯数据组装。

`index.js` 负责云初始化、OPENID、action 白名单、文档 IO、事务、注销和错误封装。修改校验时应优先在 `domain.js` 写可独立测试的纯函数，事务与数据库错误留在 `index.js`。

### 6.2 关键数据访问函数

| 函数 | 作用 |
|---|---|
| `userID(openid)` | `u_` + SHA-256(openid)，仅内部用户文档 ID |
| `deterministicRecordID(openid,clientRequestId)` | `r_` + SHA-256(openid + 分隔符 + 幂等键) |
| `getDocument/getOwnedDocument` | 按 ID 读取；后者额外要求 `ownerOpenid===openid` |
| `requireUser` | 用户必须活跃且 `actorUserId` 完整匹配 `${_id}:${generation}` |
| `fetchAll(collection,openid)` | 每批 100 条，重复归属条件，直到读完 |
| `publicUser/publicDoc` | 移除内部身份和聚合字段，`_id` 转 `id` |
| `cleanupDeletingUser/finalizeUserDeletion` | 可重入批量清理与代次复核删除 |

`publicDoc` 还移除 `openCount/latestRecordId`，但保留 `versionCount`；`publicUser` 不返回 `generation/deleting/deletingAt/ownerOpenid`。

### 6.3 action 分发

入口先验证 `ACTIONS` 白名单，再从 `cloud.getWXContext()` 取 OPENID。`login` 直接进入登录；`deleteMe` 允许删除中用户但仍校验代次；其余 action 先 `requireUser` 再执行。

空 payload 的 action 必须传 `{}` 且拒绝未知字段。列表 `page` 从 1 开始，`pageSize` 为 1–100。业务错误返回：

```js
{ error: { code, message, statusCode } }
```

未知异常仅记录服务端错误并返回 `INTERNAL_ERROR/service unavailable/500`。

### 6.4 登记、复发与状态

`createRecord` 的事务要点：

```text
生成确定性或随机 recordId
→ requireUser
→ 同 recordId 已存在：返回其 thought + record
→ 新主题：准备 thought；旧主题：读取 thought 与 latestRecord
→ 组装 registered/step=0 新 record，复发时继承评估
→ 更新用户 lastWriteAt（在业务写入前）
→ 写 record，创建或更新 thought
```

思虑更新同时维护 `versionCount/openCount/latestRecordId/status/triggerEvent/emotions/updatedAt`。事务中不用多记录查询，依赖文档 ID 和聚合元数据。

`closeRecord` 先从事务外快照取得 `thoughtId`，事务内再按思虑、记录顺序读取并复核；校验 `openCount` 和完整七步，减一并重算状态。`patchRecord` 和 `pauseRecord` 均拒绝已关闭版本，普通 patch 不允许 `status=closed`。

### 6.5 查询、匹配与统计

- `listRecords`：读取全部 records，按状态过滤、`createdAt` 倒序，再内存分页。
- `listThoughts`：读取全部 thoughts 和 records，组合最新版本与计数，再筛选、排序和分页。
- `getThought`：按 ID 和归属读取思虑，再从当前用户全部 records 中筛版本。
- `matchThoughts`：Sørensen–Dice；token 为中文连续二元字符（单字保留）及英文／数字词，阈值 `>=0.15`，最多 20 条。cloud 候选文本包含风险内容。
- `buildStats`：总记录、关闭率、至少 3 版的主题数、思虑点当前情绪计数，以及近 30 天有记录日期的平均强度。
- `dashboard` 也读取全部 records/thoughts 后计数，不是数据库聚合查询。

## 7. Go 服务代码设计

### 7.1 启动与配置

`cmd/server/main.go`：

1. 可选加载 `.env`，`config.Load()` 校验必要配置。
2. 打开 GORM MySQL，日志级别为 Warn。
3. 连接池：最大打开 25、最大空闲 10、连接存活 30 分钟；10 秒内 Ping 和 AutoMigrate。
4. 创建 `http.Server`：`ReadHeaderTimeout=5s`、`ReadTimeout=15s`、`WriteTimeout=30s`、`IdleTimeout=60s`。
5. 接收 SIGINT/SIGTERM 后 10 秒优雅关闭并关闭连接池。

`config.Load` 强制 `MYSQL_DSN`、至少 32 字节 JWT Secret、JWT TTL 1–720 小时；开发登录只允许 `APP_ENV=development`；管理员账号密码必须成对出现；关闭开发登录时强制微信 AppID/Secret。

### 7.2 `internal/api`

- `router.go`：组装服务、路由和中间件；`/health` 与 `/api/v1/health` 公开。
- `handlers.go`：只负责 decode、路径／分页参数、调用 service 和输出，不放领域事务。
- `decodeJSON`：1 MiB 上限、未知字段拒绝、只允许一个 JSON 对象。
- `middleware.go`：Bearer 解析、角色检查、用户存在检查；安全响应头和 CORS；OPTIONS 返回 204。
- `response.go`：统一 `{data}` 与 `{error}`；GORM 未找到转 404，未知错误记录服务端日志并返回通用 500。
- `apperr/errors.go`：400 `INVALID_INPUT`、401 `UNAUTHORIZED`、404 `NOT_FOUND`、409 `CONFLICT`。

主要路由组：

```text
公开：POST /auth/wechat/login，POST /admin/login
用户：/me、/dashboard、/records*、/thoughts*、/stats/summary
管理：GET /admin/overview，GET /admin/users
```

### 7.3 `internal/models`

- `User`：`OpenID` 不序列化，关联 Thoughts/Records 级联删除。
- `Thought`：`UserID` 不序列化；状态、用户索引与 Records 关联。
- `Record`：`UserID` 不序列化；包含可选 `ClientRequestID`、版本号和全部七步字段。
- `Emotions/Actions/UncontrollableItems/Confirmations` 实现 `driver.Valuer` 和 `sql.Scanner`，在 MySQL JSON 与 Go 类型之间转换。

模型标签声明唯一键、外键、状态及范围 CHECK；`Record.Intensity` 为 `*int`，区分未补充的 `null` 与合法数值。`migrations/001_init.sql` 用于 MySQL 8 新装，`002_allow_null_intensity.sql` 保留旧数据并升级既有库。修改模型必须同步迁移与 `migration_test.go`，不能只改其中一个。

### 7.4 service 模块

| 文件 | 职责与关键约束 |
|---|---|
| `auth.go` | 微信 code 交换、用户查找/创建、资料更新、JWT HS256 与角色；管理员常数时间比较；微信客户端超时 8 秒、响应上限 64 KiB |
| `idempotency.go` | 规范化可选幂等键；识别 MySQL 1062；提交后重试与并发唯一键竞争回查 |
| `records.go` | 创建、分页、详情、草稿、关闭、搁置；事务、归属条件和思虑行锁 |
| `thought_state.go` | 3 版复发阈值、思虑状态重算、评估继承且重置确认 |
| `thoughts.go` | 思虑列表/详情、匹配、dashboard、用户统计和事务注销 |
| `similarity.go` | 中文二元字符与拉丁／数字词的 Dice 相似度 |
| `validation.go` | Unicode 文本长度、分页、状态、行动数组和关闭完整性 |
| `admin.go` | 聚合计数与用户分页；查询结果不包含正文 |

Go 与 cloud 的匹配主体相同，但当前 Go `Match` 的候选文本是思虑主题及各版“触发事件 + 循环念头”，cloud 还纳入各版风险内容；修改相似度语义时需明确是否对齐这一差异并同步测试和契约。

### 7.5 Go 事务与查询要点

`RecordService.Create`：

- 新主题创建 Thought；已有主题使用 `clause.Locking{Strength:"UPDATE"}` 锁定且必须属于当前用户。
- 从最新版本分配 `versionNo+1`，继承评估；Record 初始 `registered/step=0`。
- 创建后 `recalculateThoughtStatus`；带幂等键时提交后重新读取，首次与重试返回数据库规范化后的同一结果。
- `executeIdempotent` 只恢复唯一键竞争，不能吞掉连接错误或其他写入失败。

`Close` 在事务外先取 `thoughtId`，事务内先锁 Thought 再锁 Record，与创建保持一致顺序；`Patch` 锁 Record 且禁止修改已关闭版本。`Pause` 用带 `status<>'closed'` 的条件更新，并区分未找到与已关闭。

`ThoughtService.List` 使用参数化 `LIKE`、`EXISTS` 和 `JSON_CONTAINS`，转义 `%_\\`；`Stats` 使用 MySQL `JSON_TABLE`、日期分组和近 30 天平均值，因此不能用 SQLite 代替真实 MySQL 做集成验证。

## 8. Vue 管理端代码设计

### 8.1 模块

| 模块 | 实现 |
|---|---|
| `stores/auth.js` | `reactive({token})`，持久化 key 为 `mind_trace_admin_token` |
| `api/request.js` | 基于 fetch；Base URL 去尾斜杠；Bearer；网络、非 JSON、401、业务错误统一为 `ApiError` |
| `api/admin.js` | `login/getOverview/getUsers(page,pageSize=10)` |
| `router/index.js` | `/login` 公开；`/` 重定向 `/overview`；布局下另有 `/users`；守卫检查 token |
| `layouts/AdminLayout.vue` | 桌面侧栏、移动导航、退出登录 |
| `views/LoginView.vue` | 提交管理员凭据；只允许以 `/` 开头的回跳地址 |
| `views/OverviewView.vue` | 指标卡、趋势空态和收尾占比；刷新失败有旧数据时保留旧数据并提示 |
| `views/UsersView.vue` | 分页与每页 10/20/50；`requestId` 防止旧响应覆盖新页 |
| `utils/overview.js` | 兼容指标别名、趋势字段；无数据返回空，不造数 |
| `components/*` | `StatCard` 展示指标，`TrendChart` 生成 SVG 点线，`StateBlock` 统一状态 |

当前 Go 概览不返回趋势，但返回 `activeUsers30d`；概览页展示注册、思虑、记录、收尾四项和收尾占比，趋势区域为空态。管理端没有用户详情、正文查看、编辑或删除路由。

### 8.2 构建与代理

`vite.config.js` 的开发服务器监听 `0.0.0.0`，将 `/api` 代理到 `VITE_API_PROXY_TARGET`（默认 `http://localhost:8080`）。`VITE_API_BASE_URL` 默认同源 `/api/v1`，构建时固化，不能放秘密。生产 Docker 由 Nginx 托管 SPA 并代理 `/api/`。

## 9. 核心代码级时序

### 9.1 快速登记

```text
quick-note.submit
  → validateQuick（仅单正文）
  → auth.ensureLogin
  → api.matchThoughts → request → cloud/http
  → 用户选择 thoughtId 或新主题
  → buildQuickPayload（短标题 + 完整正文 + emotions:[] + intensity:null + clientRequestId）
  → createRecord(payload)
       ├─ 成功：清速记草稿 → details → 刷新 dashboard
       └─ network：sync.enqueue（保留同一 clientRequestId）→ details(offlineSaved)

details → saveDetails
       ├─ 在线：saveRecordDetails → PATCH emotions/intensity → complete
       ├─ queued 离线项：updateQueuedDetails（同幂等 ID）→ complete
       └─ sending/uncertain：拒绝覆盖并保留提示
```

关键不变量：匹配不自动关联；只有网络错误走 outbox；离线成功不伪装成服务端记录；补充失败不否认正文已保存；注销代次变化后忽略旧异步结果。

### 9.2 七步草稿与收尾

```text
输入 → saveLocal 立即执行 → 1.4s 防抖 → saveRemote
                                  ├─ 成功：删除该 record 的本机草稿
                                  └─ 失败：保留草稿，可继续编辑

关闭 → 客户端逐步校验 1..7 → 等待当前远程保存
     → saveRemote(7) → api.closeRecord
     → 服务端重新读取并校验完整 record
     → 事务关闭 record + 重算 thought
     → 清草稿 → 3 秒反馈 → completed
```

`remoteSaving/remoteDirty` 防止并发 PATCH 乱序覆盖；远程保存期间的新编辑会再触发一次保存。关闭等待有上限，仍保存中则要求稍后重试。

### 9.3 复发创建

```text
用户确认 thoughtId
→ 服务端在事务内验证思虑属于当前用户
→ cloud：读取 versionCount/openCount/latestRecordId
   HTTP：FOR UPDATE 锁 thought，读取最新 record
→ 新 record.versionNo = previous.versionNo + 1
→ 继承七步内容，step=0，status=registered，confirmations=[false,false,false]
→ 写 record 和 thought 聚合
→ 提交；同 clientRequestId 重试返回首次结果
```

旧版本不更新为新版内容；达到 3 版后状态为 `recurring`，即使后续全部关闭也保持。

### 9.4 注销

```text
profile.deleteAll → api.deleteMe

cloud：标 deleting（同事务校验代次）
      → 分批清 records/thoughts（事务外）
      → 同代次复核后删用户；失败可用同 actorUserId 重入
HTTP ：单事务删除 records → thoughts → user

仅成功返回后：
→ deletionEpoch+1 → clearSession → wx.clearStorageSync
→ 返回“此刻”；旧请求和旧 outbox 不得进入新代次/新账号
```

cloud 新登记在事务内写用户 `lastWriteAt`，与删除标记竞争；HTTP 用户鉴权每请求检查用户存在，使旧 JWT 在删除后失效。

## 10. 配置、响应与测试

### 10.1 配置入口

| 范围 | 文件／变量 |
|---|---|
| 小程序 | `miniprogram/config.js`：`DATA_MODE/CLOUD_ENV/CLOUD_FUNCTION_NAME/API_BASE` 及本地 key |
| 云函数 | `config.json`；依赖在 `package.json`，使用当前部署环境，无独立 Secret 配置 |
| Go | `APP_ENV/PORT/MYSQL_DSN/JWT_SECRET/JWT_TTL_HOURS/AUTH_DEV_MODE` |
| 微信 HTTP 登录 | `WECHAT_APP_ID/WECHAT_APP_SECRET/WECHAT_API_URL` |
| 管理 API | `ADMIN_USERNAME/ADMIN_PASSWORD/ALLOWED_ORIGINS` |
| Vue | `VITE_API_BASE_URL/VITE_API_PROXY_TARGET` |
| Compose | 根 `.env.example` 中 MySQL、JWT、微信、管理员和 CORS 占位值 |

秘密只能放服务端环境或本地未提交 `.env`，不能写入小程序、Vue 构建变量或文档示例真实值。

### 10.2 测试文件与命令

小程序与云函数：

```bash
cd miniprogram
node tests/run.js
node scripts/check-syntax.js
node cloudfunctions/mindTrace/test/domain.test.js

cd cloudfunctions/mindTrace
npm test
npm run check
```

- `tests/run.js`：表单、数组映射、outbox、账号与后端归属、格式归一化、项目结构、WXML 静态约束、cloud action 映射与传输。
- `scripts/check-syntax.js`：递归对小程序 JS（排除 `node_modules/.artifacts`）执行 `node --check`。
- `domain.test.js`：代次、公开字段、输入、收尾、状态、继承、相似度、检索、分页和统计纯逻辑。

Go：

```bash
cd server
go test ./...
go vet ./...
go build ./cmd/server
```

测试包括 `api/middleware_test.go`、`models/migration_test.go` 和 `service` 下 auth、idempotency、search、similarity、thought_state、validation、wechat 测试。CI 的 Go 测试另加 `-race`。这些单元测试不需要数据库；真实 MySQL 的迁移、跨用户、事务、锁和并发仍需环境内集成验证。

Vue：

```bash
cd web
npm run build
```

当前没有 Vue 单元测试脚本，构建不能替代登录、401、分页、空态和浏览器功能验收。根 `make test` 会串联 Go、小程序／云函数和 Vue 构建；会生成 `web/dist`，只审阅文档时不要用它代替无产物检查。真实云数据库规则、索引、事务和 SDK 行为也必须在目标云环境验证。

## 11. 扩展与修改规范

1. **先契约后实现**：新增 action、HTTP 路由、字段或状态时同步更新对应 API 文档；双模式都需明确支持或说明差异。
2. **保持依赖方向**：页面不直接访问传输细节；云领域纯函数不引入 SDK；Go service 不引入 Gin；Vue API 不引用页面。
3. **服务端重新校验**：客户端校验只改善体验；归属、长度、状态、关闭条件和幂等必须由服务端执行。
4. **归属条件不可省略**：cloud 每次读取/写入校验 `ownerOpenid` 和适用时的代次；Go 查询必须带 `user_id`，管理查询不得因此放宽到正文。
5. **事务包含聚合更新**：record 与 thought 的版本、开关计数、状态必须一致；保持思虑先于记录的锁顺序，避免并发死锁和版本覆盖。
6. **幂等键贯穿重试**：不要在本机重试时生成新 `clientRequestId`；cloud 保持确定性 record ID，HTTP 保持用户范围唯一约束。
7. **离线不猜测结果**：网络失败与进程中断用 `uncertain`；只有合法 `queued` 自动同步；归属变化只阻断并保留，不静默改绑或删除。
8. **秘密和正文不进日志**：错误返回不含堆栈、Secret、数据库原文或 token；文档示例使用占位符。
9. **模型、迁移、测试同步**：Go 模型约束与 SQL 同步；云聚合字段与部署索引同步；前端字段变化同步归一化和页面测试。
10. **不要虚报验证范围**：Node 测试、Go 单测和 Vue 构建各自有边界；真实微信、云环境、MySQL 和真机验收单独记录结果。
