# 止念（mind_trace）原生微信小程序

## 双模式配置

默认 `DATA_MODE: 'cloud'`，所有页面仍通过 `services/api.js` 访问数据，不直接使用 `wx.cloud.database`。

### 微信云开发（默认）

1. 将 `project.config.json` 中的 `touristappid` 替换为已开通云开发的真实小程序 AppID；游客 AppID 不能用于真实云环境。
2. 在微信开发者工具中创建并选择云环境，部署 `cloudfunctions/mindTrace` 云函数并安装其依赖。
3. `CLOUD_ENV: ''` 使用默认云环境；需要指定环境时填写环境 ID。`CLOUD_FUNCTION_NAME` 默认为 `mindTrace`。
4. 云模式通过云函数上下文识别用户，不调用 `wx.login`、不依赖 token，也不需要配置 HTTP request 合法域名。

### HTTP（保留 Go API）

将 `config.js` 的 `DATA_MODE` 改为 `'http'`，并把 `API_BASE` 配置为包含 `/api/v1` 的 HTTPS 地址。生产环境需在微信公众平台配置 request 合法域名。HTTP 模式继续使用 `wx.login` 换取 token；AppSecret 只能保存在服务端，不能写入小程序。

项目使用 `compileType=miniprogram`，无小程序端 npm 运行时依赖、无 TypeScript、无跨端框架。`cloudfunctionRoot` 为 `cloudfunctions/`，测试、脚本和构建产物不会作为小程序代码上传。

## 聚焦记录、离线与幂等约定

- 第一步只输入思虑正文；客户端从首个非空行生成最多 100 字短标题，完整正文不变。首次创建的情绪为空数组、强度为 `null`。
- 正文创建或入队后，第二步再补充情绪和强度，也可暂不补充。在线通过 PATCH 保存；离线只更新仍为 `queued` 的待发送 payload，不覆盖 `sending/uncertain` 项。
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
