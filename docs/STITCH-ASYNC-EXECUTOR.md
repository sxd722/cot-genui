# Stitch 异步执行器

公开站点不再等待 Stitch 的长请求。站点校验 CardPlan、生成简体中文设计提示并提交异步任务；Cloud Tasks 调度 Cloud Run，执行器调用 Stitch、下载 H5，再把任务状态写入 Firestore、HTML 写入 GCS。浏览器以只读 token 轮询，刷新后从 IndexedDB 恢复任务。

## 状态流

`queued → running/generating → running/fetching-html → succeeded`

异常进入 `failed`；用户可标记 `canceled`；元数据和 HTML 默认 24 小时过期。任务不保存完整 CardPlan，完成后还会清空 prompt。

## 部署

执行器位于 `services/stitch-executor`，目标区域为 `asia-east1`。先在 Secret Manager 创建 `stitch-api-key`、`stitch-executor-secret`、`stitch-read-token-secret` 三个 secret，并赋予 Cloud Run 服务账号读取权限，然后在 WSL/bash 中设置项目和三个同名环境变量，运行：

```bash
cd services/stitch-executor
./deploy.sh
```

部署后把输出的 `STITCH_EXECUTOR_URL` 与相同的 `STITCH_EXECUTOR_SECRET` 配置到 Sites。确认真实异步任务成功后，才从 Sites 删除 `STITCH_API_KEY`。

## 安全与可观测性

- Site 与执行器之间使用带时间戳的 HMAC-SHA256；Cloud Tasks 使用 OIDC。
- 查询任务还必须携带每个任务独立的只读 token，Firestore 只存 token 哈希。
- GCS HTML 私有保存，不生成公开 URL；由执行器读取后经 Site 返回。
- 前端显示真实阶段和耗时，不伪造百分比；最长等待 10 分钟，记录仍可在刷新后恢复。
