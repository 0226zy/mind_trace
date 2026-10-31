# 微信云开发模式契约

默认 `DATA_MODE=cloud`，原 `http` 模式及 Go + MySQL 代码保留。页面仍调用 `miniprogram/services/api.js`，由请求层按模式选择 `wx.cloud.callFunction` 或 `wx.request`，页面不直接访问云数据库。

## 调用协议

- 云函数名：`mindTrace`，事件：`{ action, payload, actorUserId? }`。
- `login` 事件不携带 `actorUserId`；**其余所有 action 都必须携带** `actorUserId`。
- 云函数先通过 `cloud.getWXContext().OPENID` 确定微信身份，再用 `actorUserId` 校验当前内部用户及用户代次。事件中的 `openid`、`userId` 或 `actorUserId` 都不能替代 `OPENID` 身份来源。
- 公开用户 ID 为 **`${_id}:${generation}`**，`actorUserId` 必须与其完全一致。它不是只由 OPENID 哈希得到的 ID；`generation` 是用户创建时生成的随机代次。
- 成功：`{ data: ... }`；业务失败：`{ error: { code, message, statusCode? } }`。
- 云数据库集合：`users`、`thoughts`、`records`。文档使用 `_id`，普通业务归属字段统一为 **`ownerOpenid`**，不再使用数据库保留字段作为归属字段。
- 返回结构不暴露 `ownerOpenid`；用户返回还不暴露原始 `generation`、`deleting`、`deletingAt` 等内部字段。用户公开 `id` 已包含代次，记录和思虑文档的 `_id` 映射为 `id`。
- 数据库安全规则禁止小程序端直接读写；只有云函数可访问，云函数仍须逐请求校验归属。

### 登录、代次与注销

- `login` 不需要 `code`。用户不存在时创建用户并生成新 `generation`；已存在且未注销时保留原代次。
- 非 login action 先按 `OPENID` 找到用户，再校验用户处于活跃状态且 `actorUserId === ${_id}:${generation}`。用户不存在、代次不符或普通业务遇到注销中用户时返回 401，客户端重新登录并保留/阻断需要核对的本地数据。
- `deleteMe` 允许同一 `actorUserId` 在注销中重复调用，以恢复未完成的清理；旧代次不能操作新代次用户。
- 注销顺序为：**事务标记 `deleting:true` → 分批清理 records/thoughts → 事务复核同一代次并删除 users 文档**。
- `login` 遇到注销中用户时先完成同代次清理，再创建新代次；延迟清理不得删除随后创建的新代次用户。
- `createRecord` 在事务中校验活跃用户与代次，并在写业务文档前更新用户文档的 `lastWriteAt/updatedAt`，使真实创建与注销标记形成写冲突，避免注销过程中新增记录。

## action 与现有 HTTP 对应

| action | HTTP 对应 | actorUserId | payload |
| --- | --- | --- | --- |
| `login` | `POST /auth/wechat/login` | 不携带 | 可包含 nickname/avatarUrl，无需 code |
| `me` | `GET /me` | 必填 | `{}` |
| `deleteMe` | `DELETE /me` | 必填，同代次可重入清理 | `{}` |
| `dashboard` | `GET /dashboard` | 必填 | `{}` |
| `matchThoughts` | `POST /thoughts/match` | 必填 | `{text}` |
| `createRecord` | `POST /records` | 必填 | 快速登记字段及 clientRequestId |
| `listRecords` | `GET /records` | 必填 | status/page/pageSize |
| `getRecord` | `GET /records/:id` | 必填 | `{id}` |
| `patchRecord` | `PATCH /records/:id` | 必填 | `{id, ...draft}` |
| `closeRecord` | `POST /records/:id/close` | 必填 | `{id}` |
| `pauseRecord` | `POST /records/:id/pause` | 必填 | `{id}` |
| `listThoughts` | `GET /thoughts` | 必填 | query/status/emotion/page/pageSize |
| `getThought` | `GET /thoughts/:id` | 必填 | `{id}` |
| `stats` | `GET /stats/summary` | 必填 | `{}` |

## 数据与一致性

- 所有业务查询使用 `ownerOpenid = 当前 WXContext.OPENID`，不能使用客户端声明的归属。
- `users` 保存 `ownerOpenid`、`generation`、`deleting`、`deletingAt`、`lastWriteAt` 等内部字段；`thoughts` 保存 `versionCount`、`openCount`，用于事务内分配版本号和聚合状态。
- `createRecord` 使用 `db.runTransaction`。记录 `_id` 根据 `OPENID + clientRequestId` 经 SHA-256 确定性生成，同一微信用户重试返回首次记录；这是记录幂等 ID，不是公开用户 ID。`intensity` 可省略或为 `null`，有值时必须是 1–10 整数。
- 关联复发时锁定思虑文档并递增 `versionCount`；并发版本号不得重复。新版本继承评估字段但重置 `closeConfirmations`。
- `patchRecord` 接受 `emotions` 与 `intensity`；情绪可为空数组但不可为 `null`，强度可为 1–10 或显式 `null`。修改最新版本情绪时，在同一事务内同步 `thought.emotions`；历史版本不得修改当前聚合。
- 版本 >=3 为 `recurring`；不足 3 版且 `openCount=0` 为 `resolved`，否则为 `active`。
- `closeRecord` 在事务中校验记录与思虑文档，更新 `closed/openCount/status`。
- 时间统一存 ISO 字符串，保持小程序现有归一化逻辑。
- 检索/统计在云函数内按当前 `ownerOpenid` 分批读取后计算；必须分页读取全部数据，不能假设只有前 20/100 条。强度趋势忽略 `null` 和非 1–10 整数，不把空值当作 0。

## 离线队列归属

每条离线登记必须绑定：

- `ownerUserId`：入队时公开用户 ID，即 `${_id}:${generation}`，用于阻止旧代次写入新账号。
- `backendMode`：入队时的 `cloud` 或 `http`。
- `backendEnv`：cloud 为 `CLOUD_ENV || 'default'`，HTTP 为 `API_BASE`。
- `clientRequestId`：同一登记重试保持不变。

同步前逐项比对当前用户和后端环境；缺少字段、账号/代次变化或后端环境变化时标记 `blocked` 并保留本机数据，不自动跨账号、跨代次或跨环境同步。网络结果未知时标记 `uncertain`，不盲目自动重发。

## 配置与依赖风险

`miniprogram/config.js`：

- `DATA_MODE: 'cloud'` 默认；改 `'http'` 切回 Go API。
- `CLOUD_ENV: ''` 默认使用默认云环境，可填环境 ID。
- `CLOUD_FUNCTION_NAME: 'mindTrace'`。
- 保留 `API_BASE`，仅 HTTP 模式使用。

云函数位于 `miniprogram/cloudfunctions/mindTrace`，依赖 `wx-server-sdk` 4.0.2。当前该版本的 `npm audit` 仍报告其官方 SDK 间接依赖 `axios`、`lodash.set`、`lodash.unset` 漏洞；`npm audit fix` 无法非破坏消除，不得使用 `--force` 降级。上线前须复查官方更新并在真实云环境验证，作为已知风险记录，**不得宣称 0 漏洞**。

Vue 管理端仍仅对应 Go + MySQL 模式，不读取微信云数据库；两种模式数据不自动同步。
