# 「止念」文档导航

这里汇总 `mind_trace` 的产品、架构、代码、接口、部署与发布文档。各文档可独立阅读；字段细节以对应契约为准，跨系统关系以架构文档为准，文件和函数职责以代码设计为准。

## 1. 文档地图

| 分类 | 文档 | 主要内容 | 适合读者 |
|---|---|---|---|
| 产品 | [product-design.md](./product-design.md) | 角色、场景、信息架构、速记、七步、复发、离线、应急、注销、V1 边界与验收 | 产品、设计、测试、全体开发者 |
| 架构 | [architecture.md](./architecture.md) | 双模式边界、组件、身份、数据一致性、安全、部署、性能与扩容限制 | 架构、后端、运维 |
| 代码 | [code-design.md](./code-design.md) | 仓库树、模块职责、关键接口、数据结构、核心代码时序、配置、测试与扩展规范 | 小程序、云函数、Go、Vue 开发者 |
| cloud API | [cloud-api.md](./cloud-api.md) | `mindTrace` 事件、14 个 action、payload、响应、集合、索引、幂等与事务契约 | cloud 开发与联调、测试 |
| HTTP API | [api-contract.md](./api-contract.md) | Go `/api/v1` 路径、认证、请求响应、字段约束、状态和管理接口 | Go、小程序、Vue 联调与测试 |
| cloud 部署 | [cloud-deployment.md](./cloud-deployment.md) | AppID、环境、函数、集合、安全规则、索引、SDK 风险与真实云验收 | cloud 部署、运维、发布人员 |
| 发布 | [release-checklist.md](./release-checklist.md) | 通用检查及 cloud／HTTP 分模式发布清单 | 测试、运维、发布负责人 |

根目录 [README.md](../README.md) 是项目入口，保留两种模式的快速启动、配置和测试命令。模块内的 `miniprogram/README.md`、`server/README.md`、`web/README.md` 提供更聚焦的本地操作说明。

## 2. 按任务阅读

### 2.1 理解产品或编写验收用例

1. [product-design.md](./product-design.md)：先读角色、页面、核心流程与 V1 不包含的能力。
2. 按实际模式选 [cloud-api.md](./cloud-api.md) 或 [api-contract.md](./api-contract.md)：核对字段和错误。
3. [release-checklist.md](./release-checklist.md)：转换为发布前检查项。

### 2.2 修改小程序或 cloud 后端

1. [architecture.md](./architecture.md)：理解身份、归属、离线与事务约束。
2. [code-design.md](./code-design.md)：定位页面、服务、工具、云函数及核心时序。
3. [cloud-api.md](./cloud-api.md)：确认 action 与数据契约。
4. [cloud-deployment.md](./cloud-deployment.md)：部署并在真实云环境验证。

### 2.3 修改 Go API 或 Vue 管理端

1. [code-design.md](./code-design.md)：定位 Go 包、服务事务、Vue 模块和测试。
2. [api-contract.md](./api-contract.md)：核对 HTTP 与管理接口。
3. [architecture.md](./architecture.md)：检查 MySQL、连接池、安全和扩容影响。
4. 根 [README.md](../README.md) 与 `server/README.md`、`web/README.md`：启动和构建。
5. [release-checklist.md](./release-checklist.md)：执行 HTTP 发布路径。

### 2.4 部署或发布

- 默认 cloud：根 [README.md](../README.md) → [cloud-deployment.md](./cloud-deployment.md) → [release-checklist.md](./release-checklist.md)。
- 可选 HTTP：根 [README.md](../README.md) → [architecture.md](./architecture.md) → [api-contract.md](./api-contract.md) → [release-checklist.md](./release-checklist.md)。
- 发布涉及字段、状态、身份、幂等或迁移时，同时复核 [code-design.md](./code-design.md) 的扩展规范。

## 3. 文档维护约定

1. **以最新代码和真实配置为准**：不将规划能力写成已实现，不用文档假设替代代码验证。
2. **职责分层**：产品文档回答“用户能做什么”；架构文档回答“系统为何这样组织”；代码设计回答“在哪改、如何串联”；API 文档回答“调用字段是什么”；部署与清单回答“如何上线”。
3. **避免重复维护**：字段表、完整路由和逐步部署命令优先留在专属文档，其他文档链接引用，只保留理解本主题所需摘要。
4. **双模式同步**：业务字段、状态或流程变化时，检查两种服务端、统一小程序门面和相应契约；如存在差异，明确写出。
5. **保留现实边界**：测试、构建、真实云环境、MySQL、真机和发布验收分别说明，不能以其中一种代替全部验证。
6. **链接随变更检查**：新增、移动或删除文档时，同步更新本导航、根 README 和相关文档的相对链接。
