# mindTrace 云函数

使用 Node.js 与 `wx-server-sdk` 4.0.2 实现。调用协议为 `{ action, payload }`，成功返回 `{ data }`，失败返回 `{ error }`。身份只来自 `cloud.getWXContext().OPENID`。

## 本地检查

```bash
npm install
npm test
npm run check
```

测试只使用 Node.js 内置的 `node:test`，不依赖微信环境，也不需要测试第三方包。`test/` 不参与云函数运行，上传时可排除；`node_modules/` 不应手动上传。

## 部署

1. 在微信开发者工具中选择目标云开发环境，确认小程序项目已启用云开发。
2. 在云开发控制台的数据库中新建三个集合：`users`、`thoughts`、`records`。
3. 分别将三个集合的权限设置为“仅创建者可读写”以外的自定义安全规则，并应用 `database.rules.json` 中的 `read: false`、`write: false`。这会禁止小程序客户端直接读写；云函数的服务端 SDK 调用不受该客户端规则限制。
4. 当前查询均以普通字段 `ownerOpenid` 为条件，并为三个集合的 `ownerOpenid` 配置单字段索引；列表过滤、检索和统计在云函数内完成，不要求复合索引。不要使用微信保留字段 `_openid` 作为业务归属字段。若后续改为数据库端组合查询，再按实际查询添加复合索引。
5. 在此目录运行 `npm install --omit=dev`，然后在微信开发者工具中右键 `mindTrace`，选择“上传并部署：云端安装依赖”。不要上传本地 `node_modules/` 或测试依赖。
6. 云函数配置见 `config.json`：Node.js 18、256 MB、20 秒超时，无 OpenAPI 权限，也不含环境 ID、密钥或其他秘密。函数通过 `DYNAMIC_CURRENT_ENV` 使用当前环境。

集合内所有业务文档都带 `ownerOpenid`。`users._id` 是 OPENID 的 SHA-256 派生 ID，用户文档另有随机 `generation`；公开的 `user.id` 为 `${users._id}:${generation}`，注销后重新登录会更换代次，`generation` 和归属字段不公开。带 `clientRequestId` 的记录使用当前 OPENID 与该键派生的确定性 `_id`，其他文档 ID 规则不变。不要手工修改 `thoughts.versionCount`、`openCount`、`latestRecordId`，它们用于事务内版本分配、复发继承和状态计算。

## 数据规模与一致性

- 列表、检索、首页和统计按每批 100 条持续读取，直到当前用户的数据读完，不将 100 条当作总量上限。
- `createRecord` 与 `closeRecord` 使用 `db.runTransaction`，事务中仅按文档 ID 读取和写入，不执行多记录查询。
- 除 `login` 外，每个 event 都必须携带 `actorUserId`，其值必须等于当前用户的公开 `${users._id}:${generation}`；缺失或不匹配均返回 401。它只用于代次校验，身份归属仍只信任 OPENID 与服务端 `ownerOpenid`。
- 注销先在事务中设置 `deleting`，使普通业务及 `createRecord` 的事务内用户复核失败，再在事务外按记录、思虑的顺序分批清理，最后删除用户。`createRecord` 在实际写入记录前先更新用户 `lastWriteAt`，与注销标记形成写—写冲突：登记先提交时注销重试后的清理能读到新记录；注销先标记时登记重试会因用户状态或代次校验失败。
- `deleteMe` 绕过普通活跃用户校验，但仍要求 `actorUserId` 匹配删除中的同一代次，旧代次注销不能操作新账号。它可重复调用以继续未完成的清理。登录遇到 `deleting` 也会先执行同样的清理，再创建新代次；批量操作不放入事务。最终删除会核对代次，避免迟到的清理删除新用户。
- 多文档清理不是一个跨集合事务，中途失败后需要依靠 `deleteMe` 或 `login` 重试恢复。
- 检索和统计需要读取用户全部数据，数据量很大时会增加云函数耗时与读取费用。

## 验证范围

本地测试覆盖输入校验、状态计算、复发继承、收尾校验、相似度、风险检索、分页及统计。未进行真实微信云环境部署或集成调用；SDK 事务行为、数据库规则和控制台配置仍需在目标云环境中验证。
