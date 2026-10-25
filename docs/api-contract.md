# 止念 API 契约（V1）

Base URL：`/api/v1`。除登录与健康检查外均需 `Authorization: Bearer <token>`。成功响应统一为 `{ "data": ... }`，失败为 `{ "error": { "code": "...", "message": "..." } }`。时间使用 RFC3339。

## 微信用户

- `POST /auth/wechat/login`：`{code, nickname?, avatarUrl?}`，服务端用 code 调用微信 `jscode2session`，返回 `{token, user}`。仅开发环境且 `AUTH_DEV_MODE=true` 时接受 `dev_` 前缀 code。
- `GET /me`：当前用户。
- `DELETE /me`：注销并删除当前用户全部业务数据。

## 首页与记录

- `GET /dashboard`：返回 `{todayCount, pendingCount, closedCount, thoughtCount}`。
- `POST /thoughts/match`：`{text}`，返回 `{items:[{thought, score}]}`，仅提示，不自动关联。
- `POST /records`：快速登记。请求 `{thoughtId?, clientRequestId?, triggerEvent, emotions[], intensity, loopThought}`；无 `thoughtId` 时同时创建思虑点，有则为已有思虑点新增版本并继承上一版评估字段，但收尾确认会重置。`clientRequestId` 为 1–64 字符的客户端幂等键，同一用户重复提交返回首次结果，不重复创建。返回 `{thought, record}`。
- `GET /records?status=&page=&pageSize=`：登记版本队列，返回 `{items, total, page, pageSize}`。
- `GET /records/:id`：版本详情。
- `PATCH /records/:id`：保存七步评估草稿。可包含 `{step, status, ruminationType, riskContent, probability, controllableActions[], uncontrollableItems[], scenarioWorst, scenarioLikely, scenarioBest, closeConfirmations[]}`。
- `POST /records/:id/close`：校验必填项及三项确认，状态改为 `closed`。
- `POST /records/:id/pause`：状态改为 `paused`。

数组结构：`controllableActions` 为 `[{text, done}]`；`uncontrollableItems` 为 `[{text, crossedOut}]`；`closeConfirmations` 为 3 个布尔值。

## 思虑库与统计

- `GET /thoughts?query=&status=&emotion=&page=&pageSize=`：返回 `{items, total, page, pageSize}`；每项包含思虑点、版本计数、最近记录与当前进度。
- `GET /thoughts/:id`：返回 `{thought, records}`，按版本倒序。
- `GET /stats/summary`：返回 `{totalThoughts, totalRecords, closedRecords, completionRate, recurringThoughts, emotionCounts, intensityTrend}`。

## 管理端

- `POST /admin/login`：`{username,password}`，返回 `{token}`；账号密码仅由环境变量配置。
- `GET /admin/overview`：聚合运行指标，不返回思虑正文。
- `GET /admin/users?page=&pageSize=`：用户 ID、昵称、注册时间、思虑数与记录数，不返回思虑正文。

## 字段约束

- `triggerEvent` 必填，1–100 字；`loopThought` 必填，1–1000 字。
- `intensity` 为 1–10；`probability` 为 0–100。
- 版本状态：`registered`、`evaluating`、`paused`、`closed`。
- `step` 为 0–7；思虑点状态：`active`、`resolved`、`recurring`。
- 所有业务查询强制按当前用户隔离，禁止依赖客户端传用户 ID。
