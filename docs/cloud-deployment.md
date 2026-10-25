# 「止念」微信云开发部署指南（默认模式）

> 适用配置：`DATA_MODE=cloud`。
> 核心组件：微信原生小程序、`miniprogram/cloudfunctions/mindTrace`、云数据库 `users / thoughts / records`。
> 调用契约以 [cloud-api.md](./cloud-api.md) 为准；页面不直接访问云数据库。

## 1. 模式边界

云开发模式下：

- 小程序通过 `wx.cloud.callFunction` 调用 `mindTrace`。
- `login` 事件为 `{action,payload}`；非 login 事件为 `{action,payload,actorUserId}`。
- 云函数通过 `cloud.getWXContext().OPENID` 确定微信身份，再通过 `actorUserId` 校验内部用户及代次；事件传入的身份字段不能替代 `OPENID`。
- 公开用户 ID 为 `${_id}:${generation}`，不是只由 OPENID 哈希得到的 ID。
- 数据只写入当前云环境的云数据库；不写入 Go + MySQL。
- Vue 管理端仅支持 Go + MySQL HTTP 模式；**云模式 V1 无管理端数据互通**。
- **cloud 与 http 两套数据不自动同步**。切换 `DATA_MODE` 不是迁移操作，切换后可能看到另一套数据。

此模式不需要自建 API 域名，因此不需要为该 API 域名办理 ICP备案、申请证书或配置微信小程序 `request` 合法域名。小程序主体注册、真实 AppID、隐私保护指引、服务类目、体验版验收、提审和发布仍然需要。

> 微信云服务套餐、资源价格和免费额度会调整，以微信云开发控制台当期展示为准；不得承诺“永久免费”或固定免费额度。

## 2. 前置准备

- [ ] 微信公众平台账号类型为**小程序**，不是小游戏。
- [ ] 获取真实 AppID，并在 `miniprogram/project.config.json` 中配置。
- [ ] 安装[微信开发者工具 Stable](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)，导入 `miniprogram` 目录。
- [ ] `touristappid` 仅用于有限的本地界面调试；云函数、云数据库、真机预览、体验版和发布验收使用真实 AppID。
- [ ] 使用有权限的微信账号登录开发者工具，并确认小程序主体已开通云开发能力。
- [ ] 明确测试环境与生产环境的负责人、环境 ID 和发布版本；不要用生产环境存放合成测试数据。

## 3. 开通云开发并创建环境

1. 在微信开发者工具中点击“云开发”，按控制台引导开通。
2. 创建云环境，记录**环境 ID**，不是只记录环境名称。
3. 建议测试和生产使用不同云环境；若首期共用一个环境，必须明确风险并限制测试数据。
4. 在控制台核对当前套餐、配额、资源用量和计费提醒，设置可用的费用/用量告警。
5. 确认当前开发者、体验成员和运维人员的权限最小化。

发布单记录：

```text
云环境 ID：________________
环境用途：测试 / 生产
云函数名：mindTrace
小程序 AppID：________________
套餐与配额核对日期：________________
依赖安全复查日期：________________
```

## 4. 配置小程序

在 `miniprogram/config.js` 使用：

```js
module.exports = {
  DATA_MODE: 'cloud',
  CLOUD_ENV: '你的环境ID',
  CLOUD_FUNCTION_NAME: 'mindTrace',
  API_BASE: 'https://your-api.example.com/api/v1',
  // 其余现有配置保持不变
}
```

- `DATA_MODE` 必须为 `cloud`；这是默认模式。
- `CLOUD_ENV` 填环境 ID；空字符串表示使用默认云环境，队列中的对应 `backendEnv` 为 `default`。正式发布建议显式填写环境 ID。
- `CLOUD_FUNCTION_NAME` 必须为 `mindTrace`。
- `API_BASE` 仅 HTTP 模式使用，云模式下即使保留也不会用于业务请求。
- 初始化后确认调用的是 `wx.cloud.callFunction`，页面没有直接使用 `wx.cloud.database()`。
- 云函数名、环境 ID 和 AppID 不属于秘密；思虑正文、用户身份字段和管理凭据不得写入前端配置。

## 5. 部署云函数 `mindTrace`

1. 打开 `miniprogram/cloudfunctions/mindTrace`，确认入口接收 `{action,payload,actorUserId?}`，依赖 `wx-server-sdk` **4.0.2**。
2. 安装依赖并运行本地检查：

   ```bash
   cd miniprogram/cloudfunctions/mindTrace
   npm install --omit=dev
   npm run check
   npm test
   npm audit
   ```

3. 在微信开发者工具中右键 `mindTrace`，选择“上传并部署：云端安装依赖”。
4. 在云开发控制台确认函数部署成功、运行环境正常、超时和内存配置满足当前动作。
5. 查看首轮流日志，确认没有思虑正文、完整用户身份标识或其他敏感信息泄露。
6. 每次修改云函数后重新上传部署，并记录函数版本与对应小程序提交号；只上传小程序不会自动更新云函数。

云函数必须满足：

- `login` 找不到用户时创建并生成随机 `generation`；公开用户 `id` 为 `${_id}:${generation}`。
- 非 login action 必须携带 `actorUserId`，云函数同时校验 `OPENID`、活跃用户和代次；失败返回 401。
- `deleteMe` 允许同代次重入清理；旧代次不得操作新账号。
- 返回结构不暴露 `ownerOpenid`、原始 `generation`、`deleting` 等内部字段。
- 业务失败统一 `{error:{code,message}}`，成功统一 `{data:...}`。
- 检索和统计按当前 `ownerOpenid` 分批读取全部数据，不能假设数据库只返回前 20 或 100 条。

### 5.1 依赖安全审计：当前已知风险

**当前 `wx-server-sdk` 4.0.2 的 `npm audit` 仍报告官方 SDK 间接依赖 `axios`、`lodash.set`、`lodash.unset` 漏洞。普通 `npm audit fix` 无法在非破坏范围内消除这些报告。**

上线前必须执行并记录：

- [ ] 保存 `npm audit` 结果、依赖树、复查日期和负责人，不宣称“0 漏洞”或“依赖风险已清零”。
- [ ] 复查微信官方 SDK 是否有安全更新或官方处置建议；升级后重新运行测试与 `npm audit`。
- [ ] 不使用 `npm audit fix --force`，不通过强制降级制造额外兼容或安全风险。
- [ ] 在真实云环境验证云函数安装、冷启动、登录、事务、注销、检索和统计，不能只凭本地测试判定可用。
- [ ] 将上述间接依赖漏洞列为本次发布的**已知风险**；若风险不可接受，停止发布并等待官方修复或重新评估方案，而不是隐藏审计结果。

## 6. 创建集合与安全规则

在云数据库中创建三个集合：

| 集合 | 用途 | 关键字段 |
|---|---|---|
| `users` | 微信用户、代次与注销状态 | `_id`、`ownerOpenid`、`generation`、`deleting`、`deletingAt`、`lastWriteAt`、昵称、头像、时间 |
| `thoughts` | 思虑主题与聚合状态 | `_id`、`ownerOpenid`、`status`、`versionCount`、`openCount` |
| `records` | 每次登记及七步评估版本 | `_id`、`ownerOpenid`、`thoughtId`、`versionNo`、`clientRequestId`、`status`、`step`、评估字段、时间 |

`ownerOpenid` 是普通业务字段，不再使用数据库保留字段作为归属字段。对三个集合分别设置安全规则，禁止小程序客户端直接读取和写入：

```json
{
  "read": false,
  "write": false
}
```

验收要求：

- 小程序直接调用数据库读、写均被拒绝。
- 云函数通过 `wx-server-sdk` 仍可正常访问。
- 所有业务查询都由云函数附带 `ownerOpenid = 当前 WXContext.OPENID` 条件。
- 不因为规则禁止客户端访问，就省略云函数内的归属和代次校验。
- 返回给小程序的对象不暴露 `ownerOpenid`。

## 7. 创建索引

按实际查询路径在云数据库控制台创建并核对索引：

| 集合 | 索引 | 用途 |
|---|---|---|
| `users` | `ownerOpenid` 唯一索引 | 防止同一微信用户重复注册 |
| `thoughts` | `ownerOpenid + status + updatedAt` | 当前用户按状态筛选与排序 |
| `thoughts` | `ownerOpenid + updatedAt` | 当前用户思虑库列表 |
| `records` | `ownerOpenid + status + createdAt` | 当前用户版本队列 |
| `records` | `ownerOpenid + createdAt` | 当前用户最近登记与分批读取 |
| `records` | `thoughtId + versionNo` 唯一索引 | 版本时间线与版本号防重 |

如控制台对唯一索引、排序方向或字段类型有当期限制，以控制台校验结果为准，并在上线前通过并发测试证明不会重复用户或版本。不得为了绕过索引限制而删除 `ownerOpenid` 归属条件。

## 8. 事务、注销与幂等验收

### 8.1 快速登记与注销竞争

- `createRecord` 必须携带 `clientRequestId`。
- 云函数对 `OPENID + clientRequestId` 经 SHA-256 生成确定性的记录 `_id`；这是记录幂等 ID，不是公开用户 ID。同一用户重试返回首次结果，不重复创建。
- 使用 `db.runTransaction` 创建思虑点和首个版本，或在复发时锁定思虑文档并递增 `versionCount`。
- 事务先校验活跃用户与 `actorUserId`，并在写业务文档前更新用户 `lastWriteAt/updatedAt`，使用户写与注销标记形成写冲突。
- 新版本继承评估字段，但重置 `closeConfirmations`。
- 同一 `clientRequestId` 并发提交、核对后的重试均只产生一条记录；不同用户的相同 `clientRequestId` 不得互相命中或泄露结果。

### 8.2 注销流程

- `deleteMe` 首先在事务中设置 `deleting:true/deletingAt`，阻止普通业务继续写入。
- 随后在事务外分批清理 records/thoughts，最后在事务中复核同一代次并删除 users 文档。
- 同一 `actorUserId` 重复调用可恢复中断清理；旧代次调用返回 401。
- `login` 遇到注销中用户时先完成清理，再创建新 `generation`；延迟清理不得删除新代次。
- 验证注销与 `createRecord` 并发时，不会留下已标记注销后仍新增的业务记录。

### 8.3 状态与聚合

- `closeRecord` 在事务中同时校验记录与思虑文档，更新 `closed`、`openCount` 和思虑状态。
- 版本数大于等于 3 时为 `recurring`；不足 3 版且 `openCount=0` 时为 `resolved`，否则为 `active`。
- 并发复发不会产生相同 `versionNo`，`versionCount` 与实际版本数一致。
- 时间以 ISO 字符串保存，小程序归一化后展示。

## 9. 离线队列、功能与安全验收

每条离线登记必须绑定：

- `ownerUserId`：入队时公开用户 ID，cloud 包含 `${_id}:${generation}`。
- `backendMode`：`cloud` 或 `http`。
- `backendEnv`：cloud 为 `CLOUD_ENV || 'default'`，HTTP 为 `API_BASE`。
- `clientRequestId`：同一登记保持不变。

同步前缺字段、账号/代次变化或后端环境变化时，条目必须为 `blocked` 并保留本机；网络结果未知时为 `uncertain`，不得盲目自动重发。

使用云函数测试调用和真实小程序路径分别验收：

1. `login` → 保存复合用户 ID → 携带 `actorUserId` 调用 `me`、`dashboard`。
2. `matchThoughts` → `createRecord` → `listRecords` → `getRecord`。
3. `patchRecord` 逐步保存 → `closeRecord`；缺项和三项确认未完成时不能收尾。
4. `pauseRecord` 后恢复；`listThoughts`、`getThought`、`stats` 与页面一致。
5. 重复提交同一 `clientRequestId`，返回首次记录且版本计数不增加。
6. 伪造 `actorUserId`、缺代次或使用注销前代次均被拒绝；伪造其他身份字段不改变 `WXContext.OPENID`。
7. 使用两个微信测试账号验证思虑、记录、统计完全隔离。
8. `deleteMe` 后旧缓存和旧请求不能向新账号写入；客户端清除敏感缓存与离线队列。
9. 弱网、断网、切后台和进程重启后，本地草稿与待同步内容不丢失，跨账号/跨环境队列被阻断。
10. 云函数日志、控制台导出和错误告警不包含思虑正文。
11. 完成 5.1 的真实云环境依赖验证，已知风险与审计证据已纳入发布单。

## 10. 体验版与发布

- [ ] 确认体验版使用真实 AppID、正确的 `CLOUD_ENV` 和已部署的 `mindTrace`。
- [ ] 上传小程序并设为体验版，添加体验成员。
- [ ] 在真机完成登录、代次校验、登记、离线阻断、复发、七步收尾、思虑库、统计和两阶段注销。
- [ ] 记录小程序版本、云函数版本、云环境 ID、数据库规则/索引及依赖安全复查结果。
- [ ] 核对隐私政策、用户隐私保护指引、实际云数据收集字段一致。
- [ ] 选择与实际服务一致的类目并准备所需材料；云开发不免除类目或资质要求。
- [ ] 提交审核并跟踪结果，不承诺审核时长。
- [ ] 发布时确保云函数与小程序版本兼容；回滚分别评估小程序版本、云函数版本和数据库数据，不能假设回滚代码会撤销已写入数据。

## 11. 运行、费用与备份

- 监控云函数错误率、耗时、并发、资源用量和云数据库容量；告警内容不得包含用户正文。
- 定期核对套餐、账单和免费额度使用情况；升级或降配以控制台当期规则为准。
- 持续复查官方 `wx-server-sdk` 更新与 `npm audit`；每次依赖变化后重新做真实云环境验证，不宣称固定 0 漏洞。
- 按云开发控制台当期能力配置数据库备份/导出，并验证恢复流程；导出文件加密、限权，不公开分享。
- 注销数据的备份副本按已公布的保留策略到期清除。
- 定期复核数据库安全规则和 `ownerOpenid` 索引，防止后续维护误开放客户端读写或误用归属字段。
- 若未来需要管理端或迁移到 HTTP 模式，先另行设计导出、映射、去重、用户告知和迁移回滚方案；V1 不自动同步两套数据。
