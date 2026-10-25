# mind_trace Go 后端

基于 Go 1.22、Gin、GORM、MySQL 8 和 JWT 的 `/api/v1` 服务，实现 `../docs/api-contract.md`。不使用 SQLite。

## 目录

- `cmd/server`：进程入口、连接池、AutoMigrate、优雅退出
- `internal/api`：路由、中间件、HTTP 输入输出与统一错误
- `internal/service`：鉴权、思虑/版本、匹配、统计与管理业务
- `internal/models`：GORM 模型和 MySQL JSON 类型
- `migrations/001_init.sql`：生产 MySQL 8 建表脚本（含约束、外键和索引）

## 准备 MySQL 8

```sql
CREATE DATABASE mind_trace CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'mindtrace'@'%' IDENTIFIED BY 'use-a-real-password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON mind_trace.* TO 'mindtrace'@'%';
```

生产环境只执行已审阅的 SQL 时可收窄 DDL 权限，并在启动服务前执行：

```bash
mysql -h 127.0.0.1 -u mindtrace -p mind_trace < migrations/001_init.sql
```

本地开发和 Compose 启动会自动执行 GORM AutoMigrate；生产建议先执行上述 migration。两者使用相同的表、唯一键、核心索引、三个具名级联外键和五个 CHECK。模型显式声明 `fk_thoughts_user`、`fk_records_user`、`fk_records_thought` 及对应检查约束；GORM 对已有表通过 `HasConstraint`/`HasIndex` 判断后补缺，因此重复启动保持幂等。

## 配置与启动

```bash
cp .env.example .env
# 修改 .env 中的 DSN、JWT_SECRET 和管理端密码；不要提交 .env。
go run ./cmd/server
```

主要环境变量：

| 变量 | 必填 | 说明 |
|---|---|---|
| `MYSQL_DSN` | 是 | MySQL DSN，需包含 `parseTime=True` |
| `JWT_SECRET` | 是 | 至少 32 字节，使用随机高熵值 |
| `JWT_TTL_HOURS` | 否 | 默认 168，允许 1–720 |
| `APP_ENV` | 否 | 默认 `development`；生产设 `production` |
| `PORT` | 否 | 默认 `8080` |
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | 正式微信登录时必填 | 仅用于 `jscode2session`；Secret 不持久化、不记录日志 |
| `AUTH_DEV_MODE` | 否 | 仅当它为 `true` 且 `APP_ENV=development` 时接受 `dev_` code |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 否，成对配置 | 管理端唯一凭据来源；不配置则管理登录关闭 |
| `ALLOWED_ORIGINS` | 否 | 逗号分隔来源，默认 `*` |
| `WECHAT_API_URL` | 否 | 默认微信官方地址；用于测试或私有网关覆盖 |

健康检查：`GET /health` 或 `GET /api/v1/health`。

开发登录示例：

```bash
curl -s http://localhost:8080/api/v1/auth/wechat/login \
  -H 'Content-Type: application/json' \
  -d '{"code":"dev_local-user-1","nickname":"本地用户"}'
```

将返回的 token 用于 `Authorization: Bearer <token>`。用户 token 与管理 token 角色隔离，不能混用。

## 业务规则

- 快速登记不带 `thoughtId` 时创建思虑点；携带时校验归属、在事务中 `SELECT ... FOR UPDATE` 锁定思虑点，再分配 `version_no` 并继承上一版评估文本、概率、行动和不可控项；`closeConfirmations` 每版独立，始终重置为 `[false,false,false]`。
- `(thought_id, version_no)` 有数据库唯一约束；所有业务 SQL 都包含当前用户条件，客户端不能指定用户 ID。
- 快速登记支持可选 `clientRequestId`（去除首尾空白后 1–64 字符）。同一用户重复提交时返回首次登记的思虑点和版本，不重复新增；并发唯一键竞争后也会读取首次结果。省略时写入 `NULL`，利用 MySQL 多 `NULL` 行为允许无限次普通在线登记；不同用户使用相同值互不影响。唯一约束为 `(user_id, client_request_id)`。
- 相似度采用中文二元字符与英文/数字词的 Sørensen–Dice 系数，返回分数至少 0.15 的前 20 项，仅提示、不关联。
- 思虑库 `query` 检索思虑点 `trigger_event` 及当前用户任一版本的 `trigger_event`、`loop_thought`、`risk_content`，`%`、`_` 和反斜杠按字面匹配。
- 草稿不能直接改成 `closed`，必须调用关闭接口。关闭要求：类型、风险、概率、可控行动、不可控事项、最坏/最可能/最好场景齐全，三个确认都为 `true`。
- 已关闭版本不能修改或暂停。新增和关闭均在思虑点行锁保护的事务内重算状态：至少 3 版为 `recurring`；不足 3 版且全部关闭为 `resolved`；其余为 `active`。
- 分页默认 `page=1&pageSize=20`，`pageSize` 最大 100。`recurringThoughts` 统计版本数至少为 3 的思虑点，强度趋势统计最近 30 天。
- 注销在事务中删除用户全部版本、思虑点和用户记录。
- 管理 overview 仅含计数；用户列表仅含 ID、昵称、注册时间和计数，不选择或返回任何思虑正文。

## 测试与检查

```bash
gofmt -w cmd internal
go test ./...
go vet ./...
go build ./cmd/server
```

单元测试覆盖 JWT 鉴权/角色隔离/过期与算法限制、开发登录开关、管理登录、中英文相似度、关闭校验、Unicode 长度约束、幂等键校验、提交后重试和唯一键竞争恢复，以及 GORM 外键/CHECK 生成逻辑与生产 migration 的一致性。测试不需要数据库，也不会以 SQLite 冒充 MySQL。真实 MySQL 8 的启动与并发集成测试仍需在具备 MySQL 的环境执行。

## Docker

```bash
docker build -t mind-trace-server .
docker run --rm -p 8080:8080 --env-file .env mind-trace-server
```

容器以非 root 用户运行，启动时执行 AutoMigrate。生产环境请按上述流程先运行 migration，并使用受限数据库账号和密钥管理系统注入环境变量。
