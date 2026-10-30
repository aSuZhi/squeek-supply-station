# 轮次补给站接口与联调手册

版本2.0，规则 `ss-2.0.0`。旧 `MockApi`、pot、holder 接口不再属于本期。

## 快速启动

在仓库根目录：

```powershell
npm install
npm start
```

访问 `http://localhost:8080`。同一个进程提供前端和 API，无需第二个端口。没有 `.env` 也可以练习、加载真实赛题、签名登录、验证和排名。后端首次运行创建 data/squeek.sqlite，不预置分数。

可选复制 `.env.example` 为 `.env` 后设置配置。独立静态托管时在 app.js 之前注入 `window.SQUEEK_DROP_CONFIG={apiBase:'https://你的API域名'}`，并在后端 CORS_ORIGINS 配置该前端来源。不要将服务端环境文件复制到前端。

## 接口

| 方法与路径 | 身份 | 响应或用途 |
|---|---|---|
| GET /healthz | 无 | 服务与规则版本 |
| GET /v1/config | 无 | rulesVersion、chainId、contracts.board、signer、confirmations、attestationConfigured |
| POST /v1/auth/nonce | 无 | `{address}` → `{message}` |
| POST /v1/auth/verify | 无 | `{address,message,signature}` → `{token,address}` |
| GET /v1/me | JWT | 当前地址 |
| GET /v1/challenges/today | 无 | 发布/读取当天完整挑战 |
| GET /v1/challenges/:id | 无 | challengeId 或已发布 UTC 日期 |
| POST /v1/runs | JWT可选 | `{mode:'daily',challengeId,clientRulesVersion}` → `{runId,runToken,challenge,ranked,startedAt,expiresAt}` |
| POST /v1/runs/:id/finish | 原身份 | `{inputs,endTick,clientSummary}` → `{status,reason,summary,ranked,rank?,isNewBest?}` |
| GET /v1/runs/:id | 原身份 | 状态、保存结果、pinStatus、txHash |
| GET /v1/leaderboards/:id | JWT可选 | today 或已发布日期/challengeId → entries、me |
| GET /v1/proofs/:id | 无 | 仅已登录验证成绩：玩家、配置、来源、输入、结果、存证状态 |
| POST /v1/runs/:id/attestation | JWT | 当前个人最佳 EIP-712 字段及65字节signature |
| POST /v1/runs/:id/pin | JWT | `{txHash}` → `{status:'pending'|'confirmed',blockNumber?}`；不匹配交易400 |

JWT 请求头为 Authorization: Bearer token。匿名局后续请求使用 x-run-token，且不带无关钱包 JWT。客户端 JWT 存于 sessionStorage；钱包切换地址/网络时清除登录。刷新后检查当前钱包是否匹配 JWT。

## 挑战配置

```json
{
  "challengeId":"0x…", "day":"2026-10-30", "configHash":"0x…",
  "config": {
    "rulesVersion":"ss-2.0.0", "seed":"0x…", "durationTicks":10800,
    "phases":[
      {"index":0,"weather":"NAP","targetLevel":3,"quota":2,"reward":120,"startTick":0,"endTick":3600,"roundLabel":"…"}
    ]
  },
  "source":{"core":"0x…","chainId":11155111,"safeThroughBlock":"…","records":[]},
  "publishedAt":"…", "closesAt":"…"
}
```

上例为字段说明，实际 phases 始终三项。赛题来源及完整输入都可从真实响应检查，不需要前端构造虚假数据。

## 错误与恢复

- 401 auth_required：清除过期登录，连接原钱包重签；不能换地址接管旧局。
- 409 challenge_changed / rules_version_mismatch：重载赛题或刷新页面。
- 400 invalid_input / invalid_replay：请求格式错误，不进入回放。
- 200 status=rejected：业务验证失败，reason说明 too_fast、run_expired、input_rejected、input_out_of_order、inputs_after_end、summary_mismatch 等。
- 409 run_in_progress：已有同局验证请求执行中，稍后用相同日志重试。
- 已完成同日志：返回原结果；已完成不同日志：409 run_already_finished。
- 503 challenge_unavailable/source_*：不要制造随机每日赛题或展示假榜单；提供练习。
- 503 attestation_not_configured：可继续验证和排名，不能声称已上链。

客户端保存最近结算的 run、payload、result 和已发送 txHash。网络失败时重试提交；刷新后恢复结算。存证发送后立即记录hash，避免因查询回执失败反复发起交易。

## 验证顺序

1. `npm run check`：所有JS语法。
2. `npm test`：共享引擎/API及编码契约。
3. `npm run test:contracts`：Foundry合约测试。
4. `npm run test:chain`：Anvil真实交易流程，自动清理临时服务。
5. `npm start`，浏览器确认没有Demo模式，展开来源查看官方交易。
6. 匿名每日挑战操作、交付、结束；结果应“服务端回放验证通过”，但不进榜。
7. 自由练习完成应显示本地结果，无HTTP提交。
8. 真实钱包签名登录后开局；结果进入持久榜单，可查询公开proof。
9. 配置Sepolia合约和签名者后，最佳分数可申请存证；钱包发送后先pending，12确认后confirmed。
10. 390px检查任务、画布、按钮与模式标识，检查控制台。
11. Ctrl+C停止，确认8080不再监听；由使用者自行重启。

步骤8–9需要用户钱包与部署环境；本地自动测试用临时测试账户与本地合约覆盖技术流程，不代表已用用户钱包完成Sepolia交易。
