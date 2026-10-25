# 止念（mind_trace）原生微信小程序

## 配置

在 `config.js` 修改 `API_BASE`，其值应包含 `/api/v1`。生产环境需在微信公众平台配置对应 request 合法域名并开启 HTTPS。微信 `AppSecret` 只能保存在服务端，不能写入小程序。

项目使用 `touristappid`、`compileType=miniprogram`，无 npm 运行时依赖、无 TypeScript、无跨端框架。

## 离线与幂等约定

- 速记先尝试服务端相似匹配与登记；网络失败时写入本机 storage 队列，并生成持久化 `clientRequestId` 与 `ownerUserId`。
- 每次自动或手动同步前，以及 401 重登录后的请求重试前，都会比较队列原用户与当前用户的内部 ID。账号变化时记录变为 `blocked/accountChanged`，保留本机数据且禁止写入新账号；同一用户 token 过期可正常重试。
- 联网后只自动同步 `queued` 项，每次请求携带相同的 `clientRequestId`。服务端已在当前用户范围内建立唯一约束，重复请求返回首次创建的 `{thought, record}`，避免重复登记。
- 网络错误可能发生在服务端已经写入之后，因此失败项标记为 `uncertain`，不会自动重发。用户可先在思虑库核查，再手动沿用同一 `clientRequestId` 重试。
- 评估草稿即时保存到本机，并防抖同步服务端。服务端草稿成功后才移除本机副本。

## 测试

```bash
node tests/run.js
```

测试覆盖速记/七步表单校验、数组字段映射、离线队列去重与自动同步状态、数据格式化和项目结构静态检查。
